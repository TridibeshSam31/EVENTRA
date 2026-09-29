"""Deterministic Action Impact Classifier"""
from typing import Any, Dict, Optional
from decimal import Decimal
from app.models.enums import TaskPriority, EventState


class ActionImpactClassifier:
    """Classifies operational mutations into MINOR, MAJOR, or CRITICAL tiers based on authoritative facts."""

    @staticmethod
    def classify(
        action_type: str,
        payload: Dict[str, Any],
        event: Optional[Any] = None,
        task: Optional[Any] = None,
        budget_item: Optional[Any] = None,
        resource: Optional[Any] = None,
        vendor: Optional[Any] = None,
    ) -> str:
        """Determines the authoritative impact tier for an operational action."""
        # 1. Any action during an EMERGENCY event state is classified as CRITICAL
        if event:
            event_state = event.state if hasattr(event, "state") else event.get("state")
            if event_state in (EventState.EMERGENCY.value, "EMERGENCY"):
                return "CRITICAL"

        # 2. Critical Task / Critical Path Breach
        if task:
            priority = getattr(task, "priority", None) or (task.get("priority") if isinstance(task, dict) else None)
            is_cp = getattr(task, "is_critical_path", False) or (task.get("is_critical_path", False) if isinstance(task, dict) else False)
            if priority == TaskPriority.CRITICAL.value or is_cp:
                return "CRITICAL"

        # 3. Action-Specific Classifications
        if action_type in ("REASSIGN_VENDOR", "CONTRACT_VENDOR"):
            # Reassigning vendor on a HIGH priority task is CRITICAL, otherwise MAJOR
            if task:
                priority = getattr(task, "priority", None) or (task.get("priority") if isinstance(task, dict) else None)
                if priority in (TaskPriority.HIGH.value, TaskPriority.CRITICAL.value):
                    return "CRITICAL"
            cost_delta = payload.get("cost_delta", 0)
            try:
                if abs(float(cost_delta)) > 1000.0:
                    return "CRITICAL"
            except (ValueError, TypeError):
                pass
            return "MAJOR"

        elif action_type == "ADJUST_SCHEDULE":
            shift_minutes = abs(payload.get("shift_minutes", 0) or payload.get("delay_minutes", 0))
            if task:
                slack = getattr(task, "slack_minutes", 0) or 0
                if shift_minutes > slack:
                    return "CRITICAL"
                if shift_minutes > 15:
                    return "MAJOR"
            return "MINOR"

        elif action_type == "ADJUST_BUDGET":
            delta = payload.get("delta_amount", 0) or payload.get("amount", 0)
            try:
                abs_delta = abs(Decimal(str(delta)))
            except Exception:
                abs_delta = Decimal("0.00")

            total_budget = Decimal("0.00")
            if event:
                tb = getattr(event, "total_budget", 0) or (event.get("total_budget", 0) if isinstance(event, dict) else 0)
                try:
                    total_budget = Decimal(str(tb))
                except Exception:
                    pass

            if abs_delta > Decimal("1000.00") or (total_budget > 0 and (abs_delta / total_budget) >= Decimal("0.05")):
                return "CRITICAL"
            if abs_delta > Decimal("200.00"):
                return "MAJOR"
            return "MINOR"

        elif action_type == "ALLOCATE_RESOURCE":
            if task:
                priority = getattr(task, "priority", None) or (task.get("priority") if isinstance(task, dict) else None)
                if priority in (TaskPriority.HIGH.value, TaskPriority.CRITICAL.value):
                    return "CRITICAL"
            qty = payload.get("quantity", 1)
            if qty > 5:
                return "MAJOR"
            return "MINOR"

        elif action_type == "REASSIGN_TASK":
            if task:
                priority = getattr(task, "priority", None) or (task.get("priority") if isinstance(task, dict) else None)
                if priority in (TaskPriority.HIGH.value, TaskPriority.CRITICAL.value):
                    return "CRITICAL"
                if priority == TaskPriority.MEDIUM.value:
                    return "MAJOR"
        elif action_type == "COMMUNICATION_OUTREACH":
            return "MAJOR"

        # Default fallback: safe categorization
        return "MAJOR"

