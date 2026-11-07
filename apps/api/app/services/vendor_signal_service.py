"""Turns an inbound vendor message into a validated operational signal.

Pipeline (one call per inbound message):
  dedupe by provider message id -> interpret (deterministic rules) -> validate
  -> correlate with an open incident or raise a new one when the rules justify it
  -> record activity + audit -> broadcast to live subscribers.

The interpretation is deterministic on purpose: an LLM never mutates state here.
A vendor message never approves spending or changes an organizer decision.
"""
from __future__ import annotations

import logging
import re
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.models.enums import IncidentSeverity, IncidentStatus, IncidentType, TaskStatus
from app.models.incident import Incident
from app.models.task import Task

logger = logging.getLogger(__name__)

OPEN_INCIDENT_STATUSES = (
    IncidentStatus.OPEN.value,
    IncidentStatus.ACKNOWLEDGED.value,
    IncidentStatus.INVESTIGATING.value,
)
_SEVERITY_ORDER = ["LOW", "MEDIUM", "HIGH", "CRITICAL", "EMERGENCY"]


class VendorSignal(BaseModel):
    """Structured, validated reading of one vendor message."""

    outcome: str = Field(pattern=r"^(ARRIVED|CANCELLED|DECLINED|DELAY_REPORTED|ETA_UPDATED|AVAILABILITY_CONFIRMED|QUOTE_RECEIVED|NEEDS_INFO|UNCLASSIFIED)$")
    delay_minutes: Optional[int] = Field(default=None, ge=0, le=24 * 60)
    eta_minutes: Optional[int] = Field(default=None, ge=0, le=24 * 60)
    quoted_price: Optional[float] = Field(default=None, ge=0)
    certain: bool = True
    matched_rule: Optional[str] = None


_DURATION = r"(\d{1,3})\s*(?:-|\s)?\s*(min(?:ute)?s?|mins?|hrs?|hours?|ghante|ghanta|ghanto)"
_ARRIVED = re.compile(r"\b(reached|arrived|we are here|i am here|at the venue|pahunch (?:gaya|gaye|gayi|chuke|chuka))\b", re.I)
_CANCEL = re.compile(
    r"\b(cancel(?:led|ling)?|can'?t come|cannot come|not coming|won'?t (?:be able to )?(?:come|make it)|unable to (?:come|make it)|"
    r"back(?:ing)? out|nahi aa (?:paunga|payenge|paenge|sakte|sakta|sakti|payega)|nahi aayenge|nahi aaunga)\b",
    re.I,
)
_DECLINE = re.compile(r"\b(not available|unavailable|already booked|fully booked|no slot|nahi ho payega|available nahi)\b", re.I)
_DELAY_WORD = re.compile(r"\b(late|delay(?:ed)?|der|deri|running behind|stuck in traffic|traffic)\b", re.I)
_ETA_WORD = re.compile(r"\b(reach(?:ing)?|eta|pahunch(?:enge|unga|ega|ungi)?|on the way|raste me|raaste mein|arriving)\b", re.I)


def _minutes(text: str) -> Optional[int]:
    m = re.search(_DURATION, text, re.I)
    if not m:
        return None
    value, unit = int(m.group(1)), m.group(2).lower()
    return value * 60 if unit.startswith(("h", "g")) else value


def interpret_vendor_message(text: str, extracted_facts: Optional[Dict[str, Any]] = None) -> VendorSignal:
    """Deterministic interpretation. Ambiguous text is UNCLASSIFIED and flagged uncertain."""
    t = (text or "").strip()
    facts = extracted_facts or {}

    if _ARRIVED.search(t):
        return VendorSignal(outcome="ARRIVED", matched_rule="arrived")
    if _CANCEL.search(t):
        return VendorSignal(outcome="CANCELLED", matched_rule="cancel")
    if _DELAY_WORD.search(t):
        minutes = _minutes(t)
        return VendorSignal(outcome="DELAY_REPORTED", delay_minutes=minutes, certain=minutes is not None, matched_rule="delay")
    if _ETA_WORD.search(t) and _minutes(t) is not None:
        return VendorSignal(outcome="ETA_UPDATED", eta_minutes=_minutes(t), matched_rule="eta")
    if _DECLINE.search(t) or facts.get("available") is False:
        return VendorSignal(outcome="DECLINED", matched_rule="decline")

    quote = facts.get("quote") or facts.get("quoted_price") or facts.get("amount")
    try:
        quote_value = float(quote) if quote is not None else None
    except (TypeError, ValueError):
        quote_value = None
    if quote_value:
        return VendorSignal(outcome="QUOTE_RECEIVED", quoted_price=quote_value, matched_rule="quote")
    if facts.get("available") is True:
        return VendorSignal(outcome="AVAILABILITY_CONFIRMED", matched_rule="available")
    if t.endswith("?"):
        return VendorSignal(outcome="NEEDS_INFO", matched_rule="question")
    return VendorSignal(outcome="UNCLASSIFIED", certain=False)


class VendorSignalService:
    def __init__(self, db: Session):
        self.db = db

    # -- dedupe ---------------------------------------------------------------
    def claim_message(self, provider_message_id: Optional[str], payload: Dict[str, Any]) -> bool:
        """Returns False when this provider message was already processed (webhook retry)."""
        if not provider_message_id:
            return True
        from app.core.idempotency import IdempotencyService

        idem = IdempotencyService(self.db)
        try:
            already_done, _code, _body = idem.check_or_start(
                idempotency_key=f"openwa:vendor:{provider_message_id}",
                endpoint="/webhooks/openwa/vendor",
                method="POST",
                payload=payload,
            )
        except Exception:  # ConflictException: same id still processing or different payload
            return False
        return not already_done

    def complete_message(self, provider_message_id: Optional[str], result: Dict[str, Any]) -> None:
        if not provider_message_id:
            return
        from app.core.idempotency import IdempotencyService

        IdempotencyService(self.db).complete(f"openwa:vendor:{provider_message_id}", 200, result)

    # -- main entry -----------------------------------------------------------
    def process(
        self,
        *,
        event_id: str,
        vendor: Any,
        assignment: Any,
        text: str,
        extracted_facts: Optional[Dict[str, Any]] = None,
        provider_message_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        signal = interpret_vendor_message(text, extracted_facts)
        committed = str(getattr(assignment, "status", "") or "").upper() == "CONFIRMED"
        # A decline from a vendor who already committed is a cancellation of that commitment.
        if signal.outcome == "DECLINED" and committed:
            signal = VendorSignal(outcome="CANCELLED", matched_rule="decline_after_confirmation")

        task = self._linked_task(event_id, vendor.id)
        decision = self._decide(signal, task, committed)
        incident_result: Optional[Dict[str, Any]] = None
        if decision.get("raise_incident"):
            incident_result = self._raise_or_correlate(
                event_id=event_id,
                vendor=vendor,
                task=task,
                incident_type=decision["incident_type"],
                severity=decision["severity"],
                text=text,
                signal=signal,
                provider_message_id=provider_message_id,
            )

        summary = self._summary(vendor.name, signal, decision)
        self._record(event_id, vendor, signal, decision, incident_result, text, provider_message_id, summary)
        self._broadcast(event_id, vendor, signal, incident_result)
        return {
            "signal": signal.model_dump(),
            "assessment": decision.get("reason"),
            "linked_task_id": task.id if task else None,
            "incident": incident_result,
        }

    # -- helpers --------------------------------------------------------------
    def _linked_task(self, event_id: str, vendor_id: str) -> Optional[Task]:
        """The open task this vendor is assigned to (critical-path tasks first)."""
        done = (TaskStatus.COMPLETED.value, TaskStatus.CANCELLED.value)
        tasks: List[Task] = (
            self.db.query(Task)
            .filter(Task.event_id == event_id, Task.provider_id == vendor_id, Task.status.notin_(done))
            .all()
        )
        if not tasks:
            return None
        tasks.sort(key=lambda t: (not t.is_critical_path, t.planned_start is None, t.planned_start or 0))
        return tasks[0]

    def _decide(self, signal: VendorSignal, task: Optional[Task], committed: bool) -> Dict[str, Any]:
        if signal.outcome == "CANCELLED":
            if not committed and task is None:
                return {"raise_incident": False, "reason": "Vendor declined before any commitment; no event task depends on them."}
            critical = bool(task and task.is_critical_path)
            return {
                "raise_incident": True,
                "incident_type": IncidentType.VENDOR_CANCELLATION,
                "severity": IncidentSeverity.CRITICAL if critical else IncidentSeverity.HIGH,
                "reason": "Vendor cancelled a commitment" + (" on a critical-path task." if critical else "."),
            }
        if signal.outcome == "DELAY_REPORTED":
            if task is None:
                return {"raise_incident": False, "reason": "Delay reported, but no event task is linked to this vendor. Recorded as a warning."}
            if signal.delay_minutes is None:
                return {"raise_incident": False, "reason": "Delay reported without a duration. Recorded as a warning; ask the vendor for an ETA."}
            slack = task.slack_minutes
            if slack is not None and signal.delay_minutes <= slack:
                return {"raise_incident": False, "reason": f"Delay of {signal.delay_minutes} min fits within the task's {slack} min slack."}
            critical = bool(task.is_critical_path)
            return {
                "raise_incident": True,
                "incident_type": IncidentType.VENDOR_DELAY,
                "severity": IncidentSeverity.HIGH if critical else IncidentSeverity.MEDIUM,
                "reason": (
                    f"Delay of {signal.delay_minutes} min exceeds the task's {slack} min slack."
                    if slack is not None
                    else f"Delay of {signal.delay_minutes} min on a task with no computed slack."
                ),
            }
        if signal.outcome == "UNCLASSIFIED":
            return {"raise_incident": False, "reason": "Could not interpret the message. Needs human review."}
        return {"raise_incident": False, "reason": None}

    def _raise_or_correlate(self, *, event_id, vendor, task, incident_type, severity, text, signal, provider_message_id) -> Dict[str, Any]:
        from app.schemas.incident import IncidentCreate
        from app.services.incident_service import IncidentService

        evidence = {
            "source": "INBOUND_WHATSAPP",
            "message": text[:500],
            "provider_message_id": provider_message_id,
            "interpretation": signal.model_dump(),
        }
        existing = (
            self.db.query(Incident)
            .filter(
                Incident.event_id == event_id,
                Incident.related_vendor_id == vendor.id,
                Incident.incident_type == incident_type.value,
                Incident.status.in_(OPEN_INCIDENT_STATUSES),
            )
            .order_by(Incident.created_at.desc())
            .first()
        )
        service = IncidentService(self.db)
        if existing:
            meta = dict(existing.evidence_metadata or {})
            signals = list(meta.get("signals") or [])
            signals.append(evidence)
            meta["signals"] = signals[-20:]
            if signal.delay_minutes:
                # The impact engine reads the reported delay instead of a heuristic default.
                meta["delay_minutes"] = max(int(meta.get("delay_minutes") or 0), signal.delay_minutes)
            existing.evidence_metadata = meta
            if _SEVERITY_ORDER.index(severity.value) > _SEVERITY_ORDER.index(existing.severity or "LOW"):
                existing.severity = severity.value
            self.db.commit()
            service.recalculate_incident(event_id=event_id, incident_id=existing.id, current_user_id="system")
            return {"id": existing.id, "action": "UPDATED", "severity": existing.severity}

        label = "Cancellation" if incident_type == IncidentType.VENDOR_CANCELLATION else "Delay"
        incident = service.create_incident(
            event_id=event_id,
            data=IncidentCreate(
                incident_type=incident_type,
                severity=severity,
                title=f"Vendor {label}: {vendor.name}"[:255],
                description=f"{vendor.name} wrote on WhatsApp: \"{text[:300]}\"",
                source="INBOUND_WHATSAPP",
                related_vendor_id=vendor.id,
                related_task_id=task.id if task else None,
                evidence_metadata={"signals": [evidence], **({"delay_minutes": signal.delay_minutes} if signal.delay_minutes else {})},
            ),
            current_user_id="system",
        )
        return {"id": incident.id, "action": "CREATED", "severity": incident.severity}

    @staticmethod
    def _summary(vendor_name: str, signal: VendorSignal, decision: Dict[str, Any]) -> str:
        what = {
            "ARRIVED": "says they have arrived",
            "CANCELLED": "cancelled",
            "DECLINED": "is not available",
            "DELAY_REPORTED": f"reported a delay{f' of {signal.delay_minutes} min' if signal.delay_minutes else ''}",
            "ETA_UPDATED": f"expects to arrive in {signal.eta_minutes} min",
            "AVAILABILITY_CONFIRMED": "confirmed availability",
            "QUOTE_RECEIVED": f"quoted {signal.quoted_price:g}" if signal.quoted_price else "sent a quote",
            "NEEDS_INFO": "asked a question",
            "UNCLASSIFIED": "sent a message that needs review",
        }[signal.outcome]
        reason = decision.get("reason")
        return f"{vendor_name} {what}." + (f" {reason}" if reason else "")

    def _record(self, event_id, vendor, signal, decision, incident_result, text, provider_message_id, summary) -> None:
        try:
            from app.services.activity_log_service import ActivityLogService

            ActivityLogService(self.db).log(
                event_id=event_id,
                category="VENDOR",
                actor=vendor.name,
                action=f"VENDOR_SIGNAL_{signal.outcome}",
                summary=summary,
                ref_id=(incident_result or {}).get("id") or vendor.id,
                details={
                    "vendor_id": vendor.id,
                    "signal": signal.model_dump(),
                    "needs_review": not signal.certain,
                    "incident": incident_result,
                    "provider_message_id": provider_message_id,
                },
            )
        except Exception as exc:  # activity log must never block ingestion
            logger.warning("Could not log vendor signal: %s", exc)
        try:
            from app.observability.audit import AuditRecorder

            AuditRecorder(self.db).record(
                event_id=event_id,
                actor_id=vendor.id,
                actor_type="PROVIDER",
                action="VENDOR_SIGNAL_INTERPRETED",
                action_type="COMMUNICATION",
                target_type="VENDOR",
                target_id=vendor.id,
                after_state={
                    "text": text[:300],
                    "signal": signal.model_dump(),
                    "assessment": decision.get("reason"),
                    "incident": incident_result,
                    "method": "DETERMINISTIC_RULES",
                },
            )
        except Exception as exc:
            logger.warning("Could not audit vendor signal: %s", exc)

    @staticmethod
    def _broadcast(event_id, vendor, signal, incident_result) -> None:
        from app.services.live_broker import live_broker

        live_broker.publish_sync(event_id, {"type": "vendor.signal", "vendor_id": vendor.id, "outcome": signal.outcome})
        # Incident create/update frames are published by IncidentService itself.
