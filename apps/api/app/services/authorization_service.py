"""Authoritative Server-Side Authorization Service"""
from dataclasses import dataclass
from typing import Any, Dict, Optional
from sqlalchemy.orm import Session

from app.core.exceptions import (
    ForbiddenException,
    BadRequestException,
    NotFoundException,
)
from app.models.event import Event
from app.models.event_member import EventMember
from app.models.task import Task
from app.models.vendor_assignment import VendorAssignment
from app.models.resource import Resource
from app.models.budget import BudgetItem
from app.models.venue import Venue
from app.models.vendor import Vendor
from app.models.enums import RoleType
from app.engines.auth.permissions import (
    Permissions,
    ROLE_PERMISSIONS_MAP,
    ACTION_PERMISSION_MAP,
)
from app.engines.auth.classifier import ActionImpactClassifier
from app.engines.auth.policy import ApprovalPolicy


@dataclass
class AuthorizationDecision:
    allowed: bool
    requires_approval: bool
    reason: str
    action_type: str
    impact_level: str
    required_permission: str
    required_role: Optional[str] = None
    approval_policy: Optional[str] = None
    event_id: str = ""
    target_id: Optional[str] = None


class AuthorizationService:
    """Evaluates role, permissions, target scopes, and impact policies to authorize operational actions."""

    def __init__(self, db: Session):
        self.db = db

    def get_event(self, event_id: str) -> Event:
        event = self.db.query(Event).filter(Event.id == event_id).first()
        if not event:
            raise NotFoundException(f"Event with id '{event_id}' not found.")
        return event

    def get_user_role(self, event: Event, user_id: str) -> str:
        """Resolves the user's authoritative role within the event."""
        if (
            not user_id
            or user_id in ("system", "anonymous_operator")
            or user_id.startswith("system")
            or user_id.startswith("agent")
            or user_id.startswith("autonomous")
        ):
            # System/dev override treated as Main Organizer
            return RoleType.MAIN_ORGANIZER.value

        if event.owner_id == user_id:
            return RoleType.MAIN_ORGANIZER.value

        member = (
            self.db.query(EventMember)
            .filter(EventMember.event_id == event.id, EventMember.user_id == user_id)
            .first()
        )
        if not member:
            raise ForbiddenException(f"User '{user_id}' is not an authorized member of event '{event.id}'.")

        return member.role or RoleType.COLLABORATOR.value

    def validate_target_scope(self, event_id: str, target_type: str, target_id: Optional[str]) -> Optional[Any]:
        """Validates that the target entity exists and belongs to the specified event."""
        if not target_id or target_type in ("EVENT", "GENERAL"):
            return None

        target_type_upper = target_type.upper()

        if target_type_upper == "TASK":
            task = self.db.query(Task).filter(Task.id == target_id).first()
            if not task:
                raise NotFoundException(f"Target task '{target_id}' not found.")
            if task.event_id != event_id:
                raise BadRequestException(f"Target task '{target_id}' does not belong to event '{event_id}'.")
            return task

        elif target_type_upper in ("VENDOR_ASSIGNMENT", "VENDOR"):
            # Can be vendor assignment or vendor
            va = self.db.query(VendorAssignment).filter(VendorAssignment.id == target_id).first()
            if va:
                if va.event_id != event_id:
                    raise BadRequestException(f"Target vendor assignment '{target_id}' does not belong to event '{event_id}'.")
                return va
            v = self.db.query(Vendor).filter(Vendor.id == target_id).first()
            if v:
                return v
            return None

        elif target_type_upper == "RESOURCE":
            res = self.db.query(Resource).filter(Resource.id == target_id).first()
            if not res:
                raise NotFoundException(f"Target resource '{target_id}' not found.")
            if res.event_id != event_id:
                raise BadRequestException(f"Target resource '{target_id}' does not belong to event '{event_id}'.")
            return res

        elif target_type_upper == "BUDGET":
            item = self.db.query(BudgetItem).filter(BudgetItem.id == target_id).first()
            if not item:
                raise NotFoundException(f"Target budget item '{target_id}' not found.")
            if item.event_id != event_id:
                raise BadRequestException(f"Target budget item '{target_id}' does not belong to event '{event_id}'.")
            return item

        elif target_type_upper in (
            "SHORTLIST", "CANDIDATE", "VENUE", "CATERING", "PHOTOGRAPHY",
            "AV_TECH", "DECOR", "SECURITY", "TRANSPORT", "OTHER",
        ):
            from app.models.shortlist import EventShortlistEntry
            entry = self.db.query(EventShortlistEntry).filter(
                EventShortlistEntry.event_id == event_id,
                (EventShortlistEntry.candidate_id == target_id) | (EventShortlistEntry.id == target_id) | (EventShortlistEntry.provider_id == target_id),
            ).first()
            if entry:
                return entry
            try:
                from app.models.venue import Venue
                ven = self.db.query(Venue).filter(Venue.id == target_id).first()
                if ven:
                    return ven
            except Exception:
                pass
            return None

        return None


    def authorize_action(
        self,
        event_id: str,
        user_id: str,
        action_type: str,
        target_type: str,
        target_id: Optional[str] = None,
        payload: Optional[Dict[str, Any]] = None,
        recovery_option_id: Optional[str] = None,
    ) -> AuthorizationDecision:
        """Authoritatively evaluates if user can execute or must request approval for an operational action."""
        payload = payload or {}
        event = self.get_event(event_id)
        role = self.get_user_role(event, user_id)

        # 1. Viewers are strictly prohibited from any state-changing actions
        if role == RoleType.VIEWER.value:
            return AuthorizationDecision(
                allowed=False,
                requires_approval=False,
                reason="Viewers have read-only access and cannot submit operational actions.",
                action_type=action_type,
                impact_level="MINOR",
                required_permission=Permissions.ACTION_EXECUTE,
                event_id=event_id,
                target_id=target_id,
            )

        # 3. Vendor scope isolation check
        if role == RoleType.VENDOR.value:
            if target_type.upper() != "TASK":
                return AuthorizationDecision(
                    allowed=False,
                    requires_approval=False,
                    reason="Vendors are restricted to assigned task interactions only.",
                    action_type=action_type,
                    impact_level="MAJOR",
                    required_permission=ACTION_PERMISSION_MAP.get(action_type, Permissions.ACTION_EXECUTE),
                    event_id=event_id,
                    target_id=target_id,
                )

        # 4. Target scope validation (anti cross-event injection)
        target_entity = self.validate_target_scope(event_id, target_type, target_id)

        # 5. Deterministic Impact Classification
        task_entity = target_entity if target_type.upper() == "TASK" else None
        impact_level = ActionImpactClassifier.classify(
            action_type=action_type,
            payload=payload,
            event=event,
            task=task_entity,
        )

        # 6. Approval Policy check
        requires_approval = ApprovalPolicy.requires_approval(
            role=role,
            impact_level=impact_level,
            action_type=action_type,
        )

        # 7. Permission check
        required_perm = ACTION_PERMISSION_MAP.get(action_type, Permissions.ACTION_EXECUTE)
        granted_perms = ROLE_PERMISSIONS_MAP.get(role, set())

        if not requires_approval:
            # Direct execution requires the specific action permission
            if required_perm not in granted_perms and Permissions.ACTION_EXECUTE not in granted_perms:
                return AuthorizationDecision(
                    allowed=False,
                    requires_approval=False,
                    reason=f"Role '{role}' lacks required permission '{required_perm}' to execute action '{action_type}' directly.",
                    action_type=action_type,
                    impact_level=impact_level,
                    required_permission=required_perm,
                    required_role=RoleType.EVENT_MANAGER.value,
                    event_id=event_id,
                    target_id=target_id,
                )
        else:
            # Submitting for approval requires APPROVAL_CREATE permission
            if Permissions.APPROVAL_CREATE not in granted_perms and Permissions.RECOVERY_REQUEST not in granted_perms:
                return AuthorizationDecision(
                    allowed=False,
                    requires_approval=True,
                    reason=f"Role '{role}' lacks permission '{Permissions.APPROVAL_CREATE}' to submit approval requests.",
                    action_type=action_type,
                    impact_level=impact_level,
                    required_permission=Permissions.APPROVAL_CREATE,
                    event_id=event_id,
                    target_id=target_id,
                )

        reason = (
            f"Action classified as {impact_level} impact; requires formal approval from authorized approver."
            if requires_approval
            else f"Action classified as {impact_level} impact; direct execution permitted for role '{role}'."
        )

        return AuthorizationDecision(
            allowed=True,
            requires_approval=requires_approval,
            reason=reason,
            action_type=action_type,
            impact_level=impact_level,
            required_permission=required_perm,
            approval_policy="STANDARD_COLLABORATION_POLICY",
            event_id=event_id,
            target_id=target_id,
        )
