"""Durable agent run progress events.

`AgentRunEventRecorder.record()` persists a structured event with a per-run
monotonically increasing sequence, then publishes it on the existing in-process
`live_broker` so connected SSE clients receive it immediately. Because every
event is persisted first, clients that connect late or reconnect replay the
missed events from the database by sequence cursor.

Callers must record events only at real execution boundaries, and only after
committing the domain state the event describes: `record()` commits the
session it is given.
"""
import json
import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.serialization import eventra_json_dumps
from app.models.agent_run import AgentRun
from app.models.agent_run_event import AgentRunEvent
from app.services.live_broker import live_broker

logger = logging.getLogger(__name__)

# Broker message type wrapping a persisted run event. Kept distinct from the
# legacy workspace live-stream event names so existing listeners are unaffected.
RUN_EVENT_BROKER_TYPE = "agent_run.event"

# Runs in these statuses are executing (or stopping) in a worker.
ACTIVE_RUN_STATUSES = ("RUNNING", "INITIALIZED", "DISCOVERING", "CANCELLING")
# The run is no longer executing but is waiting on a human; follow-on events
# (e.g. communication started from an approved selection) can still arrive.
AWAITING_RUN_STATUSES = ("WAITING_FOR_USER_SELECTION", "PENDING_APPROVAL", "WAITING_FOR_APPROVAL")
# Nothing further will happen for runs in these statuses.
TERMINAL_RUN_STATUSES = ("COMPLETED", "FAILED", "CANCELLED", "RECOVERY_FAILED", "PAUSED")

_MAX_SEQUENCE_RETRIES = 3


def utc_now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _json_safe(data: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    if not data:
        return {}
    return json.loads(eventra_json_dumps(data))


def to_envelope(row: AgentRunEvent) -> Dict[str, Any]:
    """Wire format for a run event (SSE `data:` payload and replay API item)."""
    created = row.created_at
    return {
        "id": f"{row.run_id}:{row.sequence}",
        "run_id": row.run_id,
        "event_id": row.event_id,
        "sequence": row.sequence,
        "type": row.type,
        "timestamp": created.replace(tzinfo=timezone.utc).isoformat() if created else None,
        "data": row.data or {},
    }


class RunCancelled(Exception):
    """Raised inside a worker when the run was cancelled by the user."""


class AgentRunEventRecorder:
    def __init__(self, db: Session):
        self.db = db

    def record(
        self,
        run_id: Optional[str],
        event_id: str,
        event_type: str,
        data: Optional[Dict[str, Any]] = None,
    ) -> Optional[Dict[str, Any]]:
        """Persists and publishes a run event. Never raises: progress reporting
        must not break the domain workflow it observes."""
        if not run_id:
            return None
        payload = _json_safe(data)
        for _ in range(_MAX_SEQUENCE_RETRIES):
            try:
                current = (
                    self.db.query(func.max(AgentRunEvent.sequence))
                    .filter(AgentRunEvent.run_id == run_id)
                    .scalar()
                )
                row = AgentRunEvent(
                    run_id=run_id,
                    event_id=event_id,
                    sequence=(current or 0) + 1,
                    type=event_type,
                    data=payload,
                    created_at=utc_now(),
                )
                self.db.add(row)
                self.db.commit()
            except IntegrityError:
                # Another writer took this sequence number; retry with the next one.
                self.db.rollback()
                continue
            except Exception as exc:
                logger.warning("Could not persist agent run event %s for run %s: %s", event_type, run_id, exc)
                self.db.rollback()
                return None

            envelope = to_envelope(row)
            try:
                live_broker.publish_sync(
                    event_id,
                    {"type": RUN_EVENT_BROKER_TYPE, "event_id": event_id, "run_id": run_id, "run_event": envelope},
                )
            except Exception as exc:
                logger.debug("Live publish of run event failed (replay still available): %s", exc)
            return envelope

        logger.warning("Gave up recording agent run event %s for run %s after sequence conflicts", event_type, run_id)
        return None

    def ensure_not_cancelled(self, run_id: Optional[str]) -> None:
        """Cooperative cancellation check, called between execution steps."""
        if not run_id:
            return
        status = (
            self.db.query(AgentRun.status)
            .filter(AgentRun.run_id == run_id)
            .scalar()
        )
        if status in ("CANCELLING", "CANCELLED"):
            raise RunCancelled(run_id)


def list_run_events(db: Session, run_id: str, after: int = 0, limit: int = 500) -> List[Dict[str, Any]]:
    rows = (
        db.query(AgentRunEvent)
        .filter(AgentRunEvent.run_id == run_id, AgentRunEvent.sequence > after)
        .order_by(AgentRunEvent.sequence.asc())
        .limit(limit)
        .all()
    )
    return [to_envelope(r) for r in rows]


def parse_cursor(value: Optional[str]) -> int:
    """Accepts `RUN-XXXX:12`, `12`, or empty; returns the sequence number."""
    if not value:
        return 0
    tail = str(value).rsplit(":", 1)[-1]
    try:
        return max(0, int(tail))
    except ValueError:
        return 0


def fail_orphaned_runs(db: Session) -> int:
    """Marks runs left executing by a previous process as failed.

    Workers run in-process (FastAPI BackgroundTasks), so after a restart no
    worker owns a run that is still RUNNING/DISCOVERING/CANCELLING. Leaving it
    active would also block new runs through the duplicate-run guard.
    """
    orphans = db.query(AgentRun).filter(AgentRun.status.in_(ACTIVE_RUN_STATUSES)).all()
    recorder = AgentRunEventRecorder(db)
    for run in orphans:
        was_cancelling = run.status == "CANCELLING"
        run.status = "CANCELLED" if was_cancelling else "FAILED"
        run.error = None if was_cancelling else "Run interrupted: the API server restarted before the run finished."
        run.completed_at = utc_now()
        db.commit()
        if was_cancelling:
            recorder.record(run.run_id, run.event_id, "agent.run_cancelled", {"status": "CANCELLED"})
        else:
            recorder.record(
                run.run_id, run.event_id, "agent.run_failed",
                {"status": "FAILED", "error": run.error, "recoverable": False},
            )
    return len(orphans)


def latest_event_type(db: Session, run_id: str) -> Optional[str]:
    return (
        db.query(AgentRunEvent.type)
        .filter(AgentRunEvent.run_id == run_id)
        .order_by(AgentRunEvent.sequence.desc())
        .limit(1)
        .scalar()
    )
