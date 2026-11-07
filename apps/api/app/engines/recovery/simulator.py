"""In-memory recovery simulation using the existing schedule, impact, and risk engines."""
from copy import deepcopy
from datetime import datetime
from decimal import Decimal
from typing import Any, Dict, List

from app.engines.dependency.graph import DependencyGraph
from app.engines.impact.analyzer import ImpactAnalyzer
from app.engines.recovery.types import RecoveryCandidate, RecoveryContext, RecoverySimulation
from app.engines.risk.calculator import RiskCalculator
from app.engines.schedule.adjustment import ScheduleAdjuster
from app.engines.schedule.scheduler import ScheduleEngine


class RecoverySimulator:
    """Calculates a hypothetical state without assigning to ORM entities."""

    def __init__(self):
        self._schedule_engine = ScheduleEngine()
        self._schedule_adjuster = ScheduleAdjuster()
        self._impact_analyzer = ImpactAnalyzer()
        self._risk_calculator = RiskCalculator()

    def simulate(self, candidate: RecoveryCandidate, context: RecoveryContext) -> RecoverySimulation:
        tasks = [self._task_dict(task) for task in context.tasks]
        task_by_id = {task["id"]: task for task in tasks}
        changes = candidate.proposed_changes
        compression = int(changes.get("compression_minutes", 0) or 0)
        if compression:
            for task_id in candidate.affected_task_ids:
                if task_id in task_by_id:
                    task = task_by_id[task_id]
                    task["duration_minutes"] = max(1, int(task.get("duration_minutes") or 1) - compression)

        baseline = self._schedule_engine.schedule_tasks(context.event.start_datetime, context.tasks, context.dependencies)
        simulated = self._schedule_engine.schedule_tasks(context.event.start_datetime, tasks, context.dependencies)
        delay = max(0, int(changes.get("delay_minutes", 0) or 0) - compression)
        if delay and candidate.affected_task_ids:
            graph = DependencyGraph.from_tasks_and_dependencies(tasks, context.dependencies)
            adjusted = self._schedule_adjuster.adjust_for_delay(candidate.affected_task_ids[0], delay, graph, simulated)
            entries = adjusted.entries
            project_end = adjusted.new_project_end
        else:
            entries = simulated.entries
            project_end = simulated.project_end

        changed_tasks: List[Dict[str, Any]] = []
        for task in tasks:
            entry = entries.get(task["id"])
            old = baseline.entries.get(task["id"])
            if entry:
                task["planned_start"] = entry.planned_start
                task["planned_end"] = entry.planned_end
                if not old or entry.planned_start != old.planned_start or entry.planned_end != old.planned_end:
                    changed_tasks.append({
                        "task_id": task["id"],
                        "previous_start": old.planned_start.isoformat() if old else None,
                        "previous_end": old.planned_end.isoformat() if old else None,
                        "proposed_start": entry.planned_start.isoformat(),
                        "proposed_end": entry.planned_end.isoformat(),
                    })

        baseline_end = baseline.project_end or context.event.start_datetime
        total_delay = int((project_end - baseline_end).total_seconds() / 60) if project_end else 0
        available = int((context.event.end_datetime - context.event.start_datetime).total_seconds() / 60)
        duration = int((project_end - context.event.start_datetime).total_seconds() / 60) if project_end else 0
        schedule_delta = {
            "task_changes": changed_tasks,
            "total_delay_change_minutes": total_delay,
            "project_end_before": baseline_end.isoformat(),
            "project_end_after": project_end.isoformat() if project_end else None,
            "slack_before_minutes": max(available - baseline.total_duration_minutes, 0),
            "slack_after_minutes": max(available - duration, 0),
        }

        provider_delta = self._provider_delta(candidate, context)
        budget_delta = self._budget_delta(candidate, context)
        resource_delta = self._resource_delta(candidate)
        simulated_incident = self._incident_dict(context.incident, delay)
        impact_after = self._impact_analyzer.analyze(
            incident=simulated_incident, tasks=tasks, dependencies=context.dependencies,
            resources=context.resources, vendor_assignments=context.provider_assignments,
            budget_items=context.budget_items, objectives=context.objectives,
            constraints=context.constraints, event=context.event,
        )
        risk_after = self._risk_calculator.calculate(
            simulated_incident, impact_after, context.event,
            alternative_providers_count=len(context.providers),
        )
        objective_delta = self._objective_delta(context, impact_after)
        constraint_impact = {"affected": impact_after.get("affected_constraints", [])}
        return RecoverySimulation(candidate, schedule_delta, budget_delta, resource_delta,
                                  provider_delta, objective_delta, constraint_impact,
                                  risk_after, tasks)

    @staticmethod
    def _task_dict(task: Any) -> Dict[str, Any]:
        return {
            "id": task.id, "name": task.name, "status": task.status, "priority": task.priority,
            "phase": task.phase, "required_provider_category": task.required_provider_category,
            "duration_minutes": task.duration_minutes or 0, "slack_minutes": task.slack_minutes,
            "is_critical_path": task.is_critical_path, "planned_start": task.planned_start,
            "planned_end": task.planned_end,
        }

    @staticmethod
    def _incident_dict(incident: Any, residual_delay: int) -> Dict[str, Any]:
        metadata = deepcopy(getattr(incident, "evidence_metadata", None) or {})
        metadata["delay_minutes"] = residual_delay
        return {"id": incident.id, "incident_type": incident.incident_type,
                "related_task_id": incident.related_task_id, "related_vendor_id": incident.related_vendor_id,
                "related_resource_id": incident.related_resource_id, "related_venue_id": incident.related_venue_id,
                "evidence_metadata": metadata}

    @staticmethod
    def _provider_delta(candidate: RecoveryCandidate, context: RecoveryContext) -> Dict[str, Any]:
        if not candidate.affected_provider_ids:
            return {"assignment_changes": [], "eta_minutes": None}
        return {"assignment_changes": [{"from_provider_id": getattr(context.incident, "related_vendor_id", None),
                                         "to_provider_id": candidate.affected_provider_ids[0]}],
                "eta_minutes": candidate.proposed_changes.get("delay_minutes", 0)}

    @staticmethod
    def _budget_delta(candidate: RecoveryCandidate, context: RecoveryContext) -> Dict[str, Any]:
        proposed_cost = candidate.proposed_changes.get("provider_cost")
        if proposed_cost is None:
            changes = candidate.proposed_changes
            new_provider = any(k in changes for k in ("vendor_id", "provider_id", "replacement_vendor_id", "vendor_reassignment"))
            # A replacement vendor without a quote has an unknown cost, never an implied zero.
            return {"additional_cost": 0.0, "removed_cost": 0.0, "net_delta": 0.0, "cost_known": not new_provider}
        prior = next((a.agreed_cost for a in context.provider_assignments
                      if a.vendor_id == getattr(context.incident, "related_vendor_id", None) and a.agreed_cost is not None), 0)
        prior = float(prior or 0)
        proposed = float(proposed_cost)
        return {"additional_cost": max(proposed - prior, 0.0), "removed_cost": prior,
                "net_delta": proposed - prior, "cost_known": True}

    @staticmethod
    def _resource_delta(candidate: RecoveryCandidate) -> Dict[str, Any]:
        return {"allocations_added": candidate.affected_resource_ids, "allocations_removed": [], "conflicts": []}

    @staticmethod
    def _objective_delta(context: RecoveryContext, impact_after: Dict[str, Any]) -> Dict[str, Any]:
        before = {item.get("id"): item.get("status") for item in context.impact_result.get("affected_objectives", [])}
        after = {item.get("id"): item.get("status") for item in impact_after.get("affected_objectives", [])}
        return {"before": before, "after": after}
