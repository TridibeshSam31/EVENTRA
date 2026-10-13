import asyncio
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, Depends, Header, Query, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from starlette.background import BackgroundTask

from app.api.dependencies import get_current_user_id, get_db_session
from app.core.event_access import verify_event_access
from app.core.exceptions import ConflictException, NotFoundException
from app.core.serialization import eventra_json_dumps
from app.models.agent_run import AgentRun
from app.schemas.agent import (
    AgentRunRequest,
    AgentRunResponse,
    AgentRunRecordResponse,
    AgentRunListResponse,
    AgentRunEventListResponse,
    AgentRunSnapshotResponse,
)
from app.agent.agent import EventOperationsAgent
from app.agent.tools.registry import get_agent_tool_registry
from app.services.agent_run_events import (
    RUN_EVENT_BROKER_TYPE,
    TERMINAL_RUN_STATUSES,
    AgentRunEventRecorder,
    list_run_events,
    parse_cursor,
)
from app.services.live_broker import live_broker

router = APIRouter(tags=["Event Operations Agent"])


def _verify_agent_history_access(db: Session, event_id: str, user_id: str):
    """Ensures caller has event membership access to view agent history."""
    return verify_event_access(db, event_id, user_id)


def _to_record(run: AgentRun) -> AgentRunRecordResponse:
    return AgentRunRecordResponse(
        id=run.id,
        run_id=run.run_id,
        event_id=run.event_id,
        user_id=run.user_id,
        trigger_message=run.trigger_message,
        objective=run.objective,
        status=run.status,
        termination_status=run.termination_status,
        started_at=run.started_at.isoformat() if run.started_at else None,
        completed_at=run.completed_at.isoformat() if run.completed_at else None,
        tool_history=run.tool_history,
        decision_trace=run.decision_trace,
        final_response=run.final_response,
        error=run.error,
    )


def _get_event_run(db: Session, event_id: str, run_id: str) -> AgentRun:
    """Loads a run only if it belongs to the given event (event isolation)."""
    run = (
        db.query(AgentRun)
        .filter(
            AgentRun.event_id == event_id,
            (AgentRun.run_id == run_id) | (AgentRun.id == run_id),
        )
        .first()
    )
    if not run:
        raise NotFoundException(f"Agent run '{run_id}' not found for event '{event_id}'.")
    return run


@router.get("/agent/tools", status_code=status.HTTP_200_OK)
def list_agent_tools() -> List[Dict[str, Any]]:
    """Lists all available agent tools in EVENTRA with their metadata and schemas.

    STRICT SECURITY: Exposes only safe operational metadata without secrets or credentials.
    Disabled or unsupported tools are excluded from the available tool list.
    """
    registry = get_agent_tool_registry()
    tools = registry.list_tools(available_only=True)
    return [t.to_summary_dict() for t in tools]


@router.get("/agent/events/{event_id}/tools", status_code=status.HTTP_200_OK)
def list_event_agent_tools(event_id: str) -> List[Dict[str, Any]]:
    """Contextual endpoint returning available agent tools for a specific event."""
    registry = get_agent_tool_registry()
    tools = registry.list_tools(available_only=True)
    return [t.to_summary_dict() for t in tools]


@router.post(
    "/agent/events/{event_id}/run",
    response_model=AgentRunResponse,
    status_code=status.HTTP_200_OK,
)
@router.post(
    "/events/{event_id}/agent/runs",
    response_model=AgentRunResponse,
    status_code=status.HTTP_200_OK,
)
def run_agent_endpoint(
    event_id: str,
    payload: AgentRunRequest,
    db: Session = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user_id),
):
    """Executes the Event Operations Agent loop for a live event."""
    verify_event_access(db, event_id, current_user_id)
    agent = EventOperationsAgent(db)
    result = agent.run(
        event_id=event_id,
        message=payload.message or payload.input or "",
        user_id=current_user_id,
        approval_id=payload.approval_id,
        objective=payload.objective,
        max_steps=payload.max_steps or 12,
    )
    return result


@router.get(
    "/events/{event_id}/agent/runs",
    response_model=AgentRunListResponse,
    status_code=status.HTTP_200_OK,
)
def list_agent_runs_endpoint(
    event_id: str,
    status: Optional[str] = Query(None, description="Filter by status (e.g. COMPLETED, FAILED)"),
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user_id),
):
    """Authoritative persistent agent run history query endpoint (B10)."""
    _verify_agent_history_access(db, event_id, current_user_id)
    query = db.query(AgentRun).filter(AgentRun.event_id == event_id)
    if status:
        query = query.filter(AgentRun.status == status)

    total = query.count()
    runs = query.order_by(AgentRun.started_at.desc()).offset(offset).limit(limit).all()

    items = [_to_record(r) for r in runs]

    return AgentRunListResponse(
        total=total,
        items=items,
        limit=limit,
        offset=offset,
    )


@router.get(
    "/events/{event_id}/agent/runs/current",
    response_model=AgentRunSnapshotResponse,
    status_code=status.HTTP_200_OK,
)
def get_current_agent_run_endpoint(
    event_id: str,
    db: Session = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user_id),
):
    """Latest agent run for the event plus its persisted progress events.

    Clients call this on load/refresh to reconstruct agent state from the
    backend, then subscribe to the run stream from `last_sequence`.
    """
    verify_event_access(db, event_id, current_user_id)
    run = (
        db.query(AgentRun)
        .filter(AgentRun.event_id == event_id)
        .order_by(AgentRun.started_at.desc())
        .first()
    )
    if not run:
        return AgentRunSnapshotResponse(run=None, events=[], last_sequence=0)
    events = list_run_events(db, run.run_id)
    return AgentRunSnapshotResponse(
        run=_to_record(run),
        events=events,
        last_sequence=events[-1]["sequence"] if events else 0,
    )


@router.get(
    "/events/{event_id}/agent/runs/{run_id}/events",
    response_model=AgentRunEventListResponse,
    status_code=status.HTTP_200_OK,
)
def list_agent_run_events_endpoint(
    event_id: str,
    run_id: str,
    after: int = Query(0, ge=0, description="Return events with sequence greater than this cursor"),
    limit: int = Query(500, ge=1, le=1000),
    db: Session = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user_id),
):
    """Replays persisted progress events for a run, ordered by sequence."""
    verify_event_access(db, event_id, current_user_id)
    run = _get_event_run(db, event_id, run_id)
    items = list_run_events(db, run.run_id, after=after, limit=limit)
    return AgentRunEventListResponse(
        run_id=run.run_id,
        run_status=run.status,
        items=items,
        last_sequence=items[-1]["sequence"] if items else after,
    )


# Event types after which nothing further is emitted for a run.
_TERMINAL_EVENT_TYPES = {"agent.run_completed", "agent.run_failed", "agent.run_cancelled", "agent.run_paused"}


def _sse_frame(envelope: Dict[str, Any]) -> str:
    return f"id: {envelope['id']}\nevent: {envelope['type']}\ndata: {eventra_json_dumps(envelope)}\n\n"


@router.get("/events/{event_id}/agent/runs/{run_id}/stream")
async def stream_agent_run_events_endpoint(
    event_id: str,
    run_id: str,
    after: Optional[int] = Query(None, ge=0, description="Resume after this sequence (Last-Event-ID wins)"),
    max_frames: Optional[int] = Query(None, ge=1, description="Cap on run-event frames (tests/controlled streaming)"),
    last_event_id: Optional[str] = Header(default=None, alias="Last-Event-ID"),
    db: Session = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user_id),
):
    """Server-Sent Events stream of a run's progress.

    Authenticated with the same identity header as every other endpoint, so
    clients use a fetch-based SSE reader rather than `EventSource`. The stream
    subscribes to live events first, then replays persisted events after the
    cursor, then forwards live events not already replayed. It closes once the
    run has reached a terminal status.
    """
    verify_event_access(db, event_id, current_user_id)
    run = _get_event_run(db, event_id, run_id)
    canonical_run_id = run.run_id
    run_status = run.status
    cursor = parse_cursor(last_event_id) if last_event_id else (after or 0)

    # Subscribe before replaying so no event falls between replay and live delivery.
    queue = await live_broker.subscribe(event_id)
    replay = list_run_events(db, canonical_run_id, after=cursor, limit=1000)
    run_is_terminal = run_status in TERMINAL_RUN_STATUSES

    unsubscribed = False

    async def _unsubscribe():
        nonlocal unsubscribed
        if not unsubscribed:
            unsubscribed = True
            await live_broker.unsubscribe(event_id, queue)

    async def event_generator():
        last_sent = cursor
        frames = 0
        try:
            hello = eventra_json_dumps({"run_id": canonical_run_id, "run_status": run_status, "cursor": cursor})
            yield f"event: connected\ndata: {hello}\n\n"
            for envelope in replay:
                yield _sse_frame(envelope)
                last_sent = envelope["sequence"]
                frames += 1
                if envelope["type"] in _TERMINAL_EVENT_TYPES or (max_frames and frames >= max_frames):
                    return
            if run_is_terminal:
                return

            while True:
                try:
                    message = await asyncio.wait_for(queue.get(), timeout=15.0)
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"
                    continue
                if message.get("type") != RUN_EVENT_BROKER_TYPE or message.get("run_id") != canonical_run_id:
                    continue
                envelope = message.get("run_event") or {}
                if envelope.get("sequence", 0) <= last_sent:
                    continue  # already delivered by replay
                yield _sse_frame(envelope)
                last_sent = envelope["sequence"]
                frames += 1
                if envelope.get("type") in _TERMINAL_EVENT_TYPES or (max_frames and frames >= max_frames):
                    return
        except asyncio.CancelledError:
            pass
        finally:
            await _unsubscribe()

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
        background=BackgroundTask(_unsubscribe),
    )


@router.post(
    "/events/{event_id}/agent/runs/{run_id}/cancel",
    response_model=AgentRunRecordResponse,
    status_code=status.HTTP_200_OK,
)
def cancel_agent_run_endpoint(
    event_id: str,
    run_id: str,
    db: Session = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user_id),
):
    """Requests cooperative cancellation of an executing run.

    The worker stops at its next execution boundary and records
    `agent.run_cancelled`. Runs that are not executing cannot be cancelled.
    """
    verify_event_access(db, event_id, current_user_id)
    run = _get_event_run(db, event_id, run_id)
    updated = (
        db.query(AgentRun)
        .filter(AgentRun.id == run.id, AgentRun.status.in_(("RUNNING", "INITIALIZED", "DISCOVERING")))
        .update({AgentRun.status: "CANCELLING"}, synchronize_session=False)
    )
    db.commit()
    db.refresh(run)
    if not updated:
        if run.status == "CANCELLING":
            return _to_record(run)
        raise ConflictException(f"Agent run '{run.run_id}' is not executing (status {run.status}).")
    AgentRunEventRecorder(db).record(
        run.run_id, event_id, "agent.cancel_requested", {"status": "CANCELLING", "requested_by": current_user_id},
    )
    return _to_record(run)


@router.get(
    "/events/{event_id}/agent/runs/{run_id}",
    response_model=AgentRunRecordResponse,
    status_code=status.HTTP_200_OK,
)
def get_agent_run_endpoint(
    event_id: str,
    run_id: str,
    db: Session = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user_id),
):
    """Retrieves authoritative details of a specific persistent agent run (B10)."""
    _verify_agent_history_access(db, event_id, current_user_id)
    return _to_record(_get_event_run(db, event_id, run_id))
