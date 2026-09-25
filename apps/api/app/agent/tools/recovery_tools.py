"""INCIDENT & RECOVERY Agent Tools.

Exposes incident inspection, candidate recovery generation, validation,
and authorized/approved recovery execution with multi-domain verification.

SAFETY:
execute_recovery is a consequential WRITE operation.
It strictly enforces server-side authorization and human approval policy before
mutating any authoritative database records.
"""
from typing import Any, Dict, List
from app.models.incident import Incident
from app.models.recovery import Recovery
from app.services.incident_service import IncidentService
from app.services.recovery_service import RecoveryService
from app.services.action_service import ActionService
from app.services.verification_service import VerificationService
from app.services.final_execution_plan_service import FinalExecutionPlanService
from app.agent.tools.base import (
    AgentTool,
    ToolCategory,
    ToolAccessMode,
    ToolAvailabilityStatus,
    ToolResultStatus,
    ToolContext,
    ToolResult,
)
from app.agent.tools.schemas import (
    GetActiveIncidentsInput,
    GetActiveIncidentsOutput,
    InspectIncidentInput,
    InspectIncidentOutput,
    GenerateRecoveryOptionsInput,
    GenerateRecoveryOptionsOutput,
    RecoveryOptionSummary,
    ValidateRecoveryOptionInput,
    ValidateRecoveryOptionOutput,
    ExecuteRecoveryInput,
    ExecuteRecoveryOutput,
)
from app.agent.tools.permissions import ToolPermissionGuard


class GetActiveIncidentsTool(AgentTool):
    """Retrieves all open and active incidents currently affecting the event."""

    name = "get_active_incidents"
    description = "Retrieves all open and active incidents currently affecting the event."
    category = ToolCategory.RECOVERY
    access_mode = ToolAccessMode.READ_ONLY
    input_schema = GetActiveIncidentsInput
    output_schema = GetActiveIncidentsOutput
    availability = ToolAvailabilityStatus.AVAILABLE

    def execute(self, context: ToolContext, args: GetActiveIncidentsInput) -> ToolResult:
        ToolPermissionGuard.verify_read_permission(context.db, args.event_id, context.user_id, self.name)

        incidents = (
            context.db.query(Incident)
            .filter(Incident.event_id == args.event_id, Incident.status != "RESOLVED")
            .order_by(Incident.detected_at.desc())
            .all()
        )

        items = [
            {
                "id": inc.id,
                "title": inc.title,
                "incident_type": inc.incident_type,
                "severity": inc.severity,
                "status": inc.status,
                "related_task_id": inc.related_task_id,
                "related_vendor_id": inc.related_vendor_id,
                "detected_at": inc.detected_at.isoformat() if inc.detected_at else None,
            }
            for inc in incidents
        ]

        data = GetActiveIncidentsOutput(
            event_id=args.event_id,
            open_incidents_count=len(items),
            incidents=items,
        )
        return ToolResult.success_result(self.name, data)


class InspectIncidentTool(AgentTool):
    """Retrieves complete details, impact assessment, and risk metrics for an incident."""

    name = "inspect_incident"
    description = "Retrieves complete details, impact assessment, and risk metrics for a specific incident."
    category = ToolCategory.RECOVERY
    access_mode = ToolAccessMode.READ_ONLY
    input_schema = InspectIncidentInput
    output_schema = InspectIncidentOutput
    availability = ToolAvailabilityStatus.AVAILABLE

    def execute(self, context: ToolContext, args: InspectIncidentInput) -> ToolResult:
        ToolPermissionGuard.verify_read_permission(context.db, args.event_id, context.user_id, self.name)

        inc = (
            context.db.query(Incident)
            .filter(Incident.id == args.incident_id, Incident.event_id == args.event_id)
            .first()
        )
        if not inc:
            return ToolResult.failure_result(
                self.name,
                f"Incident '{args.incident_id}' not found for event '{args.event_id}'.",
                "NOT_FOUND",
            )

        data = InspectIncidentOutput(
            incident_id=inc.id,
            event_id=inc.event_id,
            title=inc.title,
            incident_type=inc.incident_type,
            severity=inc.severity,
            status=inc.status,
            detected_at=inc.detected_at.isoformat() if inc.detected_at else None,
            related_task_id=inc.related_task_id,
            related_vendor_id=inc.related_vendor_id,
            impact_summary=inc.impact_result,
            risk_summary=inc.risk_result,
        )
        return ToolResult.success_result(self.name, data)


class GenerateRecoveryOptionsTool(AgentTool):
    """Invokes deterministic RecoveryEngine to generate and simulate candidate recovery options."""

    name = "generate_recovery_options"
    description = "Invokes the deterministic RecoveryEngine to generate and simulate candidate recovery options."
    category = ToolCategory.RECOVERY
    access_mode = ToolAccessMode.READ_ONLY
    input_schema = GenerateRecoveryOptionsInput
    output_schema = GenerateRecoveryOptionsOutput
    availability = ToolAvailabilityStatus.AVAILABLE

    def execute(self, context: ToolContext, args: GenerateRecoveryOptionsInput) -> ToolResult:
        ToolPermissionGuard.verify_read_permission(context.db, args.event_id, context.user_id, self.name)

        inc = (
            context.db.query(Incident)
            .filter(Incident.id == args.incident_id, Incident.event_id == args.event_id)
            .first()
        )
        if not inc:
            return ToolResult.failure_result(
                self.name,
                f"Incident '{args.incident_id}' not found for event '{args.event_id}'.",
                "NOT_FOUND",
            )

        # Ensure impact and risk are populated before recovery generation
        incident_service = IncidentService(context.db)
        event = incident_service._get_event(args.event_id)
        if not inc.impact_result:
            inc.impact_result = incident_service._run_impact_analysis(event, inc)
        if not inc.risk_result:
            inc.risk_result = incident_service._run_risk_calculation(event, inc, inc.impact_result)
        context.db.commit()

        recovery_service = RecoveryService(context.db)
        try:
            options = recovery_service.generate_recovery_options(
                event_id=args.event_id,
                incident_id=args.incident_id,
                current_user_id=context.user_id,
            )
        except Exception as e:
            return ToolResult.failure_result(self.name, f"Failed to generate recovery options: {str(e)}")

        summaries = [
            RecoveryOptionSummary(
                id=opt.id,
                strategy_type=opt.strategy_type,
                status=opt.status,
                is_feasible=opt.is_feasible,
                score=float(opt.score or 0.0),
                rank=opt.rank,
                proposed_changes=opt.proposed_changes or [],
                affected_tasks=opt.affected_tasks or [],
                affected_providers=opt.affected_providers or [],
                budget_delta=float(opt.budget_delta or 0.0),
                schedule_delta=int(opt.schedule_delta or 0),
                risk_after=opt.risk_after,
            )
            for opt in options
        ]

        data = GenerateRecoveryOptionsOutput(
            event_id=args.event_id,
            incident_id=args.incident_id,
            options_count=len(summaries),
            feasible_options_count=sum(1 for s in summaries if s.is_feasible),
            options=summaries,
        )
        return ToolResult.success_result(self.name, data)


class ValidateRecoveryOptionTool(AgentTool):
    """Retrieves deterministic feasibility validation report for a recovery option."""

    name = "validate_recovery_option"
    description = "Retrieves deterministic feasibility validation report for a recovery option."
    category = ToolCategory.RECOVERY
    access_mode = ToolAccessMode.READ_ONLY
    input_schema = ValidateRecoveryOptionInput
    output_schema = ValidateRecoveryOptionOutput
    availability = ToolAvailabilityStatus.AVAILABLE

    def execute(self, context: ToolContext, args: ValidateRecoveryOptionInput) -> ToolResult:
        ToolPermissionGuard.verify_read_permission(context.db, args.event_id, context.user_id, self.name)

        opt = (
            context.db.query(Recovery)
            .filter(Recovery.id == args.option_id, Recovery.event_id == args.event_id)
            .first()
        )
        if not opt:
            return ToolResult.failure_result(
                self.name,
                f"Recovery option '{args.option_id}' not found for event '{args.event_id}'.",
                "NOT_FOUND",
            )

        f_res = opt.feasibility_result or {}
        data = ValidateRecoveryOptionOutput(
            option_id=opt.id,
            incident_id=opt.incident_id,
            is_feasible=opt.is_feasible,
            status=opt.status,
            violations=f_res.get("violations", []),
            warnings=f_res.get("warnings", []),
            validation_timestamp=f_res.get("validation_timestamp"),
        )
        return ToolResult.success_result(self.name, data)


class ExecuteRecoveryTool(AgentTool):
    """Executes an authorized and approved recovery option (WRITE operation with verification)."""

    name = "execute_recovery"
    description = "Executes an authorized and approved operational recovery option."
    category = ToolCategory.RECOVERY
    access_mode = ToolAccessMode.WRITE
    input_schema = ExecuteRecoveryInput
    output_schema = ExecuteRecoveryOutput
    approval_required = True  # High impact recovery always evaluates approval policy
    availability = ToolAvailabilityStatus.AVAILABLE

    def execute(self, context: ToolContext, args: ExecuteRecoveryInput) -> ToolResult:
        opt = (
            context.db.query(Recovery)
            .filter(Recovery.id == args.recovery_option_id, Recovery.event_id == args.event_id)
            .first()
        )
        if not opt:
            return ToolResult.failure_result(
                self.name,
                f"Recovery option '{args.recovery_option_id}' not found for event '{args.event_id}'.",
                "NOT_FOUND",
            )

        observed_plan = FinalExecutionPlanService(context.db).compile_plan(
            event_id=args.event_id, user_id=context.user_id
        )
        option_plan_version = args.plan_version or (opt.feasibility_result or {}).get("plan_version")
        if option_plan_version is not None and option_plan_version != observed_plan.plan_version:
            return ToolResult.failure_result(
                self.name,
                "STALE_PLAN: Re-observe the final execution plan and regenerate recovery options before execution.",
                "STALE_PLAN",
            )

        if not opt.is_feasible:
            return ToolResult.failure_result(
                self.name,
                f"Cannot execute recovery option '{opt.id}': Option is marked INFEASIBLE by deterministic validation.",
                "INFEASIBLE_OPTION",
            )

        # 1. Enforce Server-Side Approval Gate
        can_execute, active_approval_id = ToolPermissionGuard.enforce_approval_gate(
            db=context.db,
            event_id=args.event_id,
            user_id=context.user_id,
            action_type="EXECUTE_RECOVERY",
            target_type="RECOVERY",
            target_id=opt.id,
            payload={"strategy_type": opt.strategy_type, "proposed_changes": opt.proposed_changes},
            approval_id=args.approval_id or context.approval_id,
            recovery_option_id=opt.id,
            tool_name=self.name,
            tool_requires_approval=self.approval_required,
        )

        if not can_execute:
            return ToolResult.approval_required_result(
                tool_name=self.name,
                approval_id=active_approval_id or "pending_approval",
                reason=f"Recovery execution for strategy '{opt.strategy_type}' requires human approval before modifying live event state.",
            )

        # 2. Transactional execution via ActionService
        action_service = ActionService(context.db)
        try:
            action_exec = action_service.execute_recovery_option(
                event_id=args.event_id,
                executor_id=context.user_id,
                recovery_option_id=opt.id,
            )
            if active_approval_id and not action_exec.approval_request_id:
                action_exec.approval_request_id = active_approval_id
                context.db.commit()
        except Exception as e:
            return ToolResult.failure_result(self.name, f"Action execution failed: {str(e)}")

        # 3. Post-execution verification via VerificationService
        verified = False
        verification_id = None
        try:
            ver_service = VerificationService(context.db)
            v_res = ver_service.verify_action(
                event_id=args.event_id,
                action_execution_id=action_exec.id,
                current_user_id=context.user_id,
            )
            verified = (v_res.status == "VERIFIED")
            verification_id = v_res.id
        except Exception:
            verified = False

        data = ExecuteRecoveryOutput(
            execution_id=action_exec.id,
            event_id=args.event_id,
            recovery_option_id=opt.id,
            status=action_exec.status,
            action_type=action_exec.action_type,
            affected_entities=action_exec.affected_entities or [],
            verified=verified,
            verification_id=verification_id,
            requires_approval=False,
            approval_id=active_approval_id,
        )
        if not verified:
            return ToolResult(
                success=False,
                tool_name=self.name,
                status=ToolResultStatus.VERIFICATION_FAILED,
                data=data,
                error="RECOVERY_FAILED: Action completed but deterministic verification did not confirm recovery.",
                error_code="RECOVERY_FAILED",
                verification_status="VERIFICATION_FAILED",
            )
        return ToolResult.success_result(self.name, data)


def recovery_tools_run(**kwargs) -> Dict[str, Any]:
    """Legacy helper for backward compatibility."""
    return {"status": "success"}
