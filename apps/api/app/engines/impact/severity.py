"""Deterministic Engine: impact.severity

Calculates explainable impact severity based on concrete operational facts:
critical path status, slack consumption, downstream dependencies, and constraint pressure.
"""
from typing import Any, Dict, List
from app.models.enums import IncidentSeverity, TaskPriority


class ImpactSeverityCalculator:
    """Pure deterministic calculator for incident impact severity."""

    def calculate_severity(
        self,
        incident_type: str,
        direct_tasks: List[Dict[str, Any]],
        indirect_tasks: List[Dict[str, Any]],
        schedule_impact: Dict[str, Any],
        affected_objectives: List[Dict[str, Any]],
        affected_constraints: List[Dict[str, Any]],
        dependency_depth: int,
    ) -> str:
        """Determine severity level from factual impact indicators.

        Returns:
            One of IncidentSeverity: CRITICAL, HIGH, MEDIUM, LOW.
        """
        # 1. CRITICAL checks
        # Critical path task breached or schedule deadline exceeded
        if schedule_impact.get("critical_path_breached", False):
            return IncidentSeverity.CRITICAL.value

        if schedule_impact.get("deadline_exceeded", False):
            return IncidentSeverity.CRITICAL.value

        # Any affected task has CRITICAL priority and zero slack
        for task in direct_tasks:
            priority = task.get("priority")
            slack = task.get("slack_minutes", 999)
            if priority == TaskPriority.CRITICAL.value and slack is not None and slack <= 0:
                return IncidentSeverity.CRITICAL.value

        # Hard constraint violation
        for constraint in affected_constraints:
            if constraint.get("severity") == "HARD" or constraint.get("is_hard", False):
                return IncidentSeverity.CRITICAL.value

        # Critical objective threatened
        for obj in affected_objectives:
            if obj.get("priority") == "CRITICAL" and obj.get("status") == "AT_RISK":
                return IncidentSeverity.CRITICAL.value

        # Vendor no-show/failure on any high/critical task
        if incident_type in ("VENDOR_NO_SHOW", "VENDOR_FAILURE", "VENDOR_CANCELLATION"):
            for task in direct_tasks:
                if task.get("priority") in (TaskPriority.CRITICAL.value, TaskPriority.HIGH.value):
                    return IncidentSeverity.CRITICAL.value

        # 2. HIGH checks
        # Deep dependency chain or multiple downstream tasks affected
        if len(indirect_tasks) > 2 or dependency_depth >= 2:
            return IncidentSeverity.HIGH.value

        for task in direct_tasks:
            if task.get("priority") in (TaskPriority.CRITICAL.value, TaskPriority.HIGH.value):
                return IncidentSeverity.HIGH.value

        # High schedule delay
        if schedule_impact.get("delay_minutes", 0) >= 60:
            return IncidentSeverity.HIGH.value

        if incident_type in ("VENDOR_NO_SHOW", "VENDOR_FAILURE", "VENDOR_CANCELLATION", "VENUE_ISSUE", "DEPENDENCY_FAILURE", "RESOURCE_UNAVAILABLE", "EQUIPMENT_FAILURE"):
            return IncidentSeverity.HIGH.value

        # 3. MEDIUM checks
        if len(indirect_tasks) > 0:
            return IncidentSeverity.MEDIUM.value

        for task in direct_tasks:
            if task.get("priority") == TaskPriority.MEDIUM.value:
                return IncidentSeverity.MEDIUM.value

        if schedule_impact.get("delay_minutes", 0) > 0:
            return IncidentSeverity.MEDIUM.value

        # 4. LOW checks
        return IncidentSeverity.LOW.value
