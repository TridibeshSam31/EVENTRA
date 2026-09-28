"""API Routes: Discovery Runs & Live Funnel Telemetry (Part A.1)

Provides endpoints to inspect persisted, pollable/streamable agentic discovery runs
and their step-by-step event logs.
"""
from typing import List, Optional
from datetime import datetime
from pydantic import BaseModel, Field
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
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


class StartDiscoveryRequest(BaseModel):
    category: str = Field(..., description="Provider category (e.g. CATERING, VENUE, PHOTOGRAPHY)")
    radius_km: Optional[float] = Field(10.0, description="Search radius in kilometers")
    target_count: Optional[int] = Field(5, description="Target candidate count")


def run_background_category_discovery(
    event_id: str,
    category: str,
    run_id: str,
    radius_km: float = 10.0,
    target_count: int = 5,
):
    import logging
    from app.db.session import SessionLocal
    from app.services.agentic_discovery_controller import AgenticDiscoveryController
    from app.services.live_broker import live_broker
    from app.models.event import Event
    from app.models.discovery_run import DiscoveryRun

    logger = logging.getLogger(__name__)
    db = SessionLocal()
    try:
        event = db.query(Event).filter(Event.id == event_id).first()
        loc = (event.location if event else "Delhi") or "Delhi"
        pax = (event.guest_count if event else 100) or 100
        budget = float(event.total_budget) if event and event.total_budget else None

        live_broker.publish_sync(
            event_id,
            {
                "type": "discovery.started",
                "event_id": event_id,
                "run_id": run_id,
                "category": category,
            },
        )

        controller = AgenticDiscoveryController(db=db, max_iterations=2, target_count=target_count)
        result = controller.execute_discovery(
            event_id=event_id,
            category=category,
            location=loc,
            guest_count=pax,
            max_budget=budget,
            base_radius_km=radius_km,
            run_id=run_id,
            simulate_outreach=False,
        )

        live_broker.publish_sync(
            event_id,
            {
                "type": "discovery.completed",
                "event_id": event_id,
                "run_id": run_id,
                "category": category,
                "target_met": result.target_count_met,
                "total_matching": len(result.top_matches) + len(result.other_available_options),
            },
        )
    except Exception as exc:
        logger.error(f"Discovery background run {run_id} failed: {exc}", exc_info=True)
        try:
            run = db.query(DiscoveryRun).filter(DiscoveryRun.id == run_id).first()
            if run:
                run.status = "FAILED"
                run.summary = str(exc)
                db.commit()
            live_broker.publish_sync(
                event_id,
                {
                    "type": "discovery.failed",
                    "event_id": event_id,
                    "run_id": run_id,
                    "category": category,
                    "error": str(exc),
                },
            )
        except Exception:
            pass
    finally:
        db.close()


@router.post(
    "/{event_id}/discovery/start",
    status_code=status.HTTP_200_OK,
)
def start_category_discovery(
    event_id: str,
    payload: StartDiscoveryRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db_session),
):
    """Starts targeted provider discovery for a specific category without launching full event operations."""
    import uuid
    from app.models.event import Event

    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Event '{event_id}' not found.",
        )

    cat = payload.category.upper()

    # Idempotency / Concurrency protection: Check if an active DiscoveryRun is already running
    active_run = (
        db.query(DiscoveryRun)
        .filter(
            DiscoveryRun.event_id == event_id,
            DiscoveryRun.category == cat,
            DiscoveryRun.status == "RUNNING",
        )
        .first()
    )
    if active_run:
        return {
            "status": "ALREADY_RUNNING",
            "message": f"Discovery run is already active for category '{cat}'.",
            "run_id": active_run.id,
            "category": cat,
        }

    run_id = f"run_{uuid.uuid4().hex[:12]}"
    run = DiscoveryRun(
        id=run_id,
        event_id=event_id,
        category=cat,
        status="RUNNING",
        trigger="manual",
        current_iteration=1,
        max_iterations=2,
        radius_km=payload.radius_km or 10.0,
        target_count=payload.target_count or 5,
        parameters={
            "location": event.location or "Delhi",
            "guest_count": event.guest_count or 100,
        },
    )
    db.add(run)
    db.commit()
    db.refresh(run)

    background_tasks.add_task(
        run_background_category_discovery,
        event_id=event_id,
        category=cat,
        run_id=run.id,
        radius_km=payload.radius_km or 10.0,
        target_count=payload.target_count or 5,
    )

    return {
        "status": "STARTED",
        "message": f"Discovery initiated for category '{cat}'.",
        "run_id": run.id,
        "category": cat,
    }

