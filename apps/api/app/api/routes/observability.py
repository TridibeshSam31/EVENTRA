"""API Endpoints: Observability (Audit, Activity Feed, Decision Traces, State History)"""
from typing import List, Optional
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user_id, get_db_session
from app.core.exceptions import ForbiddenException, NotFoundException
from app.models.event import Event
from app.models.event_member import EventMember
from app.observability.activity import ActivityHistoryService
from app.observability.audit import AuditRecorder
from app.observability.decision_trace import DecisionTraceService
from app.observability.state_history import StateHistoryService
from app.schemas.observability import (
    ActivityListResponse,
    AuditListResponse,
    DecisionTraceResponse,
    StateHistoryResponse,
)

router = APIRouter(prefix="/events/{event_id}", tags=["Observability"])


def _verify_observability_access(db: Session, event_id: str, user_id: str):
    """Ensures caller has event membership access to view operational history."""
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
        raise ForbiddenException(f"User '{user_id}' is not authorized to inspect audit logs for event '{event_id}'.")
    return event


@router.get("/audit", response_model=AuditListResponse)
def get_audit_trail_endpoint(
    event_id: str,
    action_type: Optional[str] = Query(None, description="Filter by action type"),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user_id),
):
    """Retrieves immutable audit records for an event."""
    _verify_observability_access(db, event_id, current_user_id)
    recorder = AuditRecorder(db)
    items = recorder.list_records(event_id=event_id, action_type=action_type, limit=limit)
    return AuditListResponse(total=len(items), items=items)


@router.get("/activity", response_model=ActivityListResponse)
def get_activity_feed_endpoint(
    event_id: str,
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user_id),
):
    """Retrieves human-readable operational activity streams synthesized from backend events."""
    _verify_observability_access(db, event_id, current_user_id)
    service = ActivityHistoryService(db)
    items = service.get_activity_feed(event_id=event_id, limit=limit)
    return ActivityListResponse(total=len(items), items=items)


@router.get("/decision-trace", response_model=List[DecisionTraceResponse])
def get_decision_traces_endpoint(
    event_id: str,
    verification_id: Optional[str] = Query(None, description="Filter by verification ID"),
    limit: int = Query(10, ge=1, le=50),
    db: Session = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user_id),
):
    """Retrieves factual, structured operational decision traces (NO chain-of-thought)."""
    _verify_observability_access(db, event_id, current_user_id)
    service = DecisionTraceService(db)
    if verification_id:
        trace = service.get_trace_by_verification_id(event_id=event_id, verification_id=verification_id)
        return [trace] if trace else []
    return service.get_traces_for_event(event_id=event_id, limit=limit)


@router.get("/state-history", response_model=StateHistoryResponse)
def get_state_history_endpoint(
    event_id: str,
    entity_type: Optional[str] = Query(None, description="Filter by entity type (EVENT, TASK, etc.)"),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user_id),
):
    """Retrieves immutable append-only state transition records for an event."""
    _verify_observability_access(db, event_id, current_user_id)
    service = StateHistoryService(db)
    items = service.get_state_history(event_id=event_id, entity_type=entity_type, limit=limit)
    return StateHistoryResponse(total=len(items), items=items)


from app.schemas.activity_log import EventActivityStreamResponse, EventActivityLogResponse
from app.services.activity_log_service import ActivityLogService


@router.get("/activity-stream", response_model=EventActivityStreamResponse)
def get_activity_stream_endpoint(
    event_id: str,
    category: Optional[str] = Query(None, description="Filter by category (discovery, engagement, incident, approval, execution)"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user_id),
) -> EventActivityStreamResponse:
    """Retrieves normalized cross-lifecycle activity stream entries (Part A.4)."""
    _verify_observability_access(db, event_id, current_user_id)
    service = ActivityLogService(db)
    items = service.get_stream(event_id=event_id, category=category, limit=limit, offset=offset)
    total = service.count(event_id=event_id, category=category)
    return EventActivityStreamResponse(
        total=total,
        items=[EventActivityLogResponse.model_validate(item) for item in items],
    )
