"""API Route: Live State Engine Endpoints"""
import asyncio
import hashlib
import json
from typing import List, Optional
from fastapi import APIRouter, Depends, Query, Response, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user_id, get_db_session
from app.services.live_state_service import LiveStateService
from app.services.live_broker import live_broker
from app.core.serialization import eventra_json_dumps
from app.schemas.live_state import (
    EventLiveState,
    GoLiveRequest,
    TaskStatusUpdate,
    ConcludeRequest,
    ProviderOperationalSummary,
)
from app.schemas.task import TaskResponse, TaskVerificationUpdateRequest

router = APIRouter(prefix="/events", tags=["live"])


@router.post("/{event_id}/go-live", response_model=EventLiveState)
def go_live(
    event_id: str,
    payload: GoLiveRequest = GoLiveRequest(),
    db: Session = Depends(get_db_session),
) -> EventLiveState:
    """Transition an event from PLANNED to LIVE.

    Validates readiness preconditions, transitions lifecycle state,
    and activates initial tasks.
    """
    service = LiveStateService(db)
    return service.go_live(event_id, reason=payload.reason)


@router.get("/{event_id}/live-state", response_model=EventLiveState)
def get_live_state(
    event_id: str,
    db: Session = Depends(get_db_session),
) -> EventLiveState:
    """Get aggregated live operational state snapshot.

    Returns task progress, schedule deviations, budget variance,
    and overall event status.
    """
    service = LiveStateService(db)
    return service.get_live_state(event_id)


@router.get("/{event_id}/providers/live-state", response_model=ProviderOperationalSummary)
def get_providers_live_state(
    event_id: str,
    db: Session = Depends(get_db_session),
) -> ProviderOperationalSummary:
    """Get live provider operations state snapshot including confirmations and commitments."""
    service = LiveStateService(db)
    return service.get_provider_live_state(event_id)


@router.put("/{event_id}/tasks/{task_id}/status", response_model=TaskResponse)
def update_task_status(
    event_id: str,
    task_id: str,
    payload: TaskStatusUpdate,
    db: Session = Depends(get_db_session),
) -> TaskResponse:
    """Update a task's status during live event operations.

    Validates status transitions and propagates readiness to downstream tasks.
    """
    service = LiveStateService(db)
    task = service.update_task_status(
        event_id=event_id,
        task_id=task_id,
        new_status=payload.status,
        actual_start=payload.actual_start,
        actual_end=payload.actual_end,
    )
    return TaskResponse.model_validate(task)


@router.post("/{event_id}/conclude", response_model=EventLiveState)
def conclude_event(
    event_id: str,
    payload: ConcludeRequest = ConcludeRequest(),
    db: Session = Depends(get_db_session),
) -> EventLiveState:
    """Transition an event from LIVE to CONCLUDED.

    Validates that no tasks are in active status before concluding.
    """
    service = LiveStateService(db)
    service.conclude_event(event_id, reason=payload.reason)
    return service.get_live_state(event_id)


import logging
from app.services.autonomous_operations_service import AutonomousOperationsService

logger = logging.getLogger(__name__)


@router.get("/{event_id}/live-stream")
async def live_stream(
    event_id: str,
    max_frames: Optional[int] = Query(None, description="Cap on SSE frames for controlled streaming"),
    db: Session = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user_id),
):
    """Authoritative Server-Sent Events (SSE) live push stream (B5).
    
    Streams real-time operational state mutations to authorized subscribers.
    Emits an initial connection frame containing the authoritative operations snapshot
    followed by live agent, discovery, shortlist, task, and incident updates.
    """
    service = LiveStateService(db)
    initial_state = service.get_live_state(event_id)

    ops_service = AutonomousOperationsService(db)
    try:
        ops_snapshot = ops_service.get_operations_status(event_id)
    except Exception as exc:
        logger.warning(f"Could not load operations snapshot for event {event_id}: {exc}")
        ops_snapshot = None

    async def event_generator():
        queue = await live_broker.subscribe(event_id)
        frames_sent = 0
        try:
            init_data = eventra_json_dumps({
                "type": "CONNECTED",
                "event_id": event_id,
                "state": initial_state.model_dump(mode="json"),
                "snapshot": ops_snapshot,
            })
            yield f"event: connected\ndata: {init_data}\n\n"
            frames_sent += 1
            if max_frames and frames_sent >= max_frames:
                return

            while True:
                try:
                    message = await asyncio.wait_for(queue.get(), timeout=15.0)
                    msg_type = message.get("type", "update")
                    payload = eventra_json_dumps(message)
                    yield f"event: {msg_type}\ndata: {payload}\n\n"
                    frames_sent += 1
                    if max_frames and frames_sent >= max_frames:
                        return
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"
        except asyncio.CancelledError:
            pass
        finally:
            await live_broker.unsubscribe(event_id, queue)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/{event_id}/live-changes")
def get_live_changes(
    event_id: str,
    response: Response,
    since_version: Optional[str] = Query(None, description="Client's last known state version"),
    db: Session = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user_id),
):
    """Authoritative change-feed and conditional polling endpoint (B5).
    
    Computes a deterministic operational version hash. If state matches since_version,
    returns has_changes=False with matching ETag without transmitting redundant payload.
    """
    service = LiveStateService(db)
    state = service.get_live_state(event_id)
    raw = f"{state.lifecycle_state}:{state.completed_tasks}:{state.total_tasks}:{state.event_type}"
    current_version = hashlib.sha256(raw.encode()).hexdigest()[:16]
    response.headers["ETag"] = f'"{current_version}"'

    if since_version and since_version == current_version:
        return {"has_changes": False, "version": current_version, "state": None}
    return {"has_changes": True, "version": current_version, "state": state}


@router.patch("/{event_id}/tasks/{task_id}/verification", response_model=TaskResponse)
def update_task_verification_endpoint(
    event_id: str,
    task_id: str,
    payload: TaskVerificationUpdateRequest,
    db: Session = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user_id),
) -> TaskResponse:
    """Authoritatively updates the individual verification state of an operational task (B6).
    
    Supports: PENDING, IN_PROGRESS, EXECUTED, VERIFYING, VERIFIED, FAILED, UNKNOWN.
    'Executed' never automatically implies 'Verified'.
    """
    service = LiveStateService(db)
    task = service.update_task_verification(
        event_id=event_id,
        task_id=task_id,
        new_verification_status=payload.verification_status,
        notes=payload.verification_notes,
        actor_id=current_user_id,
    )
    return TaskResponse.model_validate(task)

