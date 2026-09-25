"""Pydantic Schemas for Task 9: Real Final Execution Plan.

Defines the authoritative, execution-ready operational blueprint:
- PlanReadiness (READY, PARTIALLY_READY, BLOCKED, INCOMPLETE)
- ExecutionPlanTask with topological sequence, predecessors, successors, vendor assignments, timing, slack, critical path
- CriticalPathEntry
- ExecutionCheckpoint
- PlanBlocker & PlanWarning
- UnresolvedUnknown
- BudgetSummaryPlan & ResourceSummaryPlan
- FinalExecutionPlan
"""
from decimal import Decimal
from enum import Enum
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field


class PlanReadiness(str, Enum):
    """Authoritative execution readiness states."""
    READY = "READY"                      # All operationally required tasks assigned, DAG acyclic, no blockers
    PARTIALLY_READY = "PARTIALLY_READY"  # Plan executable, but non-critical tasks/facts unresolved
    BLOCKED = "BLOCKED"                  # Critical task unassigned, schedule conflict, deadline exceeded, or budget overflow
    INCOMPLETE = "INCOMPLETE"            # Required operational info or tasks missing entirely


class PlanBlocker(BaseModel):
    """Structured blocking item preventing plan execution."""
    task_id: Optional[str] = Field(None, description="Affected task ID if task-specific")
    reason_code: str = Field(..., description="Deterministic machine-readable reason code")
    message: str = Field(..., description="Human-readable explanation of why execution is blocked")
    severity: str = Field("BLOCKING", description="Always BLOCKING for blockers")


class PlanWarning(BaseModel):
    """Structured non-blocking warning requiring operational attention."""
    task_id: Optional[str] = Field(None, description="Affected task ID if task-specific")
    reason_code: str = Field(..., description="Deterministic machine-readable reason code")
    message: str = Field(..., description="Human-readable explanation of the warning")
    severity: str = Field("WARNING", description="Always WARNING for warnings")


class UnresolvedUnknown(BaseModel):
    """Unresolved fact or specification marked UNKNOWN in vendor outcomes or intake."""
    task_id: Optional[str] = Field(None, description="Associated task ID")
    provider_id: Optional[str] = Field(None, description="Associated provider ID")
    category: Optional[str] = Field(None, description="Provider/task category")
    field: str = Field(..., description="Missing or unknown fact name")
    description: str = Field(..., description="Explanation of missing information")
    is_critical: bool = Field(False, description="Whether this unknown affects the critical path")


class TaskPredecessorInfo(BaseModel):
    """Direct predecessor task required to finish before this task starts."""
    task_id: str
    task_name: str
    status: str
    planned_end: Optional[str] = None


class TaskSuccessorInfo(BaseModel):
    """Direct successor task blocked until this task completes."""
    task_id: str
    task_name: str
    status: str
    planned_start: Optional[str] = None


class ExecutionPlanTask(BaseModel):
    """Authoritative operational task within the final execution plan."""
    task_id: str
    task_name: str
    description: Optional[str] = None
    status: str
    phase: Optional[str] = None
    required_provider_category: Optional[str] = None

    # Vendor assignment (from task.provider_id and VendorAssignment)
    assigned_provider_id: Optional[str] = None
    assigned_provider_name: Optional[str] = None
    assigned_provider_category: Optional[str] = None
    is_assigned: bool = False

    # Timing & CPM
    planned_start: Optional[str] = None
    planned_end: Optional[str] = None
    duration_minutes: int = 0
    slack_minutes: Optional[int] = None
    is_critical_path: bool = False

    # Graph relationships
    predecessors: List[TaskPredecessorInfo] = Field(default_factory=list)
    successors: List[TaskSuccessorInfo] = Field(default_factory=list)

    # Financial & Resource commitments
    budget_allocation: Optional[Decimal] = None
    committed_amount: Optional[Decimal] = None
    requirements: List[str] = Field(default_factory=list)
    resources: List[str] = Field(default_factory=list)

    # Operational execution details
    readiness_state: str = Field("READY", description="READY, PARTIALLY_READY, BLOCKED, or UNASSIGNED")
    operational_notes: Optional[str] = None


class CriticalPathEntry(BaseModel):
    """Single critical path task entry in deterministic topological sequence."""
    sequence_order: int
    task_id: str
    task_name: str
    planned_start: Optional[str] = None
    planned_end: Optional[str] = None
    duration_minutes: int = 0
    slack_minutes: int = 0
    assigned_provider_name: Optional[str] = None
    status: str


class ExecutionCheckpoint(BaseModel):
    """Actionable operational milestone derived from scheduled tasks."""
    checkpoint_id: str
    time: str = Field(..., description="Scheduled checkpoint time (HH:MM or ISO)")
    title: str = Field(..., description="Actionable checkpoint title")
    description: str = Field(..., description="Operational instructions for operators")
    task_id: Optional[str] = None
    checkpoint_type: str = Field("START", description="START, COMPLETION, VERIFICATION, DEADLINE")


class BudgetSummaryPlan(BaseModel):
    """Deterministic budget summary using Decimal monetary precision."""
    total_budget: Decimal = Decimal("0.00")
    total_committed: Decimal = Decimal("0.00")
    total_estimated: Decimal = Decimal("0.00")
    remaining_budget: Decimal = Decimal("0.00")
    uncommitted_allocation: Decimal = Decimal("0.00")
    currency: str = "INR"
    is_over_budget: bool = False
    utilization_percent: Decimal = Decimal("0.00")
    category_commitments: Dict[str, Decimal] = Field(default_factory=dict)


class ResourceSummaryPlan(BaseModel):
    """Operational resources allocated across the event."""
    total_resources: int = 0
    allocated_count: int = 0
    available_count: int = 0
    depleted_count: int = 0
    items: List[Dict[str, Any]] = Field(default_factory=list)


class EventSummary(BaseModel):
    """Metadata summary of the target event."""
    event_id: str
    event_name: str
    event_type: str
    location: Optional[str] = None
    start_datetime: Optional[str] = None
    end_datetime: Optional[str] = None
    guest_count: int = 0
    lifecycle_state: str
    total_budget: Decimal = Decimal("0.00")
    currency: str = "INR"


class CurrentAndNextTasks(BaseModel):
    """Real-time operational positioning for executing teams."""
    current_task: Optional[ExecutionPlanTask] = None
    next_task: Optional[ExecutionPlanTask] = None
    position_note: Optional[str] = None


class FinalExecutionPlan(BaseModel):
    """Authoritative, execution-ready final plan for organizers and operators."""
    plan_id: str
    event_id: str
    plan_version: int
    generated_at: str

    event_summary: EventSummary
    readiness_status: PlanReadiness

    # Deterministic topological task sequence
    tasks: List[ExecutionPlanTask] = Field(default_factory=list)

    # Critical path timeline
    critical_path: List[CriticalPathEntry] = Field(default_factory=list)
    total_critical_duration_minutes: int = 0

    # Operational intelligence
    budget_summary: BudgetSummaryPlan
    resource_summary: ResourceSummaryPlan
    current_and_next: Optional[CurrentAndNextTasks] = None
    execution_checkpoints: List[ExecutionCheckpoint] = Field(default_factory=list)

    # Governance & risks
    blockers: List[PlanBlocker] = Field(default_factory=list)
    warnings: List[PlanWarning] = Field(default_factory=list)
    unresolved_unknowns: List[UnresolvedUnknown] = Field(default_factory=list)

    # Optional summary
    operational_focus: Optional[str] = None

    # Deterministic consistency verification
    is_consistent: bool = True
    consistency_errors: List[str] = Field(default_factory=list)


class GenerateFinalExecutionPlanInput(BaseModel):
    """Agent tool input schema for generating the final execution plan."""
    event_id: str = Field(..., description="Target event UUID")
    plan_version: Optional[int] = Field(None, description="Optional target plan version filter")
