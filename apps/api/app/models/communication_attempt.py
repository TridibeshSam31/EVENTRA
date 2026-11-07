"""SQLAlchemy Model: CommunicationAttempt

Durable record of one outbound channel (WhatsApp message or phone call) to a
selected shortlist candidate. Exactly one row exists per (shortlist entry,
channel); retries reuse the row and bump attempt_count, which is what makes
double-clicks and repeated requests safe.
"""
import uuid
from datetime import datetime, timezone
from sqlalchemy import Column, String, DateTime, ForeignKey, Text, JSON, Integer, UniqueConstraint
from app.db.base import Base


def utc_now():
    return datetime.now(timezone.utc).replace(tzinfo=None)


class CommunicationAttempt(Base):
    __tablename__ = "communication_attempts"
    __table_args__ = (
        UniqueConstraint("shortlist_entry_id", "channel", name="uq_communication_attempt_entry_channel"),
    )

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    event_id = Column(String(36), ForeignKey("events.id", ondelete="CASCADE"), nullable=False, index=True)
    shortlist_entry_id = Column(
        String(36), ForeignKey("event_shortlist_entries.id", ondelete="CASCADE"), nullable=False, index=True
    )
    vendor_id = Column(String(36), ForeignKey("vendors.id", ondelete="SET NULL"), nullable=True, index=True)
    approval_id = Column(String(36), nullable=True)

    channel = Column(String(20), nullable=False)  # WHATSAPP, CALL
    provider = Column(String(30), nullable=True)  # openwa, twilio
    contact_name = Column(String(255), nullable=True)
    destination = Column(String(20), nullable=True)  # E.164

    # Provider-reported lifecycle; see VendorOutreachService for the allowed values per channel.
    status = Column(String(30), nullable=False, default="NOT_ATTEMPTED", index=True)
    provider_ref = Column(String(255), nullable=True, index=True)  # WhatsApp message id / Twilio CallSid
    error = Column(Text, nullable=True)  # Sanitized, user-presentable failure reason
    attempt_count = Column(Integer, nullable=False, default=0)
    details = Column(JSON, nullable=False, default=dict)  # transcript, duration, last provider payload summary

    requested_by = Column(String(100), nullable=True)
    last_attempt_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, nullable=False, default=utc_now)
    updated_at = Column(DateTime, nullable=False, default=utc_now, onupdate=utc_now)
