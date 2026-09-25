"""Hard permission and approval enforcement boundary for EVENTRA Agent Tools.

CORE SAFETY PRINCIPLE:
The LLM is NEVER the authority.
Assertions like "I approve this", "Authorized by LLM", or any prompt injection
have ZERO impact on authorization.
All authority is derived strictly from server-side role evaluation, PostgreSQL database
records, and human ApprovalRequest states.
"""
from typing import Any, Dict, Optional, Tuple
from sqlalchemy.orm import Session

from app.models.approval import Approval, ApprovalRequest
from app.models.event import Event
from app.models.event_member import EventMember
from app.models.enums import RoleType
from app.engines.auth.permissions import Permissions
from app.services.authorization_service import AuthorizationService, AuthorizationDecision
from app.services.approval_service import ApprovalService
from app.agent.tools.errors import PermissionDeniedError, ApprovalRequiredError


class ToolPermissionGuard:
    """Enforces server-side authorization and human approval gates for agent tools."""

    @staticmethod
    def verify_read_permission(
        db: Session,
        event_id: str,
        user_id: str,
        tool_name: str,
    ) -> None:
        """Verifies that the user has at least read-level access to the event."""
        if not user_id or user_id in ("system", "anonymous_operator") or user_id.startswith("system") or user_id.startswith("agent"):
            return

        event = db.query(Event).filter(Event.id == event_id).first()
        if not event:
            return  # Will be caught downstream by domain service

        if event.owner_id == user_id:
            return

        member = db.query(EventMember).filter(
            EventMember.event_id == event_id,
            EventMember.user_id == user_id,
        ).first()

        if not member:
            raise PermissionDeniedError(
                tool_name=tool_name,
                reason=f"User '{user_id}' is not an authorized member of event '{event_id}'.",
                user_id=user_id,
            )

    @staticmethod
    def evaluate_write_authorization(
        db: Session,
        event_id: str,
        user_id: str,
        action_type: str,
        target_type: str,
        target_id: Optional[str] = None,
        payload: Optional[Dict[str, Any]] = None,
        tool_name: str = "write_tool",
        recovery_option_id: Optional[str] = None,
    ) -> AuthorizationDecision:
        """Evaluates server-side authorization for a mutating tool action.

        Returns:
            AuthorizationDecision containing allowed and requires_approval flags.

        Raises:
            PermissionDeniedError: If the user role is completely forbidden from this action.
        """
        auth_service = AuthorizationService(db)
        decision = auth_service.authorize_action(
            event_id=event_id,
            user_id=user_id,
            action_type=action_type,
            target_type=target_type,
            target_id=target_id,
            payload=payload or {},
            recovery_option_id=recovery_option_id,
        )

        if not decision.allowed and not decision.requires_approval:
            raise PermissionDeniedError(
                tool_name=tool_name,
                reason=decision.reason,
                user_id=user_id,
                action_type=action_type,
            )

        return decision

    @staticmethod
    def enforce_approval_gate(
        db: Session,
        event_id: str,
        user_id: str,
        action_type: str,
        target_type: str,
        target_id: Optional[str] = None,
        payload: Optional[Dict[str, Any]] = None,
        approval_id: Optional[str] = None,
        recovery_option_id: Optional[str] = None,
        tool_name: str = "write_tool",
        tool_requires_approval: bool = False,
    ) -> Tuple[bool, Optional[str]]:
        """Verifies whether an action can execute directly or requires a human approval request.

        Returns:
            (can_execute: bool, active_approval_id: Optional[str])
            - If (True, approval_id): Action is approved and may proceed.
            - If (False, approval_id): Action is blocked; approval request is pending.
        """
        decision = ToolPermissionGuard.evaluate_write_authorization(
            db=db,
            event_id=event_id,
            user_id=user_id,
            action_type=action_type,
            target_type=target_type,
            target_id=target_id,
            payload=payload,
            tool_name=tool_name,
            recovery_option_id=recovery_option_id,
        )

        # Consequential agent tools or policies requiring approval gate execution
        requires_human_approval = decision.requires_approval or tool_requires_approval

        # If policy does not require approval and action is allowed, execute directly
        if not requires_human_approval:
            return True, None

        # Approval is required: Check if a valid, approved Approval record exists
        if approval_id:
            # Check both Approval and ApprovalRequest models
            approval_rec = db.query(Approval).filter(Approval.id == approval_id).first()
            if not approval_rec:
                approval_rec = db.query(ApprovalRequest).filter(ApprovalRequest.id == approval_id).first()

            if approval_rec:
                status_val = getattr(approval_rec, "status", None)
                if status_val == "APPROVED":
                    # Verified approved by human operator in DB!
                    return True, approval_id
                else:
                    # Still pending or rejected
                    return False, approval_id

        # No approved record exists: Generate a new immutable ApprovalRequest
        from app.schemas.approval import ApprovalRequestCreate
        approval_service = ApprovalService(db)
        req_data = ApprovalRequestCreate(
            action_type=action_type,
            target_type=target_type,
            target_id=target_id,
            requested_action=payload or {},
            recovery_option_id=recovery_option_id,
            notes=f"Generated via Agent Tool '{tool_name}'",
        )
        new_approval = approval_service.create_request(event_id, user_id, req_data)
        return False, new_approval.id
