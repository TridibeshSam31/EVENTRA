/**
 * Authoritative TypeScript Contracts for EVENTRA
 * Synchronized 1:1 with backend FastAPI Pydantic schemas in `apps/api/app/schemas/`
 */

// --- Base Enums ---
export type EventLifecycleState =
  | "DRAFT"
  | "SPECIFIED"
  | "PLANNED"
  | "LIVE"
  | "INCIDENT"
  | "EMERGENCY"
  | "CONCLUDED"
  | "CANCELLED";

export type EventOperationalState =
  | "NORMAL"
  | "AT_RISK"
  | "CRITICAL"
  | "EMERGENCY";

export type TaskStatus =
  | "PENDING"
  | "READY"
  | "IN_PROGRESS"
  | "BLOCKED"
  | "COMPLETED"
  | "FAILED";

export type TaskPriority = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type IncidentType =
  | "VENDOR_NO_SHOW"
  | "VENDOR_DELAY"
  | "VENUE_UNAVAILABLE"
  | "RESOURCE_SHORTAGE"
  | "TASK_FAILURE"
  | "SCHEDULE_BREACH"
  | "BUDGET_OVERRUN"
  | "WEATHER_ALERT"
  | "EQUIPMENT_MALFUNCTION"
  | "SAFETY_HAZARD"
  | "CUSTOM";

export type IncidentSeverity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" | "EMERGENCY";

export type IncidentStatus =
  | "DETECTED"
  | "INVESTIGATING"
  | "ANALYZING"
  | "RECOVERY_PROPOSED"
  | "RECOVERING"
  | "RESOLVED";

export type RecoveryStrategyType =
  | "BACKUP"
  | "RESEQUENCE"
  | "SUBSTITUTE_VENDOR"
  | "REALLOCATE_RESOURCE"
  | "SCOPE_SHED";

export type ApprovalStatus = "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";

export type ImpactLevel = "VIEW" | "MINOR" | "CRITICAL";

// --- Event Schemas ---
export interface EventBase {
  name: string;
  description?: string | null;
  event_type: string;
  location?: string | null;
  start_datetime?: string | null;
  end_datetime?: string | null;
  guest_count: number;
  state: string;
  total_budget: number | string;
  currency: string;
}

export interface EventCreate extends EventBase {
  owner_id: string;
}

export interface EventResponse extends EventBase {
  id: string;
  owner_id?: string | null;
  lifecycle_state?: string;
  created_at: string;
  updated_at: string;
}

// --- Specification Schemas ---
export interface RequirementDefinition {
  name: string;
  type: string;
  description?: string;
  required: boolean;
  value?: Record<string, unknown>;
}

export interface TaskDefinition {
  name: string;
  description?: string;
  priority: string;
  phase?: string;
  required_provider_category?: string;
  duration_minutes?: number;
}

export interface DependencyDefinition {
  predecessor_name: string;
  successor_name: string;
  dependency_type: string;
  lag_minutes?: number;
}

export interface ConstraintDefinition {
  constraint_type: string;
  parameters: Record<string, unknown>;
  description?: string;
}

export interface ObjectiveDefinition {
  title: string;
  priority: string;
  description?: string;
  is_threatened?: boolean;
}

export interface EventSpecification {
  event_id: string;
  title: string;
  description?: string | null;
  event_type: string;
  status?: string;
  start_time: string;
  end_time: string;
  guest_count: number;
  total_budget?: number | null;
  currency: string;
  location?: Record<string, unknown> | null;
  requirements: RequirementDefinition[];
  tasks: TaskDefinition[];
  dependencies: DependencyDefinition[];
  provider_categories: string[];
  constraints: ConstraintDefinition[];
  objectives: ObjectiveDefinition[];
  custom_configuration?: Record<string, unknown>;
  created_at?: string | null;
}

export interface EventSpecificationPreviewRequest {
  event_id?: string;
  title: string;
  description?: string | null;
  event_type: string;
  start_time: string;
  end_time: string;
  guest_count: number;
  total_budget?: number | null;
  currency?: string;
  location?: Record<string, unknown> | null;
  custom_requirements?: RequirementDefinition[];
  constraints?: ConstraintDefinition[];
  objectives?: ObjectiveDefinition[];
  custom_configuration?: Record<string, unknown>;
}

// --- Venue Schemas ---
export interface VenueResponse {
  id: string;
  name: string;
  address?: string | null;
  city: string;
  latitude?: number | null;
  longitude?: number | null;
  capacity: number;
  venue_type: string;
  contact_email?: string | null;
  contact_phone?: string | null;
  hourly_rate?: number | null;
  amenities: string[];
  status: string;
  created_at: string;
  updated_at: string;
}

export interface PaginatedVenuesResponse {
  total: number;
  items: VenueResponse[];
  limit: number;
  offset: number;
}

export interface VenueDiscoveryRequest {
  city?: string;
  query?: string;
  latitude?: number;
  longitude?: number;
  limit?: number;
  save_to_db?: boolean;
}

export interface VenueDiscoveryResponse {
  total_discovered: number;
  total_created: number;
  city: string;
  source: string;
  items: VenueResponse[];
}


export interface VenueAvailabilityResult {
  venue_id: string;
  is_available: boolean;
  conflicting_slots?: Array<Record<string, unknown>>;
}

export interface VenueSuitabilityCheck {
  guest_count: number;
  required_amenities?: string[];
  max_hourly_rate?: number;
}

export interface VenueSuitabilityResult {
  venue_id: string;
  is_suitable: boolean;
  score: number;
  capacity_match: boolean;
  amenity_match: boolean;
  budget_match: boolean;
  reasons: string[];
}

// --- Vendor / Provider Schemas ---
export interface VendorResponse {
  id: string;
  name: string;
  category: string;
  city: string;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  rating?: number | null;
  review_count?: number | null;
  distance_km?: number | null;
  is_assigned?: boolean;
  maps_url?: string | null;
  phone?: string | null;
  website?: string | null;
  hourly_rate?: number | null;
  capabilities?: string[];
  contact_name?: string | null;
  contact_email?: string | null;
  contact_phone?: string | null;
  base_cost?: number | null;
  service_description?: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export type DiscoveryEntityType = "VENUE" | "PROVIDER";

export interface DiscoveryMapEntity {
  id: string;
  name: string;
  entity_type: DiscoveryEntityType;
  category: string;
  latitude: number;
  longitude: number;
  address: string;
  city: string;
  rating?: number | null;
  review_count?: number | null;
  distance_km?: number | null;
  maps_url?: string | null;
  phone?: string | null;
  website?: string | null;
  hourly_rate?: number | null;
  capacity?: number | null;
  amenities?: string[];
  capabilities?: string[];
  status?: string;
  is_assigned?: boolean;
}

export interface PaginatedVendorsResponse {
  total: number;
  items: VendorResponse[];
  limit: number;
  offset: number;
}

export interface VendorAssignmentCreate {
  event_id: string;
  vendor_id: string;
  category: string;
  agreed_cost?: number | null;
  notes?: string | null;
}

export interface VendorAssignmentResponse {
  id: string;
  event_id: string;
  vendor_id: string;
  category: string;
  status: string;
  agreed_cost?: number | null;
  notes?: string | null;
  assigned_at?: string;
  created_at?: string;
  updated_at?: string;
  vendor?: VendorResponse | null;
  // Negotiation extensions
  negotiation_status?: string;
  negotiation_round?: string;
  target_amount?: number | null;
  max_approved_amount?: number | null;
  quoted_amount?: number | null;
  currency?: string;
  coverage_start?: string | null;
  coverage_end?: string | null;
  provider_count?: number;
  advance_required?: boolean | null;
  approval_id?: string | null;
  is_simulation?: boolean;
}


export interface ProviderAvailabilityResult {
  vendor_id: string;
  is_available: boolean;
  conflicting_slots?: Array<Record<string, unknown>>;
}

export interface CategoryValidationResult {
  domain: string;
  category: string;
  is_valid: boolean;
  is_required: boolean;
}

// --- Planning Engine Schemas ---
export interface PlanTaskEntry {
  id: string;
  key?: string | null;
  name: string;
  description?: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  phase?: string | null;
  required_provider_category?: string | null;
  duration_minutes?: number | null;
  is_critical_path: boolean;
  planned_start?: string | null;
  planned_end?: string | null;
}

export interface PlanDependencyEntry {
  id: string;
  predecessor_task_id: string;
  successor_task_id: string;
  dependency_type: string;
  lag_minutes: number;
}

export interface PlanResourceEntry {
  id: string;
  name: string;
  type: string;
  quantity: number;
  unit: string;
  status: string;
  allocated_task_id?: string | null;
}

export interface PlanBudgetEntry {
  id: string;
  name: string;
  category: string;
  estimated_amount: number;
  actual_amount: number;
  currency: string;
  status: string;
}

export interface PlanSummary {
  total_tasks: number;
  total_dependencies: number;
  total_resources: number;
  total_budget_items: number;
  total_estimated_budget: number;
  critical_path_tasks: number;
  lifecycle_state: string;
}

export interface EventPlan {
  event_id: string;
  event_name: string;
  event_type: string;
  lifecycle_state: string;
  summary: PlanSummary;
  tasks: PlanTaskEntry[];
  dependencies: PlanDependencyEntry[];
  resources: PlanResourceEntry[];
  budget_items: PlanBudgetEntry[];
}

// --- Schedule Engine Schemas ---
export interface TaskScheduleResponse {
  task_id: string;
  task_name: string;
  planned_start?: string | null;
  planned_end?: string | null;
  duration_minutes: number;
  slack_minutes?: number | null;
  is_critical_path: boolean;
}

export interface CriticalPathResponse {
  critical_path_tasks: string[];
  total_duration_minutes: number;
}

export interface ScheduleResponse {
  event_id: string;
  event_start: string;
  event_end: string;
  project_end?: string | null;
  total_duration_minutes: number;
  is_feasible: boolean;
  buffer_minutes: number;
  entries: TaskScheduleResponse[];
  critical_path: CriticalPathResponse;
}

// --- Budget Engine Schemas ---
export interface BudgetItemResponse {
  id: string;
  event_id: string;
  name: string;
  category: string;
  estimated_amount: number | string;
  actual_amount: number | string;
  currency: string;
  status: string;
}

export interface BudgetSummaryResponse {
  event_id: string;
  total_estimated: number;
  total_actual: number;
  total_budget: number;
  remaining: number;
  item_count: number;
  categories: Record<string, number>;
  items: BudgetItemResponse[];
}

export interface BudgetViolationResponse {
  category: string;
  violation_type: string;
  amount: number;
  description: string;
}

export interface BudgetValidationResponse {
  is_valid: boolean;
  violations: BudgetViolationResponse[];
}

// --- Live State Schemas ---
export interface TaskProgress {
  task_id: string;
  task_name: string;
  key?: string | null;
  status: string;
  priority: string;
  planned_start?: string | null;
  planned_end?: string | null;
  actual_start?: string | null;
  actual_end?: string | null;
  is_critical_path: boolean;
  deviation_minutes: number;
  deviation_type?: string | null;
}

export interface ScheduleDeviationResponse {
  task_id: string;
  task_name: string;
  deviation_type: string;
  planned_value?: string | null;
  actual_value?: string | null;
  deviation_minutes: number;
}

export interface BudgetDeviationResponse {
  total_budget: number;
  total_spent: number;
  total_estimated: number;
  variance: number;
  is_over_budget: boolean;
}

export interface EventLiveState {
  event_id: string;
  event_name: string;
  event_type: string;
  lifecycle_state: string;
  task_summary: Record<string, number>;
  total_tasks: number;
  completed_tasks: number;
  progress_percent: number;
  task_progress: TaskProgress[];
  schedule_deviations: ScheduleDeviationResponse[];
  budget_deviation?: BudgetDeviationResponse | null;
}

// --- Incident, Impact & Risk Schemas ---
export interface IncidentCreate {
  incident_type: IncidentType | string;
  title: string;
  description?: string | null;
  severity?: IncidentSeverity | string;
  source?: string;
  occurred_at?: string | null;
  related_task_id?: string | null;
  related_vendor_id?: string | null;
  related_resource_id?: string | null;
  related_venue_id?: string | null;
  evidence_metadata?: Record<string, unknown> | null;
}

export interface ImpactResultResponse {
  incident_id: string;
  directly_affected_tasks: Array<Record<string, unknown>>;
  indirectly_affected_tasks: Array<Record<string, unknown>>;
  blocked_tasks: Array<Record<string, unknown>>;
  affected_dependencies: Array<Record<string, unknown>>;
  dependency_depth: number;
  affected_resources: Array<Record<string, unknown>>;
  affected_providers: Array<Record<string, unknown>>;
  schedule_impact: Record<string, unknown>;
  budget_impact: Record<string, unknown>;
  affected_objectives: Array<Record<string, unknown>>;
  affected_constraints: Array<Record<string, unknown>>;
  severity: string;
  generated_at: string;
}

export interface RiskFactor {
  name: string;
  score: number;
  weight: number;
  weighted_score: number;
  description: string;
}

export interface RiskResultResponse {
  incident_id: string;
  score: number;
  level: string;
  factors: RiskFactor[];
  affected_objectives: string[];
  critical_constraints: string[];
  target_event_state: string;
  calculated_at: string;
}

export interface IncidentResponse {
  id: string;
  event_id: string;
  incident_type: string;
  title: string;
  description?: string | null;
  severity: IncidentSeverity | string;
  status: IncidentStatus | string;
  source: string;
  occurred_at?: string | null;
  related_task_id?: string | null;
  related_vendor_id?: string | null;
  related_resource_id?: string | null;
  related_venue_id?: string | null;
  evidence_metadata?: Record<string, unknown> | null;
  detected_at: string;
  impact_result?: ImpactResultResponse | Record<string, unknown> | null;
  risk_result?: RiskResultResponse | Record<string, unknown> | null;
  resolution_notes?: string | null;
  resolved_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface IncidentListResponse {
  total: number;
  items: IncidentResponse[];
  limit: number;
  offset: number;
}

// --- Recovery Schemas ---
export interface RecoveryOptionResponse {
  id: string;
  event_id: string;
  incident_id: string;
  strategy_type: string;
  status: string;
  is_feasible: boolean;
  is_stale: boolean;
  score?: number | null;
  rank?: number | null;
  affected_tasks: string[];
  affected_providers: string[];
  affected_resources: string[];
  proposed_changes: Record<string, unknown>;
  schedule_delta: Record<string, unknown>;
  budget_delta: Record<string, unknown>;
  resource_delta: Record<string, unknown>;
  provider_delta: Record<string, unknown>;
  objective_delta: Record<string, unknown>;
  constraint_impact: Record<string, unknown>;
  risk_before: Record<string, unknown>;
  risk_after: Record<string, unknown>;
  feasibility_result: Record<string, unknown>;
  generated_at: string;
}

export interface RecoveryOptionListResponse {
  incident_id: string;
  state_snapshot: string;
  items: RecoveryOptionResponse[];
}

// --- Approvals & Governance Schemas ---
export interface ApprovalRequestResponse {
  id: string;
  event_id: string;
  requester_id: string;
  approver_id?: string | null;
  action_type: string;
  target_type: string;
  target_id?: string | null;
  impact_level: string;
  requested_action: Record<string, unknown>;
  recovery_option_id?: string | null;
  status: ApprovalStatus | string;
  state_snapshot: string;
  rejection_reason?: string | null;
  decision_notes?: string | null;
  decided_at?: string | null;
  expires_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ApprovalRequestListResponse {
  total: number;
  items: ApprovalRequestResponse[];
  limit: number;
  offset: number;
}

// --- Action Execution Schemas ---
export interface AuthorizationDecisionResponse {
  allowed: boolean;
  requires_approval: boolean;
  reason: string;
  action_type: string;
  impact_level: string;
  required_permission: string;
  required_role?: string | null;
  approval_policy?: string | null;
  approval_request_id?: string | null;
  event_id: string;
  target_id?: string | null;
}

export interface ActionExecutionResponse {
  id: string;
  action_id: string;
  event_id: string;
  action_type: string;
  status: string;
  approval_request_id?: string | null;
  recovery_option_id?: string | null;
  executor_id: string;
  affected_entities: Array<Record<string, unknown>>;
  before_version: string;
  after_version: string;
  failure_reason?: string | null;
  execution_result_data: Record<string, unknown>;
  executed_at: string;
}

export interface ActionSubmissionResponse {
  decision: AuthorizationDecisionResponse;
  execution?: ActionExecutionResponse | null;
  approval_request?: ApprovalRequestResponse | null;
}

// --- Verification Schemas ---
export interface VerificationResultResponse {
  id: string;
  event_id: string;
  action_execution_id?: string | null;
  recovery_option_id?: string | null;
  status: "VERIFIED" | "PARTIALLY_VERIFIED" | "FAILED" | string;
  intended_outcome: Record<string, unknown>;
  actual_outcome: Record<string, unknown>;
  objective_results: Array<Record<string, unknown>>;
  schedule_result: Record<string, unknown>;
  budget_result: Record<string, unknown>;
  resource_result: Record<string, unknown>;
  provider_result: Record<string, unknown>;
  venue_result: Record<string, unknown>;
  constraint_result: Record<string, unknown>;
  risk_before?: string | null;
  risk_after?: string | null;
  event_state_before?: string | null;
  event_state_after?: string | null;
  state_snapshot: string;
  failure_reasons: string[];
  warnings: string[];
  verified_at: string;
  created_at: string;
  updated_at: string;
}

export interface VerificationListResponse {
  total: number;
  items: VerificationResultResponse[];
}

// --- Observability Schemas ---
export interface AuditRecordResponse {
  id: string;
  event_id: string;
  actor_id?: string | null;
  actor_type: string;
  action: string;
  action_type: string;
  target_type?: string | null;
  target_id?: string | null;
  before_state?: Record<string, unknown> | null;
  after_state?: Record<string, unknown> | null;
  impact_level?: string | null;
  approval_id?: string | null;
  execution_id?: string | null;
  verification_id?: string | null;
  failure_reason?: string | null;
  created_at: string;
}

export interface AuditListResponse {
  total: number;
  items: AuditRecordResponse[];
}

export interface ActivityEntryResponse {
  id: string;
  timestamp?: string | null;
  category: string;
  summary: string;
  status: string;
  actor_id?: string | null;
  details: Record<string, unknown>;
}

export interface ActivityListResponse {
  total: number;
  items: ActivityEntryResponse[];
}

export interface DecisionTraceResponse {
  trace_id: string;
  event_id: string;
  verification_id: string;
  timestamp: string;
  incident?: Record<string, unknown> | null;
  impact_and_risk: Record<string, unknown>;
  recovery_option?: Record<string, unknown> | null;
  approval?: Record<string, unknown> | null;
  execution?: Record<string, unknown> | null;
  verification: Record<string, unknown>;
  event_state: Record<string, unknown>;
}

export interface StateTransitionEntryResponse {
  id: string;
  event_id: string;
  entity_type: string;
  entity_id: string;
  previous_state: string;
  new_state: string;
  reason?: string | null;
  transitioned_at: string;
}

export interface StateHistoryResponse {
  total: number;
  items: StateTransitionEntryResponse[];
}

// --- Agent Schemas ---
export interface AgentRunRequest {
  message: string;
  approval_id?: string | null;
}

export interface ToolHistoryEntry {
  step: number;
  tool: string;
  arguments?: Record<string, unknown>;
  status: string;
  reason_code?: string;
  result_summary?: string;
}

export interface AgentRunResponse {
  run_id?: string;
  event_id: string;
  objective?: string;
  status: string;
  termination_status?: string;
  response?: string | null;
  active_incident_id?: string | null;
  incident?: Record<string, unknown> | null;
  impact?: Record<string, unknown> | null;
  risk?: Record<string, unknown> | null;
  recovery_options?: Array<Record<string, unknown>> | null;
  selected_option?: Record<string, unknown> | null;
  authorization?: Record<string, unknown> | null;
  approval_id?: string | null;
  approval?: Record<string, unknown> | null;
  execution?: Record<string, unknown> | null;
  verification?: Record<string, unknown> | null;
  decision_trace?: Record<string, unknown> | null;
  operational_intent?: string | null;
  provider_operation?: Record<string, unknown> | null;
  tool_history?: ToolHistoryEntry[];
  error?: string | null;
  step_count?: number | null;
}

// --- Integration Schemas ---
export interface NotificationItem {
  id: string;
  event_id: string;
  notification_type: string;
  channel: string;
  recipient?: string | null;
  title: string;
  message: string;
  status: string;
  created_at: string;
}

export interface ProviderMessage {
  id: string;
  event_id: string;
  provider_id: string;
  direction: "OUTBOUND" | "INBOUND";
  message: string;
  status?: string;
  timestamp: string;
}

// ==============================================================================
// TASK 9: FINAL EXECUTION PLAN CONTRACTS
// ==============================================================================
export type PlanReadiness = "READY" | "PARTIALLY_READY" | "BLOCKED" | "INCOMPLETE";

export interface PlanBlocker {
  task_id?: string | null;
  reason_code: string;
  message: string;
  severity: string;
}

export interface PlanWarning {
  task_id?: string | null;
  reason_code: string;
  message: string;
  severity: string;
}

export interface UnresolvedUnknown {
  task_id?: string | null;
  provider_id?: string | null;
  category?: string | null;
  field: string;
  description: string;
  is_critical: boolean;
}

export interface TaskPredecessorInfo {
  task_id: string;
  task_name: string;
  status: string;
  planned_end?: string | null;
}

export interface TaskSuccessorInfo {
  task_id: string;
  task_name: string;
  status: string;
  planned_start?: string | null;
}

export interface ExecutionPlanTask {
  task_id: string;
  task_name: string;
  description?: string | null;
  status: string;
  phase?: string | null;
  required_provider_category?: string | null;
  assigned_provider_id?: string | null;
  assigned_provider_name?: string | null;
  assigned_provider_category?: string | null;
  is_assigned: boolean;
  planned_start?: string | null;
  planned_end?: string | null;
  duration_minutes: number;
  slack_minutes?: number | null;
  is_critical_path: boolean;
  predecessors: TaskPredecessorInfo[];
  successors: TaskSuccessorInfo[];
  budget_allocation?: number | string | null;
  committed_amount?: number | string | null;
  requirements: string[];
  resources: string[];
  readiness_state: string;
  operational_notes?: string | null;
}

export interface CriticalPathEntry {
  sequence_order: number;
  task_id: string;
  task_name: string;
  planned_start?: string | null;
  planned_end?: string | null;
  duration_minutes: number;
  slack_minutes: number;
  assigned_provider_name?: string | null;
  status: string;
}

export interface ExecutionCheckpoint {
  checkpoint_id: string;
  time: string;
  title: string;
  description: string;
  task_id?: string | null;
  checkpoint_type: "START" | "COMPLETION" | "VERIFICATION" | "DEADLINE";
}

export interface BudgetSummaryPlan {
  total_budget: number | string;
  total_committed: number | string;
  total_estimated: number | string;
  remaining_budget: number | string;
  uncommitted_allocation: number | string;
  currency: string;
  is_over_budget: boolean;
  utilization_percent: number | string;
  category_commitments: Record<string, number | string>;
}

export interface ResourceSummaryPlan {
  total_resources: number;
  allocated_count: number;
  available_count: number;
  depleted_count: number;
  items: Array<Record<string, unknown>>;
}

export interface EventSummary {
  event_id: string;
  event_name: string;
  event_type: string;
  location?: string | null;
  start_datetime?: string | null;
  end_datetime?: string | null;
  guest_count: number;
  lifecycle_state: string;
  total_budget: number | string;
  currency: string;
}

export interface CurrentAndNextTasks {
  current_task?: ExecutionPlanTask | null;
  next_task?: ExecutionPlanTask | null;
  position_note?: string | null;
}

export interface FinalExecutionPlan {
  plan_id: string;
  event_id: string;
  plan_version: number;
  generated_at: string;
  event_summary: EventSummary;
  readiness_status: PlanReadiness;
  tasks: ExecutionPlanTask[];
  critical_path: CriticalPathEntry[];
  total_critical_duration_minutes: number;
  budget_summary: BudgetSummaryPlan;
  resource_summary: ResourceSummaryPlan;
  current_and_next?: CurrentAndNextTasks | null;
  execution_checkpoints: ExecutionCheckpoint[];
  blockers: PlanBlocker[];
  warnings: PlanWarning[];
  unresolved_unknowns: UnresolvedUnknown[];
  operational_focus?: string | null;
  is_consistent: boolean;
  consistency_errors: string[];
}

// --- Phase 11: Real Pause / Resume (Task 11) ---
export type EventExecutionState = "RUNNING" | "PAUSING" | "PAUSED" | "RESUMING";

export interface EventExecutionStateResponse {
  event_id: string;
  execution_state: EventExecutionState;
  previous_state?: string | null;
  plan_version: number;
  is_paused: boolean;
  can_pause: boolean;
  can_resume: boolean;
  active_incidents_count: number;
  last_pause_record?: Record<string, unknown> | null;
  updated_at?: string | null;
}

export interface PauseResumeRecordResponse {
  id: string;
  event_id: string;
  operation_type: "PAUSE" | "RESUME";
  requested_by: string;
  requested_at: string;
  reason?: string | null;
  previous_state: string;
  target_state: string;
  plan_version: number;
  status: string;
  approval_reference?: string | null;
  validation_result?: Record<string, unknown> | null;
  completed_at?: string | null;
  audit_reference?: string | null;
}

