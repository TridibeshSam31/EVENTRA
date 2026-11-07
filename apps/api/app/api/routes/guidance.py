"""Readiness, next step and event report (UX v3 §2, §3, §5 — docs/contracts/ux-v3-api.md).

All three endpoints are read-only and derived from existing data.
"""
from typing import Any, Dict

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.dependencies import get_db_session
from app.core.exceptions import NotFoundException
from app.models.event import Event
from app.services.next_step_service import NextStepService
from app.services.readiness_service import ReadinessService
from app.services.report_service import ReportService

router = APIRouter(prefix="/events", tags=["guidance"])


def _load_event(db: Session, event_id: str) -> Event:
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise NotFoundException(f"Event with id '{event_id}' not found.")
    return event


@router.get("/{event_id}/readiness")
def get_event_readiness(event_id: str, db: Session = Depends(get_db_session)) -> Dict[str, Any]:
    """Checklist of the gates that decide whether the event can happen."""
    return ReadinessService(db).build(_load_event(db, event_id))


@router.get("/{event_id}/next-step")
def get_event_next_step(event_id: str, db: Session = Depends(get_db_session)) -> Dict[str, Any]:
    """The single most important thing the organizer should do now."""
    return NextStepService(db).build(_load_event(db, event_id))


@router.get("/{event_id}/report")
def get_event_report(event_id: str, db: Session = Depends(get_db_session)) -> Dict[str, Any]:
    """Post-event summary: money, vendors, problems, approvals, communication, timeline."""
    return ReportService(db).build(_load_event(db, event_id))
