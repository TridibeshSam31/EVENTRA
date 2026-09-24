"""Typed Pydantic input and output schemas for all EVENTRA Agent Tools.

Strict schema contracts guarantee that:
1. All agent inputs are validated before invoking any deterministic domain service.
2. Malformed parameters are rejected before reaching domain models.
3. Outputs are structured, typed, and factual without hallucinatory fields.
4. Unknown values are explicitly typed as UNKNOWN.
"""
from datetime import datetime
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field


# ==============================================================================
# 1. EVENT / STATE SCHEMAS
# ==============================================================================

class GetEventStateInput(BaseModel):
    event_id: str = Field(..., description="Unique authoritative identifier of the event")


class GetEventStateOutput(BaseModel):
    event_id: str = Field(..., description="Event identifier")
    name: str = Field(..., description="Event title / name")
    lifecycle_state: str = Field(..., description="Lifecycle state (e.g. DRAFT, SPECIFIED, PLANNED, LIVE)")
    state: str = Field(..., description="Operational state (e.g. NORMAL, AT_RISK, INCIDENT)")
    total_budget: float = Field(..., description="Authoritative allocated total budget")
    budget_spent: float = Field(..., description="Current actual expenditure spent")
    budget_remaining: float = Field(..., description="Remaining uncommitted budget")
    task_counts: Dict[str, int] = Field(..., description="Breakdown of task counts (total, critical_path, blocked)")
    objectives_count: int = Field(..., description="Total objectives defined for the event")
    open_incidents_count: int = Field(..., description="Count of open/unresolved operational incidents")


class GetEventSpecInput(BaseModel):
    event_id: str = Field(..., description="Authoritative identifier of the event")


class GetEventSpecOutput(BaseModel):
    event_id: str = Field(..., description="Event identifier")
    title: str = Field(..., description="Canonical event title")
    event_type: str = Field(..., description="Domain event type (e.g. wedding, conference, college_fest)")
    status: str = Field(..., description="Specification status")
    guest_count: int = Field(..., description="Target guest count capacity")
    total_budget: Optional[float] = Field(None, description="Total budget in currency units")
    currency: str = Field("INR", description="Currency ISO code")
    location: Optional[Dict[str, Any]] = Field(None, description="Resolved geographic location information")
    requirements_count: int = Field(..., description="Number of baseline and custom requirements")
    tasks_count: int = Field(..., description="Number of baseline tasks compiled")
    dependencies_count: int = Field(..., description="Number of baseline dependencies")
    provider_categories: List[str] = Field(..., description="Required and permitted provider categories")
    constraints_count: int = Field(..., description="Count of operational constraints")
    objectives_count: int = Field(..., description="Count of prioritized event objectives")
    specification: Dict[str, Any] = Field(..., description="Complete canonical EventSpecification payload")


class GetOperationalStatusInput(BaseModel):
    event_id: str = Field(..., description="Unique event identifier")


class GetOperationalStatusOutput(BaseModel):
    event_id: str = Field(..., description="Event identifier")
    lifecycle_state: str = Field(..., description="Lifecycle state (e.g. PLANNED, LIVE)")
    state: str = Field(..., description="Operational health status (NORMAL, AT_RISK, INCIDENT, EMERGENCY)")
    is_active: bool = Field(..., description="Whether the event is in an active or operational lifecycle state")
    has_open_incidents: bool = Field(..., description="True if unresolved incidents are currently flagged")
    open_incidents_count: int = Field(..., description="Number of active incidents")
    critical_tasks_count: int = Field(..., description="Number of tasks currently on the critical path")
    blocked_tasks_count: int = Field(..., description="Number of tasks currently blocked")
    budget_utilization_percent: float = Field(..., description="Percentage of total budget currently spent")


class GetActiveConstraintsInput(BaseModel):
    event_id: str = Field(..., description="Unique event identifier")


class ActiveConstraintItem(BaseModel):
    id: str = Field(..., description="Constraint identifier")
    type: str = Field(..., description="Constraint type (BUDGET, TIMELINE, CAPACITY, VENUE, VENDOR)")
    name: str = Field(..., description="Descriptive name")
    description: Optional[str] = Field(None, description="Detailed constraint explanation")
    value: Dict[str, Any] = Field(default_factory=dict, description="Structured constraint threshold / parameters")
    severity: str = Field("HARD", description="HARD (mandatory invariant) or SOFT (preference)")


class GetActiveConstraintsOutput(BaseModel):
    event_id: str = Field(..., description="Event identifier")
    total_constraints: int = Field(..., description="Count of active constraints")
    constraints: List[ActiveConstraintItem] = Field(..., description="List of active operational constraints")


# ==============================================================================
# 2. PLANNING SCHEMAS
# ==============================================================================

class GetPlanInput(BaseModel):
    event_id: str = Field(..., description="Unique event identifier")


class GetPlanOutput(BaseModel):
    event_id: str = Field(..., description="Event identifier")
    event_name: str = Field(..., description="Event name")
    lifecycle_state: str = Field(..., description="Current lifecycle state")
    total_tasks: int = Field(..., description="Total tasks in the plan")
    total_dependencies: int = Field(..., description="Total dependency edges in the DAG")
    total_resources: int = Field(..., description="Total planned resources")
    total_budget_items: int = Field(..., description="Total planned budget allocations")
    total_estimated_budget: float = Field(..., description="Sum of estimated budgets across items")
    critical_path_tasks: int = Field(..., description="Count of tasks on critical path")
    tasks: List[Dict[str, Any]] = Field(..., description="List of task summaries")
    dependencies: List[Dict[str, Any]] = Field(..., description="List of dependency links")


class GetTaskInput(BaseModel):
    event_id: str = Field(..., description="Unique event identifier")
    task_id: str = Field(..., description="Target task identifier")


class GetTaskOutput(BaseModel):
    task_id: str = Field(..., description="Task identifier")
    event_id: str = Field(..., description="Event identifier")
    name: str = Field(..., description="Task title")
    description: Optional[str] = Field(None, description="Task details")
    status: str = Field(..., description="Status (PENDING, READY, IN_PROGRESS, COMPLETED, BLOCKED)")
    priority: str = Field(..., description="Priority (LOW, MEDIUM, HIGH, CRITICAL)")
    duration_minutes: int = Field(..., description="Task duration in minutes")
    is_critical_path: bool = Field(..., description="Whether task is on the critical path")
    planned_start: Optional[str] = Field(None, description="Planned start ISO timestamp")
    planned_end: Optional[str] = Field(None, description="Planned end ISO timestamp")
    actual_start: Optional[str] = Field(None, description="Actual start ISO timestamp")
    actual_end: Optional[str] = Field(None, description="Actual end ISO timestamp")
    required_provider_category: Optional[str] = Field(None, description="Associated vendor category if any")


class GetDependenciesInput(BaseModel):
    event_id: str = Field(..., description="Unique event identifier")
    task_id: Optional[str] = Field(None, description="Optional task ID to filter dependencies for a specific task")


class DependencyItem(BaseModel):
    id: str = Field(..., description="Dependency identifier")
    predecessor_task_id: str = Field(..., description="Predecessor task ID")
    successor_task_id: str = Field(..., description="Successor task ID")
    dependency_type: str = Field("FINISH_TO_START", description="Dependency type")
    lag_minutes: int = Field(0, description="Lag time in minutes")


class GetDependenciesOutput(BaseModel):
    event_id: str = Field(..., description="Event identifier")
    total: int = Field(..., description="Total dependencies returned")
    dependencies: List[DependencyItem] = Field(..., description="List of dependency records")


class GetCriticalPathInput(BaseModel):
    event_id: str = Field(..., description="Unique event identifier")


class GetCriticalPathOutput(BaseModel):
    event_id: str = Field(..., description="Event identifier")
    critical_path_task_ids: List[str] = Field(..., description="Ordered list of task IDs forming the critical path")
    critical_path_tasks: List[Dict[str, Any]] = Field(..., description="Ordered list of task objects on the critical path")
    total_duration_minutes: int = Field(..., description="Total project critical path duration in minutes")
    is_acyclic: bool = Field(..., description="True if task DAG is mathematically acyclic")


class CreateOrUpdateTaskInput(BaseModel):
    event_id: str = Field(..., description="Unique event identifier")
    task_id: Optional[str] = Field(None, description="Task ID if updating existing task, None to create new task")
    name: Optional[str] = Field(None, description="Task title")
    description: Optional[str] = Field(None, description="Task description")
    status: Optional[str] = Field(None, description="Status (PENDING, READY, IN_PROGRESS, COMPLETED, BLOCKED)")
    priority: Optional[str] = Field(None, description="Priority (LOW, MEDIUM, HIGH, CRITICAL)")
    duration_minutes: Optional[int] = Field(None, description="Duration in minutes")
    planned_start: Optional[datetime] = Field(None, description="Planned start datetime")
    planned_end: Optional[datetime] = Field(None, description="Planned end datetime")
    required_provider_category: Optional[str] = Field(None, description="Required vendor category")


class CreateOrUpdateTaskOutput(BaseModel):
    task_id: str = Field(..., description="Task identifier")
    event_id: str = Field(..., description="Event identifier")
    name: str = Field(..., description="Task title")
    status: str = Field(..., description="Current task status")
    priority: str = Field(..., description="Current task priority")
    is_created: bool = Field(..., description="True if created, False if updated")
    message: str = Field(..., description="Summary of the action performed")


# ==============================================================================
# 3. PROVIDER DISCOVERY & QUALIFICATION SCHEMAS
# ==============================================================================

class DiscoverProvidersInput(BaseModel):
    event_id: str = Field(..., description="Unique event identifier")
    category: Optional[str] = Field(None, description="Provider category (e.g. CATERING, PHOTOGRAPHY, VENUE)")
    location: Optional[str] = Field(None, description="City or locality to anchor search")
    query: Optional[str] = Field(None, description="Specific natural language or keyword query")
    radius_km: Optional[float] = Field(None, description="Maximum distance radius in kilometers")
    limit: int = Field(10, ge=1, le=50, description="Maximum number of candidates to return")
    guest_count: Optional[int] = Field(None, description="Target guest count capacity filter")
    requirements: List[str] = Field(default_factory=list, description="Mandatory requirements (e.g. vegetarian)")
    preferences: List[str] = Field(default_factory=list, description="Desirable preferences")


class ProviderCandidate(BaseModel):
    provider_id: str = Field(..., description="Unique provider ID")
    name: str = Field(..., description="Provider / business name")
    category: str = Field(..., description="Controlled category in EVENTRA taxonomy")
    city: Optional[str] = Field(None, description="City or region")
    address: Optional[str] = Field(None, description="Full street address if available")
    base_cost: Optional[float] = Field(None, description="Known base cost or starting price in currency")
    rating: Optional[float] = Field(None, description="Real average customer rating (1.0 to 5.0)")
    review_count: Optional[int] = Field(None, description="Number of real verified reviews")
    distance_km: Optional[float] = Field(None, description="Haversine distance in km from event anchor")
    is_assigned: bool = Field(False, description="Whether provider is already assigned to this event")
    status: str = Field("ACTIVE", description="Provider status (ACTIVE, INACTIVE)")
    capabilities: List[str] = Field(default_factory=list, description="Verified capabilities from evidence")
    known_constraints: List[str] = Field(default_factory=list, description="Known operational constraints")
    unknown_fields: List[str] = Field(default_factory=list, description="Attributes explicitly not confirmed")


class DiscoverProvidersOutput(BaseModel):
    event_id: str = Field(..., description="Event identifier")
    total_found: int = Field(..., description="Total candidate providers found")
    providers: List[ProviderCandidate] = Field(..., description="List of structured provider candidates")
    search_location: Optional[str] = Field(None, description="Geographic location resolved for search")
    search_category: Optional[str] = Field(None, description="Category filter applied")
    search_radius_km: Optional[float] = Field(None, description="Radius filter applied")


class QualifyProviderInput(BaseModel):
    event_id: str = Field(..., description="Unique event identifier")
    provider_id: str = Field(..., description="Unique provider ID to qualify")
    required_category: Optional[str] = Field(None, description="Required category for the task/event")
    max_budget: Optional[float] = Field(None, description="Maximum available budget ceiling")
    max_distance_km: Optional[float] = Field(None, description="Maximum acceptable distance in km")
    required_capabilities: List[str] = Field(default_factory=list, description="Required capabilities")


class QualifyProviderOutput(BaseModel):
    provider_id: str = Field(..., description="Provider identifier")
    name: str = Field(..., description="Provider name")
    is_qualified: bool = Field(..., description="True if all verifiable hard requirements are met")
    status: str = Field(..., description="QUALIFIED, DISQUALIFIED, or INSUFFICIENT_INFORMATION")
    category_match: bool = Field(..., description="Whether category satisfies the requirement")
    budget_check: Dict[str, Any] = Field(..., description="Deterministic budget evaluation against base cost")
    distance_check: Dict[str, Any] = Field(..., description="Deterministic distance evaluation against radius")
    capability_match: Dict[str, Any] = Field(..., description="Matched vs missing capabilities")
    known_facts: Dict[str, Any] = Field(..., description="Authoritatively verified facts from DB")
    unknown_facts: List[str] = Field(..., description="Facts that remain UNKNOWN (e.g. live availability, capacity)")
    qualification_summary: str = Field(..., description="Factual, deterministic explanation of qualification")


class CheckProviderAvailabilityInput(BaseModel):
    vendor_id: str = Field(..., description="Provider identifier")
    start_datetime: datetime = Field(..., description="Requested window start datetime")
    end_datetime: datetime = Field(..., description="Requested window end datetime")


class CheckProviderAvailabilityOutput(BaseModel):
    vendor_id: str = Field(..., description="Provider identifier")
    is_available: bool = Field(..., description="True if no database conflicts exist and provider is ACTIVE")
    status: str = Field(..., description="AVAILABLE, CONFLICT, or UNKNOWN")
    start_datetime: str = Field(..., description="Start of window evaluated")
    end_datetime: str = Field(..., description="End of window evaluated")
    data_source: str = Field("DATABASE_RECORDS", description="Authoritative origin of availability info")
    conflicts_count: int = Field(0, description="Number of overlapping BOOKED/BLOCKED slots")
    conflicts: List[Dict[str, Any]] = Field(default_factory=list, description="Conflicting booked windows")
    note: str = Field(..., description="Truthful note: database records only, NOT live phone/WhatsApp confirmation")


class CompareCandidatesInput(BaseModel):
    event_id: str = Field(..., description="Unique event identifier")
    provider_ids: List[str] = Field(..., min_length=1, max_length=10, description="List of provider IDs to compare")
    task_id: Optional[str] = Field(None, description="Optional task ID to contextualize requirements")


class ProviderComparisonEntry(BaseModel):
    provider_id: str = Field(..., description="Provider ID")
    name: str = Field(..., description="Provider name")
    category: str = Field(..., description="Provider category")
    base_cost: Optional[float] = Field(None, description="Known base cost")
    rating: Optional[float] = Field(None, description="Rating")
    review_count: Optional[int] = Field(None, description="Review count")
    distance_km: Optional[float] = Field(None, description="Distance from event")
    capabilities: List[str] = Field(default_factory=list, description="Capabilities")
    requirement_matches: List[str] = Field(default_factory=list, description="Matched requirements")
    requirement_mismatches: List[str] = Field(default_factory=list, description="Unmet requirements")
    known_constraints: List[str] = Field(default_factory=list, description="Known constraints")
    unknown_fields: List[str] = Field(default_factory=list, description="Explicitly unknown attributes")


class CompareCandidatesOutput(BaseModel):
    event_id: str = Field(..., description="Event identifier")
    total_compared: int = Field(..., description="Number of candidates compared")
    comparison_matrix: List[ProviderComparisonEntry] = Field(..., description="Detailed deterministic comparison table")
    deterministic_summary: str = Field(..., description="Summary of objective differences across candidates")


# ==============================================================================
# 4. IMPACT & RISK SCHEMAS
# ==============================================================================

class AnalyzeImpactInput(BaseModel):
    event_id: str = Field(..., description="Unique event identifier")
    incident_id: str = Field(..., description="Incident ID to analyze impact for")


class AnalyzeImpactOutput(BaseModel):
    event_id: str = Field(..., description="Event identifier")
    incident_id: str = Field(..., description="Incident identifier")
    severity: str = Field(..., description="Calculated impact severity (MINOR, MODERATE, MAJOR, CRITICAL)")
    affected_tasks_count: int = Field(..., description="Count of directly and transitively affected tasks")
    affected_tasks: List[Dict[str, Any]] = Field(..., description="Details of affected tasks")
    critical_path_breached: bool = Field(..., description="True if critical path tasks are delayed or threatened")
    schedule_delay_minutes: int = Field(0, description="Projected schedule delay in minutes")
    estimated_budget_impact: float = Field(0.0, description="Projected budget impact delta")
    blocked_tasks: List[str] = Field(default_factory=list, description="List of task IDs blocked by this incident")


class AssessRiskInput(BaseModel):
    event_id: str = Field(..., description="Unique event identifier")
    incident_id: str = Field(..., description="Incident ID to evaluate risk for")


class AssessRiskOutput(BaseModel):
    event_id: str = Field(..., description="Event identifier")
    incident_id: str = Field(..., description="Incident identifier")
    composite_score: float = Field(..., description="Calculated composite risk score (0.0 to 1.0)")
    severity_level: str = Field(..., description="Risk category: LOW, MEDIUM, HIGH, CRITICAL")
    deadline_risk: float = Field(..., description="Deadline risk component (0.0 to 1.0)")
    dependency_risk: float = Field(..., description="Dependency risk component (0.0 to 1.0)")
    provider_risk: float = Field(..., description="Provider / vendor risk component (0.0 to 1.0)")
    budget_risk: float = Field(..., description="Budget risk component (0.0 to 1.0)")
    resource_risk: float = Field(..., description="Resource availability risk component (0.0 to 1.0)")
    factor_breakdown: Dict[str, Any] = Field(default_factory=dict, description="Deterministic risk factor breakdown")


# ==============================================================================
# 5. INCIDENT & RECOVERY SCHEMAS
# ==============================================================================

class GetActiveIncidentsInput(BaseModel):
    event_id: str = Field(..., description="Unique event identifier")


class GetActiveIncidentsOutput(BaseModel):
    event_id: str = Field(..., description="Event identifier")
    open_incidents_count: int = Field(..., description="Count of active incidents")
    incidents: List[Dict[str, Any]] = Field(..., description="List of active incident summaries")


class InspectIncidentInput(BaseModel):
    event_id: str = Field(..., description="Unique event identifier")
    incident_id: str = Field(..., description="Incident identifier to inspect")


class InspectIncidentOutput(BaseModel):
    incident_id: str = Field(..., description="Incident identifier")
    event_id: str = Field(..., description="Event identifier")
    title: str = Field(..., description="Incident title")
    incident_type: str = Field(..., description="Incident type enum")
    severity: str = Field(..., description="Current severity (MINOR, MODERATE, MAJOR, CRITICAL)")
    status: str = Field(..., description="Incident status (OPEN, INVESTIGATING, RESOLVED)")
    detected_at: Optional[str] = Field(None, description="Detection timestamp")
    related_task_id: Optional[str] = Field(None, description="Associated task ID")
    related_vendor_id: Optional[str] = Field(None, description="Associated vendor ID")
    impact_summary: Optional[Dict[str, Any]] = Field(None, description="Summary of calculated impact")
    risk_summary: Optional[Dict[str, Any]] = Field(None, description="Summary of calculated risk")


class GenerateRecoveryOptionsInput(BaseModel):
    event_id: str = Field(..., description="Unique event identifier")
    incident_id: str = Field(..., description="Incident ID to generate recovery candidates for")


class RecoveryOptionSummary(BaseModel):
    id: str = Field(..., description="Recovery option identifier")
    strategy_type: str = Field(..., description="Strategy type (REPLACE_VENDOR, REORDER_TASKS, ADJUST_BUDGET, etc.)")
    status: str = Field(..., description="FEASIBLE or INFEASIBLE")
    is_feasible: bool = Field(..., description="Feasibility flag")
    score: float = Field(..., description="Deterministic score assigned by RecoveryScorer")
    rank: Optional[int] = Field(None, description="Rank among feasible options")
    proposed_changes: List[str] = Field(default_factory=list, description="Summary of proposed operational mutations")
    affected_tasks: List[str] = Field(default_factory=list, description="IDs of affected tasks")
    affected_providers: List[str] = Field(default_factory=list, description="IDs of affected providers")
    budget_delta: float = Field(0.0, description="Financial delta in currency")
    schedule_delta: int = Field(0, description="Schedule delta in minutes")
    risk_after: Optional[Dict[str, Any]] = Field(None, description="Projected risk score after applying option")


class GenerateRecoveryOptionsOutput(BaseModel):
    event_id: str = Field(..., description="Event identifier")
    incident_id: str = Field(..., description="Incident identifier")
    options_count: int = Field(..., description="Total candidate options generated")
    feasible_options_count: int = Field(..., description="Count of feasible candidates")
    options: List[RecoveryOptionSummary] = Field(..., description="Ranked candidate recovery options")


class ValidateRecoveryOptionInput(BaseModel):
    event_id: str = Field(..., description="Unique event identifier")
    incident_id: str = Field(..., description="Incident identifier")
    option_id: str = Field(..., description="Recovery option identifier to validate")


class ValidateRecoveryOptionOutput(BaseModel):
    option_id: str = Field(..., description="Option identifier")
    incident_id: str = Field(..., description="Incident identifier")
    is_feasible: bool = Field(..., description="Feasibility result")
    status: str = Field(..., description="FEASIBLE or INFEASIBLE")
    violations: List[str] = Field(default_factory=list, description="Constraint or domain violations")
    warnings: List[str] = Field(default_factory=list, description="Operational warnings")
    validation_timestamp: Optional[str] = Field(None, description="Timestamp of validation")


class ExecuteRecoveryInput(BaseModel):
    event_id: str = Field(..., description="Unique event identifier")
    recovery_option_id: str = Field(..., description="Recovery option identifier to execute")
    approval_id: Optional[str] = Field(None, description="ApprovalRequest ID if previously submitted and approved")


class ExecuteRecoveryOutput(BaseModel):
    execution_id: str = Field(..., description="Unique ActionExecution ID")
    event_id: str = Field(..., description="Event identifier")
    recovery_option_id: str = Field(..., description="Executed recovery option ID")
    status: str = Field(..., description="Execution status (COMPLETED, FAILED, REQUIRES_APPROVAL)")
    action_type: str = Field(..., description="Action type executed")
    affected_entities: List[Dict[str, Any]] = Field(default_factory=list, description="Entities updated")
    verified: bool = Field(False, description="Whether post-action multi-domain verification passed")
    verification_id: Optional[str] = Field(None, description="Verification result ID if verified")
    requires_approval: bool = Field(False, description="True if action is blocked pending human approval")
    approval_id: Optional[str] = Field(None, description="ApprovalRequest ID if held for approval")


# ==============================================================================
# 6. OBSERVABILITY & TRACE SCHEMAS
# ==============================================================================

class RecordDecisionInput(BaseModel):
    event_id: str = Field(..., description="Unique event identifier")
    decision_type: str = Field(..., description="Operational decision type (e.g. SELECT_OPTION, REJECT_CANDIDATE)")
    rationale: str = Field(..., description="Concise operational rationale (no chain-of-thought)")
    entity_type: Optional[str] = Field(None, description="Target entity type (TASK, VENDOR, INCIDENT)")
    entity_id: Optional[str] = Field(None, description="Target entity ID")
    metadata: Dict[str, Any] = Field(default_factory=dict, description="Structured factual operational metadata")


class RecordDecisionOutput(BaseModel):
    trace_id: str = Field(..., description="Generated trace identifier")
    event_id: str = Field(..., description="Event identifier")
    decision_type: str = Field(..., description="Decision type recorded")
    recorded_at: str = Field(..., description="ISO timestamp")
    success: bool = Field(True, description="True if trace record was successfully committed")


class GetDecisionTraceInput(BaseModel):
    event_id: str = Field(..., description="Unique event identifier")
    verification_id: Optional[str] = Field(None, description="Optional verification ID to trace single execution")
    limit: int = Field(10, ge=1, le=50, description="Max traces to retrieve")


class GetDecisionTraceOutput(BaseModel):
    event_id: str = Field(..., description="Event identifier")
    total: int = Field(..., description="Count of traces returned")
    traces: List[Dict[str, Any]] = Field(..., description="List of factual structured decision traces")
