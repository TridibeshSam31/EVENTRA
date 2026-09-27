"""API Routes: Discovery Runs & Live Funnel Telemetry (Part A.1)

Provides endpoints to inspect persisted, pollable/streamable agentic discovery runs
and their step-by-step event logs.
"""
from typing import List, Optional
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.api.dependencies import get_db_session
from app.models.discovery_run import DiscoveryRun, DiscoveryRunEvent
from app.schemas.discovery_run import (
    DiscoveryRunResponse,
    DiscoveryRunEventResponse,
    DiscoveryRunListResponse,
)

router = APIRouter(prefix="/events", tags=["Discovery Runs"])


@router.get(
    "/{event_id}/discovery-runs",
    response_model=DiscoveryRunListResponse,
    status_code=status.HTTP_200_OK,
)
def list_discovery_runs(
    event_id: str,
    category: Optional[str] = Query(None, description="Optional category filter (e.g. catering, venue)"),
    db: Session = Depends(get_db_session),
) -> DiscoveryRunListResponse:
    """Lists all discovery runs for an event ordered by recency."""
    query = db.query(DiscoveryRun).filter(DiscoveryRun.event_id == event_id)
    if category:
        query = query.filter(DiscoveryRun.category == category)
    runs = query.order_by(DiscoveryRun.created_at.desc()).all()

    items: List[DiscoveryRunResponse] = []
    for r in runs:
        # Fetch latest 5 events for preview
        latest_evs = (
            db.query(DiscoveryRunEvent)
            .filter(DiscoveryRunEvent.run_id == r.id)
            .order_by(DiscoveryRunEvent.timestamp.desc())
            .limit(5)
            .all()
        )
        resp = DiscoveryRunResponse.model_validate(r)
        resp.latest_events = [DiscoveryRunEventResponse.model_validate(e) for e in reversed(latest_evs)]
        items.append(resp)

    return DiscoveryRunListResponse(items=items, total=len(items))


@router.get(
    "/{event_id}/discovery-runs/{run_id}",
    response_model=DiscoveryRunResponse,
    status_code=status.HTTP_200_OK,
)
def get_discovery_run(
    event_id: str,
    run_id: str,
    db: Session = Depends(get_db_session),
) -> DiscoveryRunResponse:
    """Retrieves current DiscoveryRun funnel telemetry and recent events for polling."""
    run = db.query(DiscoveryRun).filter(
        DiscoveryRun.id == run_id,
        DiscoveryRun.event_id == event_id,
    ).first()

    if not run:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"DiscoveryRun '{run_id}' not found for event '{event_id}'.",
        )

    latest_evs = (
        db.query(DiscoveryRunEvent)
        .filter(DiscoveryRunEvent.run_id == run.id)
        .order_by(DiscoveryRunEvent.timestamp.asc())
        .all()
    )

    resp = DiscoveryRunResponse.model_validate(run)
    resp.latest_events = [DiscoveryRunEventResponse.model_validate(e) for e in latest_evs]
    return resp


@router.get(
    "/{event_id}/discovery-runs/{run_id}/events",
    response_model=List[DiscoveryRunEventResponse],
    status_code=status.HTTP_200_OK,
)
def get_discovery_run_events(
    event_id: str,
    run_id: str,
    since: Optional[datetime] = Query(None, description="ISO timestamp to poll new events since"),
    db: Session = Depends(get_db_session),
) -> List[DiscoveryRunEventResponse]:
    """Retrieves line-by-line real-time activity log events for a DiscoveryRun (pollable)."""
    query = (
        db.query(DiscoveryRunEvent)
        .join(DiscoveryRun, DiscoveryRun.id == DiscoveryRunEvent.run_id)
        .filter(
            DiscoveryRunEvent.run_id == run_id,
            DiscoveryRun.event_id == event_id,
        )
    )
    if since:
        query = query.filter(DiscoveryRunEvent.timestamp > since)

    events = query.order_by(DiscoveryRunEvent.timestamp.asc()).all()
    return [DiscoveryRunEventResponse.model_validate(e) for e in events]
