"""RISK ASSESSMENT Agent Tool.

Exposes deterministic operational risk calculation via Phase 7 RiskCalculator.
Calculates deadline risk, dependency risk, provider risk, budget risk, and resource risk.
"""
from typing import Any, Dict
from app.models.incident import Incident
from app.services.incident_service import IncidentService
from app.agent.tools.base import (
    AgentTool,
    ToolCategory,
    ToolAccessMode,
    ToolAvailabilityStatus,
    ToolContext,
    ToolResult,
)
from app.agent.tools.schemas import (
    AssessRiskInput,
    AssessRiskOutput,
)
from app.agent.tools.permissions import ToolPermissionGuard


class AssessRiskTool(AgentTool):
    """Runs deterministic multi-factor risk calculation for an operational incident."""

    name = "assess_risk"
    description = "Runs deterministic multi-factor risk calculation for an operational incident."
    category = ToolCategory.IMPACT_RISK
    access_mode = ToolAccessMode.READ_ONLY
    input_schema = AssessRiskInput
    output_schema = AssessRiskOutput
    availability = ToolAvailabilityStatus.AVAILABLE

    def execute(self, context: ToolContext, args: AssessRiskInput) -> ToolResult:
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

        if inc.risk_result:
            risk_dict = inc.risk_result
        else:
            incident_service = IncidentService(context.db)
            event = incident_service._get_event(args.event_id)
            impact_dict = inc.impact_result or incident_service._run_impact_analysis(event, inc)
            risk_dict = incident_service._run_risk_calculation(event, inc, impact_dict)
            inc.risk_result = risk_dict
            context.db.commit()
            context.db.refresh(inc)

        factors_list = risk_dict.get("factors", [])
        factor_scores = {}
        if isinstance(factors_list, list):
            for f in factors_list:
                if isinstance(f, dict):
                    factor_scores[f.get("name")] = float(f.get("score", 0.0))
        elif isinstance(factors_list, dict):
            factor_scores = {k: float(v) for k, v in factors_list.items()}

        composite_score = float(risk_dict.get("score") if risk_dict.get("score") is not None else risk_dict.get("composite_score", 0.0))
        severity_level = str(risk_dict.get("level") or risk_dict.get("severity_level", "MEDIUM"))

        data = AssessRiskOutput(
            event_id=args.event_id,
            incident_id=args.incident_id,
            composite_score=composite_score,
            severity_level=severity_level,
            deadline_risk=float(factor_scores.get("time_remaining", factor_scores.get("deadline_risk", 0.0))),
            dependency_risk=float(factor_scores.get("dependency_depth", factor_scores.get("dependency_risk", 0.0))),
            provider_risk=float(factor_scores.get("provider_alternatives", factor_scores.get("provider_risk", 0.0))),
            budget_risk=float(factor_scores.get("budget_headroom", factor_scores.get("budget_risk", 0.0))),
            resource_risk=float(factor_scores.get("resource_availability", factor_scores.get("resource_risk", 0.0))),
            factor_breakdown=factor_scores if factor_scores else {"raw": factors_list},
        )
        return ToolResult.success_result(self.name, data)


def risk_tools_run(**kwargs) -> Dict[str, Any]:
    """Legacy helper for backward compatibility."""
    return {"status": "success"}
