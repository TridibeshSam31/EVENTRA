"""SQLAlchemy Model: EventPauseRecord (Task 11 Structured Pause/Resume Request Domain)."""
import uuid
from datetime import datetime, timezone
from sqlalchemy import Column, String, DateTime, Text, JSON, Integer, ForeignKey
from sqlalchemy.orm import relationship

from app.db.base import Base


def utc_now():
    return datetime.now(timezone.utc).replace(tzinfo=None)


class EventPauseRecord(Base):
    """Structured audit and state record for event pause and resume operations."""

    __tablename__ = "event_pause_records"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    event_id = Column(String(36), ForeignKey("events.id", ondelete="CASCADE"), nullable=False, index=True)
    operation_type = Column(String(20), nullable=False, index=True)  # PAUSE, RESUME
    requested_by = Column(String(36), nullable=False, index=True)
    requested_at = Column(DateTime, default=utc_now, nullable=False)
    reason = Column(Text, nullable=True)
    previous_state = Column(String(50), nullable=False)
    target_state = Column(String(50), nullable=False)
    plan_version = Column(Integer, nullable=False, default=1)
    status = Column(String(30), nullable=False, default="COMPLETED", index=True)  # COMPLETED, ALREADY_PAUSED, ALREADY_RUNNING, FAILED
    approval_reference = Column(String(36), nullable=True)
    validation_result = Column(JSON, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    audit_reference = Column(String(36), nullable=True)
    created_at = Column(DateTime, default=utc_now, nullable=False, index=True)

    event = relationship("Event")
