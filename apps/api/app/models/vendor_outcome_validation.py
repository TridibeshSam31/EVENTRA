"""SQLAlchemy Model: VendorOutcomeValidation (Deterministic Claims & Validation)"""
import uuid
from datetime import datetime, timezone
from sqlalchemy import Column, String, DateTime, Text, ForeignKey, JSON
from sqlalchemy.orm import relationship
from app.db.base import Base


def utc_now():
    return datetime.now(timezone.utc).replace(tzinfo=None)


class VendorOutcomeValidation(Base):
    __tablename__ = "vendor_outcome_validations"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    vendor_outcome_id = Column(String(36), ForeignKey("vendor_outcomes.id", ondelete="CASCADE"), nullable=False, index=True)
    event_id = Column(String(36), ForeignKey("events.id", ondelete="CASCADE"), nullable=False, index=True)
    task_id = Column(String(36), ForeignKey("tasks.id", ondelete="SET NULL"), nullable=True, index=True)
    provider_id = Column(String(36), ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False, index=True)

    # Deterministic Evaluation Status
    overall_status = Column(String(50), nullable=False, index=True)  # VALIDATED, PARTIALLY_VALIDATED, FAILED, CONFLICT, INSUFFICIENT_INFORMATION

    # Structured Extracted Claims (from LLM semantic parsing)
    extracted_claims = Column(JSON, nullable=False, default=list)

    # Per-Claim and Per-Requirement Deterministic Evaluation Results
    claim_results = Column(JSON, nullable=False, default=list)

    # Detailed Categorized Matches and Gaps
    hard_requirements_passed = Column(JSON, nullable=False, default=list)
    hard_requirements_failed = Column(JSON, nullable=False, default=list)
    preferences_matched = Column(JSON, nullable=False, default=list)
    conflicts = Column(JSON, nullable=False, default=list)
    unknown_facts = Column(JSON, nullable=False, default=list)

    # Metadata & Versioning
    validator_version = Column(String(50), default="1.0.0", nullable=False)
    summary = Column(Text, nullable=True)

    created_at = Column(DateTime, default=utc_now, nullable=False)
    updated_at = Column(DateTime, default=utc_now, onupdate=utc_now, nullable=False)

    # Entity Relationships
    vendor_outcome = relationship("VendorOutcome", backref="validations")
    event = relationship("Event")
    task = relationship("Task")
    vendor = relationship("Vendor")
