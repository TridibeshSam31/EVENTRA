from typing import Any, Dict, List, Optional
from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user_id, get_db_session
from app.core.exceptions import NotFoundException, ForbiddenException
from app.models.event import Event
from app.models.event_member import EventMember
from app.models.agent_run import AgentRun
from app.schemas.agent import (
    AgentRunRequest,
    AgentRunResponse,
    AgentRunRecordResponse,
    AgentRunListResponse,
)
from app.agent.agent import EventOperationsAgent
from app.agent.tools.registry import get_agent_tool_registry

router = APIRouter(tags=["Event Operations Agent"])


def _verify_agent_history_access(db: Session, event_id: str, user_id: str):
    """Ensures caller has event membership access to view agent history."""
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise NotFoundException(f"Event '{event_id}' not found.")

    if user_id in ("anonymous_operator", "system", "SYSTEM"):
        return event

    if event.owner_id == user_id:
        return event

    member = (
        db.query(EventMember)
        .filter(EventMember.event_id == event_id, EventMember.user_id == user_id)
        .first()
    )
    if not member:
        raise ForbiddenException(f"User '{user_id}' is not authorized to inspect agent runs for event '{event_id}'.")
    return event


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

    items = []
    for r in runs:
        items.append(
            AgentRunRecordResponse(
                id=r.id,
                run_id=r.run_id,
                event_id=r.event_id,
                user_id=r.user_id,
                trigger_message=r.trigger_message,
                objective=r.objective,
                status=r.status,
                termination_status=r.termination_status,
                started_at=r.started_at.isoformat() if r.started_at else None,
                completed_at=r.completed_at.isoformat() if r.completed_at else None,
                tool_history=r.tool_history,
                decision_trace=r.decision_trace,
                final_response=r.final_response,
                error=r.error,
            )
        )

    return AgentRunListResponse(
        total=total,
        items=items,
        limit=limit,
        offset=offset,
    )


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
