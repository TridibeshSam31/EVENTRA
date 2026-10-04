"""Domain Service: ApprovalEscalationService

Periodically monitors pending approvals:
1. Enforces TTL expiry: marks EXPIRED, notifies organizers, triggers agent replanning via triggers.py.
2. Sends reminder alerts at configured fraction of TTL to still-eligible approvers.
3. Escalates to next eligible approvers (excluding requester & already-notified users) via dispatcher (WhatsApp + push + in-app), falling back to event owner.
4. Optionally places voice calls via Twilio/Exotel for CRITICAL impact approvals.
"""
import asyncio
import logging
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional, Set
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from app.core.config import settings
from app.db.session import SessionLocal
from app.models.approval import Approval
from app.models.event import Event
from app.models.event_member import EventMember
from app.models.user import User
from app.models.notification import Notification
from app.engines.auth.policy import ApprovalPolicy
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

    def _claim_action_flag(
        self,
        approval_id: str,
        flag: str,
        extra_payload: Optional[Dict[str, Any]] = None,
    ) -> Optional[Approval]:
        """Atomically claims a sweeper action flag (reminder_sent, escalated, voice_called).
        
        SQLite limitation:
        SQLite operates with database-level locking and does not support pessimistic row-level
        locking ('SELECT ... FOR UPDATE'). Under SQLite, concurrency control relies on database write
        serialization, but row-level mutual exclusion cannot be enforced across separate connections.
        In PostgreSQL and other production RDBMS, 'with_for_update()' acquires an exclusive row lock
        ensuring strict mutual exclusion between competing worker replicas.
        
        Returns the claimed Approval object, or None if already claimed or no longer PENDING.
        """
        try:
            query = self.db.query(Approval).filter(Approval.id == approval_id)
            if self.db.bind and self.db.bind.dialect.name != "sqlite":
                query = query.with_for_update()

            approval = query.first()
            if not approval or approval.status != "PENDING":
                return None

            req_action = dict(approval.requested_action or {})
            if req_action.get(flag):
                # Already claimed by another worker or previous run
                return None

            req_action[flag] = True
            req_action[f"{flag}_at"] = utc_now().isoformat()
            if extra_payload:
                req_action.update(extra_payload)

            approval.requested_action = req_action
            flag_modified(approval, "requested_action")
            self.db.add(approval)
            self.db.commit()
            self.db.refresh(approval)
            return approval
        except Exception as err:
            self.db.rollback()
            logger.error("Failed to claim action flag '%s' for approval %s: %s", flag, approval_id, err)
            return None

    def _get_already_notified_user_ids(self, approval: Approval) -> Set[str]:
        """Collects IDs of all users already notified for this approval."""
        notified = set()
        req_action = dict(approval.requested_action or {})
        for uid in req_action.get("notified_to", []):
            notified.add(str(uid))
        for uid in req_action.get("escalated_to", []):
            notified.add(str(uid))

        # Inspect Notification table for existing deliveries for this approval
        notifs = (
            self.db.query(Notification)
            .filter(Notification.event_id == approval.event_id)
            .all()
        )
        for n in notifs:
            payload = n.payload or {}
            if payload.get("approval_id") == approval.id:
                if n.channel == "IN_APP" and n.recipient:
                    notified.add(str(n.recipient))

        return notified

    def _resolve_escalation_recipients(self, approval: Approval) -> List[User]:
        """Finds next eligible approvers via ApprovalPolicy, excluding requester and already-notified users.
        
        Falls back to event owner only if no eligible approver remains.
        """
        event = self.db.query(Event).filter(Event.id == approval.event_id).first()
        if not event:
            return []

        already_notified = self._get_already_notified_user_ids(approval)
        eligible_user_ids: Set[str] = set()

        # 1. Candidate event members with eligible role under ApprovalPolicy
        members = (
            self.db.query(EventMember)
            .filter(EventMember.event_id == approval.event_id)
            .all()
        )
        for m in members:
            if m.user_id == approval.requester_id:
                continue
            if ApprovalPolicy.is_eligible_approver(m.role, approval.impact_level):
                eligible_user_ids.add(m.user_id)

        # 2. Candidate event owner (MAIN_ORGANIZER role)
        if event.owner_id and event.owner_id != approval.requester_id:
            if ApprovalPolicy.is_eligible_approver("MAIN_ORGANIZER", approval.impact_level):
                eligible_user_ids.add(event.owner_id)

        # 3. Filter out anyone already notified
        next_user_ids = [uid for uid in eligible_user_ids if uid not in already_notified]

        if next_user_ids:
            return self.db.query(User).filter(User.id.in_(next_user_ids)).all()

        # 4. Fall back to event owner only if no eligible approver remains
        if event.owner_id and event.owner_id != approval.requester_id:
            owner = self.db.query(User).filter(User.id == event.owner_id).first()
            if owner:
                return [owner]

        return []

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
                        claimed = self._claim_action_flag(approval.id, "reminder_sent")
                        if claimed:
                            self._handle_reminder(claimed)
                            counts["reminded"] += 1

                # Refresh req_action state after reminder check
                req_action = dict(approval.requested_action or {})

                # -------------------------------------------------------------
                # 3. ESCALATION CHECK (after N minutes)
                # -------------------------------------------------------------
                minutes_pending = (now - approval.created_at).total_seconds() / 60.0
                if minutes_pending >= settings.APPROVAL_ESCALATION_MINUTES and not req_action.get("escalated"):
                    next_approvers = self._resolve_escalation_recipients(approval)
                    if next_approvers:
                        escalated_to_ids = [u.id for u in next_approvers]
                        claimed = self._claim_action_flag(
                            approval.id,
                            "escalated",
                            extra_payload={"escalated_to": escalated_to_ids},
                        )
                        if claimed:
                            self._handle_escalation(claimed, next_approvers)
                            counts["escalated"] += 1

                # Refresh req_action state after escalation check
                req_action = dict(approval.requested_action or {})

                # -------------------------------------------------------------
                # 4. VOICE CALL ESCALATION (CRITICAL impact only)
                # -------------------------------------------------------------
                if (
                    approval.impact_level == "CRITICAL"
                    and settings.APPROVAL_VOICE_ESCALATION_ENABLED
                    and not req_action.get("voice_called")
                ):
                    claimed = self._claim_action_flag(approval.id, "voice_called")
                    if claimed:
                        self._handle_voice_escalation(claimed)
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

    def _handle_reminder(self, approval: Approval):
        """Dispatches reminder notification only to still-eligible approvers."""
        logger.info("Sending reminder for pending approval %s (code=%s).", approval.id, approval.reply_code)
        still_eligible = self._dispatcher.resolve_eligible_approvers(approval)
        if not still_eligible:
            logger.info("No still-eligible approvers for reminder on approval %s.", approval.id)
            return

        event = self.db.query(Event).filter(Event.id == approval.event_id).first()
        event_name = event.name if event else "Event"

        time_left = ""
        if approval.expires_at:
            mins_left = max(1, int((approval.expires_at - utc_now()).total_seconds() / 60))
            time_left = f" (Expires in {mins_left}m)"

        reminder_msg = f"[REMINDER: {event_name}] Approval required for {approval.action_type}{time_left}. Reply YES {approval.reply_code} to approve or NO {approval.reply_code} to reject."

        comm = registry.get_communication_provider()
        for approver in still_eligible:
            if getattr(approver, "phone_e164", None):
                comm.send_message(
                    event_id=approval.event_id,
                    provider_id=approver.id,
                    message=reminder_msg,
                    recipient_contact=approver.phone_e164,
                )

    def _handle_escalation(self, approval: Approval, approvers: List[User]):
        """Escalates pending approval to next eligible approvers via dispatcher (WhatsApp + push + in-app)."""
        logger.info("Escalating pending approval %s to %d recipients.", approval.id, len(approvers))
        self._dispatcher.dispatch_escalation(approval, approvers)

    def _handle_voice_escalation(self, approval: Approval):
        """Places voice call via Twilio/Exotel for CRITICAL approvals."""
        logger.info("Placing voice escalation call for CRITICAL approval %s.", approval.id)
        approvers = self._dispatcher.resolve_eligible_approvers(approval)
        comm = registry.get_communication_provider()

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
