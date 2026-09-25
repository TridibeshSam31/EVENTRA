"""Deterministic Engine: impact.analyzer

Core Impact Analysis Engine. Quantifies operational consequences of an incident across
tasks, dependencies, resources, providers, schedule, budget, objectives, and constraints.
"""
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional, Set
from decimal import Decimal

from app.engines.dependency.graph import DependencyGraph
from app.engines.impact.propagation import ImpactPropagation
from app.engines.impact.severity import ImpactSeverityCalculator


def utc_now():
    return datetime.now(timezone.utc).replace(tzinfo=None)


class ImpactAnalyzer:
    """Pure deterministic impact analysis engine.

    Orchestrates dependency propagation, schedule consequence evaluation,
    resource and provider impact aggregation, and severity assignment.
    """

    def __init__(self):
        self._propagation = ImpactPropagation()
        self._severity_calculator = ImpactSeverityCalculator()

    def analyze(
        self,
        incident: Any,
        tasks: List[Any],
        dependencies: List[Any],
        resources: Optional[List[Any]] = None,
        vendor_assignments: Optional[List[Any]] = None,
        budget_items: Optional[List[Any]] = None,
        objectives: Optional[List[Any]] = None,
        constraints: Optional[List[Any]] = None,
        event: Optional[Any] = None,
    ) -> Dict[str, Any]:
        """Perform comprehensive deterministic impact analysis.

        Returns:
            Structured ImpactResult dictionary.
        """
        resources = resources or []
        vendor_assignments = vendor_assignments or []
        budget_items = budget_items or []
        objectives = objectives or []
        constraints = constraints or []

        # Extract incident attributes
        incident_id = incident.get("id") if isinstance(incident, dict) else getattr(incident, "id", "")
        incident_type = (
            incident.get("incident_type") if isinstance(incident, dict)
            else getattr(incident, "incident_type", "GENERAL")
        )
        related_task_id = (
            incident.get("related_task_id") if isinstance(incident, dict)
            else getattr(incident, "related_task_id", None)
        )
        related_vendor_id = (
            incident.get("related_vendor_id") if isinstance(incident, dict)
            else getattr(incident, "related_vendor_id", None)
        )
        related_resource_id = (
            incident.get("related_resource_id") if isinstance(incident, dict)
            else getattr(incident, "related_resource_id", None)
        )
        related_venue_id = (
            incident.get("related_venue_id") if isinstance(incident, dict)
            else getattr(incident, "related_venue_id", None)
        )
        metadata = (
            incident.get("evidence_metadata") if isinstance(incident, dict)
            else getattr(incident, "evidence_metadata", None)
        ) or {}

        # Build in-memory task lookups
        tasks_by_id: Dict[str, Any] = {}
        for t in tasks:
            tid = t.get("id") if isinstance(t, dict) else getattr(t, "id")
            tasks_by_id[tid] = t

        # 1. Identify directly affected tasks
        direct_task_ids: Set[str] = set()
        if related_task_id and related_task_id in tasks_by_id:
            direct_task_ids.add(related_task_id)

        # If related_vendor_id is provided, find tasks assigned to or requiring this vendor
        affected_provider_assignments: List[Dict[str, Any]] = []
        vendor_category = None
        for va in vendor_assignments:
            va_vid = va.get("vendor_id") if isinstance(va, dict) else getattr(va, "vendor_id")
            if va_vid == related_vendor_id:
                affected_provider_assignments.append(
                    va if isinstance(va, dict)
                    else {
                        "id": getattr(va, "id"),
                        "vendor_id": va_vid,
                        "category": getattr(va, "category", None),
                        "status": getattr(va, "status", None),
                        "agreed_cost": getattr(va, "agreed_cost", None),
                    }
                )
                vendor_category = va.get("category") if isinstance(va, dict) else getattr(va, "category", None)

        if related_vendor_id and not related_task_id:
            for tid, t in tasks_by_id.items():
                cat = t.get("required_provider_category") if isinstance(t, dict) else getattr(t, "required_provider_category", None)
                if cat and vendor_category and cat.lower() == vendor_category.lower():
                    direct_task_ids.add(tid)

        # If related_resource_id is provided, find task allocated to it
        if related_resource_id:
            for r in resources:
                rid = r.get("id") if isinstance(r, dict) else getattr(r, "id")
                if rid == related_resource_id:
                    task_id = r.get("allocated_task_id") if isinstance(r, dict) else getattr(r, "allocated_task_id", None)
                    if task_id and task_id in tasks_by_id:
                        direct_task_ids.add(task_id)

        # If related_venue_id is provided, all setup/facility tasks are affected
        if related_venue_id and incident_type in ("VENUE_ISSUE", "CAPACITY_PROBLEM", "CAPACITY_CHANGE"):
            for tid, t in tasks_by_id.items():
                phase = t.get("phase") if isinstance(t, dict) else getattr(t, "phase", "")
                cat = t.get("required_provider_category") if isinstance(t, dict) else getattr(t, "required_provider_category", "")
                if phase in ("SETUP", "PRE_EVENT") or (cat and "venue" in cat.lower()):
                    direct_task_ids.add(tid)

        # If still no direct task (e.g. general incident), take first root or empty
        if not direct_task_ids and related_task_id:
            direct_task_ids.add(related_task_id)

        # 2. Build DependencyGraph and Propagate
        graph = DependencyGraph.from_tasks_and_dependencies(tasks, dependencies)
        indirect_ids, blocked_ids, affected_deps, max_depth = self._propagation.propagate_task_impact(
            direct_task_ids, graph, tasks_by_id
        )

        all_affected_ids = direct_task_ids.union(indirect_ids)

        # Serialize direct tasks
        direct_tasks_data: List[Dict[str, Any]] = []
        for tid in sorted(direct_task_ids):
            t = tasks_by_id.get(tid)
            if t:
                direct_tasks_data.append(self._serialize_task(t))

        # Serialize indirect tasks
        indirect_tasks_data: List[Dict[str, Any]] = []
        for tid in indirect_ids:
            t = tasks_by_id.get(tid)
            if t:
                indirect_tasks_data.append(self._serialize_task(t))

        # Serialize blocked tasks
        blocked_tasks_data: List[Dict[str, Any]] = []
        for tid in blocked_ids:
            t = tasks_by_id.get(tid)
            if t:
                blocked_tasks_data.append(self._serialize_task(t))

        # 3. Schedule Impact
        delay_minutes = metadata.get("delay_minutes", 0)
        if not delay_minutes:
            if incident_type in ("VENDOR_DELAY", "SCHEDULE_SLIP"):
                delay_minutes = 60
            elif incident_type in ("VENDOR_NO_SHOW", "VENDOR_FAILURE", "VENDOR_CANCELLATION"):
                # Default delay is duration of direct task or 120
                delay_minutes = max((t.get("duration_minutes", 60) for t in direct_tasks_data), default=120)
            elif incident_type in ("SCHEDULE_DEVIATION", "TASK_DELAY"):
                delay_minutes = metadata.get("deviation_minutes", 30)
            elif incident_type in ("RESOURCE_SHORTAGE", "RESOURCE_UNAVAILABLE", "EQUIPMENT_FAILURE", "VENUE_ISSUE", "DEPENDENCY_FAILURE", "CAPACITY_CHANGE"):
                delay_minutes = 45

        # Slack evaluation
        min_slack = None
        critical_path_breached = False
        for t_dict in direct_tasks_data + indirect_tasks_data:
            slack = t_dict.get("slack_minutes")
            if slack is not None:
                min_slack = slack if min_slack is None else min(min_slack, slack)
            if t_dict.get("is_critical_path", False):
                critical_path_breached = True

        if min_slack is not None and delay_minutes > min_slack:
            critical_path_breached = True

        # Check event end pressure
        deadline_exceeded = False
        if event:
            event_end = event.get("end_datetime") if isinstance(event, dict) else getattr(event, "end_datetime", None)
            if event_end:
                for t_dict in direct_tasks_data:
                    p_end = t_dict.get("planned_end")
                    if p_end and isinstance(p_end, datetime):
                        if p_end + timedelta(minutes=delay_minutes) > event_end:
                            deadline_exceeded = True

        slack_consumed = min(delay_minutes, min_slack) if min_slack is not None else delay_minutes
        remaining_slack = max(0, min_slack - delay_minutes) if min_slack is not None else None

        schedule_impact = {
            "delay_minutes": delay_minutes,
            "slack_consumed": slack_consumed,
            "remaining_slack": remaining_slack,
            "available_slack": min_slack,
            "critical_path_breached": critical_path_breached,
            "deadline_exceeded": deadline_exceeded,
            "affected_task_count": len(all_affected_ids),
        }

        # 4. Resource Impact
        affected_resources: List[Dict[str, Any]] = []
        for r in resources:
            r_task_id = r.get("allocated_task_id") if isinstance(r, dict) else getattr(r, "allocated_task_id", None)
            r_id = r.get("id") if isinstance(r, dict) else getattr(r, "id")
            if (r_task_id and r_task_id in all_affected_ids) or (r_id == related_resource_id):
                affected_resources.append({
                    "id": r_id,
                    "name": r.get("name") if isinstance(r, dict) else getattr(r, "name"),
                    "type": r.get("type") if isinstance(r, dict) else getattr(r, "type"),
                    "quantity": r.get("quantity") if isinstance(r, dict) else getattr(r, "quantity", 1),
                    "status": r.get("status") if isinstance(r, dict) else getattr(r, "status", "AVAILABLE"),
                    "allocated_task_id": r_task_id,
                })

        # 5. Provider Impact
        affected_providers: List[Dict[str, Any]] = affected_provider_assignments

        # 6. Budget Impact
        affected_budget_items: List[Dict[str, Any]] = []
        committed_cost_at_risk = Decimal("0.00")
        for bi in budget_items:
            bi_cat = bi.get("category") if isinstance(bi, dict) else getattr(bi, "category", "")
            # If category matches affected task or provider
            matches_category = any(
                t.get("required_provider_category", "").lower() == bi_cat.lower()
                for t in direct_tasks_data
                if t.get("required_provider_category")
            )
            if matches_category or (vendor_category and bi_cat.lower() == vendor_category.lower()):
                amt = bi.get("committed_amount", 0) if isinstance(bi, dict) else getattr(bi, "committed_amount", Decimal("0.00"))
                if not amt:
                    amt = bi.get("estimated_amount", 0) if isinstance(bi, dict) else getattr(bi, "estimated_amount", Decimal("0.00"))
                committed_cost_at_risk += Decimal(str(amt))
                affected_budget_items.append({
                    "id": bi.get("id") if isinstance(bi, dict) else getattr(bi, "id"),
                    "category": bi_cat,
                    "description": bi.get("description") if isinstance(bi, dict) else getattr(bi, "description", None),
                    "amount": float(amt),
                })

        budget_impact = {
            "committed_cost_at_risk": float(committed_cost_at_risk),
            "affected_budget_items_count": len(affected_budget_items),
        }

        # 7. Objectives Impact
        affected_objectives: List[Dict[str, Any]] = []
        for obj in objectives:
            obj_name = (obj.get("name") if isinstance(obj, dict) else getattr(obj, "name", "")).lower()
            obj_priority = obj.get("priority") if isinstance(obj, dict) else getattr(obj, "priority", "HIGH")
            obj_type = obj.get("type") if isinstance(obj, dict) else getattr(obj, "type", "")
            
            # Match if task name or category is mentioned in objective
            threatened = False
            for t in direct_tasks_data + indirect_tasks_data:
                tname = t.get("name", "").lower()
                if any(word in obj_name for word in tname.split() if len(word) > 3):
                    threatened = True
                    break

            if threatened or critical_path_breached:
                affected_objectives.append({
                    "id": obj.get("id") if isinstance(obj, dict) else getattr(obj, "id"),
                    "name": obj.get("name") if isinstance(obj, dict) else getattr(obj, "name"),
                    "priority": obj_priority,
                    "type": obj_type,
                    "status": "AT_RISK",
                })

        # 8. Constraints Impact
        affected_constraints: List[Dict[str, Any]] = []
        for c in constraints:
            c_type = c.get("type") if isinstance(c, dict) else getattr(c, "type", "")
            c_sev = c.get("severity") if isinstance(c, dict) else getattr(c, "severity", "HARD")
            c_name = c.get("name") if isinstance(c, dict) else getattr(c, "name", "")
            
            is_affected = False
            if c_type == "TIME_WINDOW" and deadline_exceeded:
                is_affected = True
            elif c_type == "VENUE_CAPACITY" and incident_type in ("VENUE_ISSUE", "CAPACITY_PROBLEM"):
                is_affected = True
            elif c_type == "RESOURCE" and len(affected_resources) > 0:
                is_affected = True

            if is_affected:
                affected_constraints.append({
                    "id": c.get("id") if isinstance(c, dict) else getattr(c, "id"),
                    "type": c_type,
                    "name": c_name,
                    "severity": c_sev,
                    "is_hard": (c_sev == "HARD"),
                })

        # 9. Severity
        calculated_severity = self._severity_calculator.calculate_severity(
            incident_type=incident_type,
            direct_tasks=direct_tasks_data,
            indirect_tasks=indirect_tasks_data,
            schedule_impact=schedule_impact,
            affected_objectives=affected_objectives,
            affected_constraints=affected_constraints,
            dependency_depth=max_depth,
        )

        return {
            "incident_id": incident_id,
            "directly_affected_tasks": direct_tasks_data,
            "indirectly_affected_tasks": indirect_tasks_data,
            "blocked_tasks": blocked_tasks_data,
            "affected_dependencies": affected_deps,
            "dependency_depth": max_depth,
            "affected_resources": affected_resources,
            "affected_providers": affected_providers,
            "schedule_impact": schedule_impact,
            "budget_impact": budget_impact,
            "affected_objectives": affected_objectives,
            "affected_constraints": affected_constraints,
            "severity": calculated_severity,
            "generated_at": utc_now().isoformat(),
        }

    def _serialize_task(self, task: Any) -> Dict[str, Any]:
        """Serialize a task ORM or dict record for impact reporting."""
        planned_start = task.get("planned_start") if isinstance(task, dict) else getattr(task, "planned_start", None)
        planned_end = task.get("planned_end") if isinstance(task, dict) else getattr(task, "planned_end", None)

        return {
            "id": task.get("id") if isinstance(task, dict) else getattr(task, "id"),
            "name": task.get("name") if isinstance(task, dict) else getattr(task, "name"),
            "status": task.get("status") if isinstance(task, dict) else getattr(task, "status"),
            "priority": task.get("priority") if isinstance(task, dict) else getattr(task, "priority"),
            "phase": task.get("phase") if isinstance(task, dict) else getattr(task, "phase", None),
            "required_provider_category": (
                task.get("required_provider_category") if isinstance(task, dict)
                else getattr(task, "required_provider_category", None)
            ),
            "duration_minutes": (
                task.get("duration_minutes") if isinstance(task, dict)
                else getattr(task, "duration_minutes", 0)
            ),
            "slack_minutes": (
                task.get("slack_minutes") if isinstance(task, dict)
                else getattr(task, "slack_minutes", None)
            ),
            "is_critical_path": (
                task.get("is_critical_path", False) if isinstance(task, dict)
                else getattr(task, "is_critical_path", False)
            ),
            "planned_start": planned_start.isoformat() if isinstance(planned_start, datetime) else planned_start,
            "planned_end": planned_end.isoformat() if isinstance(planned_end, datetime) else planned_end,
        }
