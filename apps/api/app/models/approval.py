"""SQLAlchemy Model: Approval / ApprovalRequest"""
import uuid
from datetime import datetime, timezone
from sqlalchemy import Column, String, DateTime, ForeignKey, Text, JSON
from sqlalchemy.orm import relationship
from app.db.base import Base


def utc_now():
    return datetime.now(timezone.utc).replace(tzinfo=None)


class Approval(Base):
    """Immutable operational approval request governing high-impact mutations."""

    __tablename__ = "approvals"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    event_id = Column(String(36), ForeignKey("events.id", ondelete="CASCADE"), nullable=False, index=True)
    requester_id = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    approver_id = Column(String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    
    action_type = Column(String(50), nullable=False, index=True)
    target_type = Column(String(50), nullable=False, index=True)
    target_id = Column(String(36), nullable=True, index=True)
    impact_level = Column(String(20), nullable=False, index=True)
    
    requested_action = Column(JSON, nullable=False, default=dict)
    recovery_option_id = Column(String(36), ForeignKey("recovery_options.id", ondelete="SET NULL"), nullable=True, index=True)
    
    status = Column(String(20), nullable=False, default="PENDING", index=True)
    state_snapshot = Column(String(128), nullable=False, index=True)
    
    rejection_reason = Column(Text, nullable=True)
    decision_notes = Column(Text, nullable=True)
    reply_code = Column(String(10), nullable=True, index=True)
    decided_at = Column(DateTime, nullable=True)
    expires_at = Column(DateTime, nullable=True)
    
    created_at = Column(DateTime, default=utc_now, nullable=False, index=True)
    updated_at = Column(DateTime, default=utc_now, onupdate=utc_now, nullable=False)

    # Relationships
    event = relationship("Event", foreign_keys=[event_id])
    requester = relationship("User", foreign_keys=[requester_id])
    approver = relationship("User", foreign_keys=[approver_id])
    recovery_option = relationship("Recovery", foreign_keys=[recovery_option_id])


# Canonical alias
ApprovalRequest = Approval
