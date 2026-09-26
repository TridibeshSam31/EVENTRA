"""Central Typed Tool Registry for EVENTRA Agent Operations (Task 3 & Task 4).

Coordinates:
- Tool registration, duplicate prevention, and categorization
- Strict input validation against Pydantic schemas
- Single common execution pipeline:
    Agent Request -> Tool Lookup -> Input Validation -> Permission Check -> Approval Gate -> Deterministic Service -> Result -> Trace
- Runtime availability checks (rejects disabled / unsupported tools)
- Model-friendly Gemini FunctionDeclarations for autonomous tool calling
- Execution trace recording with recursive secret redaction
- Task 4 default_registry compatibility for EventOperationsAgent LangGraph
"""
import logging
import time
import uuid
from typing import Any, Callable, Dict, List, Optional, Type
from pydantic import BaseModel, Field, ValidationError
from sqlalchemy.orm import Session

from app.agent.tools.base import (
    AgentTool,
    ToolCategory,
    ToolAccessMode,
    ToolAvailabilityStatus,
    ToolResultStatus,
    ToolResult,
    ToolContext,
    ExecutionTraceRecord,
)
from app.agent.tools.errors import (
    UnknownToolError,
    InvalidToolInputError,
    PermissionDeniedError,
    ApprovalRequiredError,
    UnsupportedToolError,
    ToolTimeoutError,
    ToolExecutionFailedError,
)

logger = logging.getLogger(__name__)

# Task 4 status alias
ToolStatus = ToolResultStatus


# ==============================================================================
# TASK 4: FUNCTIONAL TOOL DEFINITIONS & HANDLERS
# ==============================================================================

class ToolDefinition(BaseModel):
    """Metadata and specification for a functional agent tool (Task 4)."""
    name: str = Field(..., description="Unique tool identifier")
    description: str = Field(..., description="Clear operational description of the tool")
    category: ToolCategory = Field(..., description="READ, COMPUTATIONAL, or WRITE")
    parameters_schema: Optional[Type[BaseModel]] = Field(None, description="Pydantic schema for tool arguments")
    requires_approval: bool = Field(False, description="Whether this tool represents a consequential mutation")
    permission_action: Optional[str] = Field(None, description="Authorization action type checked if WRITE")

    model_config = {"arbitrary_types_allowed": True}


# --- Tool Input Schemas for Task 4 Functional Tools ---

class GetEventStateInput(BaseModel):
    event_id: str = Field(..., description="Event UUID")


class GetEventSpecInput(BaseModel):
    event_id: str = Field(..., description="Event UUID")


class GetOperationalStatusInput(BaseModel):
    event_id: str = Field(..., description="Event UUID")


class GetIncidentsInput(BaseModel):
    event_id: str = Field(..., description="Event UUID")


class GetIncidentDetailsInput(BaseModel):
    event_id: str = Field(..., description="Event UUID")
    incident_id: str = Field(..., description="Incident UUID")


class GetTaskInput(BaseModel):
    event_id: str = Field(..., description="Event UUID")
    task_id: Optional[str] = Field(None, description="Optional specific task UUID")
    category: Optional[str] = Field(None, description="Optional provider category filter")


class GetProviderStatusInput(BaseModel):
    event_id: str = Field(..., description="Event UUID")
    category: Optional[str] = Field(None, description="Provider category, e.g. 'photography', 'catering'")
    vendor_id: Optional[str] = Field(None, description="Optional vendor UUID")


class AnalyzeImpactInput(BaseModel):
    event_id: str = Field(..., description="Event UUID")
    incident_id: str = Field(..., description="Incident UUID")


class AssessRiskInput(BaseModel):
    event_id: str = Field(..., description="Event UUID")
    incident_id: str = Field(..., description="Incident UUID")


class GenerateRecoveryOptionsInput(BaseModel):
    event_id: str = Field(..., description="Event UUID")
    incident_id: str = Field(..., description="Incident UUID")


class ValidateRecoveryOptionInput(BaseModel):
    event_id: str = Field(..., description="Event UUID")
    incident_id: str = Field(..., description="Incident UUID")
    option_id: str = Field(..., description="Recovery option UUID")


class CalculateResourceRequirementsInput(BaseModel):
    event_id: str = Field(..., description="Event UUID")
    new_guest_count: int = Field(..., description="New total guest count")
    original_guest_count: Optional[int] = Field(None, description="Prior guest count")


class RequestActionApprovalInput(BaseModel):
    event_id: str = Field(..., description="Event UUID")
    action_type: str = Field(..., description="Action type, e.g. REASSIGN_VENDOR, ADJUST_SCHEDULE, PROCURE_RESOURCES")
    target_type: str = Field(..., description="Target type, e.g. TASK, VENDOR, BUDGET")
    target_id: Optional[str] = Field(None, description="Target entity ID")
    requested_action: Optional[Dict[str, Any]] = Field(default_factory=dict, description="Proposed payload")
    recovery_option_id: Optional[str] = Field(None, description="Optional associated recovery option ID")
    notes: Optional[str] = Field(None, description="Operational justification")


class CheckApprovalStatusInput(BaseModel):
    approval_id: str = Field(..., description="Approval request UUID")


class ExecuteActionInput(BaseModel):
    event_id: str = Field(..., description="Event UUID")
    recovery_option_id: Optional[str] = Field(None, description="Recovery option UUID to execute")
    action_id: Optional[str] = Field(None, description="Optional specific action ID")
    approval_request_id: Optional[str] = Field(None, description="Authoritative approval ID if required")


class VerifyActionInput(BaseModel):
    event_id: str = Field(..., description="Event UUID")
    action_execution_id: str = Field(..., description="Action execution ID returned by execute_action")


class ModifyEventPlanInput(BaseModel):
    event_id: str = Field(..., description="Event UUID")
    modification: str = Field(..., description="Operational change description")


class GetDecisionTraceInput(BaseModel):
    event_id: str = Field(..., description="Event UUID")
    verification_id: Optional[str] = Field(None, description="Optional verification ID")


class GetRecoveryStatusInput(BaseModel):
    event_id: str = Field(..., description="Event UUID")
    incident_id: Optional[str] = Field(None, description="Optional incident UUID")


InspectIncidentInput = GetIncidentDetailsInput
RunImpactAnalysisInput = AnalyzeImpactInput
ExecuteRecoveryInput = ExecuteActionInput
VerifyRecoveryInput = VerifyActionInput


class PauseEventInput(BaseModel):
    event_id: str = Field(..., description="Event UUID")
    reason: str = Field(..., description="Operational rationale for pausing execution")
    plan_version: Optional[int] = Field(None, ge=1, description="Observed Task 9 plan version for concurrency safety")
    approval_id: Optional[str] = Field(None, description="Optional approved approval reference")


class ResumeEventInput(BaseModel):
    event_id: str = Field(..., description="Event UUID")
    reason: Optional[str] = Field(None, description="Optional operational rationale for resuming execution")
    plan_version: Optional[int] = Field(None, ge=1, description="Observed Task 9 plan version for concurrency safety")
    approval_id: Optional[str] = Field(None, description="Optional approved approval reference")


class GetExecutionStateInput(BaseModel):
    event_id: str = Field(..., description="Event UUID")


# --- Central Tool Registry for Task 4 ---

class ToolRegistry:
    """Central registry and governance execution boundary for Task 4 agent tools."""

    def __init__(self):
        self._tools: Dict[str, ToolDefinition] = {}
        self._handlers: Dict[str, Callable] = {}

    def register(
        self,
        name: str,
        description: str,
        category: ToolCategory,
        handler: Callable,
        parameters_schema: Optional[Type[BaseModel]] = None,
        requires_approval: bool = False,
        permission_action: Optional[str] = None,
    ) -> None:
        """Registers a typed tool into the registry."""
        tool_def = ToolDefinition(
            name=name,
            description=description,
            category=category,
            parameters_schema=parameters_schema,
            requires_approval=requires_approval,
            permission_action=permission_action,
        )
        self._tools[name] = tool_def
        self._handlers[name] = handler

    def get(self, name: str) -> Optional[ToolDefinition]:
        return self._tools.get(name)

    def list_tools(
        self,
        category: Optional[ToolCategory] = None,
    ) -> List[ToolDefinition]:
        if category:
            return [t for t in self._tools.values() if t.category == category]
        return list(self._tools.values())

    def get_tool_schemas(self) -> List[Dict[str, Any]]:
        """Returns tool definitions for prompt inclusion."""
        schemas = []
        for name, tool in self._tools.items():
            param_props = {}
            required = []
            if tool.parameters_schema:
                schema = tool.parameters_schema.model_json_schema()
                param_props = schema.get("properties", {})
                required = schema.get("required", [])

            schemas.append({
                "name": name,
                "description": tool.description,
                "category": tool.category.value,
                "requires_approval": tool.requires_approval,
                "parameters": {
                    "type": "object",
                    "properties": param_props,
                    "required": required,
                },
            })
        return schemas

    def execute(
        self,
        tool_name: str,
        arguments: Dict[str, Any],
        db: Session,
        user_id: str = "anonymous_operator",
        event_id: Optional[str] = None,
        approval_id: Optional[str] = None,
    ) -> ToolResult:
        """Executes a tool within strict validation, authorization, and error boundaries."""
        # 1. Unknown tool check
        tool_def = self._tools.get(tool_name)
        if not tool_def:
            logger.warning("Agent requested unknown tool: %s", tool_name)
            return ToolResult(
                status=ToolStatus.FAILURE,
                error_code="UNKNOWN_TOOL",
                message=f"Tool '{tool_name}' is not registered in the tool registry. Available tools: {list(self._tools.keys())}",
            )

        handler = self._handlers.get(tool_name)
        if not handler:
            return ToolResult(
                status=ToolStatus.FAILURE,
                error_code="MISSING_HANDLER",
                message=f"No execution handler registered for tool '{tool_name}'.",
            )

        # 2. Argument validation against Pydantic schema
        clean_args = dict(arguments or {})
        if event_id and "event_id" not in clean_args:
            clean_args["event_id"] = event_id
        if approval_id and "approval_request_id" not in clean_args and "approval_id" not in clean_args:
            clean_args["approval_request_id"] = approval_id

        if tool_def.parameters_schema:
            try:
                validated_model = tool_def.parameters_schema.model_validate(clean_args)
                clean_args = validated_model.model_dump()
            except ValidationError as ve:
                logger.warning("Tool argument validation failed for %s: %s", tool_name, ve)
                return ToolResult(
                    status=ToolStatus.FAILURE,
                    error_code="INVALID_ARGUMENTS",
                    message=f"Validation failed for tool '{tool_name}': {str(ve)}",
                    data={"errors": ve.errors()},
                )

        # 3. Permission & Approval Boundary for consequential WRITE tools
        if tool_def.category == ToolCategory.WRITE and tool_def.requires_approval:
            active_appr_id = clean_args.get("approval_request_id") or clean_args.get("approval_id") or approval_id
            from app.agent.tools.operations_tools import check_approval_status
            is_approved = False
            if active_appr_id:
                try:
                    appr_rec = check_approval_status(db, active_appr_id)
                    is_approved = appr_rec.get("is_approved", False)
                except Exception:
                    is_approved = False

            if not is_approved:
                logger.info("Tool %s requires approval before execution; not pre-approved.", tool_name)
                return ToolResult(
                    status=ToolStatus.REQUIRES_APPROVAL,
                    requires_approval=True,
                    error_code="APPROVAL_REQUIRED",
                    message=f"Tool '{tool_name}' constitutes a consequential operational action requiring human approval.",
                    data={"requires_approval": True, "action_type": tool_def.permission_action or tool_name},
                )

        # 4. Safe execution
        try:
            raw_result = handler(db=db, user_id=user_id, **clean_args)
            if isinstance(raw_result, ToolResult):
                return raw_result
            return ToolResult(
                status=ToolStatus.SUCCESS,
                data=raw_result,
                message=f"Tool '{tool_name}' executed successfully.",
            )
        except Exception as exc:
            logger.error("Error executing tool %s: %s", tool_name, exc, exc_info=True)
            return ToolResult(
                status=ToolStatus.FAILURE,
                error_code="EXECUTION_ERROR",
                message=f"Tool '{tool_name}' execution failed: {str(exc)}",
            )


# --- Handlers connecting tools to deterministic services ---

def _handle_get_event_state(db: Session, user_id: str, event_id: str) -> Dict[str, Any]:
    from app.agent.tools.operations_tools import get_event_state
    return get_event_state(db, event_id)


def _handle_get_event_spec(db: Session, user_id: str, event_id: str) -> Dict[str, Any]:
    from app.models.event import Event
    from app.services.specification_service import SpecificationService
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise ValueError(f"Event '{event_id}' not found.")
    spec_svc = SpecificationService(db)
    spec = spec_svc.build_specification(event)
    return spec.model_dump()


def _handle_get_operational_status(db: Session, user_id: str, event_id: str) -> Dict[str, Any]:
    from app.agent.tools.operations_tools import get_event_state, get_incidents
    state = get_event_state(db, event_id)
    incidents = get_incidents(db, event_id)
    return {
        "event_state": state.get("state"),
        "lifecycle_state": state.get("lifecycle_state"),
        "open_incidents_count": len(incidents),
        "critical_tasks_count": state.get("task_counts", {}).get("critical_path", 0),
        "blocked_tasks_count": state.get("task_counts", {}).get("blocked", 0),
        "budget_remaining": state.get("budget_remaining", 0),
    }


def _handle_get_incidents(db: Session, user_id: str, event_id: str) -> List[Dict[str, Any]]:
    from app.agent.tools.operations_tools import get_incidents
    return get_incidents(db, event_id)


def _handle_get_incident_details(db: Session, user_id: str, event_id: str, incident_id: str) -> Dict[str, Any]:
    from app.agent.tools.operations_tools import get_incident_details
    return get_incident_details(db, event_id, incident_id)


def _handle_get_task(db: Session, user_id: str, event_id: str, task_id: Optional[str] = None, category: Optional[str] = None) -> Any:
    from app.models.task import Task
    query = db.query(Task).filter(Task.event_id == event_id)
    if task_id:
        task = query.filter(Task.id == task_id).first()
        if not task:
            raise ValueError(f"Task '{task_id}' not found.")
        return {
            "id": task.id,
            "name": task.name,
            "status": task.status,
            "priority": task.priority,
            "is_critical_path": task.is_critical_path,
            "planned_start": task.planned_start.isoformat() if task.planned_start else None,
            "planned_end": task.planned_end.isoformat() if task.planned_end else None,
            "assigned_vendor_id": getattr(task, "assigned_vendor_id", None),
            "required_provider_category": task.required_provider_category,
        }
    if category:
        query = query.filter(Task.required_provider_category == category)
    tasks = query.all()
    return [
        {
            "id": t.id,
            "name": t.name,
            "status": t.status,
            "priority": t.priority,
            "is_critical_path": t.is_critical_path,
            "required_provider_category": t.required_provider_category,
        }
        for t in tasks
    ]


def _handle_get_provider_status(db: Session, user_id: str, event_id: str, category: Optional[str] = None, vendor_id: Optional[str] = None) -> Any:
    from app.models.vendor_assignment import VendorAssignment
    from app.models.vendor import Vendor
    query = db.query(VendorAssignment).filter(VendorAssignment.event_id == event_id)
    if category:
        query = query.filter(VendorAssignment.category.ilike(f"%{category}%"))
    if vendor_id:
        query = query.filter(VendorAssignment.vendor_id == vendor_id)
    assignments = query.all()
    if not assignments:
        return {
            "found": False,
            "status": "UNKNOWN",
            "message": f"No active provider assignment found for category '{category or 'any'}'. Status remains UNKNOWN.",
        }
    results = []
    for a in assignments:
        vendor = db.query(Vendor).filter(Vendor.id == a.vendor_id).first() if a.vendor_id else None
        results.append({
            "assignment_id": a.id,
            "vendor_name": vendor.name if vendor else "Unassigned",
            "category": a.category,
            "negotiation_status": a.negotiation_status,
            "contact_channel": getattr(a, "contact_channel", "DIRECT"),
            "quoted_amount": float(a.quoted_amount) if a.quoted_amount else None,
            "agreed_cost": float(a.agreed_cost) if a.agreed_cost else None,
            "has_responded": a.negotiation_status not in ("CONTACTED", "NO_RESPONSE", "PENDING"),
        })
    return {"found": True, "assignments": results}


def _handle_discover_providers(db: Session, user_id: str, event_id: str, **kwargs) -> Any:
    from app.agent.tools.provider_tools import DiscoverProvidersTool
    from app.agent.tools.schemas import DiscoverProvidersInput
    tool = DiscoverProvidersTool()
    args_dict = {"event_id": event_id, **kwargs}
    args_model = DiscoverProvidersInput.model_validate(args_dict)
    ctx = ToolContext(db=db, user_id=user_id, event_id=event_id)
    res = tool.execute(ctx, args_model)
    return res.data.model_dump() if res.success and res.data else res


def _handle_qualify_provider(db: Session, user_id: str, event_id: str, **kwargs) -> Any:
    from app.agent.tools.provider_tools import QualifyProviderTool
    from app.agent.tools.schemas import QualifyProviderInput
    tool = QualifyProviderTool()
    args_dict = {"event_id": event_id, **kwargs}
    args_model = QualifyProviderInput.model_validate(args_dict)
    ctx = ToolContext(db=db, user_id=user_id, event_id=event_id)
    res = tool.execute(ctx, args_model)
    return res.data.model_dump() if res.success and res.data else res


def _handle_compare_candidates(db: Session, user_id: str, event_id: str, **kwargs) -> Any:
    from app.agent.tools.provider_tools import CompareCandidatesTool
    from app.agent.tools.schemas import CompareCandidatesInput
    tool = CompareCandidatesTool()
    args_dict = {"event_id": event_id, **kwargs}
    args_model = CompareCandidatesInput.model_validate(args_dict)
    ctx = ToolContext(db=db, user_id=user_id, event_id=event_id)
    res = tool.execute(ctx, args_model)
    return res.data.model_dump() if res.success and res.data else res


def _handle_shortlist_vendors(db: Session, user_id: str, event_id: str, **kwargs) -> Any:
    from app.agent.tools.provider_tools import ShortlistVendorsTool
    from app.agent.tools.schemas import ShortlistVendorsInput
    tool = ShortlistVendorsTool()
    args_dict = {"event_id": event_id, **kwargs}
    args_model = ShortlistVendorsInput.model_validate(args_dict)
    ctx = ToolContext(db=db, user_id=user_id, event_id=event_id)
    res = tool.execute(ctx, args_model)
    return res.data.model_dump() if res.success and res.data else res


def _handle_submit_vendor_outcome(db: Session, user_id: str, event_id: str, **kwargs) -> Any:
    from app.agent.tools.provider_tools import SubmitVendorOutcomeTool
    from app.agent.tools.schemas import SubmitVendorOutcomeInput
    tool = SubmitVendorOutcomeTool()
    args_dict = {"event_id": event_id, **kwargs}
    args_model = SubmitVendorOutcomeInput.model_validate(args_dict)
    ctx = ToolContext(db=db, user_id=user_id, event_id=event_id)
    res = tool.execute(ctx, args_model)
    return res.data.model_dump() if res.success and res.data else res


def _handle_validate_vendor_outcome(db: Session, user_id: str, event_id: str, **kwargs) -> Any:
    from app.agent.tools.provider_tools import ValidateVendorOutcomeTool
    from app.agent.tools.schemas import ValidateVendorOutcomeInput
    tool = ValidateVendorOutcomeTool()
    args_dict = {"event_id": event_id, **kwargs}
    args_model = ValidateVendorOutcomeInput.model_validate(args_dict)
    ctx = ToolContext(db=db, user_id=user_id, event_id=event_id)
    res = tool.execute(ctx, args_model)
    return res.data.model_dump() if res.success and res.data else res


def _handle_bind_vendor_to_task(db: Session, user_id: str, event_id: str, **kwargs) -> Any:
    from app.agent.tools.provider_tools import BindVendorToTaskTool
    from app.agent.tools.schemas import BindVendorToTaskInput
    tool = BindVendorToTaskTool()
    args_dict = {"event_id": event_id, **kwargs}
    args_model = BindVendorToTaskInput.model_validate(args_dict)
    ctx = ToolContext(db=db, user_id=user_id, event_id=event_id)
    res = tool.execute(ctx, args_model)
    return res.data.model_dump() if res.success and res.data else res


def _handle_generate_final_execution_plan(db: Session, user_id: str, event_id: str, **kwargs) -> Any:
    from app.agent.tools.planning_tools import GenerateFinalExecutionPlanTool
    from app.schemas.execution_plan import GenerateFinalExecutionPlanInput
    tool = GenerateFinalExecutionPlanTool()
    args_dict = {"event_id": event_id, **kwargs}
    args_model = GenerateFinalExecutionPlanInput.model_validate(args_dict)
    ctx = ToolContext(db=db, user_id=user_id, event_id=event_id)
    res = tool.execute(ctx, args_model)
    return res.data.model_dump() if res.success and res.data else res





def _handle_analyze_impact(db: Session, user_id: str, event_id: str, incident_id: str) -> Dict[str, Any]:
    from app.agent.tools.operations_tools import analyze_impact
    return analyze_impact(db, event_id, incident_id)


def _handle_assess_risk(db: Session, user_id: str, event_id: str, incident_id: str) -> Dict[str, Any]:
    from app.agent.tools.operations_tools import calculate_risk
    return calculate_risk(db, event_id, incident_id)


def _handle_generate_recovery_options(db: Session, user_id: str, event_id: str, incident_id: str) -> List[Dict[str, Any]]:
    from app.agent.tools.operations_tools import generate_recovery_options
    return generate_recovery_options(db, event_id, incident_id, user_id)


def _handle_validate_recovery_option(db: Session, user_id: str, event_id: str, incident_id: str, option_id: str) -> Dict[str, Any]:
    from app.agent.tools.operations_tools import validate_recovery_option
    return validate_recovery_option(db, event_id, incident_id, option_id, user_id)


def _handle_calculate_resource_requirements(db: Session, user_id: str, event_id: str, new_guest_count: int, original_guest_count: Optional[int] = None) -> Dict[str, Any]:
    """Deterministic calculation of resource delta for guest count change."""
    from app.models.event import Event
    event = db.query(Event).filter(Event.id == event_id).first()
    orig = original_guest_count or (event.guest_count if event and event.guest_count else 500)
    delta_guests = max(0, new_guest_count - orig)
    
    meals_additional = delta_guests
    chairs_additional = int(delta_guests * 0.4) if delta_guests > 0 else 0
    tables_additional = int(chairs_additional / 8) if chairs_additional > 0 else 0
    water_dispensers_additional = max(1, int(delta_guests / 50)) if delta_guests > 0 else 0

    return {
        "event_id": event_id,
        "original_guest_count": orig,
        "new_guest_count": new_guest_count,
        "delta_guests": delta_guests,
        "resource_requirements": {
            "meals": meals_additional,
            "chairs": chairs_additional,
            "tables": tables_additional,
            "water_dispensers": water_dispensers_additional,
        },
        "procurement_required": delta_guests > 0,
        "estimated_budget_impact": delta_guests * 450.0,
    }


def _handle_request_action_approval(
    db: Session,
    user_id: str,
    event_id: str,
    action_type: str,
    target_type: str,
    target_id: Optional[str] = None,
    requested_action: Optional[Dict[str, Any]] = None,
    recovery_option_id: Optional[str] = None,
    notes: Optional[str] = None,
) -> Dict[str, Any]:
    from app.agent.tools.operations_tools import request_action_approval
    return request_action_approval(
        db=db,
        event_id=event_id,
        user_id=user_id,
        action_type=action_type,
        target_type=target_type,
        target_id=target_id,
        requested_action=requested_action,
        recovery_option_id=recovery_option_id,
        notes=notes,
    )


def _handle_check_approval_status(db: Session, user_id: str, approval_id: str, **kwargs) -> Dict[str, Any]:
    from app.agent.tools.operations_tools import check_approval_status
    return check_approval_status(db, approval_id)


def _handle_execute_action(
    db: Session,
    user_id: str,
    event_id: str,
    recovery_option_id: Optional[str] = None,
    action_id: Optional[str] = None,
    approval_request_id: Optional[str] = None,
) -> Dict[str, Any]:
    from app.agent.tools.operations_tools import execute_action
    if not recovery_option_id and not action_id:
        raise ValueError("Either recovery_option_id or action_id must be provided to execute_action.")
    return execute_action(
        db=db,
        event_id=event_id,
        user_id=user_id,
        recovery_option_id=recovery_option_id or "",
        action_id=action_id,
        approval_request_id=approval_request_id,
    )


def _handle_verify_action(db: Session, user_id: str, event_id: str, action_execution_id: str) -> Dict[str, Any]:
    from app.agent.tools.operations_tools import verify_action
    result = verify_action(db, event_id, action_execution_id, user_id)
    if result.get("status") not in ("VERIFIED", "PARTIALLY_VERIFIED"):
        return ToolResult(
            status=ToolStatus.VERIFICATION_FAILED,
            data=result,
            error_code="VERIFICATION_FAILED",
            message="Verification failed: Post-action event state did not confirm operational recovery.",
        )
    return result


def _handle_modify_event_plan(db: Session, user_id: str, event_id: str, modification: str) -> Dict[str, Any]:
    from app.agent.tools.operations_tools import modify_event_plan
    return modify_event_plan(db, event_id, modification, user_id)


def _handle_get_decision_trace(db: Session, user_id: str, event_id: str, verification_id: Optional[str] = None) -> Any:
    from app.agent.tools.operations_tools import get_decision_trace
    return get_decision_trace(db, event_id, verification_id)


def _handle_get_recovery_status(db: Session, user_id: str, event_id: str, incident_id: Optional[str] = None, **kwargs) -> Dict[str, Any]:
    """Inspects authoritative status of recovery pipeline for an incident or event."""
    from app.models.incident import Incident
    from app.models.recovery import Recovery
    from app.models.action import ActionExecution
    from app.models.verification import VerificationResult

    inc_q = db.query(Incident).filter(Incident.event_id == event_id)
    if incident_id:
        inc = inc_q.filter(Incident.id == incident_id).first()
    else:
        inc = inc_q.filter(Incident.status != "RESOLVED").order_by(Incident.detected_at.desc()).first()

    inc_id = inc.id if inc else incident_id
    options = db.query(Recovery).filter(Recovery.event_id == event_id, Recovery.incident_id == inc_id).all() if inc_id else []
    latest_exec = db.query(ActionExecution).filter(ActionExecution.event_id == event_id).order_by(ActionExecution.executed_at.desc()).first()
    latest_ver = db.query(VerificationResult).filter(VerificationResult.event_id == event_id).order_by(VerificationResult.verified_at.desc()).first()

    return {
        "event_id": event_id,
        "incident_id": inc_id,
        "incident_status": inc.status if inc else None,
        "incident_severity": inc.severity if inc else None,
        "options_count": len(options),
        "feasible_options_count": sum(1 for o in options if o.is_feasible),
        "latest_execution_id": latest_exec.id if latest_exec else None,
        "latest_action_status": latest_exec.status if latest_exec else None,
        "is_verified": (latest_ver.status == "VERIFIED") if latest_ver else False,
        "verification_status": latest_ver.status if latest_ver else None,
    }


def _handle_pause_event(
    db: Session,
    user_id: str,
    event_id: str,
    reason: str,
    plan_version: Optional[int] = None,
    approval_id: Optional[str] = None,
    **kwargs,
) -> Dict[str, Any]:
    from app.agent.tools.operations_tools import pause_event
    return pause_event(
        db=db,
        event_id=event_id,
        reason=reason,
        user_id=user_id,
        plan_version=plan_version,
        approval_id=approval_id,
    )


def _handle_resume_event(
    db: Session,
    user_id: str,
    event_id: str,
    reason: Optional[str] = None,
    plan_version: Optional[int] = None,
    approval_id: Optional[str] = None,
    **kwargs,
) -> Dict[str, Any]:
    from app.agent.tools.operations_tools import resume_event
    return resume_event(
        db=db,
        event_id=event_id,
        user_id=user_id,
        reason=reason,
        plan_version=plan_version,
        approval_id=approval_id,
    )


def _handle_get_execution_state(
    db: Session,
    user_id: str,
    event_id: str,
) -> Dict[str, Any]:
    from app.agent.tools.operations_tools import get_execution_state
    return get_execution_state(db=db, event_id=event_id, user_id=user_id)


def _handle_call_vendor(
    db: Session,
    user_id: str,
    event_id: str,
    task_id: str,
    provider_id: str,
    reason: Optional[str] = "P3_RECOVERY",
    recovery_option_id: Optional[str] = None,
    call_objective: Optional[str] = None,
    **kwargs,
) -> Dict[str, Any]:
    from app.agent.tools.communication_tools import call_vendor
    return call_vendor(
        event_id=event_id,
        task_id=task_id,
        provider_id=provider_id,
        reason=reason,
        recovery_option_id=recovery_option_id,
        call_objective=call_objective,
        db=db,
        user_id=user_id,
    )


def create_default_functional_tool_registry() -> ToolRegistry:
    """Builds and populates the default central ToolRegistry for Task 4 agent loop."""
    registry = ToolRegistry()

    # 1. State & Inspection (READ)
    registry.register(
        name="get_event_state",
        description="Retrieves authoritative current event state snapshot, task metrics, and budget.",
        category=ToolCategory.READ,
        parameters_schema=GetEventStateInput,
        handler=_handle_get_event_state,
    )
    registry.register(
        name="get_event_spec",
        description="Retrieves the canonical EventSpecification with baseline requirements and constraints.",
        category=ToolCategory.READ,
        parameters_schema=GetEventSpecInput,
        handler=_handle_get_event_spec,
    )
    registry.register(
        name="get_operational_status",
        description="Retrieves live operational readiness, open incident counts, and critical path health.",
        category=ToolCategory.READ,
        parameters_schema=GetOperationalStatusInput,
        handler=_handle_get_operational_status,
    )
    registry.register(
        name="get_incidents",
        description="Retrieves all active open incidents and disruptions for the event.",
        category=ToolCategory.READ,
        parameters_schema=GetIncidentsInput,
        handler=_handle_get_incidents,
    )
    registry.register(
        name="get_incident_details",
        description="Retrieves full details, evidence, and affected entities for a specific incident.",
        category=ToolCategory.READ,
        parameters_schema=GetIncidentDetailsInput,
        handler=_handle_get_incident_details,
    )
    registry.register(
        name="get_task",
        description="Inspects specific tasks or lists tasks filtered by provider category or critical status.",
        category=ToolCategory.READ,
        parameters_schema=GetTaskInput,
        handler=_handle_get_task,
    )
    registry.register(
        name="get_provider_status",
        description="Inspects provider assignment, responsiveness, quotation, and engagement status.",
        category=ToolCategory.READ,
        parameters_schema=GetProviderStatusInput,
        handler=_handle_get_provider_status,
    )
    from app.agent.tools.schemas import (
        DiscoverProvidersInput,
        QualifyProviderInput,
        CompareCandidatesInput,
        ShortlistVendorsInput,
        SubmitVendorOutcomeInput,
        ValidateVendorOutcomeInput,
        BindVendorToTaskInput,
    )
    registry.register(
        name="discover_providers",
        description="Discovers provider candidates matching event/task requirements and produces a deterministic shortlist.",
        category=ToolCategory.READ,
        parameters_schema=DiscoverProvidersInput,
        handler=_handle_discover_providers,
    )
    registry.register(
        name="qualify_provider",
        description="Evaluates whether known provider information satisfies event or task requirements.",
        category=ToolCategory.READ,
        parameters_schema=QualifyProviderInput,
        handler=_handle_qualify_provider,
    )
    registry.register(
        name="compare_candidates",
        description="Deterministically compares structured provider candidates against requirements and constraints.",
        category=ToolCategory.READ,
        parameters_schema=CompareCandidatesInput,
        handler=_handle_compare_candidates,
    )
    registry.register(
        name="shortlist_vendors",
        description="Generates an explainable deterministic shortlist of provider candidates for an event task.",
        category=ToolCategory.READ,
        parameters_schema=ShortlistVendorsInput,
        handler=_handle_shortlist_vendors,
    )
    registry.register(
        name="submit_vendor_outcome",
        description="Records the organizer-reported outcome of external communication with a provider without mutating bookings or plans.",
        category=ToolCategory.WRITE,
        parameters_schema=SubmitVendorOutcomeInput,
        handler=_handle_submit_vendor_outcome,
        requires_approval=False,
    )
    registry.register(
        name="validate_vendor_outcome",
        description="Parses organizer-reported vendor outcome notes and evaluates claims against requirements, budget, guest capacity, and calendar.",
        category=ToolCategory.WRITE,
        parameters_schema=ValidateVendorOutcomeInput,
        handler=_handle_validate_vendor_outcome,
        requires_approval=False,
    )
    registry.register(
        name="bind_vendor_to_task",
        description="Evaluates feasibility and binds a qualified, validated provider to an operational task, recalculating schedule, critical path, and budget.",
        category=ToolCategory.WRITE,
        parameters_schema=BindVendorToTaskInput,
        handler=_handle_bind_vendor_to_task,
        requires_approval=False,
    )
    from app.schemas.execution_plan import GenerateFinalExecutionPlanInput
    registry.register(
        name="generate_final_execution_plan",
        description="Deterministically compiles the authoritative post-Task-8 execution plan with topological task sequence, vendor assignments, critical path, budget, checkpoints, blockers, and warnings.",
        category=ToolCategory.READ,
        parameters_schema=GenerateFinalExecutionPlanInput,
        handler=_handle_generate_final_execution_plan,
        requires_approval=False,
    )



    # 2. Deterministic Analysis & Computational Options
    registry.register(
        name="analyze_impact",
        description="Runs deterministic graph traversal to compute downstream affected tasks and critical path impact.",
        category=ToolCategory.READ,
        parameters_schema=AnalyzeImpactInput,
        handler=_handle_analyze_impact,
    )
    registry.register(
        name="assess_risk",
        description="Calculates deterministic operational risk score and evaluates objective threats.",
        category=ToolCategory.READ,
        parameters_schema=AssessRiskInput,
        handler=_handle_assess_risk,
    )
    registry.register(
        name="generate_recovery_options",
        description="Runs deterministic RecoveryEngine to generate feasible candidate recovery strategies.",
        category=ToolCategory.COMPUTATIONAL,
        parameters_schema=GenerateRecoveryOptionsInput,
        handler=_handle_generate_recovery_options,
    )
    registry.register(
        name="validate_recovery_option",
        description="Validates constraint feasibility, budget delta, and schedule delta for a recovery option.",
        category=ToolCategory.COMPUTATIONAL,
        parameters_schema=ValidateRecoveryOptionInput,
        handler=_handle_validate_recovery_option,
    )
    registry.register(
        name="calculate_resource_requirements",
        description="Calculates additional meals, chairs, tables, and budget impact deterministically for guest changes.",
        category=ToolCategory.COMPUTATIONAL,
        parameters_schema=CalculateResourceRequirementsInput,
        handler=_handle_calculate_resource_requirements,
    )

    # 3. Governance & Approvals
    registry.register(
        name="request_action_approval",
        description="Creates an authoritative immutable approval request ticket for operator review.",
        category=ToolCategory.WRITE,
        parameters_schema=RequestActionApprovalInput,
        handler=_handle_request_action_approval,
        requires_approval=False,
    )
    registry.register(
        name="check_approval_status",
        description="Authoritatively checks if an approval request has been APPROVED or REJECTED by an operator.",
        category=ToolCategory.READ,
        parameters_schema=CheckApprovalStatusInput,
        handler=_handle_check_approval_status,
    )

    # 4. Consequential Mutations & Verification (WRITE)
    registry.register(
        name="execute_action",
        description="Executes an authorized/approved operational recovery option through ActionService. Requires approval.",
        category=ToolCategory.WRITE,
        parameters_schema=ExecuteActionInput,
        handler=_handle_execute_action,
        requires_approval=True,
        permission_action="EXECUTE_RECOVERY",
    )
    registry.register(
        name="verify_action",
        description="Executes authoritative multi-domain verification to confirm whether operational recovery succeeded.",
        category=ToolCategory.WRITE,
        parameters_schema=VerifyActionInput,
        handler=_handle_verify_action,
        requires_approval=False,
    )
    registry.register(
        name="modify_event_plan",
        description="Modifies event parameters (e.g. guest count, requirements) and updates operational plan. Requires approval.",
        category=ToolCategory.WRITE,
        parameters_schema=ModifyEventPlanInput,
        handler=_handle_modify_event_plan,
        requires_approval=True,
        permission_action="MODIFY_EVENT_PLAN",
    )
    registry.register(
        name="get_decision_trace",
        description="Retrieves the immutable, structured operational decision trace for an event or verification.",
        category=ToolCategory.READ,
        parameters_schema=GetDecisionTraceInput,
        handler=_handle_get_decision_trace,
    )
    registry.register(
        name="inspect_incident",
        description="Retrieves full details, evidence, and affected entities for a specific incident.",
        category=ToolCategory.READ,
        parameters_schema=InspectIncidentInput,
        handler=_handle_get_incident_details,
    )
    registry.register(
        name="run_impact_analysis",
        description="Runs deterministic graph traversal to compute downstream affected tasks and critical path impact.",
        category=ToolCategory.READ,
        parameters_schema=RunImpactAnalysisInput,
        handler=_handle_analyze_impact,
    )
    registry.register(
        name="execute_recovery",
        description="Executes an authorized/approved operational recovery option through ActionService. Requires approval.",
        category=ToolCategory.WRITE,
        parameters_schema=ExecuteRecoveryInput,
        handler=_handle_execute_action,
        requires_approval=True,
        permission_action="EXECUTE_RECOVERY",
    )
    registry.register(
        name="verify_recovery",
        description="Executes authoritative multi-domain verification to confirm whether operational recovery succeeded.",
        category=ToolCategory.WRITE,
        parameters_schema=VerifyRecoveryInput,
        handler=_handle_verify_action,
        requires_approval=False,
    )
    registry.register(
        name="get_recovery_status",
        description="Inspects authoritative status of recovery pipeline for an incident or event.",
        category=ToolCategory.READ,
        parameters_schema=GetRecoveryStatusInput,
        handler=_handle_get_recovery_status,
    )
    registry.register(
        name="pause_event",
        description="Transactionally pauses operational execution of the event. Consequential action mutations become blocked.",
        category=ToolCategory.WRITE,
        parameters_schema=PauseEventInput,
        handler=_handle_pause_event,
        requires_approval=True,
        permission_action="EVENT_PAUSE",
    )
    registry.register(
        name="resume_event",
        description="Transactionally resumes operational execution from PAUSED state after re-observing and validating state.",
        category=ToolCategory.WRITE,
        parameters_schema=ResumeEventInput,
        handler=_handle_resume_event,
        requires_approval=True,
        permission_action="EVENT_RESUME",
    )
    registry.register(
        name="get_execution_state",
        description="Retrieves the authoritative current operational execution state (RUNNING, PAUSING, PAUSED, RESUMING).",
        category=ToolCategory.READ,
        parameters_schema=GetExecutionStateInput,
        handler=_handle_get_execution_state,
    )
    from app.agent.tools.schemas import CallVendorInput
    registry.register(
        name="call_vendor",
        description="Initiates an authorized, deterministic voice call to a vendor for operational recovery or engagement.",
        category=ToolCategory.WRITE,
        parameters_schema=CallVendorInput,
        handler=_handle_call_vendor,
        requires_approval=False,
    )

    return registry


# Global default registry instance for Task 4 LangGraph agent
default_registry = create_default_functional_tool_registry()


# ==============================================================================
# TASK 3: TYPED AGENT TOOL REGISTRY & PIPELINE
# ==============================================================================

class AgentToolRegistry:
    """Central authoritative registry for all agent tools in EVENTRA."""

    def __init__(self):
        self._tools: Dict[str, AgentTool] = {}
        self._execution_traces: List[ExecutionTraceRecord] = []

    def register(self, tool: AgentTool) -> None:
        """Registers a tool in the registry. Rejects duplicates."""
        if tool.name in self._tools:
            raise ValueError(f"Tool with name '{tool.name}' is already registered in AgentToolRegistry.")
        self._tools[tool.name] = tool
        logger.info(f"Registered agent tool: {tool.name} [{tool.category.value} / {tool.access_mode.value}]")

    def get(self, name: str) -> AgentTool:
        """Retrieves a registered tool by name. Raises UnknownToolError if not found."""
        tool = self._tools.get(name)
        if not tool:
            raise UnknownToolError(tool_name=name)
        return tool

    def has_tool(self, name: str) -> bool:
        """Checks if a tool is registered."""
        return name in self._tools

    def list_tools(
        self,
        category: Optional[ToolCategory] = None,
        access_mode: Optional[ToolAccessMode] = None,
        available_only: bool = True,
    ) -> List[AgentTool]:
        """Lists registered tools matching the provided criteria."""
        results = list(self._tools.values())

        if category:
            results = [t for t in results if t.category == category]
        if access_mode:
            results = [t for t in results if t.access_mode == access_mode]
        if available_only:
            results = [t for t in results if t.availability == ToolAvailabilityStatus.AVAILABLE]

        return results

    def get_llm_tools(self) -> List[Dict[str, Any]]:
        """Returns model-friendly tool definitions formatted for Gemini function calling.

        STRICT PRODUCT SCOPE:
        Only tools with availability == AVAILABLE are exposed to the LLM.
        Disabled tools (e.g. WhatsApp, phone, autonomous negotiation) are strictly excluded.
        """
        available_tools = self.list_tools(available_only=True)
        return [tool.to_gemini_declaration() for tool in available_tools]

    def execute(
        self,
        name: str,
        args: Dict[str, Any] | BaseModel,
        context: ToolContext,
        timeout_seconds: Optional[float] = None,
    ) -> ToolResult:
        """Common execution pipeline for all agent tools.

        Pipeline:
        1. Tool lookup in registry
        2. Tool availability check (reject DISABLED / UNSUPPORTED)
        3. Typed input validation via Pydantic
        4. Deterministic service invocation with timing
        5. Structured ToolResult generation
        6. Operational execution trace recording
        """
        start_time = time.perf_counter()
        trace_id = f"exec-{uuid.uuid4().hex[:12]}"

        # 1. Tool Lookup
        if not self.has_tool(name):
            err_res = ToolResult.failure_result(
                tool_name=name,
                error=f"Tool '{name}' is not registered in the Agent Tool Registry.",
                error_code="TOOL_UNKNOWN",
            )
            self._record_trace(
                trace_id=trace_id,
                context=context,
                tool_name=name,
                category="UNKNOWN",
                access_mode="UNKNOWN",
                status=ToolResultStatus.FAILURE.value,
                input_summary=self._sanitize_input_summary(args),
                result_summary=err_res.error or "Unknown tool",
                duration_ms=(time.perf_counter() - start_time) * 1000,
                error=err_res.error,
            )
            return err_res

        tool = self.get(name)

        # 2. Availability Check
        if tool.availability != ToolAvailabilityStatus.AVAILABLE:
            unsupported_res = ToolResult.unsupported_result(
                tool_name=name,
                reason=f"Tool '{name}' is currently {tool.availability.value} in this environment.",
            )
            self._record_trace(
                trace_id=trace_id,
                context=context,
                tool_name=name,
                category=tool.category.value,
                access_mode=tool.access_mode.value,
                status=ToolResultStatus.UNSUPPORTED.value,
                input_summary=self._sanitize_input_summary(args),
                result_summary=unsupported_res.error or "Tool unsupported",
                duration_ms=(time.perf_counter() - start_time) * 1000,
                error=unsupported_res.error,
            )
            return unsupported_res

        # 3. Input Validation
        if isinstance(args, dict):
            try:
                validated_args = tool.input_schema.model_validate(args)
            except ValidationError as ve:
                val_err_res = ToolResult.failure_result(
                    tool_name=name,
                    error=f"Validation failed for tool '{name}' input: {str(ve)}",
                    error_code="TOOL_INVALID_INPUT",
                    metadata={"validation_errors": ve.errors()},
                )
                self._record_trace(
                    trace_id=trace_id,
                    context=context,
                    tool_name=name,
                    category=tool.category.value,
                    access_mode=tool.access_mode.value,
                    status=ToolResultStatus.FAILURE.value,
                    input_summary=self._sanitize_input_summary(args),
                    result_summary="Input validation failed",
                    duration_ms=(time.perf_counter() - start_time) * 1000,
                    error=val_err_res.error,
                )
                return val_err_res
        elif isinstance(args, tool.input_schema):
            validated_args = args
        else:
            val_err_res = ToolResult.failure_result(
                tool_name=name,
                error=f"Expected input schema of type '{tool.input_schema.__name__}', got '{type(args).__name__}'.",
                error_code="TOOL_INVALID_INPUT",
            )
            return val_err_res

        # 4. Deterministic Execution
        try:
            result = tool.execute(context=context, args=validated_args)

        except PermissionDeniedError as pde:
            result = ToolResult.failure_result(
                tool_name=name,
                error=pde.message,
                error_code=pde.code,
                metadata=pde.details,
            )
        except ApprovalRequiredError as are:
            result = ToolResult.approval_required_result(
                tool_name=name,
                approval_id=are.details.get("approval_id") or "pending",
                reason=are.message,
                metadata=are.details,
            )
        except Exception as e:
            logger.exception(f"Unexpected execution error in tool '{name}': {e}")
            result = ToolResult.failure_result(
                tool_name=name,
                error=f"Deterministic execution failed: {str(e)}",
                error_code="TOOL_EXECUTION_FAILED",
            )

        duration_ms = (time.perf_counter() - start_time) * 1000

        # 5. Record Execution Trace
        summary_str = f"Status: {result.status.value}"
        if result.success and result.data:
            summary_str += f" | Output: {type(result.data).__name__}"
        elif result.error:
            summary_str += f" | Error: {result.error}"

        self._record_trace(
            trace_id=trace_id,
            context=context,
            tool_name=name,
            category=tool.category.value,
            access_mode=tool.access_mode.value,
            status=result.status.value,
            input_summary=self._sanitize_input_summary(validated_args.model_dump()),
            result_summary=summary_str,
            duration_ms=duration_ms,
            error=result.error,
        )

        return result

    def get_traces(
        self,
        event_id: Optional[str] = None,
        run_id: Optional[str] = None,
        tool_name: Optional[str] = None,
    ) -> List[ExecutionTraceRecord]:
        """Retrieves in-memory execution traces filtered by criteria."""
        traces = self._execution_traces
        if event_id:
            traces = [t for t in traces if t.event_id == event_id]
        if run_id:
            traces = [t for t in traces if t.run_id == run_id]
        if tool_name:
            traces = [t for t in traces if t.tool_name == tool_name]
        return list(traces)

    def _record_trace(
        self,
        trace_id: str,
        context: ToolContext,
        tool_name: str,
        category: str,
        access_mode: str,
        status: str,
        input_summary: Dict[str, Any],
        result_summary: str,
        duration_ms: float,
        error: Optional[str] = None,
    ) -> None:
        """Records a factual execution trace record with recursive secret redaction."""
        trace = ExecutionTraceRecord(
            trace_id=trace_id,
            tool_name=tool_name,
            category=category,
            access_mode=access_mode,
            event_id=context.event_id,
            user_id=context.user_id,
            run_id=context.run_id,
            input_summary=input_summary,
            result_summary=result_summary,
            status=status,
            duration_ms=duration_ms,
            error=error,
        )
        self._execution_traces.append(trace)

    def _sanitize_input_summary(self, data: Any) -> Dict[str, Any]:
        """Recursively redacts sensitive keys such as api_key, token, secret, password."""
        if not isinstance(data, dict):
            if hasattr(data, "model_dump"):
                data = data.model_dump()
            elif hasattr(data, "__dict__"):
                data = dict(data.__dict__)
            else:
                return {"value": str(data)[:100]}

        sanitized: Dict[str, Any] = {}
        secret_keywords = {"api_key", "token", "secret", "password", "authorization", "bearer", "credential"}

        for k, v in data.items():
            k_lower = str(k).lower()
            if any(secret in k_lower for secret in secret_keywords):
                sanitized[k] = "[REDACTED]"
            elif isinstance(v, dict):
                sanitized[k] = self._sanitize_input_summary(v)
            elif isinstance(v, list):
                sanitized[k] = [
                    self._sanitize_input_summary(item) if isinstance(item, dict) else item
                    for item in v
                ]
            else:
                sanitized[k] = v
        return sanitized


def create_default_tool_registry() -> AgentToolRegistry:
    """Builds and populates the canonical AgentToolRegistry with all 22 domain tools (Task 3)."""
    registry = AgentToolRegistry()

    # 1. Event / State Tools
    from app.agent.tools.event_tools import (
        GetEventStateTool,
        GetEventSpecTool,
        GetOperationalStatusTool,
        GetActiveConstraintsTool,
    )
    registry.register(GetEventStateTool())
    registry.register(GetEventSpecTool())
    registry.register(GetOperationalStatusTool())
    registry.register(GetActiveConstraintsTool())

    # 2. Planning Tools
    from app.agent.tools.planning_tools import (
        GetPlanTool,
        GetTaskTool,
        GetDependenciesTool,
        GetCriticalPathTool,
        CreateOrUpdateTaskTool,
        GenerateFinalExecutionPlanTool,
    )
    registry.register(GetPlanTool())
    registry.register(GetTaskTool())
    registry.register(GetDependenciesTool())
    registry.register(GetCriticalPathTool())
    registry.register(CreateOrUpdateTaskTool())
    registry.register(GenerateFinalExecutionPlanTool())

    # 3. Provider Tools
    from app.agent.tools.provider_tools import (
        DiscoverProvidersTool,
        QualifyProviderTool,
        CheckProviderAvailabilityTool,
        CompareCandidatesTool,
        ShortlistVendorsTool,
        SubmitVendorOutcomeTool,
        ValidateVendorOutcomeTool,
        BindVendorToTaskTool,
    )
    registry.register(DiscoverProvidersTool())
    registry.register(QualifyProviderTool())
    registry.register(CheckProviderAvailabilityTool())
    registry.register(CompareCandidatesTool())
    registry.register(ShortlistVendorsTool())
    registry.register(SubmitVendorOutcomeTool())
    registry.register(ValidateVendorOutcomeTool())
    registry.register(BindVendorToTaskTool())

    # 4. Impact & Risk Tools
    from app.agent.tools.impact_tools import AnalyzeImpactTool
    from app.agent.tools.risk_tools import AssessRiskTool
    registry.register(AnalyzeImpactTool())
    registry.register(AssessRiskTool())

    # 5. Recovery Tools
    from app.agent.tools.recovery_tools import (
        GetActiveIncidentsTool,
        InspectIncidentTool,
        GenerateRecoveryOptionsTool,
        ValidateRecoveryOptionTool,
        ExecuteRecoveryTool,
        CallVendorTool,
    )
    registry.register(GetActiveIncidentsTool())
    registry.register(InspectIncidentTool())
    registry.register(GenerateRecoveryOptionsTool())
    registry.register(ValidateRecoveryOptionTool())
    registry.register(ExecuteRecoveryTool())
    registry.register(CallVendorTool())

    # 6. Observability Tools
    from app.agent.tools.trace_tools import (
        RecordDecisionTool,
        GetDecisionTraceTool,
    )
    registry.register(RecordDecisionTool())
    registry.register(GetDecisionTraceTool())

    # 7. Venue Discovery & Navigation Tools
    from app.agent.tools.venue_tools import DiscoverAndRankVenuesTool
    registry.register(DiscoverAndRankVenuesTool())

    return registry


# Global canonical singleton registry for Task 3
_default_agent_registry: Optional[AgentToolRegistry] = None


def get_agent_tool_registry() -> AgentToolRegistry:
    """Provides the global canonical AgentToolRegistry instance."""
    global _default_agent_registry
    if _default_agent_registry is None:
        _default_agent_registry = create_default_tool_registry()
    return _default_agent_registry
