"""Pydantic Schemas: Approval / ApprovalRequest"""
from datetime import datetime
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, ConfigDict, Field


class ApprovalRequestCreate(BaseModel):
    """Payload for requesting operational approval."""
    action_type: str = Field(..., description="Action type, e.g. REASSIGN_VENDOR, ADJUST_SCHEDULE")
    target_type: str = Field(..., description="Target entity type, e.g. TASK, VENDOR_ASSIGNMENT")
    target_id: Optional[str] = Field(None, description="Target entity ID within event")
    requested_action: Dict[str, Any] = Field(default_factory=dict, description="Immutable action parameters")
    recovery_option_id: Optional[str] = Field(None, description="Optional associated recovery option ID")
    notes: Optional[str] = Field(None, description="Context or justification for approval")


class ApprovalDecisionRequest(BaseModel):
    """Payload when approving an approval request."""
    decision_notes: Optional[str] = Field(None, description="Optional notes or rationale from approver")


class ApprovalRejectionRequest(BaseModel):
    """Payload when rejecting an approval request."""
    reason: str = Field(..., min_length=1, description="Mandatory rejection reason")


class ApprovalBudgetImpact(BaseModel):
    """Committed spend in the affected category before vs after approving (UX v3 §1)."""
    category: str
    category_budget: Optional[float] = None
    committed_before: float
    committed_after: float
    total_budget: Optional[float] = None
    over_category_budget: Optional[bool] = None


class ApprovalRequestResponse(BaseModel):
    """Authoritative representation of an approval request."""
    id: str
    event_id: str
    requester_id: str
    approver_id: Optional[str] = None
    action_type: str
    target_type: str
    target_id: Optional[str] = None
    impact_level: str
    requested_action: Dict[str, Any]
    recovery_option_id: Optional[str] = None
    status: str
    state_snapshot: str
    rejection_reason: Optional[str] = None
    decision_notes: Optional[str] = None
    decided_at: Optional[datetime] = None
    expires_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime

    # ── UX v3 computed, human-facing fields (docs/contracts/ux-v3-api.md §1) ──
    # Derived by app.services.approval_presenter; None/absent when not computed or unknown.
    summary: Optional[str] = None
    vendor_name: Optional[str] = None
    category: Optional[str] = None
    channel: Optional[str] = None
    involves_money: Optional[bool] = None
    amount: Optional[float] = None
    currency: Optional[str] = None
    budget_impact: Optional[ApprovalBudgetImpact] = None
    on_approve: Optional[str] = None
    on_reject: Optional[str] = None
    reversible: Optional[bool] = None

    model_config = ConfigDict(from_attributes=True)


class ApprovalRequestListResponse(BaseModel):
    """Paginated list of approval requests."""
    total: int
    items: List[ApprovalRequestResponse]
    limit: int
    offset: int
