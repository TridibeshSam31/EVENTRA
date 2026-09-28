"""SQLAlchemy Model: EventShortlistEntry

Persisted event-scoped shortlist entries representing explicit human/organizer
decisions to shortlist specific candidates/providers for an event.
Survives refresh, navigation, browser reload, agent updates, and is synchronized
across all workspace pages.
"""
import uuid
from datetime import datetime, timezone
from sqlalchemy import Column, String, Integer, Float, DateTime, ForeignKey, Text, JSON
from sqlalchemy.orm import relationship

from app.db.base import Base


def utc_now():
    return datetime.now(timezone.utc).replace(tzinfo=None)


class EventShortlistEntry(Base):
    __tablename__ = "event_shortlist_entries"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    event_id = Column(String(36), ForeignKey("events.id", ondelete="CASCADE"), nullable=False, index=True)
    candidate_id = Column(String(255), nullable=False, index=True)
    provider_id = Column(String(36), nullable=True, index=True)
    category = Column(String(100), nullable=True, index=True)
    candidate_name = Column(String(255), nullable=True)
    status = Column(String(50), nullable=False, default="SHORTLISTED", index=True)
    ranking = Column(Integer, nullable=True)
    notes = Column(Text, nullable=True)
    candidate_data = Column(JSON, nullable=True, default=dict)

    created_at = Column(DateTime, default=utc_now, nullable=False, index=True)
    updated_at = Column(DateTime, default=utc_now, onupdate=utc_now, nullable=False)

    event = relationship("Event", backref="shortlist_entries")
