"""Pydantic Schemas: Vendor -> Task Binding and Plan Recalculation (Task 8)"""
from typing import Any, List, Optional
from pydantic import BaseModel, ConfigDict, Field
from app.models.enums import BindingStatus, BlockingReason


class VendorTaskBindingInput(BaseModel):
    """Input payload to evaluate and execute vendor-to-task binding."""
    event_id: str = Field(..., description="ID of the event")
    task_id: str = Field(..., description="ID of the operational task to bind the vendor to")
    provider_id: str = Field(..., description="ID of the qualified vendor/provider")
    validation_id: Optional[str] = Field(None, description="Optional specific Task 7 validation ID. If omitted, latest validation is used.")
    allow_reassignment: bool = Field(False, description="Explicit approval to reassign if task already has a bound vendor")
    force_override_unknown: bool = Field(False, description="Explicit organizer policy override allowing binding when non-critical availability is UNKNOWN")


class BindingDecision(BaseModel):
    """Deterministic feasibility evaluation of whether a vendor can be bound to a task."""
    decision: str = Field(..., description="'BIND' or 'BLOCK'")
    can_bind: bool = Field(..., description="True if binding is feasible, allowed, and authorized")
    reason: str = Field(..., description="Human-readable explanation of the decision")
    reason_code: Optional[BlockingReason] = Field(None, description="Controlled reason code if BLOCKED")
    blocking_factors: List[str] = Field(default_factory=list, description="Specific failing conditions or conflicting claims")
    validation_id: Optional[str] = Field(None, description="ID of the Task 7 validation record evaluated")
    provider_id: str = Field(..., description="ID of the provider")
    task_id: str = Field(..., description="ID of the task")
    event_id: str = Field(..., description="ID of the event")

    model_config = ConfigDict(from_attributes=True)


class PlanRecalculationResult(BaseModel):
    """Results of deterministic plan recalculation triggered by vendor binding."""
    schedule_recalculated: bool = Field(True, description="Whether planned task start/end times were recalculated")
    critical_path_recalculated: bool = Field(True, description="Whether critical path and slack were recomputed")
    budget_recalculated: bool = Field(True, description="Whether budget commitments were recalculated")
    is_dag_acyclic: bool = Field(True, description="Confirmation that task DAG remains strictly acyclic")
    total_duration_minutes: int = Field(0, description="Total project critical path duration in minutes")
    critical_path_task_ids: List[str] = Field(default_factory=list, description="Ordered task IDs on the critical path")
    task_slack_minutes: Optional[int] = Field(None, description="Updated slack in minutes for the bound task")
    task_is_critical_path: bool = Field(False, description="Whether the bound task is now on the critical path")
    budget_committed_amount: Optional[float] = Field(None, description="Newly committed amount for the task's category")
    plan_version_before: int = Field(1, description="Plan version sequence before recalculation")
    plan_version_after: int = Field(2, description="Plan version sequence after recalculation")

    model_config = ConfigDict(from_attributes=True)


class VendorTaskBindingResponse(BaseModel):
    """Authoritative API response schema for a vendor-to-task binding attempt."""
    binding_status: BindingStatus = Field(..., description="'BOUND', 'BLOCKED', or 'ALREADY_BOUND'")
    event_id: str
    task_id: str
    provider_id: str
    validation_id: Optional[str] = None
    previous_provider_id: Optional[str] = None
    decision: BindingDecision
    plan_recalculation: Optional[PlanRecalculationResult] = None
    plan_version_before: Optional[int] = None
    plan_version_after: Optional[int] = None
    schedule_recalculated: bool = False
    critical_path_recalculated: bool = False
    budget_recalculated: bool = False
    audit_id: Optional[str] = None
    message: str = Field(..., description="Summary status message")

    model_config = ConfigDict(from_attributes=True)
