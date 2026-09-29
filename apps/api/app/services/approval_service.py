"""Domain Service: ApprovalService (Governance, Separation of Duties, Stale Revalidation)"""
from datetime import datetime, timezone
from typing import List, Optional, Tuple
from sqlalchemy.orm import Session

from app.core.exceptions import (
    ForbiddenException,
    BadRequestException,
    NotFoundException,
    ConflictException,
)
from app.models.event import Event
from app.models.user import User
from app.models.approval import Approval
from app.models.action import ActionExecution
from app.models.enums import RoleType
from app.schemas.approval import ApprovalRequestCreate
from app.engines.auth.snapshot import compute_event_state_snapshot
from app.engines.auth.policy import ApprovalPolicy
from app.engines.auth.permissions import Permissions, ROLE_PERMISSIONS_MAP
from app.services.authorization_service import AuthorizationService
from app.services.action_service import ActionService


def utc_now():
    return datetime.now(timezone.utc).replace(tzinfo=None)


class ApprovalService:
    """Orchestrates approval request lifecycles, enforces separation of duties, and triggers atomic execution."""

    def __init__(self, db: Session):
        self.db = db
        self._auth_service = AuthorizationService(db)
        self._action_service = ActionService(db)

    def _get_event(self, event_id: str) -> Event:
        event = self.db.query(Event).filter(Event.id == event_id).first()
        if not event:
            raise NotFoundException(f"Event with id '{event_id}' not found.")
        return event

    def _ensure_user_exists(self, user_id: Optional[str]) -> Optional[str]:
        if not user_id:
            return None
        from app.services.identity_service import ensure_user_exists
        return ensure_user_exists(self.db, user_id).id

    def _resolve_and_verify_requester(self, event_id: str, candidate_user_id: Optional[str]) -> str:
        """Centrally resolves and guarantees requester_id exists in the users table prior to INSERT."""
        from app.services.identity_service import resolve_requester_identity, ensure_user_exists
        from app.models.user import User

        resolved_id = resolve_requester_identity(self.db, event_id=event_id, candidate_user_id=candidate_user_id)
        user = self.db.query(User).filter(User.id == resolved_id).first()
        if not user:
            user = ensure_user_exists(self.db, resolved_id)
            self.db.flush()

        db_user = self.db.query(User).filter(User.id == user.id).first()
        if not db_user:
            raise NotFoundException(
                f"Referential integrity failure: resolved user '{resolved_id}' could not be verified in users table."
            )
        return db_user.id

    def create_communication_outreach_approval(
        self,
        event_id: str,
        candidate_id: str,
        requester_id: Optional[str] = None,
        candidate_name: Optional[str] = None,
        category: Optional[str] = None,
        provider_id: Optional[str] = None,
    ) -> Tuple[Approval, bool]:
        """Centrally creates or retrieves a COMMUNICATION_OUTREACH approval for a shortlist candidate.
        
        Guarantees that requester_id is resolved and verified to exist in the users table prior
        to INSERT, strictly maintaining the approvals_requester_id_fkey constraint.
        """
        existing = (
            self.db.query(Approval)
            .filter(
                Approval.event_id == event_id,
                Approval.action_type == "COMMUNICATION_OUTREACH",
                Approval.target_id == candidate_id,
            )
            .first()
        )
        if existing:
            return existing, False

        verified_requester_id = self._resolve_and_verify_requester(event_id, requester_id)

        approval = Approval(
            event_id=event_id,
            requester_id=verified_requester_id,
            approver_id=None,
            action_type="COMMUNICATION_OUTREACH",
            target_type=(category or "VENDOR").upper(),
            target_id=candidate_id,
            impact_level="MAJOR",
            requested_action={
                "candidate_id": candidate_id,
                "candidate_name": candidate_name,
                "category": category,
                "provider_id": provider_id,
            },
            status="PENDING",
            state_snapshot=compute_event_state_snapshot(self.db, event_id),
            created_at=utc_now(),
        )
        self.db.add(approval)
        self.db.flush()
        return approval, True

    def create_request(
        self,
        event_id: str,
        requester_id: str,
        data: ApprovalRequestCreate,
    ) -> Approval:
        """Evaluates policy and creates an immutable, snapshot-anchored ApprovalRequest."""
        event = self._get_event(event_id)
        requester_id = self._resolve_and_verify_requester(event_id, requester_id)

        # 1. Authorize action and determine impact level
        decision = self._auth_service.authorize_action(
            event_id=event_id,
            user_id=requester_id,
            action_type=data.action_type,
            target_type=data.target_type,
            target_id=data.target_id,
            payload=data.requested_action,
            recovery_option_id=data.recovery_option_id,
        )
        if not decision.allowed:
            raise ForbiddenException(decision.reason)

        # 2. Capture optimistic concurrency snapshot
        current_snapshot = compute_event_state_snapshot(self.db, event_id)

        # 3. Create immutable Approval request
        approval = Approval(
            event_id=event_id,
            requester_id=requester_id,
            action_type=data.action_type,
            target_type=data.target_type,
            target_id=data.target_id,
            impact_level=decision.impact_level,
            requested_action=data.requested_action,
            recovery_option_id=data.recovery_option_id,
            status="PENDING",
            state_snapshot=current_snapshot,
            decision_notes=data.notes,
            created_at=utc_now(),
        )
        self.db.add(approval)
        self.db.commit()
        self.db.refresh(approval)
        return approval

    def approve(
        self,
        event_id: str,
        approval_id: str,
        approver_id: str,
        decision_notes: Optional[str] = None,
    ) -> Tuple[Approval, ActionExecution]:
        """Approves a request, enforces separation of duties, revalidates state freshness, and executes mutation."""
        event = self._get_event(event_id)
        approval = (
            self.db.query(Approval)
            .filter(Approval.id == approval_id, Approval.event_id == event_id)
            .first()
        )
        if not approval:
            raise NotFoundException(f"Approval request '{approval_id}' not found for event '{event_id}'.")

        approver_id = self._ensure_user_exists(approver_id)

        if approval.status != "PENDING":
            raise BadRequestException(f"Approval request is '{approval.status}', only PENDING requests can be approved.")

        # 1. Separation of duties: Requester cannot approve their own request
        if approver_id and approver_id != "anonymous_operator" and approver_id == approval.requester_id:
            raise ForbiddenException("Separation of duties violation: The requester cannot approve their own approval request.")

        # 2. Approver role & permission verification
        approver_role = self._auth_service.get_user_role(event, approver_id)
        approver_perms = ROLE_PERMISSIONS_MAP.get(approver_role, set())
        if Permissions.APPROVAL_APPROVE not in approver_perms:
            raise ForbiddenException(f"Role '{approver_role}' lacks permission to approve operational requests.")

        if not ApprovalPolicy.is_eligible_approver(approver_role, approval.impact_level):
            raise ForbiddenException(
                f"Role '{approver_role}' is not authorized to approve {approval.impact_level} impact actions."
            )

        # 3. Optimistic Concurrency & Stale Check
        current_snapshot = compute_event_state_snapshot(self.db, event_id)
        if approval.state_snapshot != current_snapshot:
            approval.status = "STALE"
            self.db.commit()
            raise ConflictException(
                "STALE_ACTION: Event state has changed since approval request was created. Action execution aborted."
            )

        # 4. Revalidate target scope still exists
        self._auth_service.validate_target_scope(event_id, approval.target_type, approval.target_id)

        # 5. Execute action transactionally
        execution = self._action_service.execute_action(
            event_id=event_id,
            executor_id=approver_id,
            action_type=approval.action_type,
            target_type=approval.target_type,
            target_id=approval.target_id,
            payload=approval.requested_action,
            approval_request_id=approval.id,
            recovery_option_id=approval.recovery_option_id,
        )

        # 6. Mark approval approved
        approval.status = "APPROVED"
        approval.approver_id = approver_id
        approval.decided_at = utc_now()
        if decision_notes:
            approval.decision_notes = decision_notes

        self.db.commit()
        self.db.refresh(approval)
        return approval, execution

    def reject(
        self,
        event_id: str,
        approval_id: str,
        approver_id: str,
        reason: str,
    ) -> Approval:
        """Rejects an approval request without mutating operational state."""
        event = self._get_event(event_id)
        approval = (
            self.db.query(Approval)
            .filter(Approval.id == approval_id, Approval.event_id == event_id)
            .first()
        )
        if not approval:
            raise NotFoundException(f"Approval request '{approval_id}' not found for event '{event_id}'.")

        if approval.status != "PENDING":
            raise BadRequestException(f"Approval request is '{approval.status}', only PENDING requests can be rejected.")

        # Check approver role
        approver_role = self._auth_service.get_user_role(event, approver_id)
        approver_perms = ROLE_PERMISSIONS_MAP.get(approver_role, set())
        if Permissions.APPROVAL_APPROVE not in approver_perms:
            raise ForbiddenException(f"Role '{approver_role}' lacks permission to reject approval requests.")

        approval.status = "REJECTED"
        approval.approver_id = approver_id
        approval.rejection_reason = reason
        approval.decided_at = utc_now()

        if approval.action_type == "COMMUNICATION_OUTREACH" and approval.target_id:
            from app.models.shortlist import EventShortlistEntry
            entry = self.db.query(EventShortlistEntry).filter(
                EventShortlistEntry.event_id == event_id,
                (EventShortlistEntry.candidate_id == approval.target_id) | (EventShortlistEntry.id == approval.target_id),
            ).first()
            if entry:
                c_data = dict(entry.candidate_data or {})
                comm_data = dict(c_data.get("communication") or {})
                comm_data["approval_status"] = "REJECTED"
                comm_data["overall_status"] = "DISMISSED"
                comm_data["call_status"] = "NOT_ATTEMPTED"
                comm_data["whatsapp_status"] = "NOT_ATTEMPTED"
                comm_data["updated_at"] = utc_now().isoformat()
                c_data["communication"] = comm_data
                entry.candidate_data = c_data
                self.db.add(entry)
                from app.services.live_broker import live_broker
                live_broker.publish_sync(event_id, {
                    "type": "shortlist.updated",
                    "event_id": event_id,
                    "action": "communication_dismissed",
                    "candidate_id": entry.candidate_id,
                    "candidate_name": entry.candidate_name,
                    "category": entry.category,
                    "status": entry.status,
                    "communication": comm_data,
                })

        self.db.commit()
        self.db.refresh(approval)
        return approval


    def cancel(
        self,
        event_id: str,
        approval_id: str,
        requester_id: str,
        reason: Optional[str] = None,
    ) -> Approval:
        """Allows the requester or organizer to cancel a pending approval request."""
        event = self._get_event(event_id)
        approval = (
            self.db.query(Approval)
            .filter(Approval.id == approval_id, Approval.event_id == event_id)
            .first()
        )
        if not approval:
            raise NotFoundException(f"Approval request '{approval_id}' not found for event '{event_id}'.")

        if approval.status != "PENDING":
            raise BadRequestException(f"Approval request is '{approval.status}', only PENDING requests can be cancelled.")

        user_role = self._auth_service.get_user_role(event, requester_id)
        if requester_id != approval.requester_id and user_role != RoleType.MAIN_ORGANIZER.value:
            raise ForbiddenException("Only the requester or Main Organizer can cancel an approval request.")

        approval.status = "CANCELLED"
        if reason:
            approval.rejection_reason = f"Cancelled: {reason}"
        approval.decided_at = utc_now()

        self.db.commit()
        self.db.refresh(approval)
        return approval

    def list_requests(
        self,
        event_id: str,
        status: Optional[str] = None,
        requester_id: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
        current_user_id: str = "anonymous_operator",
    ) -> Tuple[List[Approval], int]:
        """Lists approval requests for an event with deterministic pagination."""
        event = self._get_event(event_id)
        self._auth_service.get_user_role(event, current_user_id)

        query = self.db.query(Approval).filter(Approval.event_id == event_id)
        if status:
            query = query.filter(Approval.status == status.strip().upper())
        if requester_id:
            query = query.filter(Approval.requester_id == requester_id)

        total = query.count()
        items = (
            query.order_by(Approval.created_at.desc(), Approval.id.asc())
            .offset(offset)
            .limit(limit)
            .all()
        )
        return items, total

    def get_request(
        self,
        event_id: str,
        approval_id: str,
        current_user_id: str = "anonymous_operator",
    ) -> Approval:
        """Retrieves a single approval request."""
        event = self._get_event(event_id)
        self._auth_service.get_user_role(event, current_user_id)

        approval = (
            self.db.query(Approval)
            .filter(Approval.id == approval_id, Approval.event_id == event_id)
            .first()
        )
        if not approval:
            raise NotFoundException(f"Approval request '{approval_id}' not found for event '{event_id}'.")
        return approval

    def get_pending_approvals(self, event_id: str) -> List[Approval]:
        """Retrieves pending approval requests for an event."""
        return (
            self.db.query(Approval)
            .filter(Approval.event_id == event_id, Approval.status == "PENDING")
            .order_by(Approval.created_at.desc(), Approval.id.asc())
            .all()
        )


