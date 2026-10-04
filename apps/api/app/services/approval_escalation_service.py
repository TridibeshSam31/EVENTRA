"""Domain Service: ApprovalEscalationService

Periodically monitors pending approvals:
1. Enforces TTL expiry: marks EXPIRED, notifies organizers, triggers agent replanning via triggers.py.
2. Sends reminder alerts at configured fraction of TTL.
3. Escalates to next eligible approver after N minutes.
4. Optionally places voice calls via Twilio/Exotel for CRITICAL impact approvals.
"""
import asyncio
import logging
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.session import SessionLocal
from app.models.approval import Approval
from app.models.event import Event
from app.models.notification import Notification
from app.services.approval_service import ApprovalService
from app.services.approval_notification_dispatcher import ApprovalNotificationDispatcher
from app.agent.triggers import trigger_agent_run
from app.integrations.registry import registry
from app.observability.audit import AuditRecorder

logger = logging.getLogger(__name__)


def utc_now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class ApprovalEscalationService:
    """Evaluates and acts on pending approvals requiring reminder, escalation, or expiry."""

    def __init__(self, db: Session):
        self.db = db
        self._audit = AuditRecorder(db)
        self._dispatcher = ApprovalNotificationDispatcher(db)

    def sweep_pending_approvals(self) -> Dict[str, int]:
        """Runs a single pass across all PENDING approvals."""
        counts = {
            "expired": 0,
            "reminded": 0,
            "escalated": 0,
            "voice_called": 0,
        }
        now = utc_now()

        pending_approvals = (
            self.db.query(Approval)
            .filter(Approval.status == "PENDING")
            .all()
        )

        for approval in pending_approvals:
            try:
                # -------------------------------------------------------------
                # 1. EXPIRY CHECK
                # -------------------------------------------------------------
                if approval.expires_at and now >= approval.expires_at:
                    self._handle_expiry(approval)
                    counts["expired"] += 1
                    continue  # Once expired, no further reminders or escalation

                req_action = dict(approval.requested_action or {})

                # -------------------------------------------------------------
                # 2. REMINDER CHECK (at configured fraction of TTL)
                # -------------------------------------------------------------
                if approval.expires_at and approval.created_at and not req_action.get("reminder_sent"):
                    ttl_seconds = (approval.expires_at - approval.created_at).total_seconds()
                    reminder_time = approval.created_at + timedelta(
                        seconds=ttl_seconds * max(0.1, min(0.9, settings.APPROVAL_REMINDER_FRACTION))
                    )
                    if now >= reminder_time:
                        self._handle_reminder(approval, req_action)
                        counts["reminded"] += 1

                # -------------------------------------------------------------
                # 3. ESCALATION CHECK (after N minutes)
                # -------------------------------------------------------------
                minutes_pending = (now - approval.created_at).total_seconds() / 60.0
                if minutes_pending >= settings.APPROVAL_ESCALATION_MINUTES and not req_action.get("escalated"):
                    self._handle_escalation(approval, req_action)
                    counts["escalated"] += 1

                # -------------------------------------------------------------
                # 4. VOICE CALL ESCALATION (CRITICAL impact only)
                # -------------------------------------------------------------
                if (
                    approval.impact_level == "CRITICAL"
                    and settings.APPROVAL_VOICE_ESCALATION_ENABLED
                    and not req_action.get("voice_called")
                ):
                    self._handle_voice_escalation(approval, req_action)
                    counts["voice_called"] += 1

            except Exception as err:
                logger.error("Error evaluating approval %s during escalation sweep: %s", approval.id, err)

        return counts

    def _handle_expiry(self, approval: Approval):
        """Marks approval as EXPIRED, notifies organizer, and triggers agent replan."""
        logger.info("Approval %s (code=%s) has expired. Marking EXPIRED.", approval.id, approval.reply_code)
        service = ApprovalService(self.db)
        service.expire(approval.event_id, approval.id, reason="Approval TTL expired without organizer decision.")

        # Notify organizer in-app & WhatsApp
        event = self.db.query(Event).filter(Event.id == approval.event_id).first()
        event_name = event.name if event else "Event"
        msg = f"[{event_name}] Approval request {approval.reply_code or approval.id[:8]} EXPIRED. The agent is replanning operations."

        notif = Notification(
            event_id=approval.event_id,
            notification_type="APPROVAL_EXPIRED",
            channel="IN_APP",
            recipient="organizer",
            title=f"Approval Expired: {approval.action_type}",
            message=msg,
            payload={"approval_id": approval.id, "reply_code": approval.reply_code},
            status="DELIVERED",
        )
        self.db.add(notif)
        self.db.commit()

        # Trigger agent replan
        try:
            trigger_agent_run(
                event_id=approval.event_id,
                message=f"Approval request {approval.id} has EXPIRED. Replan event operations to handle blocked dependency.",
                user_id="system",
                approval_id=approval.id,
            )
        except Exception as trigger_err:
            logger.warning("Failed to trigger agent replan on expiry for %s: %s", approval.id, trigger_err)

    def _handle_reminder(self, approval: Approval, req_action: Dict[str, Any]):
        """Dispatches a reminder notification to approvers."""
        logger.info("Sending reminder for pending approval %s (code=%s).", approval.id, approval.reply_code)
        approvers = self._dispatcher.resolve_eligible_approvers(approval)
        event = self.db.query(Event).filter(Event.id == approval.event_id).first()
        event_name = event.name if event else "Event"

        time_left = ""
        if approval.expires_at:
            mins_left = max(1, int((approval.expires_at - utc_now()).total_seconds() / 60))
            time_left = f" (Expires in {mins_left}m)"

        reminder_msg = f"[REMINDER: {event_name}] Approval required for {approval.action_type}{time_left}. Reply YES {approval.reply_code} to approve or NO {approval.reply_code} to reject."

        comm = registry.get_communication_provider()
        for approver in approvers:
            if getattr(approver, "phone_e164", None):
                comm.send_message(
                    event_id=approval.event_id,
                    provider_id=approver.id,
                    message=reminder_msg,
                    recipient_contact=approver.phone_e164,
                )

        req_action["reminder_sent"] = True
        req_action["reminder_sent_at"] = utc_now().isoformat()
        approval.requested_action = req_action
        self.db.commit()

    def _handle_escalation(self, approval: Approval, req_action: Dict[str, Any]):
        """Escalates pending approval to Main Organizer."""
        logger.info("Escalating pending approval %s to Main Organizer.", approval.id)
        event = self.db.query(Event).filter(Event.id == approval.event_id).first()
        if not event:
            return

        escalation_msg = f"[ESCALATION: {event.name}] Urgent: Approval ticket {approval.reply_code or approval.id[:8]} pending for >{settings.APPROVAL_ESCALATION_MINUTES} mins. Reply YES {approval.reply_code} to approve."

        approvers = self._dispatcher.resolve_eligible_approvers(approval)
        comm = registry.get_communication_provider()
        for approver in approvers:
            if getattr(approver, "phone_e164", None):
                comm.send_message(
                    event_id=approval.event_id,
                    provider_id=approver.id,
                    message=escalation_msg,
                    recipient_contact=approver.phone_e164,
                )

        req_action["escalated"] = True
        req_action["escalated_at"] = utc_now().isoformat()
        approval.requested_action = req_action
        self.db.commit()

    def _handle_voice_escalation(self, approval: Approval, req_action: Dict[str, Any]):
        """Places voice call via Twilio/Exotel for CRITICAL approvals."""
        logger.info("Placing voice escalation call for CRITICAL approval %s.", approval.id)
        event = self.db.query(Event).filter(Event.id == approval.event_id).first()
        approvers = self._dispatcher.resolve_eligible_approvers(approval)

        comm = registry.get_communication_provider()
        # If provider has voice call support or in mock mode
        for approver in approvers:
            phone = getattr(approver, "phone_e164", None)
            if phone and hasattr(comm, "initiate_call"):
                try:
                    comm.initiate_call(
                        event_id=approval.event_id,
                        vendor_id=approver.id,
                        to_number=phone,
                        initial_context={
                            "reason": "CRITICAL_APPROVAL_ESCALATION",
                            "approval_id": approval.id,
                            "reply_code": approval.reply_code,
                        },
                    )
                except Exception as call_err:
                    logger.warning("Voice escalation call failed: %s", call_err)

        req_action["voice_called"] = True
        req_action["voice_called_at"] = utc_now().isoformat()
        approval.requested_action = req_action
        self.db.commit()


async def run_approval_sweeper_loop():
    """Background asyncio worker loop that runs the sweeper at configured interval."""
    interval = max(5, settings.APPROVAL_EXPIRY_INTERVAL_SECONDS)
    logger.info("Starting Approval Expiry and Escalation Sweeper loop (interval=%ds).", interval)
    while True:
        try:
            with SessionLocal() as db:
                service = ApprovalEscalationService(db)
                service.sweep_pending_approvals()
        except asyncio.CancelledError:
            logger.info("Approval Expiry Sweeper loop cancelled.")
            break
        except Exception as exc:
            logger.error("Error in Approval Sweeper loop iteration: %s", exc)

        try:
            await asyncio.sleep(interval)
        except asyncio.CancelledError:
            break
