"""SQLAlchemy Model: Event"""
import uuid
from datetime import datetime, timezone
from decimal import Decimal
from sqlalchemy import Column, String, Integer, Text, Numeric, DateTime, ForeignKey, Boolean
from sqlalchemy.orm import relationship
from app.db.base import Base
from app.models.enums import EventType, EventState, EventLifecycleState, EventExecutionState


def utc_now():
    return datetime.now(timezone.utc).replace(tzinfo=None)


class Event(Base):
    __tablename__ = "events"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    owner_id = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True)
    name = Column(String(255), nullable=False, default="Untitled Event", index=True)
    description = Column(Text, nullable=True)
    event_type = Column(String(50), nullable=False, default=EventType.OTHER.value)
    location = Column(String(500), nullable=True)
    start_datetime = Column(DateTime, nullable=True)
    end_datetime = Column(DateTime, nullable=True)
    guest_count = Column(Integer, nullable=False, default=0)
    state = Column(String(50), nullable=False, default=EventState.NORMAL.value, index=True)
    lifecycle_state = Column(String(50), nullable=False, default=EventLifecycleState.DRAFT.value, index=True)
    execution_state = Column(String(50), nullable=False, default=EventExecutionState.RUNNING.value, index=True)
    manual_mode = Column(Boolean, nullable=False, default=False)
    total_budget = Column(Numeric(12, 2), nullable=False, default=Decimal("0.00"))
    currency = Column(String(10), nullable=False, default="USD")
    created_at = Column(DateTime, default=utc_now, nullable=False)
    updated_at = Column(DateTime, default=utc_now, onupdate=utc_now, nullable=False)

    owner = relationship("User", back_populates="owned_events", foreign_keys=[owner_id])
    members = relationship(
        "EventMember",
        back_populates="event",
        cascade="all, delete-orphan",
        lazy="select",
    )
    requirements = relationship(
        "Requirement",
        back_populates="event",
        cascade="all, delete-orphan",
        lazy="select",
    )
    constraints = relationship(
        "Constraint",
        back_populates="event",
        cascade="all, delete-orphan",
        lazy="select",
    )
    objectives = relationship(
        "Objective",
        back_populates="event",
        cascade="all, delete-orphan",
        lazy="select",
    )
    vendor_assignments = relationship(
        "VendorAssignment",
        back_populates="event",
        cascade="all, delete-orphan",
        lazy="select",
    )
    tasks = relationship(
        "Task",
        back_populates="event",
        cascade="all, delete-orphan",
        lazy="select",
    )
    resources = relationship(
        "Resource",
        back_populates="event",
        cascade="all, delete-orphan",
        lazy="select",
    )
    budget_items = relationship(
        "BudgetItem",
        back_populates="event",
        cascade="all, delete-orphan",
        lazy="select",
    )
    incidents = relationship(
        "Incident",
        back_populates="event",
        cascade="all, delete-orphan",
        lazy="select",
    )
