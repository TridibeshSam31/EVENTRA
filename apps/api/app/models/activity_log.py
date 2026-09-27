"""SQLAlchemy Model: EventActivityLog

Unified event stream across the entire event lifecycle:
Discovery → Engagement → Execution → Recovery.
"""
import uuid
from datetime import datetime, timezone
from sqlalchemy import Column, String, DateTime, ForeignKey, Text, JSON
from app.db.base import Base


def utc_now():
    return datetime.now(timezone.utc).replace(tzinfo=None)


class EventActivityLog(Base):
    """Unified chronological activity and audit log entry for an event."""

    __tablename__ = "event_activity_logs"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    event_id = Column(String(36), ForeignKey("events.id", ondelete="CASCADE"), nullable=False, index=True)
    
    timestamp = Column(DateTime, nullable=False, default=utc_now, index=True)
    
    # Category: discovery, engagement, incident, approval, execution, planning
    category = Column(String(50), nullable=False, index=True)
    
    # Actor: agent, deterministic_engine, human, external
    actor = Column(String(50), nullable=False, index=True)
    
    action = Column(String(100), nullable=False)
    summary = Column(Text, nullable=False)
    ref_id = Column(String(100), nullable=True, index=True)
    details = Column(JSON, nullable=False, default=dict)
