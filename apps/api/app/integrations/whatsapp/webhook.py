"""Inbound WhatsApp Webhook Processor for Remote Organizer Approvals."""
import logging
from typing import Any, Dict, List, Optional
from sqlalchemy.orm import Session

from app.core.exceptions import (
    ConflictException,
    BadRequestException,
    ForbiddenException,
    NotFoundException,
)
from app.core.idempotency import IdempotencyService, compute_payload_hash
from app.models.approval import Approval
from app.models.event import Event
from app.models.event_member import EventMember
from app.engines.auth.policy import ApprovalPolicy
from app.services.approval_service import ApprovalService
from app.services.organizer_phone_service import resolve_user_by_phone
from app.integrations.registry import registry
from app.integrations.whatsapp.parser import parse_inbound_reply
from app.integrations.whatsapp.templates import (
    format_approval_confirmed,
    format_rejection_confirmed,
    format_stale_warning,
    format_expired_notice,
    format_unauthorized_notice,
    format_multiple_pending_notice,
    format_verification_result,
)
from app.agent.triggers import trigger_agent_run

logger = logging.getLogger(__name__)


def find_eligible_pending_approvals(db: Session, user_id: str) -> List[Approval]:
    """Finds all pending approvals for events where the user is an eligible approver."""
    # 1. Events where user is owner
    owned_events = db.query(Event.id).filter(Event.owner_id == user_id).all()
    owned_event_ids = {e[0] for e in owned_events}

    # 2. Events where user is a member
    memberships = db.query(EventMember).filter(EventMember.user_id == user_id).all()
    member_roles = {m.event_id: m.role for m in memberships}

    all_event_ids = list(owned_event_ids.union(member_roles.keys()))
    if not all_event_ids:
        return []

    pending = (
        db.query(Approval)
        .filter(
            Approval.event_id.in_(all_event_ids),
            Approval.status == "PENDING",
            Approval.requester_id != user_id,  # Separation of duties: requester cannot approve
        )
        .all()
    )

    eligible = []
    for app in pending:
        # Determine role
        role = "MAIN_ORGANIZER" if app.event_id in owned_event_ids else member_roles.get(app.event_id, "COLLABORATOR")
        if ApprovalPolicy.is_eligible_approver(role, app.impact_level):
            eligible.append(app)

    return eligible


def process_organizer_approval_reply(
    db: Session,
    sender: str,
    text: str,
    message_id: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    """Inspects inbound WhatsApp message.
    
    If sender is an organizer AND the message parses into an approval decision,
    executes the approve/reject lifecycle with the organizer's verified user_id.
    
    Returns:
        Dict result if processed as an organizer approval, or None if not an organizer or non-decision message.
    """
    # 1. Resolve sender to Organizer User
    user = resolve_user_by_phone(db, sender)
    if not user:
        return None

    # 2. Parse text for decision & optional code
    decision, code = parse_inbound_reply(text)
    if not decision:
        return None

    # 3. Idempotency protection
    idempotency = IdempotencyService(db)
    idem_key = f"openwa:approval:{message_id or compute_payload_hash({'sender': sender, 'text': text.strip()})}"
    already_done, resp_code, resp_body = idempotency.check_or_start(
        idempotency_key=idem_key,
        endpoint="/webhooks/openwa/approval",
        method="POST",
        payload={"sender": sender, "text": text, "user_id": user.id},
    )
    if already_done:
        logger.info("Ignoring duplicate WhatsApp webhook approval message: %s", idem_key)
        return resp_body if isinstance(resp_body, dict) else {"status": "ALREADY_PROCESSED"}

    comm = registry.get_communication_provider()

    # 4. Resolve target approval
    eligible_pending = find_eligible_pending_approvals(db, user.id)

    target_approval: Optional[Approval] = None
    if code:
        for app in eligible_pending:
            if app.reply_code and app.reply_code.upper() == code.upper():
                target_approval = app
                break
        if not target_approval:
            # Check if code matched an expired or already decided approval for clearer error
            other_match = db.query(Approval).filter(Approval.reply_code == code.upper()).first()
            if other_match and other_match.status != "PENDING":
                reply_msg = f"Approval {code} is already {other_match.status}."
            else:
                reply_msg = f"No pending approval matching code '{code}' was found."
            comm.send_message(
                event_id=eligible_pending[0].event_id if eligible_pending else "SYSTEM",
                provider_id=user.id,
                message=reply_msg,
                recipient_contact=sender,
            )
            result = {"status": "CODE_NOT_FOUND", "code": code}
            idempotency.complete(idem_key, 200, result)
            return result
    else:
        if len(eligible_pending) == 1:
            target_approval = eligible_pending[0]
        elif len(eligible_pending) > 1:
            codes = [a.reply_code for a in eligible_pending if a.reply_code]
            comm.send_message(
                event_id=eligible_pending[0].event_id,
                provider_id=user.id,
                message=format_multiple_pending_notice(codes),
                recipient_contact=sender,
            )
            result = {"status": "MULTIPLE_PENDING", "codes": codes}
            idempotency.complete(idem_key, 200, result)
            return result
        else:
            comm.send_message(
                event_id="SYSTEM",
                provider_id=user.id,
                message="You currently have no pending approval requests.",
                recipient_contact=sender,
            )
            result = {"status": "NO_PENDING_APPROVALS"}
            idempotency.complete(idem_key, 200, result)
            return result

    approval_service = ApprovalService(db)
    event_id = target_approval.event_id
    approval_id = target_approval.id

    # 5. Execute Decision via ApprovalService
    if decision == "APPROVE":
        try:
            approval, action_exec = approval_service.approve(
                event_id=event_id,
                approval_id=approval_id,
                approver_id=user.id,
                decision_notes=f"Approved remotely via WhatsApp reply ('{text.strip()}').",
            )

            # Send immediate acknowledgement
            comm.send_message(
                event_id=event_id,
                provider_id=user.id,
                message=format_approval_confirmed(approval.action_type),
                recipient_contact=sender,
            )

            # Run execution verification if applicable
            ver_status = "VERIFIED"
            ver_summary = None
            if approval.recovery_option_id:
                try:
                    from app.services.verification_service import VerificationService
                    ver_svc = VerificationService(db)
                    ver_result = ver_svc.verify_action(
                        event_id=event_id,
                        action_execution_id=action_exec.id,
                        current_user_id=user.id,
                    )
                    ver_status = getattr(ver_result, "status", "VERIFIED")
                    ver_summary = f"Recovery executed with status {ver_status}"
                except Exception as ver_err:
                    logger.warning("Recovery verification error: %s", ver_err)
                    ver_status = "VERIFICATION_FAILED"
                    ver_summary = str(ver_err)

            # Trigger agent execution to resume and replan/verify
            try:
                trigger_agent_run(
                    event_id=event_id,
                    message=f"Approval granted via WhatsApp for request {approval_id}. Resume action execution and verification.",
                    user_id=user.id,
                    approval_id=approval_id,
                )
            except Exception as agent_err:
                logger.warning("Failed to trigger agent run: %s", agent_err)

            # Send final verification message
            comm.send_message(
                event_id=event_id,
                provider_id=user.id,
                message=format_verification_result(ver_status, ver_summary),
                recipient_contact=sender,
            )

            res = {
                "status": "APPROVED",
                "approval_id": approval.id,
                "verification_status": ver_status,
                "approver_id": user.id,
            }
            idempotency.complete(idem_key, 200, res)
            return res

        except ConflictException:
            comm.send_message(
                event_id=event_id,
                provider_id=user.id,
                message=format_stale_warning(),
                recipient_contact=sender,
            )
            res = {"status": "STALE", "approval_id": approval_id}
            idempotency.complete(idem_key, 409, res)
            return res

        except BadRequestException as exc:
            msg = format_expired_notice() if "expire" in str(exc).lower() else f"Error: {exc}"
            comm.send_message(
                event_id=event_id,
                provider_id=user.id,
                message=msg,
                recipient_contact=sender,
            )
            res = {"status": "BAD_REQUEST", "error": str(exc)}
            idempotency.complete(idem_key, 400, res)
            return res

        except ForbiddenException as exc:
            comm.send_message(
                event_id=event_id,
                provider_id=user.id,
                message=format_unauthorized_notice(),
                recipient_contact=sender,
            )
            res = {"status": "FORBIDDEN", "error": str(exc)}
            idempotency.complete(idem_key, 403, res)
            return res

    elif decision == "REJECT":
        try:
            approval = approval_service.reject(
                event_id=event_id,
                approval_id=approval_id,
                approver_id=user.id,
                reason=f"Rejected remotely by organizer via WhatsApp ('{text.strip()}').",
            )
            comm.send_message(
                event_id=event_id,
                provider_id=user.id,
                message=format_rejection_confirmed(approval.action_type),
                recipient_contact=sender,
            )
            res = {"status": "REJECTED", "approval_id": approval.id, "approver_id": user.id}
            idempotency.complete(idem_key, 200, res)
            return res

        except BadRequestException as exc:
            msg = format_expired_notice() if "expire" in str(exc).lower() else f"Error: {exc}"
            comm.send_message(
                event_id=event_id,
                provider_id=user.id,
                message=msg,
                recipient_contact=sender,
            )
            res = {"status": "BAD_REQUEST", "error": str(exc)}
            idempotency.complete(idem_key, 400, res)
            return res

        except ForbiddenException as exc:
            comm.send_message(
                event_id=event_id,
                provider_id=user.id,
                message=format_unauthorized_notice(),
                recipient_contact=sender,
            )
            res = {"status": "FORBIDDEN", "error": str(exc)}
            idempotency.complete(idem_key, 403, res)
            return res

    return None
