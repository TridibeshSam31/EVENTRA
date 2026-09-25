"""IMPACT ANALYSIS Agent Tool.

Exposes deterministic dependency-aware impact calculation via Phase 7 ImpactAnalyzer.
The LLM never calculates dependency graphs or delays itself; all facts are computed deterministically.
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
    AnalyzeImpactInput,
    AnalyzeImpactOutput,
)
from app.agent.tools.permissions import ToolPermissionGuard


class AnalyzeImpactTool(AgentTool):
    """Runs deterministic dependency traversal to calculate operational impact of an incident."""

    name = "analyze_impact"
    description = "Runs deterministic dependency traversal to calculate operational impact of an incident or disruption."
    category = ToolCategory.IMPACT_RISK
    access_mode = ToolAccessMode.READ_ONLY
    input_schema = AnalyzeImpactInput
    output_schema = AnalyzeImpactOutput
    availability = ToolAvailabilityStatus.AVAILABLE

    def execute(self, context: ToolContext, args: AnalyzeImpactInput) -> ToolResult:
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

        if inc.impact_result:
            impact_dict = inc.impact_result
        else:
            incident_service = IncidentService(context.db)
            event = incident_service._get_event(args.event_id)
            impact_dict = incident_service._run_impact_analysis(event, inc)
            inc.impact_result = impact_dict
            context.db.commit()
            context.db.refresh(inc)

        direct_tasks = impact_dict.get("directly_affected_tasks", [])
        indirect_tasks = impact_dict.get("indirectly_affected_tasks", [])
        affected_tasks = impact_dict.get("affected_tasks") or (direct_tasks + indirect_tasks)
        blocked_raw = impact_dict.get("blocked_tasks", [])
        blocked = [
            t.get("id") or t.get("task_id") if isinstance(t, dict) else str(t)
            for t in blocked_raw
        ]

        sched = impact_dict.get("schedule_impact", {})
        budg = impact_dict.get("budget_impact", {})

        data = AnalyzeImpactOutput(
            event_id=args.event_id,
            incident_id=args.incident_id,
            severity=impact_dict.get("severity", inc.severity or "MODERATE"),
            affected_tasks_count=len(affected_tasks),
            affected_tasks=affected_tasks,
            critical_path_breached=bool(sched.get("critical_path_breached", False)),
            schedule_delay_minutes=int(sched.get("delay_minutes", sched.get("max_delay_minutes", 0))),
            estimated_budget_impact=float(budg.get("committed_cost_at_risk", budg.get("estimated_cost_increase", 0.0))),
            blocked_tasks=blocked,
        )
        return ToolResult.success_result(self.name, data)


def impact_tools_run(**kwargs) -> Dict[str, Any]:
    """Legacy helper for backward compatibility."""
    return {"status": "success"}
