"""API Route: Incident Detection, Impact Analysis, and Risk Engine Endpoints"""
from typing import Optional, Dict, Any
from fastapi import APIRouter, Depends, Query, status, BackgroundTasks
from sqlalchemy.orm import Session

from app.api.dependencies import get_db_session, get_current_user_id
from app.services.incident_service import IncidentService
from app.agent.triggers import trigger_agent_run
from app.schemas.incident import (
    IncidentCreate,
    IncidentResponse,
    IncidentListResponse,
    IncidentResolveRequest,
    ImpactResultResponse,
    RiskResultResponse,
)

router = APIRouter(prefix="/events", tags=["incidents"])


@router.post(
    "/{event_id}/incidents",
    response_model=IncidentResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_incident(
    event_id: str,
    payload: IncidentCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user_id),
) -> IncidentResponse:
    """Ingest, normalize, evaluate deterministic impact and risk, and transition event state."""
    service = IncidentService(db)
    incident = service.create_incident(event_id, payload, current_user_id=current_user_id)
    background_tasks.add_task(
        trigger_agent_run,
        event_id=event_id,
        message=f"Incident reported: {incident.title}. {incident.description or ''}".strip(),
        user_id=current_user_id,
    )
    return IncidentResponse.model_validate(incident)


@router.get(
    "/{event_id}/incidents",
    response_model=IncidentListResponse,
)
def list_incidents(
    event_id: str,
    status: Optional[str] = Query(None, description="Filter by status (OPEN, INVESTIGATING, RESOLVED, etc.)"),
    incident_type: Optional[str] = Query(None, description="Filter by incident type"),
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user_id),
) -> IncidentListResponse:
    """List incidents for an event with deterministic pagination and ordering."""
    service = IncidentService(db)
    items, total = service.list_incidents(
        event_id, status=status, incident_type=incident_type, limit=limit, offset=offset, current_user_id=current_user_id
    )
    return IncidentListResponse(
        total=total,
        items=[IncidentResponse.model_validate(i) for i in items],
        limit=limit,
        offset=offset,
    )


@router.get(
    "/{event_id}/incidents/{incident_id}",
    response_model=IncidentResponse,
)
def get_incident(
    event_id: str,
    incident_id: str,
    db: Session = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user_id),
) -> IncidentResponse:
    """Retrieve single incident record including impact and risk results."""
    service = IncidentService(db)
    incident = service.get_incident(event_id, incident_id, current_user_id=current_user_id)
    return IncidentResponse.model_validate(incident)


@router.get(
    "/{event_id}/incidents/{incident_id}/impact",
    response_model=Dict[str, Any],
)
def get_incident_impact(
    event_id: str,
    incident_id: str,
    db: Session = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user_id),
) -> Dict[str, Any]:
    """Retrieve structured impact analysis result for an incident."""
    service = IncidentService(db)
    incident = service.get_incident(event_id, incident_id, current_user_id=current_user_id)
    return incident.impact_result or {}


@router.get(
    "/{event_id}/incidents/{incident_id}/risk",
    response_model=Dict[str, Any],
)
def get_incident_risk(
    event_id: str,
    incident_id: str,
    db: Session = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user_id),
) -> Dict[str, Any]:
    """Retrieve structured operational risk result for an incident."""
    service = IncidentService(db)
    incident = service.get_incident(event_id, incident_id, current_user_id=current_user_id)
    return incident.risk_result or {}


@router.post(
    "/{event_id}/incidents/{incident_id}/recalculate",
    response_model=IncidentResponse,
)
def recalculate_incident(
    event_id: str,
    incident_id: str,
    db: Session = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user_id),
) -> IncidentResponse:
    """Deterministically recalculate impact and risk against the current live event state."""
    service = IncidentService(db)
    incident = service.recalculate_incident(event_id, incident_id, current_user_id=current_user_id)
    return IncidentResponse.model_validate(incident)


@router.post(
    "/{event_id}/incidents/{incident_id}/resolve",
    response_model=IncidentResponse,
)
def resolve_incident(
    event_id: str,
    incident_id: str,
    payload: IncidentResolveRequest = IncidentResolveRequest(),
    db: Session = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user_id),
) -> IncidentResponse:
    """Resolve an incident and re-evaluate event operational state."""
    service = IncidentService(db)
    incident = service.resolve_incident(
        event_id, incident_id, resolution_notes=payload.resolution_notes, current_user_id=current_user_id
    )
    return IncidentResponse.model_validate(incident)
