"""Late-task → DELAY incident sweeper (UX v3 contract §6).

For events that are running (LIVE / INCIDENT / EMERGENCY), a task with an assigned
vendor that is later than ``settings.LATE_TASK_INCIDENT_MINUTES`` against its plan
(not started after planned_start, or not finished after planned_end) raises ONE
VENDOR_DELAY incident linked to the task, through the normal IncidentService pipeline
(impact + risk + event-state transitions).

Idempotent: a task never gets a second sweeper incident, whatever the first one's
status — once the organizer has seen/resolved it we don't keep re-raising it.
"""
import asyncio
import logging
from datetime import datetime, timedelta, timezone
from typing import List, Optional, Tuple

from sqlalchemy.orm import Session

from app.core.config import settings

logger = logging.getLogger("eventra.late_task")

SWEEPER_SOURCE = "LATE_TASK_DETECTION"
RUNNING_LIFECYCLES = ("LIVE", "INCIDENT", "EMERGENCY")
DONE_STATUSES = ("COMPLETED", "CANCELLED", "SKIPPED")


def _now() -> datetime:
    # Matches the naive-UTC convention used by the models.
    return datetime.now(timezone.utc).replace(tzinfo=None)


async def run_late_task_loop() -> None:
    while True:
        try:
            await asyncio.to_thread(sweep_once)
        except Exception as exc:
            logger.warning("Late-task sweep failed: %s", exc)
        await asyncio.sleep(settings.LATE_TASK_SWEEPER_INTERVAL_SECONDS)


def lateness(task, now: datetime, threshold_minutes: int) -> Optional[Tuple[str, int]]:
    """Return ("start" | "finish", minutes_late) when the task is late beyond the threshold."""
    if (task.status or "").upper() in DONE_STATUSES:
        return None
    threshold = timedelta(minutes=threshold_minutes)
    if task.planned_start and task.actual_start is None and now > task.planned_start + threshold:
        return "start", int((now - task.planned_start).total_seconds() // 60)
    if task.planned_end and task.actual_end is None and now > task.planned_end + threshold:
        return "finish", int((now - task.planned_end).total_seconds() // 60)
    return None


def sweep_event(db: Session, event, now: Optional[datetime] = None) -> int:
    """Raise DELAY incidents for late, vendor-assigned tasks of one event. Returns count created."""
    from app.models.incident import Incident
    from app.models.task import Task
    from app.models.vendor import Vendor
    from app.models.enums import IncidentSeverity, IncidentType
    from app.schemas.incident import IncidentCreate
    from app.services.incident_service import IncidentService

    now = now or _now()
    threshold = int(settings.LATE_TASK_INCIDENT_MINUTES)
    tasks: List[Task] = (
        db.query(Task)
        .filter(Task.event_id == event.id, Task.provider_id.isnot(None))
        .all()
    )
    created = 0
    for task in tasks:
        late = lateness(task, now, threshold)
        if not late:
            continue
        already = (
            db.query(Incident.id)
            .filter(
                Incident.event_id == event.id,
                Incident.related_task_id == task.id,
                Incident.source == SWEEPER_SOURCE,
            )
            .first()
        )
        if already:
            continue

        kind, minutes = late
        vendor = db.query(Vendor).filter(Vendor.id == task.provider_id).first()
        vendor_name = vendor.name if vendor else "Assigned vendor"
        verb = "hasn't started" if kind == "start" else "hasn't finished"
        severity = IncidentSeverity.HIGH if task.is_critical_path else IncidentSeverity.MEDIUM
        try:
            IncidentService(db).create_incident(
                event_id=event.id,
                data=IncidentCreate(
                    incident_type=IncidentType.VENDOR_DELAY,
                    severity=severity,
                    title=f"Running late: {task.name}"[:255],
                    description=(
                        f"'{task.name}' ({vendor_name}) {verb} — {minutes} min behind plan."
                    ),
                    source=SWEEPER_SOURCE,
                    related_task_id=task.id,
                    related_vendor_id=task.provider_id,
                    evidence_metadata={
                        "delay_minutes": minutes,
                        "late_kind": kind,
                        "planned_start": task.planned_start.isoformat() if task.planned_start else None,
                        "planned_end": task.planned_end.isoformat() if task.planned_end else None,
                        "threshold_minutes": threshold,
                        "detected_by": "late_task_sweeper",
                    },
                ),
                current_user_id="system",
            )
            created += 1
        except Exception as exc:  # one bad task must not stop the sweep
            db.rollback()
            logger.warning("Could not raise late-task incident for task %s: %s", task.id, exc)
    return created


def sweep_once() -> int:
    """Scan running events once. Returns the number of incidents created."""
    from app.db.session import SessionLocal
    from app.models.event import Event

    created = 0
    with SessionLocal() as db:
        events = db.query(Event).filter(Event.lifecycle_state.in_(RUNNING_LIFECYCLES)).all()
        for event in events:
            created += sweep_event(db, event)
    if created:
        logger.info("Late-task sweep raised %d incident(s).", created)
    return created
