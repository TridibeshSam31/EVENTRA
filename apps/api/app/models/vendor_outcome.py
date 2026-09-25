"""SQLAlchemy Model: VendorOutcome (Organizer-Reported Vendor Interaction Result)"""
import uuid
from datetime import datetime, timezone
from sqlalchemy import Column, String, Float, DateTime, Text, ForeignKey, JSON
from sqlalchemy.orm import relationship
from app.db.base import Base


def utc_now():
    return datetime.now(timezone.utc).replace(tzinfo=None)


class VendorOutcome(Base):
    __tablename__ = "vendor_outcomes"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    event_id = Column(String(36), ForeignKey("events.id", ondelete="CASCADE"), nullable=False, index=True)
    task_id = Column(String(36), ForeignKey("tasks.id", ondelete="SET NULL"), nullable=True, index=True)
    provider_id = Column(String(36), ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False, index=True)

    # Communication metadata
    communication_channel = Column(String(50), nullable=False, default="OTHER")
    outcome_status = Column(String(50), nullable=False, default="CONTACTED", index=True)

    # Financial and Availability facts reported by organizer
    quoted_price = Column(Float, nullable=True)
    currency = Column(String(10), default="INR", nullable=False)
    reported_availability = Column(String(50), default="UNKNOWN", nullable=False)

    # Freeform notes and structured details reported by organizer
    organizer_notes = Column(Text, nullable=True)
    vendor_response = Column(JSON, nullable=True)

    # Critical architectural provenance boundary:
    # Always ORGANIZER_REPORTED and UNVERIFIED in Task 6.
    source = Column(String(50), default="ORGANIZER_REPORTED", nullable=False)
    verification_status = Column(String(50), default="UNVERIFIED", nullable=False)

    # Operational audit tracking
    submitted_by = Column(String(255), nullable=True)
    created_at = Column(DateTime, default=utc_now, nullable=False)
    updated_at = Column(DateTime, default=utc_now, onupdate=utc_now, nullable=False)

    # Entity relationships
    event = relationship("Event", backref="vendor_outcomes")
    vendor = relationship("Vendor", backref="vendor_outcomes")
    task = relationship("Task", backref="vendor_outcomes")
