"""Domain Service: ApprovalNotificationDispatcher

Orchestrates multi-channel notification fan-out (WHATSAPP, WEB_PUSH, IN_APP) when an Approval is created.
Guarantees channel fault isolation: a failure in any channel NEVER aborts other channels or approval creation.
Emits per-channel delivery records in the Notification table and records audit trail events.
"""
import logging
import secrets
from typing import Any, Dict, List, Optional
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from app.models.approval import Approval
from app.models.event import Event
from app.models.event_member import EventMember
from app.models.user import User
from app.models.notification import Notification
from app.models.push_subscription import PushSubscription
from app.engines.auth.policy import ApprovalPolicy
from app.core.tokens import build_approval_deep_link
from app.integrations.registry import registry
from app.integrations.notifications.push import PushAdapter
from app.integrations.whatsapp.templates import (
    format_whatsapp_approval_request,
    build_proposed_summary_from_action,
)
from app.observability.audit import AuditRecorder
from app.services.live_broker import live_broker

logger = logging.getLogger(__name__)


UNAMBIGUOUS_REPLY_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"


def generate_unique_reply_code(db: Session, length: int = 6, max_retries: int = 25) -> str:
    """Generates an unambiguous 6-character uppercase reply code.
    
    Checks against ALL existing approvals in the database (not just PENDING ones)
    to enforce global uniqueness. Retries upon any collision.
    Excludes ambiguous characters (0, O, 1, I).
    """
    for _ in range(max_retries):
        code = "".join(secrets.choice(UNAMBIGUOUS_REPLY_CHARS) for _ in range(length))
        exists = db.query(Approval.id).filter(Approval.reply_code == code).first()
        if not exists:
            return code

    # Fallback with higher entropy if maximum retries collided
    for _ in range(max_retries):
        code = "".join(secrets.choice(UNAMBIGUOUS_REPLY_CHARS) for _ in range(length + 2))
        exists = db.query(Approval.id).filter(Approval.reply_code == code).first()
        if not exists:
            return code

    raise RuntimeError("Failed to generate a unique approval reply code after multiple attempts.")


class ApprovalNotificationDispatcher:
    """Dispatches remote notifications across independent channels to eligible approvers."""

    def __init__(self, db: Session):
        self.db = db
        self._audit = AuditRecorder(db)
        self._push_adapter = PushAdapter()

    def resolve_eligible_approvers(self, approval: Approval) -> List[User]:
        """Resolves all event members whose role is eligible under ApprovalPolicy, excluding requester."""
        event = self.db.query(Event).filter(Event.id == approval.event_id).first()
        if not event:
            return []

        eligible_user_ids = set()

        # 1. Check Event Owner (always has MAIN_ORGANIZER role)
        if event.owner_id and event.owner_id != approval.requester_id:
            if ApprovalPolicy.is_eligible_approver("MAIN_ORGANIZER", approval.impact_level):
                eligible_user_ids.add(event.owner_id)

        # 2. Check Event Members
        members = (
            self.db.query(EventMember)
            .filter(EventMember.event_id == approval.event_id)
            .all()
        )
        for member in members:
            if member.user_id == approval.requester_id:
                continue
            if ApprovalPolicy.is_eligible_approver(member.role, approval.impact_level):
                eligible_user_ids.add(member.user_id)

        if not eligible_user_ids:
            # Fallback if no specific member matched: if owner is requester, try other event members
            for m in members:
                if m.user_id != approval.requester_id:
                    eligible_user_ids.add(m.user_id)

        if not eligible_user_ids:
            return []

        return self.db.query(User).filter(User.id.in_(list(eligible_user_ids))).all()

    def dispatch(self, approval: Approval) -> Dict[str, Any]:
        """Orchestrates fan-out across IN_APP, WHATSAPP, and WEB_PUSH.
        
        Guaranteed to not raise exceptions outward so approval creation is never blocked.
        """
        results = {
            "in_app": 0,
            "whatsapp": 0,
            "web_push": 0,
            "errors": [],
        }

        try:
            event = self.db.query(Event).filter(Event.id == approval.event_id).first()
            event_name = event.name if event else "EVENTRA"

            # Ensure reply_code exists on approval
            if not approval.reply_code:
                approval.reply_code = generate_unique_reply_code(self.db)
                self.db.add(approval)
                self.db.commit()
                self.db.refresh(approval)

            # Check low-risk policy
            should_notify_external = ApprovalPolicy.should_notify(
                impact_level=approval.impact_level,
                action_type=approval.action_type,
                payload=approval.requested_action,
            )

            # Resolve approvers
            approvers = self.resolve_eligible_approvers(approval)
            if not approvers:
                logger.info(
                    "No eligible approvers found for approval '%s' (impact=%s, requester=%s).",
                    approval.id,
                    approval.impact_level,
                    approval.requester_id,
                )
                return results

            # Record initial notified approvers in requested_action
            req_action = dict(approval.requested_action or {})
            existing_notified = list(req_action.get("notified_to", []))
            for u in approvers:
                if u.id not in existing_notified:
                    existing_notified.append(u.id)
            req_action["notified_to"] = existing_notified
            approval.requested_action = req_action
            flag_modified(approval, "requested_action")
            self.db.add(approval)
            self.db.commit()

            # Deep link URL
            deep_link = build_approval_deep_link(
                event_id=approval.event_id,
                approval_id=approval.id,
                expires_at=approval.expires_at,
            )

            proposed_summary = build_proposed_summary_from_action(approval.requested_action)
            title = f"Approval Required: {approval.action_type.replace('_', ' ').title()}"

            for approver in approvers:
                # -------------------------------------------------------------
                # Channel 1: IN_APP (Always dispatched)
                # -------------------------------------------------------------
                try:
                    in_app_notif = Notification(
                        event_id=approval.event_id,
                        notification_type="APPROVAL_REQUESTED",
                        channel="IN_APP",
                        recipient=approver.id,
                        title=title,
                        message=f"Ticket {approval.id} ({approval.impact_level}) requires sign-off. Code: {approval.reply_code}",
                        payload={
                            "approval_id": approval.id,
                            "impact_level": approval.impact_level,
                            "reply_code": approval.reply_code,
                            "deep_link": deep_link,
                            "requested_action": approval.requested_action,
                        },
                        status="DELIVERED",
                    )
                    self.db.add(in_app_notif)
                    self.db.commit()
                    results["in_app"] += 1

                    # Publish to SSE/Live Broker
                    try:
                        live_broker.publish_sync(
                            approval.event_id,
                            {
                                "type": "notification.created",
                                "event_id": approval.event_id,
                                "notification_id": in_app_notif.id,
                                "title": title,
                                "approval_id": approval.id,
                                "reply_code": approval.reply_code,
                            },
                        )
                    except Exception as sse_err:
                        logger.debug("Live broker publish failed: %s", sse_err)
                except Exception as in_app_err:
                    self.db.rollback()
                    logger.error("Failed to dispatch IN_APP notification: %s", in_app_err)
                    results["errors"].append(f"IN_APP: {in_app_err}")
                    self._record_audit_failure(approval, approver.id, "IN_APP", str(in_app_err))

                if not should_notify_external:
                    continue

                # -------------------------------------------------------------
                # Channel 2: WHATSAPP
                # -------------------------------------------------------------
                phone = getattr(approver, "phone_e164", None)
                if phone:
                    try:
                        whatsapp_body = format_whatsapp_approval_request(
                            event_name=event_name,
                            title=title,
                            proposed_summary=proposed_summary,
                            reply_code=approval.reply_code,
                            deep_link=deep_link,
                        )
                        comm_provider = registry.get_communication_provider()
                        send_res = comm_provider.send_message(
                            event_id=approval.event_id,
                            provider_id=approver.id,
                            message=whatsapp_body,
                            recipient_contact=phone,
                        )
                        wa_status = "SENT" if send_res.success else "FAILED"
                        wa_notif = Notification(
                            event_id=approval.event_id,
                            notification_type="APPROVAL_REQUESTED",
                            channel="WHATSAPP",
                            recipient=phone,
                            title=title,
                            message=whatsapp_body,
                            payload={
                                "approval_id": approval.id,
                                "reply_code": approval.reply_code,
                                "integration_source": str(send_res.source),
                                "error": send_res.error,
                            },
                            status=wa_status,
                        )
                        self.db.add(wa_notif)
                        self.db.commit()
                        if send_res.success:
                            results["whatsapp"] += 1
                        else:
                            self._record_audit_failure(approval, phone, "WHATSAPP", send_res.error or "Dispatch failed")
                    except Exception as wa_err:
                        self.db.rollback()
                        logger.error("Failed to dispatch WHATSAPP notification: %s", wa_err)
                        results["errors"].append(f"WHATSAPP: {wa_err}")
                        self._record_audit_failure(approval, phone, "WHATSAPP", str(wa_err))

                # -------------------------------------------------------------
                # Channel 3: WEB_PUSH (PWA)
                # -------------------------------------------------------------
                try:
                    subscriptions = (
                        self.db.query(PushSubscription)
                        .filter(PushSubscription.user_id == approver.id)
                        .all()
                    )
                    for sub in subscriptions:
                        sub_info = {
                            "endpoint": sub.endpoint,
                            "keys": {
                                "p256dh": sub.p256dh,
                                "auth": sub.auth,
                            },
                        }
                        push_payload = {
                            "title": title,
                            "body": f"[{event_name}] {proposed_summary or 'Action requires approval'}. Code: {approval.reply_code}",
                            "url": f"/events/{approval.event_id}/approvals/{approval.id}?token={deep_link.split('token=')[-1]}",
                            "data": {
                                "approval_id": approval.id,
                                "event_id": approval.event_id,
                                "reply_code": approval.reply_code,
                            },
                        }
                        push_res = self._push_adapter.send_push(sub_info, push_payload)
                        # If subscription is dead (404/410), delete it
                        if push_res.data and push_res.data.get("is_unsubscribed"):
                            logger.info("Pruning expired push subscription %s", sub.id)
                            self.db.delete(sub)
                            self.db.commit()

                        push_status = "SENT" if push_res.success else "FAILED"
                        push_notif = Notification(
                            event_id=approval.event_id,
                            notification_type="APPROVAL_REQUESTED",
                            channel="WEB_PUSH",
                            recipient=sub.endpoint[:250],
                            title=title,
                            message=push_payload["body"],
                            payload={
                                "approval_id": approval.id,
                                "reply_code": approval.reply_code,
                                "subscription_id": sub.id,
                                "error": push_res.error,
                            },
                            status=push_status,
                        )
                        self.db.add(push_notif)
                        self.db.commit()
                        if push_res.success:
                            results["web_push"] += 1
                        else:
                            self._record_audit_failure(approval, sub.endpoint[:80], "WEB_PUSH", push_res.error or "Push error")
                except Exception as push_err:
                    self.db.rollback()
                    logger.error("Failed to dispatch WEB_PUSH notification: %s", push_err)
                    results["errors"].append(f"WEB_PUSH: {push_err}")
                    self._record_audit_failure(approval, approver.id, "WEB_PUSH", str(push_err))

        except Exception as global_err:
            logger.error("Unexpected error in ApprovalNotificationDispatcher.dispatch: %s", global_err)
            results["errors"].append(str(global_err))

        return results

    def dispatch_escalation(self, approval: Approval, approvers: List[User]) -> Dict[str, Any]:
        """Dispatches escalation notifications across IN_APP, WHATSAPP, and WEB_PUSH to escalated approvers."""
        results = {
            "in_app": 0,
            "whatsapp": 0,
            "web_push": 0,
            "errors": [],
        }
        if not approvers:
            return results

        try:
            event = self.db.query(Event).filter(Event.id == approval.event_id).first()
            event_name = event.name if event else "EVENTRA"

            # Ensure reply_code exists
            if not approval.reply_code:
                approval.reply_code = generate_unique_reply_code(self.db)
                self.db.add(approval)
                self.db.commit()
                self.db.refresh(approval)

            deep_link = build_approval_deep_link(
                event_id=approval.event_id,
                approval_id=approval.id,
                expires_at=approval.expires_at,
            )

            proposed_summary = build_proposed_summary_from_action(approval.requested_action)
            base_action = approval.action_type.replace('_', ' ').title()
            title = f"[ESCALATION] Approval Required: {base_action}"
            escalation_msg = (
                f"[ESCALATION: {event_name}] Urgent: Approval ticket {approval.reply_code or approval.id[:8]} "
                f"pending for >{settings.APPROVAL_ESCALATION_MINUTES} mins. Reply YES {approval.reply_code} to approve."
            )

            for approver in approvers:
                # 1. IN_APP
                try:
                    in_app_notif = Notification(
                        event_id=approval.event_id,
                        notification_type="APPROVAL_ESCALATED",
                        channel="IN_APP",
                        recipient=approver.id,
                        title=title,
                        message=escalation_msg,
                        payload={
                            "approval_id": approval.id,
                            "impact_level": approval.impact_level,
                            "reply_code": approval.reply_code,
                            "deep_link": deep_link,
                            "is_escalation": True,
                        },
                        status="DELIVERED",
                    )
                    self.db.add(in_app_notif)
                    self.db.commit()
                    results["in_app"] += 1

                    try:
                        live_broker.publish_sync(
                            approval.event_id,
                            {
                                "type": "notification.created",
                                "event_id": approval.event_id,
                                "notification_id": in_app_notif.id,
                                "title": title,
                                "approval_id": approval.id,
                                "reply_code": approval.reply_code,
                                "is_escalation": True,
                            },
                        )
                    except Exception:
                        pass
                except Exception as in_app_err:
                    self.db.rollback()
                    logger.error("Failed to dispatch escalation IN_APP: %s", in_app_err)
                    results["errors"].append(f"IN_APP: {in_app_err}")
                    self._record_audit_failure(approval, approver.id, "IN_APP", str(in_app_err))

                # 2. WHATSAPP
                phone = getattr(approver, "phone_e164", None)
                if phone:
                    try:
                        comm_provider = registry.get_communication_provider()
                        send_res = comm_provider.send_message(
                            event_id=approval.event_id,
                            provider_id=approver.id,
                            message=escalation_msg,
                            recipient_contact=phone,
                        )
                        wa_status = "SENT" if send_res.success else "FAILED"
                        wa_notif = Notification(
                            event_id=approval.event_id,
                            notification_type="APPROVAL_ESCALATED",
                            channel="WHATSAPP",
                            recipient=phone,
                            title=title,
                            message=escalation_msg,
                            payload={
                                "approval_id": approval.id,
                                "reply_code": approval.reply_code,
                                "integration_source": str(send_res.source),
                                "is_escalation": True,
                            },
                            status=wa_status,
                        )
                        self.db.add(wa_notif)
                        self.db.commit()
                        if send_res.success:
                            results["whatsapp"] += 1
                        else:
                            self._record_audit_failure(approval, phone, "WHATSAPP", send_res.error or "Dispatch failed")
                    except Exception as wa_err:
                        self.db.rollback()
                        logger.error("Failed to dispatch escalation WHATSAPP: %s", wa_err)
                        results["errors"].append(f"WHATSAPP: {wa_err}")
                        self._record_audit_failure(approval, phone, "WHATSAPP", str(wa_err))

                # 3. WEB_PUSH
                try:
                    subscriptions = (
                        self.db.query(PushSubscription)
                        .filter(PushSubscription.user_id == approver.id)
                        .all()
                    )
                    for sub in subscriptions:
                        sub_info = {
                            "endpoint": sub.endpoint,
                            "keys": {
                                "p256dh": sub.p256dh,
                                "auth": sub.auth,
                            },
                        }
                        push_payload = {
                            "title": title,
                            "body": escalation_msg,
                            "url": f"/events/{approval.event_id}/approvals/{approval.id}?token={deep_link.split('token=')[-1]}",
                            "data": {
                                "approval_id": approval.id,
                                "event_id": approval.event_id,
                                "reply_code": approval.reply_code,
                                "is_escalation": True,
                            },
                        }
                        push_res = self._push_adapter.send_push(sub_info, push_payload)
                        if push_res.data and push_res.data.get("is_unsubscribed"):
                            self.db.delete(sub)
                            self.db.commit()

                        push_status = "SENT" if push_res.success else "FAILED"
                        push_notif = Notification(
                            event_id=approval.event_id,
                            notification_type="APPROVAL_ESCALATED",
                            channel="WEB_PUSH",
                            recipient=sub.endpoint[:250],
                            title=title,
                            message=push_payload["body"],
                            payload={
                                "approval_id": approval.id,
                                "reply_code": approval.reply_code,
                                "is_escalation": True,
                            },
                            status=push_status,
                        )
                        self.db.add(push_notif)
                        self.db.commit()
                        if push_res.success:
                            results["web_push"] += 1
                        else:
                            self._record_audit_failure(approval, sub.endpoint[:80], "WEB_PUSH", push_res.error or "Push error")
                except Exception as push_err:
                    self.db.rollback()
                    logger.error("Failed to dispatch escalation WEB_PUSH: %s", push_err)
                    results["errors"].append(f"WEB_PUSH: {push_err}")
                    self._record_audit_failure(approval, approver.id, "WEB_PUSH", str(push_err))

        except Exception as global_err:
            logger.error("Unexpected error in dispatch_escalation: %s", global_err)
            results["errors"].append(str(global_err))

        return results

    def _record_audit_failure(self, approval: Approval, recipient: str, channel: str, error_detail: str):
        """Records an audit log entry for a failed channel delivery."""
        try:
            self._audit.record(
                event_id=approval.event_id,
                actor_id="system",
                actor_type="SYSTEM",
                action="NOTIFICATION_DELIVERY_FAILED",
                action_type="COMMUNICATION",
                target_type="APPROVAL",
                target_id=approval.id,
                after_state={
                    "channel": channel,
                    "recipient": recipient,
                    "error": error_detail,
                    "impact_level": approval.impact_level,
                },
            )
        except Exception:
            pass
