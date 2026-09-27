"""Persisted, non-executing recovery-option snapshots."""
import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, Column, DateTime, Float, ForeignKey, Integer, JSON, String
from sqlalchemy.orm import relationship

from app.db.base import Base


def utc_now():
    return datetime.now(timezone.utc).replace(tzinfo=None)


class Recovery(Base):
    """A deterministic recovery option, never an executed action."""

    __tablename__ = "recovery_options"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    event_id = Column(String(36), ForeignKey("events.id", ondelete="CASCADE"), nullable=False, index=True)
    incident_id = Column(String(36), ForeignKey("incidents.id", ondelete="CASCADE"), nullable=False, index=True)
    strategy_type = Column(String(50), nullable=False, index=True)
    status = Column(String(20), nullable=False, default="INFEASIBLE", index=True)
    is_feasible = Column(Boolean, nullable=False, default=False)
    rank = Column(Integer, nullable=True)
    score = Column(Float, nullable=True)
    state_snapshot = Column(String(128), nullable=False, index=True)
    proposed_changes = Column(JSON, nullable=False, default=dict)
    affected_tasks = Column(JSON, nullable=False, default=list)
    affected_providers = Column(JSON, nullable=False, default=list)
    affected_resources = Column(JSON, nullable=False, default=list)
    schedule_delta = Column(JSON, nullable=False, default=dict)
    budget_delta = Column(JSON, nullable=False, default=dict)
    resource_delta = Column(JSON, nullable=False, default=dict)
    provider_delta = Column(JSON, nullable=False, default=dict)
    objective_delta = Column(JSON, nullable=False, default=dict)
    constraint_impact = Column(JSON, nullable=False, default=dict)
    risk_before = Column(JSON, nullable=False, default=dict)
    risk_after = Column(JSON, nullable=False, default=dict)
    feasibility_result = Column(JSON, nullable=False, default=dict)
    generated_at = Column(DateTime, default=utc_now, nullable=False, index=True)

    event = relationship("Event")
    incident = relationship("Incident")

    @property
    def requires_approval(self) -> bool:
        if getattr(self, "_requires_approval", None) is not None:
            return self._requires_approval
        if self.status == "APPROVAL_REQUIRED":
            return True
        return bool((self.feasibility_result or {}).get("requires_approval", False))

    @requires_approval.setter
    def requires_approval(self, val: bool):
        self._requires_approval = val


# Alias for backward compatibility
RecoveryOption = Recovery
