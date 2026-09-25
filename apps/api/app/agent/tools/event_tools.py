"""EVENT / STATE Agent Tools.

Exposes authoritative, deterministic event state, canonical EventSpecification,
operational status, and active operational constraints.
"""
from decimal import Decimal
from typing import Any, Dict, List
from app.models.event import Event
from app.models.task import Task
from app.models.budget import BudgetItem
from app.models.objective import Objective
from app.models.incident import Incident
from app.models.constraint import Constraint
from app.core.exceptions import NotFoundException
from app.services.specification_service import SpecificationService
from app.agent.tools.base import (
    AgentTool,
    ToolCategory,
    ToolAccessMode,
    ToolAvailabilityStatus,
    ToolContext,
    ToolResult,
)
from app.agent.tools.schemas import (
    GetEventStateInput,
    GetEventStateOutput,
    GetEventSpecInput,
    GetEventSpecOutput,
    GetOperationalStatusInput,
    GetOperationalStatusOutput,
    GetActiveConstraintsInput,
    GetActiveConstraintsOutput,
    ActiveConstraintItem,
)
from app.agent.tools.permissions import ToolPermissionGuard


class GetEventStateTool(AgentTool):
    """Retrieves authoritative current event state and operational telemetry."""

    name = "get_event_state"
    description = "Retrieves authoritative current event state and operational telemetry."
    category = ToolCategory.EVENT_STATE
    access_mode = ToolAccessMode.READ_ONLY
    input_schema = GetEventStateInput
    output_schema = GetEventStateOutput
    availability = ToolAvailabilityStatus.AVAILABLE

    def execute(self, context: ToolContext, args: GetEventStateInput) -> ToolResult:
        ToolPermissionGuard.verify_read_permission(context.db, args.event_id, context.user_id, self.name)

        event = context.db.query(Event).filter(Event.id == args.event_id).first()
        if not event:
            return ToolResult.failure_result(self.name, f"Event with id '{args.event_id}' not found.", "NOT_FOUND")

        tasks = context.db.query(Task).filter(Task.event_id == args.event_id).all()
        budget_items = context.db.query(BudgetItem).filter(BudgetItem.event_id == args.event_id).all()
        objectives = context.db.query(Objective).filter(Objective.event_id == args.event_id).all()
        open_incidents = (
            context.db.query(Incident)
            .filter(Incident.event_id == args.event_id, Incident.status != "RESOLVED")
            .all()
        )

        total_act = sum((b.actual_amount for b in budget_items), Decimal("0.00"))
        critical_tasks = [t for t in tasks if t.is_critical_path]
        blocked_tasks = [t for t in tasks if t.status == "BLOCKED"]

        data = GetEventStateOutput(
            event_id=event.id,
            name=event.name,
            lifecycle_state=event.lifecycle_state,
            state=event.state,
            total_budget=float(event.total_budget or 0),
            budget_spent=float(total_act),
            budget_remaining=float((event.total_budget or Decimal("0.00")) - total_act),
            task_counts={
                "total": len(tasks),
                "critical_path": len(critical_tasks),
                "blocked": len(blocked_tasks),
            },
            objectives_count=len(objectives),
            open_incidents_count=len(open_incidents),
        )
        return ToolResult.success_result(self.name, data)


class GetEventSpecTool(AgentTool):
    """Retrieves the canonical, deterministic EventSpecification for the event."""

    name = "get_event_spec"
    description = "Retrieves the canonical, deterministic EventSpecification for the event."
    category = ToolCategory.EVENT_STATE
    access_mode = ToolAccessMode.READ_ONLY
    input_schema = GetEventSpecInput
    output_schema = GetEventSpecOutput
    availability = ToolAvailabilityStatus.AVAILABLE

    def execute(self, context: ToolContext, args: GetEventSpecInput) -> ToolResult:
        ToolPermissionGuard.verify_read_permission(context.db, args.event_id, context.user_id, self.name)

        event = context.db.query(Event).filter(Event.id == args.event_id).first()
        if not event:
            return ToolResult.failure_result(self.name, f"Event with id '{args.event_id}' not found.", "NOT_FOUND")

        spec_service = SpecificationService(context.db)
        try:
            specification = spec_service.build_specification(event=event)
        except Exception as e:
            return ToolResult.failure_result(self.name, f"Failed to build EventSpecification: {str(e)}")

        spec_dict = specification.model_dump()
        data = GetEventSpecOutput(
            event_id=specification.event_id,
            title=specification.title,
            event_type=specification.event_type.value if hasattr(specification.event_type, "value") else str(specification.event_type),
            status=specification.status,
            guest_count=specification.guest_count,
            total_budget=specification.total_budget,
            currency=specification.currency,
            location=specification.location,
            requirements_count=len(specification.requirements),
            tasks_count=len(specification.tasks),
            dependencies_count=len(specification.dependencies),
            provider_categories=[c.value if hasattr(c, "value") else str(c) for c in specification.provider_categories],
            constraints_count=len(specification.constraints),
            objectives_count=len(specification.objectives),
            specification=spec_dict,
        )
        return ToolResult.success_result(self.name, data)


class GetOperationalStatusTool(AgentTool):
    """Retrieves operational health, incident status, and task readiness for the event."""

    name = "get_operational_status"
    description = "Retrieves operational health, incident status, and task readiness for the event."
    category = ToolCategory.EVENT_STATE
    access_mode = ToolAccessMode.READ_ONLY
    input_schema = GetOperationalStatusInput
    output_schema = GetOperationalStatusOutput
    availability = ToolAvailabilityStatus.AVAILABLE

    def execute(self, context: ToolContext, args: GetOperationalStatusInput) -> ToolResult:
        ToolPermissionGuard.verify_read_permission(context.db, args.event_id, context.user_id, self.name)

        event = context.db.query(Event).filter(Event.id == args.event_id).first()
        if not event:
            return ToolResult.failure_result(self.name, f"Event with id '{args.event_id}' not found.", "NOT_FOUND")

        tasks = context.db.query(Task).filter(Task.event_id == args.event_id).all()
        critical_tasks = [t for t in tasks if t.is_critical_path]
        blocked_tasks = [t for t in tasks if t.status == "BLOCKED"]

        open_incidents = (
            context.db.query(Incident)
            .filter(Incident.event_id == args.event_id, Incident.status != "RESOLVED")
            .all()
        )

        budget_items = context.db.query(BudgetItem).filter(BudgetItem.event_id == args.event_id).all()
        total_act = sum((b.actual_amount for b in budget_items), Decimal("0.00"))
        tot_budget = event.total_budget or Decimal("0.00")
        util_pct = float((total_act / tot_budget) * 100) if tot_budget > 0 else 0.0

        is_active = event.lifecycle_state in ("PLANNED", "LIVE", "INCIDENT")

        data = GetOperationalStatusOutput(
            event_id=event.id,
            lifecycle_state=event.lifecycle_state,
            state=event.state,
            is_active=is_active,
            has_open_incidents=len(open_incidents) > 0,
            open_incidents_count=len(open_incidents),
            critical_tasks_count=len(critical_tasks),
            blocked_tasks_count=len(blocked_tasks),
            budget_utilization_percent=round(util_pct, 2),
        )
        return ToolResult.success_result(self.name, data)


class GetActiveConstraintsTool(AgentTool):
    """Retrieves all active operational constraints for the event."""

    name = "get_active_constraints"
    description = "Retrieves all active operational constraints (budget, deadline, capacity, venue, vendor requirements)."
    category = ToolCategory.EVENT_STATE
    access_mode = ToolAccessMode.READ_ONLY
    input_schema = GetActiveConstraintsInput
    output_schema = GetActiveConstraintsOutput
    availability = ToolAvailabilityStatus.AVAILABLE

    def execute(self, context: ToolContext, args: GetActiveConstraintsInput) -> ToolResult:
        ToolPermissionGuard.verify_read_permission(context.db, args.event_id, context.user_id, self.name)

        event = context.db.query(Event).filter(Event.id == args.event_id).first()
        if not event:
            return ToolResult.failure_result(self.name, f"Event with id '{args.event_id}' not found.", "NOT_FOUND")

        constraints = context.db.query(Constraint).filter(Constraint.event_id == args.event_id).all()

        items: List[ActiveConstraintItem] = []
        for c in constraints:
            val = c.value if isinstance(c.value, dict) else {"raw": c.value}
            items.append(
                ActiveConstraintItem(
                    id=c.id,
                    type=c.type if hasattr(c, "type") else "GENERAL",
                    name=c.name or "Constraint",
                    description=c.description,
                    value=val,
                    severity=getattr(c, "severity", "HARD") or "HARD",
                )
            )

        # Also synthesize top-level invariants if not represented as DB constraints
        if event.total_budget:
            items.append(
                ActiveConstraintItem(
                    id=f"budget-cap-{event.id}",
                    type="BUDGET",
                    name="Total Budget Ceiling",
                    description=f"Maximum approved event budget of {event.total_budget} {event.currency or 'INR'}",
                    value={"max_amount": float(event.total_budget), "currency": event.currency or "INR"},
                    severity="HARD",
                )
            )

        if event.guest_count:
            items.append(
                ActiveConstraintItem(
                    id=f"capacity-{event.id}",
                    type="CAPACITY",
                    name="Target Guest Count",
                    description=f"Target guest capacity of {event.guest_count} attendees",
                    value={"target_guests": int(event.guest_count)},
                    severity="HARD",
                )
            )

        data = GetActiveConstraintsOutput(
            event_id=args.event_id,
            total_constraints=len(items),
            constraints=items,
        )
        return ToolResult.success_result(self.name, data)


def event_tools_run(**kwargs) -> Dict[str, Any]:
    """Legacy helper for backward compatibility."""
    return {"status": "success"}
