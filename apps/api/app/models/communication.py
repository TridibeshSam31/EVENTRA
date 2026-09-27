"""SQLAlchemy Models: Conversation & Message

Provides real persistence for all provider interactions across WhatsApp,
AI voice calls, and email, storing raw transcripts and structured extracted facts.
"""
import uuid
from datetime import datetime, timezone
from sqlalchemy import Column, String, DateTime, ForeignKey, Text, JSON
from sqlalchemy.orm import relationship
from app.db.base import Base


def utc_now():
    return datetime.now(timezone.utc).replace(tzinfo=None)


class Conversation(Base):
    """Threaded communication session between EVENTRA and a candidate/vendor for an event."""

    __tablename__ = "conversations"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    event_id = Column(String(36), ForeignKey("events.id", ondelete="CASCADE"), nullable=False, index=True)
    vendor_id = Column(String(36), ForeignKey("vendors.id", ondelete="SET NULL"), nullable=True, index=True)
    
    vendor_name = Column(String(150), nullable=True)
    channel = Column(String(30), nullable=False, default="whatsapp")  # whatsapp, call, email
    status = Column(String(30), nullable=False, default="active")     # active, pending, resolved, closed
    recipient_contact = Column(String(100), nullable=True)

    last_message_at = Column(DateTime, nullable=False, default=utc_now)
    created_at = Column(DateTime, nullable=False, default=utc_now)
    updated_at = Column(DateTime, nullable=False, default=utc_now, onupdate=utc_now)

    # Relationships
    messages = relationship(
        "Message",
        back_populates="conversation",
        cascade="all, delete-orphan",
        order_by="Message.timestamp.asc()",
    )


class Message(Base):
    """Individual communication message or call transcript record."""

    __tablename__ = "messages"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    conversation_id = Column(String(36), ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False, index=True)
    event_id = Column(String(36), ForeignKey("events.id", ondelete="CASCADE"), nullable=False, index=True)
    vendor_id = Column(String(36), ForeignKey("vendors.id", ondelete="SET NULL"), nullable=True, index=True)

    direction = Column(String(20), nullable=False, index=True)        # inbound, outbound
    channel = Column(String(30), nullable=False, default="whatsapp")  # whatsapp, call, email
    sender = Column(String(100), nullable=True)
    recipient = Column(String(100), nullable=True)

    raw_text = Column(Text, nullable=False)
    status = Column(String(30), nullable=False, default="sent")       # sent, delivered, received, failed
    
    # Structured extracted facts: {available: bool, quoted_amount: float | None, currency: str, notes: str, confidence: float}
    extracted_facts = Column(JSON, nullable=False, default=dict)

    timestamp = Column(DateTime, nullable=False, default=utc_now, index=True)
    created_at = Column(DateTime, nullable=False, default=utc_now)

    # Relationships
    conversation = relationship("Conversation", back_populates="messages")
