"""Domain Service: VendorOutreachService

Real, approved outreach to a selected shortlist candidate over two independent
channels: a WhatsApp message (OpenWA) and an AI-voice phone call (Twilio +
Gemini Live).

Invariants:
- One CommunicationAttempt row per (shortlist entry, channel). A channel is
  only dispatched after atomically claiming that row, so double-clicks,
  repeated requests and concurrent retries cannot send twice.
- No database transaction is held open while a provider is being called.
- A channel is only reported in a state the provider actually reported.
  Mock/fallback results are never presented as real delivery.
- Provider callbacks only move a channel forward; duplicates and out-of-order
  callbacks are ignored, and terminal states are final.
- Contacting a vendor is never treated as agreement or a booking.
"""
import logging
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Iterable, List, Optional, Tuple

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.phone import InvalidPhoneNumber, mask_phone, normalize_phone_e164
from app.models.communication_attempt import CommunicationAttempt
from app.models.event import Event
from app.models.shortlist import EventShortlistEntry
from app.models.vendor import Vendor
from app.observability.audit import AuditRecorder
from app.services.live_broker import live_broker

logger = logging.getLogger(__name__)

WHATSAPP = "WHATSAPP"
CALL = "CALL"
CHANNELS = (CALL, WHATSAPP)

# WhatsApp: ACCEPTED = OpenWA returned a message id; SENT/DELIVERED/READ come from WhatsApp acks.
WHATSAPP_RANK = {"NOT_ATTEMPTED": 0, "SENDING": 1, "ACCEPTED": 2, "SENT": 3, "DELIVERED": 4, "READ": 5, "REPLIED": 6}
WHATSAPP_ACK_STATUS = {1: "SENT", 2: "DELIVERED", 3: "READ", 4: "READ"}

# Call: provider-reported Twilio CallStatus values, upper-cased.
CALL_RANK = {"NOT_ATTEMPTED": 0, "INITIATING": 1, "QUEUED": 2, "INITIATED": 3, "RINGING": 4, "IN_PROGRESS": 5}
CALL_TERMINAL = {"COMPLETED", "NO_CONVERSATION", "BUSY", "NO_ANSWER", "FAILED", "CANCELED"}
# The phone call ended but the AI agent never spoke with the vendor (e.g. the media stream
# never started, which on a Twilio trial happens when no key is pressed after the trial notice).
NO_CONVERSATION_ERROR = (
    "The call ended before the AI conversation started. Either the AI voice stream could not be "
    "reached (check the tunnel), or, on a Twilio trial account, no key was pressed after the trial message."
)
TWILIO_STATUS_MAP = {
    "queued": "QUEUED",
    "initiated": "INITIATED",
    "ringing": "RINGING",
    "in-progress": "IN_PROGRESS",
    "answered": "IN_PROGRESS",
    "completed": "COMPLETED",
    "busy": "BUSY",
    "no-answer": "NO_ANSWER",
    "failed": "FAILED",
    "canceled": "CANCELED",
}

IN_FLIGHT = {"SENDING", "INITIATING"}
RETRYABLE = {"NOT_ATTEMPTED", "FAILED", "UNAVAILABLE", "BUSY", "NO_ANSWER", "CANCELED", "NO_CONVERSATION"}
# A claim that never resolved (e.g. the API process died mid-request) becomes
# retryable after this long; the error tells the organizer to check first.
STALE_CLAIM_AFTER = timedelta(minutes=10)

CATEGORY_LABELS = {
    "DJ_MUSIC": "DJ and music",
    "AV_TECH": "audio-visual",
    "MAKEUP_STYLING": "makeup and styling",
}

REAL_OUTREACH_BLOCKED_IDS = {"", "system", "anonymous_operator", "organizer"}

# Budget line names used for each provider category (budget items use their own names).
BUDGET_CATEGORY_ALIASES = {
    "DECOR": ("DECOR", "DECORATION"),
    "DJ_MUSIC": ("DJ_MUSIC", "MUSIC"),
    "TRANSPORT": ("TRANSPORT", "TRANSPORTATION"),
    "AV_TECH": ("AV_TECH", "AV"),
}
# Without an organizer-set target, the agent opens at this share of the category budget.
DEFAULT_TARGET_SHARE = 0.8


def negotiation_limits(db: Session, event: Event, vendor_id: Optional[str], category: Optional[str]) -> Optional[Dict[str, Any]]:
    """Price limits for an AI call, resolved server-side. They are never sent to the voice model.

    Priority: limits the organizer set on the vendor assignment, then the event's budget
    line for the category. Without either the call is an inquiry only.
    """
    from app.models.budget import BudgetItem
    from app.models.vendor_assignment import VendorAssignment

    if vendor_id:
        asg = (
            db.query(VendorAssignment)
            .filter(VendorAssignment.event_id == event.id, VendorAssignment.vendor_id == vendor_id)
            .first()
        )
        if asg and asg.max_approved_amount:
            ceiling = float(asg.max_approved_amount)
            target = float(asg.target_amount) if asg.target_amount else ceiling * DEFAULT_TARGET_SHARE
            return {
                "target": round(min(target, ceiling)),
                "max": round(ceiling),
                "currency": asg.currency or event.currency or "INR",
                "source": "ORGANIZER_LIMIT",
            }

    key = (category or "").upper()
    names = [n.upper() for n in BUDGET_CATEGORY_ALIASES.get(key, (key,))]
    items = [
        i for i in db.query(BudgetItem).filter(BudgetItem.event_id == event.id).all()
        if (i.category or "").upper() in names and (i.status or "").upper() != "CANCELLED"
    ]
    ceiling = sum(float(i.estimated_amount or 0) - float(i.actual_amount or 0) for i in items)
    if ceiling <= 0:
        return None
    return {
        "target": round(ceiling * DEFAULT_TARGET_SHARE),
        "max": round(ceiling),
        "currency": items[0].currency or event.currency or "INR",
        "source": "CATEGORY_BUDGET",
    }


# A quote more than this multiple of the ceiling gets the final offer straight away.
FAR_ABOVE_FACTOR = 2.0


def evaluate_vendor_price(limits: Dict[str, Any], price: float, counters_made: int) -> Dict[str, Any]:
    """Decides the agent's next move for a price the vendor stated.

    The response tells the agent what to say without ever revealing the ceiling; the
    final counter equals the ceiling, presented as the organizer's best offer.
    """
    ceiling, target, currency = float(limits["max"]), float(limits["target"]), limits["currency"]
    if price <= ceiling:
        return {
            "decision": "WITHIN_BUDGET",
            "instruction": (
                "This price can be recorded. Thank the vendor, repeat the agreed price and what it includes, and say "
                "the organizer will confirm the booking. Do not say it is booked or confirmed."
            ),
        }
    counters = [target, target + (ceiling - target) / 2, ceiling]
    if price > ceiling * FAR_ABOVE_FACTOR:
        # Small steps toward a ceiling far below the quote waste the vendor's time:
        # make one final offer instead.
        counters_made = len(counters) - 1 if counters_made == 0 else len(counters)
    while counters_made < len(counters) and counters[counters_made] >= price:
        counters_made += 1
    if counters_made < len(counters):
        raw = counters[counters_made]
        # Round down to a natural amount so a counter can never exceed the ceiling.
        offer = int(raw // 100 * 100) if raw >= 1000 else int(raw)
        final = counters_made == len(counters) - 1
        return {
            "decision": "COUNTER",
            "counter_offer": offer,
            "currency": currency,
            "is_final_offer": final,
            "instruction": (
                f"Politely counter-offer {offer} {currency}"
                + (" and say this is the best the organizer can do." if final else " and ask whether they can work with it.")
                + " Never mention a budget, limit or ceiling."
            ),
        }
    return {
        "decision": "ABOVE_BUDGET",
        "instruction": (
            "Do not offer more. In the vendor's language, thank them, say the organizer will review their quote of "
            f"{int(price)} {currency} and get back to them, say goodbye, and then call end_call with final_price."
        ),
    }


def utc_now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class OutreachAuthorizationError(Exception):
    pass


def require_real_organizer(db: Session, event: Event, user_id: Optional[str]) -> None:
    """Real calls/messages need an identified organizer of this event.

    The development identity overrides (anonymous/system/agent ids) that the rest
    of the API treats as MAIN_ORGANIZER are deliberately not accepted here.
    """
    from app.engines.auth.policy import ApprovalPolicy
    from app.models.event_member import EventMember

    uid = (user_id or "").strip()
    if uid in REAL_OUTREACH_BLOCKED_IDS or uid.startswith(("system", "agent", "autonomous")):
        raise OutreachAuthorizationError(
            "Contacting real vendors requires an identified organizer of this event, not an anonymous or system identity."
        )
    if event.owner_id == uid:
        return
    member = db.query(EventMember).filter(EventMember.event_id == event.id, EventMember.user_id == uid).first()
    if not member or not ApprovalPolicy.is_eligible_approver(member.role, "MAJOR"):
        raise OutreachAuthorizationError(f"User '{uid}' is not authorized to contact vendors for this event.")


def build_whatsapp_message(contact_name: str, event: Event, category: Optional[str]) -> str:
    """Initial vendor inquiry built only from real event data (no placeholders)."""
    service = humanize_category(category)
    where = f" in {event.location.strip()}" if event.location and event.location.strip() else ""
    when = f" on {format_event_date(event.start_datetime)}" if event.start_datetime else ""
    return (
        f"Hello {contact_name}, I am contacting you on behalf of the organizer of {event.name}. "
        f"We are looking for {service} services for an event{where}{when}. "
        "Could you please confirm your availability and share your estimated pricing? Thank you."
    )


def humanize_category(category: Optional[str]) -> str:
    key = (category or "").upper()
    if key in CATEGORY_LABELS:
        return CATEGORY_LABELS[key]
    return key.replace("_", " ").lower() if key and key != "OTHER" else "event"


def format_event_date(value: datetime) -> str:
    return f"{value.day} {value.strftime('%B %Y')}"


class VendorOutreachService:
    def __init__(self, db: Session):
        self.db = db
        self._audit = AuditRecorder(db)

    # ------------------------------------------------------------------
    # Contact resolution
    # ------------------------------------------------------------------

    def resolve_contact(self, entry: EventShortlistEntry) -> Tuple[Optional[str], Optional[str], Optional[str], Optional[str]]:
        """Returns (contact_name, e164_phone, vendor_id, error) for a shortlist entry."""
        c_data = entry.candidate_data or {}
        vendor = self.db.get(Vendor, entry.provider_id) if entry.provider_id else None
        raw_phone = None
        contact_name = None
        if vendor:
            raw_phone = vendor.contact_phone
            contact_name = vendor.contact_name or vendor.name
        if not raw_phone:
            raw_phone = c_data.get("contact_phone") or c_data.get("phone")
        if not raw_phone and entry.provider_id:
            from app.models.venue import Venue
            venue = self.db.get(Venue, entry.provider_id)
            if venue and venue.contact_phone:
                raw_phone = venue.contact_phone
        contact_name = contact_name or c_data.get("contact_name") or entry.candidate_name
        try:
            phone = normalize_phone_e164(raw_phone)
        except InvalidPhoneNumber as err:
            return contact_name, None, vendor.id if vendor else None, str(err)
        return contact_name, phone, vendor.id if vendor else None, None

    # ------------------------------------------------------------------
    # Dispatch
    # ------------------------------------------------------------------

    def start_outreach(
        self,
        event: Event,
        entry: EventShortlistEntry,
        actor_id: str,
        approval_id: Optional[str] = None,
        channels: Iterable[str] = CHANNELS,
        redial: bool = False,
    ) -> Dict[str, Any]:
        """Dispatches each requested channel that is not already in progress or done.

        `redial` lets the organizer explicitly call a vendor again after a finished call.
        """
        contact_name, phone, vendor_id, contact_error = self.resolve_contact(entry)
        started = False
        for channel in channels:
            attempt = self._claim(event, entry, channel, actor_id, approval_id, contact_name, phone, vendor_id, redial=redial)
            if attempt is None:
                continue  # already in progress or completed: never send twice
            if not started:
                started = True
                self._record_run_event(entry, "communication.started", {"has_contact_phone": bool(phone), "approval_id": approval_id})
                if contact_error:
                    self._record_run_event(
                        entry, "communication.status_changed", {"channel": "ALL", "status": "NOT_ATTEMPTED", "detail": contact_error}
                    )
            if contact_error:
                self._finish(attempt.id, "FAILED", error=contact_error, report_run_event=False)
                continue
            try:
                if channel == WHATSAPP:
                    self._dispatch_whatsapp(attempt.id, event, entry, contact_name, phone)
                else:
                    self._dispatch_call(attempt.id, event, entry, contact_name, phone, vendor_id)
            except Exception as exc:
                # Never leave a channel stuck in-flight, and keep the other channel independent.
                logger.exception("Unexpected error dispatching %s outreach", channel)
                self.db.rollback()
                self._finish(
                    attempt.id,
                    "FAILED",
                    error=f"Unexpected error while sending ({type(exc).__name__}). Check the provider console before retrying.",
                )
        summary = self.summary(entry)
        if started:
            self._record_run_event(
                entry,
                "communication.status_changed",
                {
                    "channel": "OVERALL",
                    "status": summary["overall_status"],
                    "call_status": summary["call"]["status"],
                    "whatsapp_status": summary["whatsapp"]["status"],
                },
            )
        return summary

    def _claim(
        self,
        event: Event,
        entry: EventShortlistEntry,
        channel: str,
        actor_id: str,
        approval_id: Optional[str],
        contact_name: Optional[str],
        phone: Optional[str],
        vendor_id: Optional[str],
        redial: bool = False,
    ) -> Optional[CommunicationAttempt]:
        """Atomically moves a channel into its in-flight state; returns None if it may not be sent."""
        in_flight_status = "SENDING" if channel == WHATSAPP else "INITIATING"
        now = utc_now()
        attempt = self._get_attempt(entry.id, channel)
        if attempt is None:
            attempt = CommunicationAttempt(
                event_id=event.id,
                shortlist_entry_id=entry.id,
                channel=channel,
                status="NOT_ATTEMPTED",
                attempt_count=0,
                details={},
            )
            self.db.add(attempt)
            try:
                self.db.commit()
            except IntegrityError:
                self.db.rollback()  # a concurrent request created it first
            attempt = self._get_attempt(entry.id, channel)

        retryable = list(RETRYABLE) + (["COMPLETED"] if redial and channel == CALL else [])
        # Keep what earlier calls produced; the new attempt starts with a clean result.
        fresh_details = {"history": _call_history(attempt)} if channel == CALL and _call_history(attempt) else {}
        stale_cutoff = now - STALE_CLAIM_AFTER
        query = self.db.query(CommunicationAttempt).filter(CommunicationAttempt.id == attempt.id)
        claimable = query.filter(
            (CommunicationAttempt.status.in_(retryable))
            | (CommunicationAttempt.status.in_(list(IN_FLIGHT)) & (CommunicationAttempt.last_attempt_at < stale_cutoff))
        )
        updated = claimable.update(
            {
                CommunicationAttempt.status: in_flight_status,
                CommunicationAttempt.attempt_count: CommunicationAttempt.attempt_count + 1,
                CommunicationAttempt.error: None,
                CommunicationAttempt.provider_ref: None,
                CommunicationAttempt.completed_at: None,
                CommunicationAttempt.details: fresh_details,
                CommunicationAttempt.last_attempt_at: now,
                CommunicationAttempt.requested_by: actor_id,
                CommunicationAttempt.approval_id: approval_id,
                CommunicationAttempt.contact_name: contact_name,
                CommunicationAttempt.destination: phone,
                CommunicationAttempt.vendor_id: vendor_id,
                CommunicationAttempt.provider: "openwa" if channel == WHATSAPP else "twilio",
            },
            synchronize_session=False,
        )
        self.db.commit()
        if not updated:
            logger.info("Outreach %s for entry %s already in progress or done; not re-sending.", channel, entry.id)
            return None
        attempt = self.db.get(CommunicationAttempt, attempt.id)
        self.db.refresh(attempt)
        self._audit.record(
            event_id=event.id,
            actor_id=actor_id,
            actor_type="ORGANIZER",
            action="VENDOR_OUTREACH_DISPATCH",
            action_type="COMMUNICATION",
            target_type="SHORTLIST_ENTRY",
            target_id=entry.id,
            approval_id=approval_id,
            after_state={"channel": channel, "attempt": attempt.attempt_count, "destination": mask_phone(phone)},
        )
        self.db.commit()
        self._publish(attempt)
        return attempt

    def _dispatch_whatsapp(
        self, attempt_id: str, event: Event, entry: EventShortlistEntry, contact_name: str, phone: str
    ) -> None:
        from app.integrations.whatsapp.client import OpenWACommunicationAdapter

        message = build_whatsapp_message(contact_name, event, entry.category)
        event_id, vendor_id = event.id, entry.provider_id
        self.db.commit()  # release any open transaction before the network call
        result = OpenWACommunicationAdapter().send_text_strict(phone, message)
        if result.success:
            self._finish(
                attempt_id,
                "ACCEPTED",
                provider_ref=result.data["message_id"],
                details={"message_text": message},
                final=False,
            )
            self._record_conversation(event_id, vendor_id, message, phone, "sent")
        else:
            status = "UNAVAILABLE" if (result.data or {}).get("error_code") == "OPENWA_NOT_CONFIGURED" else "FAILED"
            self._finish(attempt_id, status, error=result.error, details={"error_code": (result.data or {}).get("error_code")})

    def _dispatch_call(
        self,
        attempt_id: str,
        event: Event,
        entry: EventShortlistEntry,
        contact_name: str,
        phone: str,
        vendor_id: Optional[str],
    ) -> None:
        from app.integrations.communication.twilio import TwilioVoiceAdapter

        attempt = self.db.get(CommunicationAttempt, attempt_id)
        params = {
            "session_id": f"{attempt_id}:{attempt.attempt_count}",
            "attempt_id": attempt_id,
            "event_id": event.id,
            "provider_id": vendor_id or "",
            "vendor_name": contact_name,
            "event_name": event.name,
            "event_date": format_event_date(event.start_datetime) if event.start_datetime else "",
            "event_location": event.location or "",
            "service_category": humanize_category(entry.category),
            "inquiry_goal": "Ask whether the vendor is available and request an estimated price and relevant service details.",
        }
        self.db.commit()
        adapter = TwilioVoiceAdapter()
        if not (settings.TWILIO_ENABLED or (settings.COMMUNICATION_PROVIDER or "").lower() == "twilio"):
            self._finish(attempt_id, "UNAVAILABLE", error="Phone calling is disabled. Set TWILIO_ENABLED=true in .env and restart the API.")
            return
        result = adapter.place_outbound_call(phone, params)
        if result.success:
            status = TWILIO_STATUS_MAP.get(str(result.data.get("status", "queued")).lower(), "QUEUED")
            self._finish(
                attempt_id,
                status,
                provider_ref=result.data["call_sid"],
                details={
                    "session_id": params["session_id"],
                    "ai_voice": True,
                    # Read back by the voice bridge from the database; never sent to Twilio.
                    "negotiation_limits": negotiation_limits(self.db, event, vendor_id, entry.category),
                },
                final=False,
            )
        else:
            code = (result.data or {}).get("error_code")
            status = "UNAVAILABLE" if code and code.startswith("TWILIO_NOT_CONFIGURED") else "FAILED"
            self._finish(attempt_id, status, error=result.error, details={"error_code": code})

    # ------------------------------------------------------------------
    # Provider status updates
    # ------------------------------------------------------------------

    def apply_call_status(self, call_sid: str, twilio_status: str, payload: Dict[str, Any]) -> Optional[CommunicationAttempt]:
        """Applies a verified Twilio status callback. Returns the attempt, or None if unknown."""
        attempt = self._attempt_by_ref(CALL, call_sid)
        if attempt is None:
            return None
        new_status = TWILIO_STATUS_MAP.get((twilio_status or "").lower())
        if not new_status or not self._call_advances(attempt.status, new_status):
            return attempt  # duplicate, out-of-order, or unknown status
        details = {"twilio_status": twilio_status}
        if payload.get("CallDuration"):
            details["duration_seconds"] = int(payload["CallDuration"])
        if payload.get("AnsweredBy"):
            details["answered_by"] = payload["AnsweredBy"]
        error = None
        if new_status == "COMPLETED" and not (attempt.details or {}).get("transcript"):
            new_status = "NO_CONVERSATION"
            error = NO_CONVERSATION_ERROR
        if new_status in ("FAILED", "BUSY", "NO_ANSWER", "CANCELED"):
            error = {
                "FAILED": "The call could not be connected.",
                "BUSY": "The line was busy.",
                "NO_ANSWER": "The call was not answered.",
                "CANCELED": "The call was cancelled before it connected.",
            }[new_status]
        return self._finish(attempt.id, new_status, error=error, details=details, final=new_status in CALL_TERMINAL)

    def apply_whatsapp_ack(self, message_id: str, ack: Optional[int]) -> Optional[CommunicationAttempt]:
        attempt = self._attempt_by_ref(WHATSAPP, message_id)
        if attempt is None or ack is None:
            return attempt
        if ack == -1:
            if WHATSAPP_RANK.get(attempt.status, 0) < WHATSAPP_RANK["SENT"]:
                return self._finish(attempt.id, "FAILED", error="WhatsApp reported that the message could not be sent.")
            return attempt
        new_status = WHATSAPP_ACK_STATUS.get(ack)
        if not new_status or WHATSAPP_RANK.get(new_status, 0) <= WHATSAPP_RANK.get(attempt.status, 0):
            return attempt
        return self._finish(attempt.id, new_status, details={"ack": ack}, final=new_status == "READ")

    def refresh_whatsapp_acks(self, entry: EventShortlistEntry) -> None:
        """Pulls the current ack for a message that has not been read yet."""
        from app.integrations.whatsapp.client import OpenWACommunicationAdapter, OpenWAError

        attempt = self._get_attempt(entry.id, WHATSAPP)
        if not attempt or not attempt.provider_ref or attempt.status not in ("ACCEPTED", "SENT", "DELIVERED"):
            return
        message_id = attempt.provider_ref
        self.db.commit()
        try:
            ack = OpenWACommunicationAdapter().get_message_ack(message_id)
        except OpenWAError as err:
            logger.info("Could not refresh WhatsApp ack: %s", err.reason)
            return
        self.apply_whatsapp_ack(message_id, ack)

    def refresh_call_status(self, entry: EventShortlistEntry) -> None:
        """Pulls the call state from Twilio for a call whose status callbacks never arrived."""
        from app.integrations.communication.twilio import TwilioVoiceAdapter

        attempt = self._get_attempt(entry.id, CALL)
        if not attempt or not attempt.provider_ref or attempt.status in CALL_TERMINAL or attempt.status in ("INITIATING", "UNAVAILABLE"):
            return
        call_sid = attempt.provider_ref
        self.db.commit()
        info = TwilioVoiceAdapter().fetch_call(call_sid)
        if not info or not info.get("status"):
            return
        payload = {"CallDuration": info["duration"]} if info.get("duration") else {}
        if info.get("answered_by"):
            payload["AnsweredBy"] = info["answered_by"]
        self.apply_call_status(call_sid, info["status"], payload)

    def refresh_whatsapp_replies(self, entry: EventShortlistEntry) -> None:
        """Reads the vendor's WhatsApp replies and records what they mean (yes / no / price)."""
        from app.integrations.whatsapp.client import OpenWACommunicationAdapter, OpenWAError
        from app.services.vendor_reply_analysis import analyze_vendor_reply

        attempt = self._get_attempt(entry.id, WHATSAPP)
        if not attempt or not attempt.provider_ref or WHATSAPP_RANK.get(attempt.status, 0) < WHATSAPP_RANK["ACCEPTED"]:
            return
        message_id, attempt_id = attempt.provider_ref, attempt.id
        known = {r.get("id") for r in (attempt.details or {}).get("replies") or []}
        # A keyword-only reading is provisional: try the AI again on the next refresh.
        provisional = ((attempt.details or {}).get("reply_analysis") or {}).get("method") == "KEYWORDS"
        self.db.commit()
        try:
            replies = OpenWACommunicationAdapter().get_replies_after(message_id)
        except OpenWAError as err:
            logger.info("Could not read WhatsApp replies: %s", err.reason)
            return
        if not replies or ({r["id"] for r in replies} <= known and not provisional):
            return
        # Judge the vendor's latest answer: only what they wrote after our last follow-up.
        followups = (attempt.details or {}).get("followups") or []
        since = max((f.get("t") or 0 for f in followups), default=0)
        latest = [r for r in replies if (r.get("t") or 0) >= since] or replies[-1:]
        text = "\n".join(r["text"] for r in latest)
        analysis = analyze_vendor_reply(text, self._analysis_context(entry), self._limits_for(entry, attempt.vendor_id))
        self._finish(
            attempt_id,
            "REPLIED",
            details={"replies": replies[-20:], "reply_analysis": analysis},
            final=True,
        )

    def draft_whatsapp_followup(self, entry: EventShortlistEntry) -> Dict[str, Any]:
        """Drafts the next WhatsApp message from everything the vendor said on WhatsApp and the call."""
        from app.services.vendor_reply_analysis import draft_followup

        summary = self.summary(entry)
        wa, call = summary["whatsapp"], summary["call"]
        lines = [f"ORGANIZER (WhatsApp): {wa['message_text']}"] if wa.get("message_text") else []
        timeline = [(r.get("t") or 0, f"VENDOR (WhatsApp): {r['text']}") for r in wa.get("replies") or []]
        timeline += [(f.get("t") or 0, f"ORGANIZER (WhatsApp): {f['text']}") for f in wa.get("followups") or []]
        lines += [text for _, text in sorted(timeline, key=lambda x: x[0])]
        lines += [f"{'VENDOR' if t.get('speaker') == 'VENDOR' else 'AI ASSISTANT'} (phone call): {t.get('text')}" for t in call.get("transcript") or []]
        rounds = (call.get("negotiation") or {}).get("rounds") or []
        agreed = rounds[-1].get("vendor_price") if rounds and (call.get("verdict") or {}).get("code") == "AGREED" else None
        return draft_followup(self._analysis_context(entry), lines, wa.get("reply_analysis"), call.get("verdict"), agreed)

    def send_whatsapp_followup(self, event: Event, entry: EventShortlistEntry, text: str, actor_id: str) -> Dict[str, Any]:
        """Sends an organizer-approved follow-up in the existing WhatsApp conversation."""
        from app.integrations.whatsapp.client import OpenWACommunicationAdapter

        attempt = self._get_attempt(entry.id, WHATSAPP)
        if not attempt or not attempt.provider_ref or not attempt.destination:
            raise ValueError("The first WhatsApp message has not been sent to this vendor yet.")
        attempt_id, phone, vendor_id = attempt.id, attempt.destination, attempt.vendor_id
        self.db.commit()  # no transaction held during the network call
        result = OpenWACommunicationAdapter().send_text_strict(phone, text)
        if not result.success:
            raise RuntimeError(result.error or "WhatsApp did not accept the message.")
        attempt = self.db.get(CommunicationAttempt, attempt_id)
        self.db.refresh(attempt)
        details = dict(attempt.details or {})
        details["followups"] = (list(details.get("followups") or []) + [{
            "text": text,
            "message_id": result.data["message_id"],
            "t": int(time.time()),
            "sent_by": actor_id,
        }])[-20:]
        attempt.details = details
        self.db.commit()
        self._audit.record(
            event_id=event.id,
            actor_id=actor_id,
            actor_type="ORGANIZER",
            action="VENDOR_WHATSAPP_FOLLOWUP",
            action_type="COMMUNICATION",
            target_type="SHORTLIST_ENTRY",
            target_id=entry.id,
            approval_id=attempt.approval_id,
        )
        self._record_conversation(event.id, vendor_id, text, phone, "sent")
        self._sync_entry(attempt)
        self._publish(attempt)
        return self.summary(entry)

    def refresh_call_analysis(self, entry: EventShortlistEntry) -> None:
        """Works out what the vendor said on a finished call when the agent did not record an outcome."""
        from app.services.vendor_reply_analysis import analyze_vendor_reply, transcript_text

        attempt = self._get_attempt(entry.id, CALL)
        details = (attempt.details or {}) if attempt else {}
        if not attempt or attempt.status != "COMPLETED" or not details.get("transcript"):
            return
        previous = details.get("transcript_analysis") or {}
        if details.get("conversation_outcome") or (previous and previous.get("method") != "KEYWORDS"):
            return
        attempt_id = attempt.id
        self.db.commit()
        analysis = analyze_vendor_reply(
            transcript_text(details["transcript"]),
            self._analysis_context(entry),
            self._limits_for(entry, attempt.vendor_id),
            vendor_only_text=transcript_text(details["transcript"], speaker="VENDOR"),
        )
        self._finish(attempt_id, "COMPLETED", details={"transcript_analysis": analysis}, report_run_event=False)

    def _analysis_context(self, entry: EventShortlistEntry) -> str:
        event = self.db.get(Event, entry.event_id)
        return f"{humanize_category(entry.category)} for '{event.name if event else ''}' in {event.location if event else ''}"

    def _limits_for(self, entry: EventShortlistEntry, vendor_id: Optional[str]) -> Optional[Dict[str, Any]]:
        event = self.db.get(Event, entry.event_id)
        return negotiation_limits(self.db, event, vendor_id, entry.category) if event else None

    def record_call_conversation(
        self,
        attempt_id: str,
        transcript: List[Dict[str, Any]],
        outcome: Optional[Dict[str, Any]],
        duration_seconds: Optional[float],
        error: Optional[str],
        negotiation: Optional[Dict[str, Any]] = None,
    ) -> None:
        """Persists what was actually said on an AI call (called when the media stream closes)."""
        attempt = self.db.get(CommunicationAttempt, attempt_id)
        if attempt is None:
            return
        details = dict(attempt.details or {})
        details["transcript"] = transcript[-200:]
        details["conversation_outcome"] = outcome
        if negotiation is not None:
            details["negotiation"] = negotiation
        details["conversation_seconds"] = round(duration_seconds or 0, 1)
        if error:
            details["voice_agent_error"] = error[:300]
        attempt.details = details
        if attempt.status == "NO_CONVERSATION" and details["transcript"]:
            # The completed callback arrived before the transcript; the conversation did happen.
            attempt.status = "COMPLETED"
            attempt.error = None
        self.db.commit()
        self._sync_entry(attempt)
        self._publish(attempt)

    # ------------------------------------------------------------------
    # Read model
    # ------------------------------------------------------------------

    def summary(self, entry: EventShortlistEntry) -> Dict[str, Any]:
        attempts = {a.channel: a for a in self.db.query(CommunicationAttempt).filter(CommunicationAttempt.shortlist_entry_id == entry.id)}
        channels = {ch: self._channel_view(attempts.get(ch)) for ch in CHANNELS}
        any_attempt = next((a for a in attempts.values() if a.contact_name or a.destination), None)
        return {
            "contact_name": any_attempt.contact_name if any_attempt else None,
            "destination_masked": mask_phone(any_attempt.destination) if any_attempt else None,
            "whatsapp": channels[WHATSAPP],
            "call": channels[CALL],
            "overall_status": overall_status(channels[WHATSAPP]["status"], channels[CALL]["status"]),
            **reply_state(attempts.get(WHATSAPP), attempts.get(CALL)),
        }

    @staticmethod
    def _channel_view(attempt: Optional[CommunicationAttempt]) -> Dict[str, Any]:
        if attempt is None:
            return {"status": "NOT_ATTEMPTED", "retryable": False, "attempt_count": 0}
        details = attempt.details or {}
        view = {
            "status": attempt.status,
            "provider": attempt.provider,
            "provider_ref": attempt.provider_ref,
            "error": attempt.error,
            "attempt_count": attempt.attempt_count,
            "retryable": attempt.status in RETRYABLE and attempt.status != "NOT_ATTEMPTED",
            "last_attempt_at": attempt.last_attempt_at.isoformat() if attempt.last_attempt_at else None,
            "completed_at": attempt.completed_at.isoformat() if attempt.completed_at else None,
            "updated_at": attempt.updated_at.isoformat() if attempt.updated_at else None,
        }
        if attempt.channel == WHATSAPP:
            view["message_text"] = details.get("message_text")
            view["replies"] = details.get("replies") or []
            view["reply_analysis"] = details.get("reply_analysis")
            view["followups"] = details.get("followups") or []
            view["can_follow_up"] = bool(attempt.provider_ref) and WHATSAPP_RANK.get(attempt.status, 0) >= WHATSAPP_RANK["ACCEPTED"]
        else:
            view["can_call_again"] = attempt.status == "COMPLETED"
            view["verdict"] = call_verdict(attempt.status, details)
            view["history"] = details.get("history") or []
            view["duration_seconds"] = details.get("duration_seconds")
            view["ai_voice"] = bool(details.get("ai_voice"))
            view["transcript"] = details.get("transcript") or []
            view["conversation_outcome"] = details.get("conversation_outcome")
            view["negotiation"] = details.get("negotiation")
        return view

    # ------------------------------------------------------------------
    # Internals
    # ------------------------------------------------------------------

    def _get_attempt(self, entry_id: str, channel: str) -> Optional[CommunicationAttempt]:
        return (
            self.db.query(CommunicationAttempt)
            .filter(CommunicationAttempt.shortlist_entry_id == entry_id, CommunicationAttempt.channel == channel)
            .first()
        )

    def _attempt_by_ref(self, channel: str, provider_ref: str) -> Optional[CommunicationAttempt]:
        if not provider_ref:
            return None
        return (
            self.db.query(CommunicationAttempt)
            .filter(CommunicationAttempt.channel == channel, CommunicationAttempt.provider_ref == provider_ref)
            .first()
        )

    @staticmethod
    def _call_advances(current: str, new: str) -> bool:
        if current in CALL_TERMINAL:
            return False
        if new in CALL_TERMINAL:
            return True
        return CALL_RANK.get(new, 0) > CALL_RANK.get(current, 0)

    def _finish(
        self,
        attempt_id: str,
        status: str,
        provider_ref: Optional[str] = None,
        error: Optional[str] = None,
        details: Optional[Dict[str, Any]] = None,
        final: bool = True,
        report_run_event: bool = True,
    ) -> CommunicationAttempt:
        attempt = self.db.get(CommunicationAttempt, attempt_id)
        self.db.refresh(attempt)
        attempt.status = status
        if provider_ref:
            attempt.provider_ref = provider_ref
        attempt.error = error[:500] if error else (None if status not in ("FAILED", "UNAVAILABLE") else attempt.error)
        if details:
            merged = dict(attempt.details or {})
            merged.update({k: v for k, v in details.items() if v is not None})
            attempt.details = merged
        if final:
            attempt.completed_at = utc_now()
        self.db.commit()
        self._sync_entry(attempt)
        self._publish(attempt)
        if report_run_event:
            entry = self.db.get(EventShortlistEntry, attempt.shortlist_entry_id)
            data = {"channel": attempt.channel, "status": status}
            if error:
                data["detail"] = error[:300]
            if entry is not None:
                self._record_run_event(entry, "communication.status_changed", data)
        return attempt

    def _record_run_event(self, entry: EventShortlistEntry, event_type: str, data: Dict[str, Any]) -> None:
        """Mirrors outreach progress onto the agent run that recommended this candidate, if any."""
        run_id = (entry.candidate_data or {}).get("agent_run_id")
        if not run_id:
            return
        from app.services.agent_run_events import AgentRunEventRecorder
        AgentRunEventRecorder(self.db).record(
            run_id,
            entry.event_id,
            event_type,
            {"candidate_id": entry.candidate_id, "candidate_name": entry.candidate_name, "category": entry.category, **data},
        )

    def _sync_entry(self, attempt: CommunicationAttempt) -> None:
        """Mirrors the per-channel state into candidate_data.communication for existing readers."""
        entry = self.db.get(EventShortlistEntry, attempt.shortlist_entry_id)
        if entry is None:
            return
        summary = self.summary(entry)
        c_data = dict(entry.candidate_data or {})
        comm = dict(c_data.get("communication") or {})
        comm.update(
            {
                "approval_status": comm.get("approval_status") or ("APPROVED" if attempt.approval_id else None),
                "approval_id": comm.get("approval_id") or attempt.approval_id,
                "whatsapp_status": summary["whatsapp"]["status"],
                "call_status": summary["call"]["status"],
                "whatsapp_error": summary["whatsapp"].get("error"),
                "call_error": summary["call"].get("error"),
                "overall_status": summary["overall_status"],
                "contact_name": summary["contact_name"],
                "phone": summary["destination_masked"],
                "channels": {"whatsapp": summary["whatsapp"], "call": summary["call"]},
                "updated_at": utc_now().isoformat(),
            }
        )
        c_data["communication"] = comm
        entry.candidate_data = c_data
        self.db.commit()

    def _publish(self, attempt: CommunicationAttempt) -> None:
        entry = self.db.get(EventShortlistEntry, attempt.shortlist_entry_id)
        live_broker.publish_sync(
            attempt.event_id,
            {
                "type": "communication.updated",
                "event_id": attempt.event_id,
                "candidate_id": entry.candidate_id if entry else None,
                "shortlist_entry_id": attempt.shortlist_entry_id,
                "channel": attempt.channel,
                "status": attempt.status,
                "error": attempt.error,
            },
        )

    def _record_conversation(self, event_id: str, vendor_id: Optional[str], text: str, phone: str, status: str) -> None:
        if not vendor_id or not self.db.get(Vendor, vendor_id):
            return
        try:
            from app.services.conversation_service import ConversationService
            ConversationService(self.db).record_outbound_message(
                event_id=event_id,
                vendor_id=vendor_id,
                raw_text=text,
                channel="whatsapp",
                recipient=phone,
                sender="EVENTRA Operations",
                status=status,
            )
            self.db.commit()
        except Exception as err:
            self.db.rollback()
            logger.warning("Could not record outbound WhatsApp in conversation thread: %s", err)


def _call_history(attempt: Optional[CommunicationAttempt]) -> List[Dict[str, Any]]:
    """Earlier calls on this attempt, newest last, including the one about to be replaced."""
    if attempt is None:
        return []
    details = attempt.details or {}
    history = list(details.get("history") or [])
    if details.get("transcript") or details.get("negotiation") or details.get("conversation_outcome"):
        history.append(
            {
                "status": attempt.status,
                "completed_at": attempt.completed_at.isoformat() if attempt.completed_at else None,
                "duration_seconds": details.get("duration_seconds"),
                "verdict": call_verdict(attempt.status, details),
                "transcript": details.get("transcript") or [],
                "negotiation": details.get("negotiation"),
            }
        )
    return history[-5:]


def _money(value: Any) -> str:
    try:
        return f"{int(float(value)):,}"
    except (TypeError, ValueError):
        return str(value)


def call_verdict(status: str, details: Dict[str, Any]) -> Optional[Dict[str, str]]:
    """The final result of a finished call, so nothing is left looking 'pending' after hang-up."""
    if status != "COMPLETED":
        return None
    negotiation = details.get("negotiation") or {}
    rounds = negotiation.get("rounds") or []
    decision = negotiation.get("final_decision")
    last_quote = next((r.get("vendor_price") for r in reversed(rounds) if r.get("vendor_price")), None)
    last_counter = next((r.get("counter_offer") for r in reversed(rounds) if r.get("counter_offer")), None)
    if decision == "WITHIN_BUDGET":
        return {"code": "AGREED", "label": "Agreed within budget",
                "detail": f"Vendor agreed to {_money(last_quote)}. The organizer still needs to confirm the booking."}
    if decision == "ABOVE_BUDGET":
        return {"code": "OVER_BUDGET", "label": "Over budget",
                "detail": f"Vendor would not go below {_money(last_quote)}"
                          + (f"; our final offer of {_money(last_counter)} was declined." if last_counter else ".")}
    if decision == "COUNTER":
        return {"code": "NO_AGREEMENT", "label": "No agreement",
                "detail": f"Vendor quoted {_money(last_quote)} and did not accept the counter-offer of {_money(last_counter)}."}
    outcome = details.get("conversation_outcome") or {}
    analysis = details.get("transcript_analysis") or {}
    code = str(outcome.get("outcome") or "").upper()
    if code in ("AVAILABLE", "INTERESTED") or analysis.get("decision") == "YES":
        return {"code": "AVAILABLE", "label": "Vendor is available",
                "detail": analysis.get("summary") or outcome.get("estimated_price") or "Vendor said yes."}
    if code in ("NOT_AVAILABLE", "NOT_INTERESTED", "DECLINED") or analysis.get("decision") == "NO":
        return {"code": "DECLINED", "label": "Vendor declined",
                "detail": analysis.get("summary") or "Vendor said no."}
    if analysis:
        return {"code": analysis.get("decision", "UNCLEAR"), "label": "Needs follow-up", "detail": analysis.get("summary") or ""}
    return {"code": "ENDED", "label": "Call ended", "detail": "No clear answer was recorded."}


def overall_status(whatsapp_status: str, call_status: str) -> str:
    statuses = (whatsapp_status, call_status)
    if any(s in IN_FLIGHT for s in statuses):
        return "PROCESSING"
    if all(s == "NOT_ATTEMPTED" for s in statuses):
        return "NOT_REQUESTED"
    ok = [s for s in statuses if s not in RETRYABLE]
    if len(ok) == 2:
        return "CONTACTED"
    if len(ok) == 1:
        return "PARTIAL"
    if all(s == "UNAVAILABLE" for s in statuses):
        return "UNAVAILABLE"
    return "FAILED"


# ---------------------------------------------------------------------------
# No-reply tracking (UX v3 §6)
# ---------------------------------------------------------------------------

# WhatsApp states in which our message reached (or was accepted for) the vendor.
WHATSAPP_OUTBOUND_OK = {"ACCEPTED", "SENT", "DELIVERED", "READ"}
# Call states in which we genuinely tried to reach the vendor but heard nothing back.
CALL_ATTEMPTED_NO_ANSWER = {"NO_ANSWER", "BUSY", "NO_CONVERSATION", "CANCELED"}


def _call_got_vendor_reply(attempt: Optional[CommunicationAttempt]) -> bool:
    """A completed call counts as a reply only when the vendor actually spoke or an outcome was recorded."""
    if attempt is None or attempt.status != "COMPLETED":
        return False
    details = attempt.details or {}
    if details.get("conversation_outcome"):
        return True
    return any((line or {}).get("speaker") == "VENDOR" for line in details.get("transcript") or [])


def _last_outbound_at(wa: Optional[CommunicationAttempt], call: Optional[CommunicationAttempt]) -> Optional[datetime]:
    """Most recent time we successfully reached out (message accepted / follow-up sent / call placed)."""
    times: List[datetime] = []
    if wa is not None and wa.status in WHATSAPP_OUTBOUND_OK and wa.last_attempt_at:
        times.append(wa.last_attempt_at)
        for f in (wa.details or {}).get("followups") or []:
            t = f.get("t")
            if t:
                times.append(datetime.fromtimestamp(int(t), tz=timezone.utc).replace(tzinfo=None))
    if call is not None and call.last_attempt_at and (
        call.status in CALL_ATTEMPTED_NO_ANSWER or (call.status == "COMPLETED" and not _call_got_vendor_reply(call))
    ):
        times.append(call.last_attempt_at)
    return max(times) if times else None


def reply_state(
    wa: Optional[CommunicationAttempt],
    call: Optional[CommunicationAttempt],
    now: Optional[datetime] = None,
) -> Dict[str, Any]:
    """Whether a contacted vendor has replied, and when a follow-up is due.

    Returns ``awaiting_reply_since`` / ``follow_up_due_at`` (ISO, UTC) and ``no_reply``.
    Nothing is reported while no outreach actually went out, or once the vendor replied
    on any channel.
    """
    replied = (wa is not None and wa.status == "REPLIED") or _call_got_vendor_reply(call)
    since = None if replied else _last_outbound_at(wa, call)
    if since is None:
        return {"awaiting_reply_since": None, "follow_up_due_at": None, "no_reply": False}
    due = since + timedelta(hours=float(settings.OUTREACH_NO_REPLY_HOURS))
    current = now or utc_now()
    return {
        "awaiting_reply_since": since.isoformat(),
        "follow_up_due_at": due.isoformat(),
        "no_reply": current >= due,
    }
