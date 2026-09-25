"""SQLAlchemy Model: Task"""
import uuid
from datetime import datetime, timezone
from sqlalchemy import Column, String, Integer, Boolean, DateTime, ForeignKey, Text
from sqlalchemy.orm import relationship
from app.db.base import Base
from app.models.enums import TaskStatus, TaskPriority


def utc_now():
    return datetime.now(timezone.utc).replace(tzinfo=None)


class Task(Base):
    __tablename__ = "tasks"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    event_id = Column(String(36), ForeignKey("events.id", ondelete="CASCADE"), nullable=False, index=True)
    key = Column(String(255), nullable=True, index=True)  # Stable domain task key, e.g. 'wedding.venue_prep'
    name = Column(String(255), nullable=False, index=True)
    description = Column(Text, nullable=True)
    status = Column(String(50), default=TaskStatus.PENDING.value, nullable=False, index=True)
    priority = Column(String(50), default=TaskPriority.MEDIUM.value, nullable=False)
    phase = Column(String(50), nullable=True)  # PRE_EVENT, SETUP, EXECUTION
    required_provider_category = Column(String(100), nullable=True)  # Matching vendor category
    duration_minutes = Column(Integer, nullable=True)  # Estimated duration from domain baseline
    slack_minutes = Column(Integer, nullable=True)  # Computed by critical path engine
    is_critical_path = Column(Boolean, default=False, nullable=False)  # Set by critical path engine
    planned_start = Column(DateTime, nullable=True)
    planned_end = Column(DateTime, nullable=True)
    actual_start = Column(DateTime, nullable=True)
    actual_end = Column(DateTime, nullable=True)
    provider_id = Column(String(36), ForeignKey("vendors.id", ondelete="SET NULL"), nullable=True, index=True)
    created_at = Column(DateTime, default=utc_now, nullable=False)
    updated_at = Column(DateTime, default=utc_now, onupdate=utc_now, nullable=False)

    event = relationship("Event", back_populates="tasks")
    provider = relationship("Vendor", foreign_keys=[provider_id])

    outgoing_dependencies = relationship(
        "TaskDependency",
        foreign_keys="TaskDependency.predecessor_task_id",
        back_populates="predecessor_task",
        cascade="all, delete-orphan",
        lazy="select",
    )
    incoming_dependencies = relationship(
        "TaskDependency",
        foreign_keys="TaskDependency.successor_task_id",
        back_populates="successor_task",
        cascade="all, delete-orphan",
        lazy="select",
    )
