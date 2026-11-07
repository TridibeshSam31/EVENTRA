"""No-reply follow-up sweeper (UX v3 §6).

Every few minutes, finds vendors we reached out to who have not replied within
``OUTREACH_NO_REPLY_HOURS`` and:

* alerts the organizers once per outreach (in-app notification + activity entry);
* only when ``OUTREACH_AUTO_FOLLOW_UP`` is true (default **false**), sends one
  polite WhatsApp follow-up. EVENTRA never messages vendors silently by default.

"Once" is tracked per outreach timestamp: if the organizer sends their own
follow-up, the clock restarts and a new alert can fire later.
"""
import asyncio
import logging
from collections import defaultdict
from datetime import datetime, timedelta
from typing import Dict, Optional

from sqlalchemy.orm import Session

from app.core.config import settings

logger = logging.getLogger("eventra.outreach_followup")

NOTIFIED_KEY = "no_reply_notified_for"
AUTO_FOLLOWUP_KEY = "auto_followup_sent_for"

AUTO_FOLLOWUP_TEXT = (
    "Hello again! Just following up on our earlier message about the event. "
    "Could you let us know your availability and an approximate quote when you get a moment? Thank you."
)


async def run_outreach_followup_loop() -> None:
    """Periodically flag outreach with no reply."""
    while True:
        try:
            await asyncio.to_thread(sweep_once)
        except Exception as exc:  # never crash the app
            logger.warning("Outreach follow-up sweep failed: %s", exc)
        await asyncio.sleep(settings.OUTREACH_FOLLOWUP_INTERVAL_SECONDS)


def sweep_once(db: Optional[Session] = None, now: Optional[datetime] = None) -> int:
    """Flag stale outreach. Returns the number of outreaches newly flagged."""
    owns_session = db is None
    if db is None:
        from app.db.session import SessionLocal

        db = SessionLocal()
    try:
        return _sweep(db, now)
    finally:
        if owns_session:
            db.close()


def _sweep(db: Session, now: Optional[datetime]) -> int:
    from app.models.communication_attempt import CommunicationAttempt
    from app.models.shortlist import EventShortlistEntry
    from app.services.vendor_outreach_service import (
        CALL,
        CALL_ATTEMPTED_NO_ANSWER,
        WHATSAPP,
        WHATSAPP_OUTBOUND_OK,
        reply_state,
        utc_now,
    )

    current = now or utc_now()
    cutoff = current - timedelta(hours=float(settings.OUTREACH_NO_REPLY_HOURS))
    candidates = (
        db.query(CommunicationAttempt.shortlist_entry_id)
        .filter(
            CommunicationAttempt.status.in_(list(WHATSAPP_OUTBOUND_OK | CALL_ATTEMPTED_NO_ANSWER | {"COMPLETED"})),
            CommunicationAttempt.last_attempt_at.isnot(None),
            CommunicationAttempt.last_attempt_at <= cutoff,
        )
        .all()
    )
    entry_ids = {row[0] for row in candidates}
    if not entry_ids:
        return 0

    by_entry: Dict[str, Dict[str, CommunicationAttempt]] = defaultdict(dict)
    for a in db.query(CommunicationAttempt).filter(CommunicationAttempt.shortlist_entry_id.in_(list(entry_ids))):
        by_entry[a.shortlist_entry_id][a.channel] = a

    flagged = 0
    for entry_id, attempts in by_entry.items():
        wa, call = attempts.get(WHATSAPP), attempts.get(CALL)
        state = reply_state(wa, call, now=current)
        if not state["no_reply"]:
            continue
        since = state["awaiting_reply_since"]
        if any((a.details or {}).get(NOTIFIED_KEY) == since for a in attempts.values()):
            continue

        entry = db.get(EventShortlistEntry, entry_id)
        if entry is None:
            continue
        _mark(db, wa or call, NOTIFIED_KEY, since)  # mark first: an alert must never repeat
        _alert_organizers(db, entry, since)
        flagged += 1

        if settings.OUTREACH_AUTO_FOLLOW_UP and wa is not None and (wa.details or {}).get(AUTO_FOLLOWUP_KEY) != since:
            _auto_follow_up(db, entry, wa, since)

    return flagged


def _mark(db: Session, attempt, key: str, value: str) -> None:
    details = dict(attempt.details or {})
    details[key] = value
    attempt.details = details  # reassign so the JSON column is flagged dirty
    db.commit()


def _hours_text() -> str:
    hours = float(settings.OUTREACH_NO_REPLY_HOURS)
    return f"{hours:g} hour" + ("" if hours == 1 else "s")


def _alert_organizers(db: Session, entry, since: str) -> None:
    name = entry.candidate_name or "A vendor"
    message = (
        f"{name} hasn't replied in {_hours_text()}. You can retry WhatsApp, try a call, "
        "or note that you reached them yourself."
    )
    from app.services.organizer_alerts import alert_organizers

    alert_organizers(
        db,
        entry.event_id,
        title=f"No reply from {name}",
        message=message,
        payload={
            "kind": "VENDOR_NO_REPLY",
            "candidate_id": entry.candidate_id,
            "shortlist_entry_id": entry.id,
            "category": entry.category,
            "awaiting_reply_since": since,
        },
    )
    try:
        from app.services.activity_log_service import ActivityLogService

        ActivityLogService(db).log(
            event_id=entry.event_id,
            category="COMMUNICATION",
            actor="system",
            action="VENDOR_NO_REPLY",
            summary=f"No reply from {name} after {_hours_text()}",
            ref_id=entry.candidate_id,
            details={"shortlist_entry_id": entry.id, "awaiting_reply_since": since},
        )
    except Exception as exc:
        logger.warning("Could not log no-reply activity: %s", exc)


def _auto_follow_up(db: Session, entry, wa, since: str) -> None:
    """Send one WhatsApp follow-up. Only reachable when OUTREACH_AUTO_FOLLOW_UP is enabled."""
    from app.models.event import Event
    from app.services.vendor_outreach_service import WHATSAPP_RANK, VendorOutreachService

    if not wa.provider_ref or WHATSAPP_RANK.get(wa.status, 0) < WHATSAPP_RANK["ACCEPTED"]:
        return
    event = db.get(Event, entry.event_id)
    if event is None:
        return
    # Mark first so a failing provider can never cause repeated sends.
    _mark(db, wa, AUTO_FOLLOWUP_KEY, since)
    try:
        VendorOutreachService(db).send_whatsapp_followup(event, entry, AUTO_FOLLOWUP_TEXT, actor_id="system")
    except Exception as exc:
        logger.warning("Automatic follow-up to %s failed: %s", entry.candidate_name, exc)
