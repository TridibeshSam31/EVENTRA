"""SQLAlchemy Models: DiscoveryRun & DiscoveryRunEvent

Supports persisted, pollable/streamable agentic discovery runs with
funnel transparency counts and step-by-step event logs.
"""
import uuid
from datetime import datetime, timezone
from sqlalchemy import Column, String, Integer, Float, DateTime, ForeignKey, Text, JSON
from sqlalchemy.orm import relationship
from app.db.base import Base


def utc_now():
    return datetime.now(timezone.utc).replace(tzinfo=None)


class DiscoveryRun(Base):
    """Represents a persisted execution of an agentic discovery run for an event."""

    __tablename__ = "discovery_runs"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    event_id = Column(String(36), ForeignKey("events.id", ondelete="CASCADE"), nullable=False, index=True)
    category = Column(String(50), nullable=False, index=True)
    
    # Status: RUNNING, TARGET_REACHED, EXHAUSTED, FAILED
    status = Column(String(30), nullable=False, default="RUNNING", index=True)
    
    # Trigger: routine, recovery, manual
    trigger = Column(String(30), nullable=False, default="routine", index=True)
    incident_id = Column(String(36), ForeignKey("incidents.id", ondelete="SET NULL"), nullable=True, index=True)

    current_iteration = Column(Integer, nullable=False, default=1)
    max_iterations = Column(Integer, nullable=False, default=3)
    radius_km = Column(Float, nullable=False, default=10.0)
    target_count = Column(Integer, nullable=False, default=5)

    # Dynamic Funnel Stage Counts (Target UX Spec Section 8.2)
    discovered = Column(Integer, nullable=False, default=0)
    unique_count = Column(Integer, nullable=False, default=0)
    relevant = Column(Integer, nullable=False, default=0)
    matching = Column(Integer, nullable=False, default=0)
    shortlisted = Column(Integer, nullable=False, default=0)

    summary = Column(Text, nullable=True)
    parameters = Column(JSON, nullable=False, default=dict)

    created_at = Column(DateTime, nullable=False, default=utc_now)
    updated_at = Column(DateTime, nullable=False, default=utc_now, onupdate=utc_now)

    # Relationships
    events = relationship(
        "DiscoveryRunEvent",
        back_populates="run",
        cascade="all, delete-orphan",
        order_by="DiscoveryRunEvent.timestamp.asc()",
    )


class DiscoveryRunEvent(Base):
    """Line-by-line real-time activity log for a DiscoveryRun."""

    __tablename__ = "discovery_run_events"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    run_id = Column(String(36), ForeignKey("discovery_runs.id", ondelete="CASCADE"), nullable=False, index=True)
    
    iteration = Column(Integer, nullable=False, default=1)
    event_type = Column(String(50), nullable=False, index=True)
    message = Column(Text, nullable=False)
    data = Column(JSON, nullable=False, default=dict)
    timestamp = Column(DateTime, nullable=False, default=utc_now, index=True)

    # Relationships
    run = relationship("DiscoveryRun", back_populates="events")
