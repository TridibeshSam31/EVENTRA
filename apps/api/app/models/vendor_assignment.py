"""SQLAlchemy Model: VendorAssignment"""
import uuid
from datetime import datetime, timezone
from sqlalchemy import Column, String, Float, DateTime, Text, ForeignKey, Boolean, JSON
from sqlalchemy.orm import relationship
from app.db.base import Base


def utc_now():
    return datetime.now(timezone.utc).replace(tzinfo=None)


class VendorAssignment(Base):
    __tablename__ = "vendor_assignments"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    event_id = Column(String(36), ForeignKey("events.id", ondelete="CASCADE"), nullable=False, index=True)
    vendor_id = Column(String(36), ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False, index=True)
    category = Column(String(100), nullable=False)  # purpose / role (e.g. sound, catering)
    status = Column(String(50), default="REQUESTED", nullable=False)  # REQUESTED, CONFIRMED, CANCELLED
    agreed_cost = Column(Float, nullable=True)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=utc_now, nullable=False)
    updated_at = Column(DateTime, default=utc_now, onupdate=utc_now, nullable=False)

    # --- Negotiation lifecycle ---
    negotiation_status = Column(String(50), default="DISCOVERED", nullable=False, index=True)
    target_amount = Column(Float, nullable=True)  # What the agent negotiates TOWARD
    max_approved_amount = Column(Float, nullable=True)  # Hard ceiling agent cannot exceed
    quoted_amount = Column(Float, nullable=True)  # Latest provider quotation
    currency = Column(String(10), default="INR", nullable=True)
    provider_available = Column(Boolean, nullable=True)
    coverage_start = Column(String(20), nullable=True)  # e.g. "10:00"
    coverage_end = Column(String(20), nullable=True)  # e.g. "20:00"
    advance_required = Column(Boolean, nullable=True)
    provider_response_summary = Column(JSON, nullable=True)  # Structured parsed offer
    negotiation_round = Column(String(10), default="0", nullable=True)  # Counter for negotiation rounds
    approval_id = Column(String(36), nullable=True, index=True)  # Links to Approval request
    is_simulation = Column(Boolean, default=False, nullable=False)  # True for demo simulation
    negotiation_control = Column(String(20), default="AGENT", nullable=False)  # "AGENT" | "HUMAN"
    control_changed_by = Column(String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    control_changed_at = Column(DateTime, nullable=True)

    vendor = relationship("Vendor", back_populates="assignments")
    event = relationship("Event", back_populates="vendor_assignments")

