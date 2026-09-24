"""Central Typed Tool Registry for the Event Operations Agent.

Adheres strictly to the architectural principle:
"The deterministic engine calculates what is feasible.
The agent decides what should happen next."

Features:
- Categorization: READ, COMPUTATIONAL, WRITE
- Strict input validation against Pydantic schemas
- Permission & approval boundaries for consequential actions
- Structured ToolResult contract with strict status values:
  SUCCESS, FAILURE, UNKNOWN, REQUIRES_APPROVAL, UNSUPPORTED, VERIFICATION_FAILED
- Execution error and timeout isolation
"""
from enum import Enum
from typing import Any, Callable, Dict, List, Optional, Type
import logging
from pydantic import BaseModel, Field, ValidationError
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)


class ToolCategory(str, Enum):
    """Classification of tool operations."""
    READ = "READ"
    COMPUTATIONAL = "COMPUTATIONAL"
    WRITE = "WRITE"


class ToolStatus(str, Enum):
    """Authoritative outcome status of a tool execution."""
    SUCCESS = "SUCCESS"
    FAILURE = "FAILURE"
    UNKNOWN = "UNKNOWN"
    REQUIRES_APPROVAL = "REQUIRES_APPROVAL"
    UNSUPPORTED = "UNSUPPORTED"
    VERIFICATION_FAILED = "VERIFICATION_FAILED"


class ToolResult(BaseModel):
    """The structured result contract returned after every tool execution."""
    status: ToolStatus = Field(..., description="Status of the tool execution")
    data: Optional[Any] = Field(None, description="Factual output data from the deterministic backend")
    error_code: Optional[str] = Field(None, description="Standard error code if failed")
    message: Optional[str] = Field(None, description="Factual summary of execution outcome")
    reason_code: Optional[str] = Field(None, description="Operational reason code")
    metadata: Optional[Dict[str, Any]] = Field(default_factory=dict, description="Execution metadata")

    def summary(self) -> str:
        """Concise operational summary for decision tracing (NOT chain-of-thought)."""
        if self.message:
            return self.message[:120]
        if self.status == ToolStatus.SUCCESS:
            if isinstance(self.data, dict):
                keys = list(self.data.keys())[:3]
                return f"Success ({', '.join(keys)})"
            if isinstance(self.data, list):
                return f"Success ({len(self.data)} items)"
            return "Execution completed successfully"
        return f"{self.status}: {self.error_code or 'Unknown reason'}"


class ToolDefinition(BaseModel):
    """Metadata and specification for an agent tool."""
    name: str = Field(..., description="Unique tool identifier")
    description: str = Field(..., description="Clear operational description of the tool")
    category: ToolCategory = Field(..., description="READ, COMPUTATIONAL, or WRITE")
    parameters_schema: Optional[Type[BaseModel]] = Field(None, description="Pydantic schema for tool arguments")
    requires_approval: bool = Field(False, description="Whether this tool represents a consequential mutation")
    permission_action: Optional[str] = Field(None, description="Authorization action type checked if WRITE")

    model_config = {"arbitrary_types_allowed": True}


# --- Tool Input Schemas ---

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


# --- Central Tool Registry ---

class ToolRegistry:
    """Central registry and governance execution boundary for agent tools."""

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
            # Check if this execution already has an authoritative approval granted
            approval_id = clean_args.get("approval_request_id") or clean_args.get("approval_id")
            from app.agent.tools.operations_tools import check_approval_status
            is_approved = False
            if approval_id:
                try:
                    appr_rec = check_approval_status(db, approval_id)
                    is_approved = appr_rec.get("is_approved", False)
                except Exception:
                    is_approved = False

            if not is_approved:
                # Agent CANNOT self-approve. Consequential action must pause for human approval.
                logger.info("Tool %s requires approval before execution; not pre-approved.", tool_name)
                return ToolResult(
                    status=ToolStatus.REQUIRES_APPROVAL,
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
        # Unknown status stays UNKNOWN - do not fabricate availability or response!
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
    
    # Authoritative deterministic formulas
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


def create_default_tool_registry() -> ToolRegistry:
    """Builds and populates the default central ToolRegistry for EVENTRA."""
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
        requires_approval=False,  # Requesting approval itself does not require approval
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

    return registry


# Global default registry instance
default_registry = create_default_tool_registry()
