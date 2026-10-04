"""Deterministic Approval Policy Engine"""
from typing import List, Optional, Set
from app.models.enums import RoleType


class ApprovalPolicy:
    """Evaluates whether an action requires approval or can be executed directly, and resolves approvers."""

    @staticmethod
    def requires_approval(
        role: str,
        impact_level: str,
        action_type: str,
    ) -> bool:
        """Determines if the action requires an approval request based on role and impact level."""
        # Viewers cannot execute any mutations
        if role == RoleType.VIEWER.value:
            return False  # Will be rejected as not allowed entirely

        # Main Organizer can directly execute MINOR and MAJOR actions
        if role == RoleType.MAIN_ORGANIZER.value:
            # Critical actions can be directly executed by the Main Organizer (the ultimate authority)
            # unless explicitly submitted for peer approval
            return False

        # Event Manager
        if role == RoleType.EVENT_MANAGER.value:
            if impact_level == "CRITICAL":
                return True
            return False

        # Collaborator
        if role == RoleType.COLLABORATOR.value:
            if impact_level in ("MAJOR", "CRITICAL"):
                return True
            # Minor actions can be directly executed if collaborator has permission
            return False

        # Vendor
        if role == RoleType.VENDOR.value:
            # Vendors can only update status on assigned tasks directly
            if action_type == "TASK_STATUS_UPDATE" and impact_level == "MINOR":
                return False
            return True

        return True

    @staticmethod
    def eligible_approver_roles(impact_level: str) -> Set[str]:
        """Returns the set of roles eligible to approve an action of a given impact level."""
        if impact_level == "CRITICAL":
            return {RoleType.MAIN_ORGANIZER.value}
        # MAJOR and MINOR can be approved by Event Manager or Main Organizer
        return {RoleType.MAIN_ORGANIZER.value, RoleType.EVENT_MANAGER.value}

    @staticmethod
    def is_eligible_approver(approver_role: str, impact_level: str) -> bool:
        """Checks if a given role is eligible to approve an action."""
        return approver_role in ApprovalPolicy.eligible_approver_roles(impact_level)

    @staticmethod
    def should_notify(impact_level: str, action_type: Optional[str] = None, payload: Optional[dict] = None) -> bool:
        """Determines if external notifications (WhatsApp/Push) should be dispatched.
        
        Deterministic policy to prevent notification fatigue for low-risk actions.
        """
        if impact_level in ("CRITICAL", "MAJOR"):
            return True
        if payload and payload.get("pre_authorized") is True:
            return False
        try:
            from app.core.config import settings
            cost = float((payload or {}).get("cost_delta") or (payload or {}).get("proposed_cost") or 0.0)
            if cost <= settings.APPROVAL_LOW_RISK_THRESHOLD and impact_level == "MINOR":
                return False
        except Exception:
            pass
        return True
