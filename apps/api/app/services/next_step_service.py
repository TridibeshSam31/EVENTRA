"""The single next thing the organizer should do (UX v3 §3, docs/contracts/ux-v3-api.md).

Deterministic priority order (first match wins):
  event concluded/cancelled → event_done
  open serious problem      → resolve_problem
  approvals waiting         → approve_requests
  options waiting for picks → pick_vendors
  discovery in progress     → discovery_running
  key details missing       → complete_details   (only before any discovery exists)
  nothing discovered yet    → start_discovery
  contacted, no reply yet   → awaiting_replies
  quotes to review          → review_quotes
  plan blocked / no plan    → fix_plan_blockers
  schedule not worked out   → compute_schedule
  event live                → run_event
  otherwise                 → go_live

`event_done` is checked first (not last) so a finished event never nags about
leftover requests. Read-only; copy is plain organizer language.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

from app.models.event import Event
from app.services.readiness_service import (
    ATTEMPT_FAILED,
    CALL_ANSWERED,
    DONE_LIFECYCLES,
    LIVE_LIFECYCLES,
    QUOTE_OPEN_NEGOTIATION,
    SERIOUS_SEVERITIES,
    WHATSAPP_REPLIED,
    EventSnapshot,
    canonical_category,
    category_label,
    compute_gates,
    format_money,
    gate_progress,
    join_names,
    load_snapshot,
    page_path,
)

STAGE_BY_STEP = {
    "complete_details": "DEFINE",
    "start_discovery": "DISCOVER",
    "discovery_running": "DISCOVER",
    "pick_vendors": "DISCOVER",
    "approve_requests": "CONTACT",
    "awaiting_replies": "CONTACT",
    "review_quotes": "DECIDE",
    "fix_plan_blockers": "PLAN",
    "compute_schedule": "PLAN",
    "go_live": "READY",
    "run_event": "LIVE",
    "resolve_problem": "RECOVER",
    "event_done": "DONE",
}


def _plural(n: int, word: str, plural: Optional[str] = None) -> str:
    return f"{n} {word if n == 1 else (plural or word + 's')}"


def _vendor_name_for_approval(snap: EventSnapshot, approval) -> Optional[str]:
    ra = approval.requested_action or {}
    if isinstance(ra, dict):
        for key in ("candidate_name", "vendor_name", "provider_name", "name"):
            if ra.get(key):
                return str(ra[key])
    return None


# ── Facts derived from the snapshot ──────────────────────────────────────────


def _categories_needing_picks(snap: EventSnapshot) -> List[str]:
    """Categories where EVENTRA recommended options but nothing has been picked."""
    by_cat: Dict[str, Dict[str, int]] = {}
    for e in snap.shortlist:
        cat = canonical_category(e.category)
        if not cat:
            continue
        counts = by_cat.setdefault(cat, {"recommended": 0, "selected": 0})
        st = (e.status or "").upper()
        if st == "SELECTED":
            counts["selected"] += 1
        elif st in ("RECOMMENDED", "SHORTLISTED"):
            counts["recommended"] += 1
    confirmed = snap.confirmed_categories()
    return [
        c for c, n in by_cat.items()
        if n["recommended"] > 0 and n["selected"] == 0 and c not in confirmed
    ]


def _vendors_awaiting_reply(snap: EventSnapshot) -> Dict[str, List[str]]:
    """Picked vendors we contacted that haven't replied: {'waiting': [...], 'failed': [...]}."""
    entries = {e.id: e for e in snap.shortlist}
    waiting: List[str] = []
    failed: List[str] = []
    for key, attempts in snap.attempts_by_entry().items():
        real = [a for a in attempts if (a.status or "").upper() != "NOT_ATTEMPTED"]
        if not real:
            continue
        replied = any(
            ((a.channel or "").upper() == "WHATSAPP" and (a.status or "").upper() in WHATSAPP_REPLIED)
            or ((a.channel or "").upper() == "CALL" and (a.status or "").upper() in CALL_ANSWERED)
            for a in real
        )
        if replied:
            continue
        entry = entries.get(key)
        name = (entry.candidate_name if entry else None) or next((a.contact_name for a in real if a.contact_name), None) or "A vendor"
        if all((a.status or "").upper() in ATTEMPT_FAILED for a in real):
            failed.append(name)
        else:
            waiting.append(name)
    return {"waiting": waiting, "failed": failed}


def _open_quotes(snap: EventSnapshot):
    out = []
    for a in snap.assignments:
        if a.quoted_amount is None:
            continue
        if (a.status or "").upper() in ("CONFIRMED", "CANCELLED"):
            continue
        neg = (a.negotiation_status or "").upper()
        if neg in QUOTE_OPEN_NEGOTIATION:
            out.append(a)
    return out


def _completed_steps(snap: EventSnapshot, gates_by_id: Dict[str, Dict[str, Any]]) -> List[str]:
    steps = ["create_event"]
    if gates_by_id["details"]["status"] == "done":
        steps.append("details_complete")
    if snap.shortlist:
        steps.append("vendors_found")
    if any((e.status or "").upper() == "SELECTED" for e in snap.shortlist):
        steps.append("vendors_picked")
    if any((a.status or "").upper() not in ("NOT_ATTEMPTED",) for a in snap.attempts):
        steps.append("vendors_contacted")
    if any(
        ((a.channel or "").upper() == "WHATSAPP" and (a.status or "").upper() in WHATSAPP_REPLIED)
        or ((a.channel or "").upper() == "CALL" and (a.status or "").upper() in CALL_ANSWERED)
        for a in snap.attempts
    ):
        steps.append("replies_received")
    if any(a.quoted_amount is not None for a in snap.assignments):
        steps.append("quotes_received")
    if snap.confirmed_categories():
        steps.append("vendors_booked")
    if snap.plan_readiness == "READY":
        steps.append("plan_ready")
    if gates_by_id["schedule"]["status"] == "done":
        steps.append("schedule_ready")
    if snap.lifecycle in LIVE_LIFECYCLES or snap.lifecycle == "CONCLUDED":
        steps.append("went_live")
    if snap.lifecycle == "CONCLUDED":
        steps.append("event_done")
    return steps


def _unlocked_pages(snap: EventSnapshot) -> List[str]:
    pages = ["overview", "setup", "vendors", "venue", "plan"]
    if snap.approvals:
        pages.append("decisions")
    if any((a.status or "").upper() != "NOT_ATTEMPTED" for a in snap.attempts) or snap.attempts:
        pages.append("conversations")
    if snap.tasks or snap.budget_items:
        pages.append("budget")
    if snap.confirmed_categories() or snap.lifecycle in LIVE_LIFECYCLES or snap.lifecycle == "CONCLUDED":
        pages.append("live")
    if snap.incidents:
        pages.append("problems")
    if snap.lifecycle in DONE_LIFECYCLES:
        pages.append("report")
    return pages


# ── Step selection ───────────────────────────────────────────────────────────


def _step(step_id: str, *, urgency: str, title: str, body: str, cta: str, page: str, count: Optional[int], event_id: str) -> Dict[str, Any]:
    return {
        "step_id": step_id,
        "stage": STAGE_BY_STEP[step_id],
        "urgency": urgency,
        "title": title,
        "body": body,
        "cta_label": cta,
        "page": page,
        "path": page_path(page, event_id),
        "count": count,
    }


def choose_step(snap: EventSnapshot, gates_by_id: Dict[str, Dict[str, Any]]) -> Dict[str, Any]:
    e = snap.event
    eid = e.id

    # 0. Finished
    if snap.lifecycle in DONE_LIFECYCLES:
        if snap.lifecycle == "CANCELLED":
            return _step("event_done", urgency="normal", title="This event was cancelled",
                         body="Nothing else needs doing. You can still look back at what happened.",
                         cta="See the summary", page="report", count=None, event_id=eid)
        return _step("event_done", urgency="normal", title="Your event is wrapped up",
                     body="See how it went: money spent, vendors used and any problems along the way.",
                     cta="See the event summary", page="report", count=None, event_id=eid)

    # 1. Serious open problem
    serious = [i for i in snap.open_incidents if (i.severity or "").upper() in SERIOUS_SEVERITIES]
    if serious:
        top = serious[0]
        others = len(serious) - 1
        body = (top.description or "This needs a decision before it affects the rest of the event.").strip()
        if len(body) > 220:
            body = body[:217].rstrip() + "…"
        if others:
            body += f" ({_plural(others, 'other serious problem')} also open.)"
        return _step("resolve_problem", urgency="critical", title=top.title or "A problem needs your attention",
                     body=body, cta="Fix this now", page="problems", count=len(serious), event_id=eid)

    # 2. Approvals waiting
    pending = snap.pending_approvals
    if pending:
        n = len(pending)
        names = [nm for nm in (_vendor_name_for_approval(snap, a) for a in pending) if nm]
        all_outreach = all((a.action_type or "").upper() == "COMMUNICATION_OUTREACH" for a in pending)
        if all_outreach:
            title = f"{_plural(n, 'vendor')} {'is' if n == 1 else 'are'} waiting for your OK"
            body = "EVENTRA won't message or call anyone until you approve."
            if names:
                body = f"Approve contacting {join_names(names)}. " + body
        else:
            title = f"{_plural(n, 'decision')} {'needs' if n == 1 else 'need'} your OK"
            body = "Nothing happens until you approve."
            if names:
                body = f"Involves {join_names(names)}. " + body
        return _step("approve_requests", urgency="attention", title=title, body=body,
                     cta="Review and approve", page="decisions", count=n, event_id=eid)

    # 3. Options waiting for a pick
    need_picks = _categories_needing_picks(snap)
    if need_picks:
        n = len(need_picks)
        labels = [category_label(c) for c in need_picks]
        return _step("pick_vendors", urgency="attention",
                     title=f"Pick your vendors for {join_names(labels)}",
                     body=f"EVENTRA found options in {_plural(n, 'category', 'categories')}. "
                          "Pick the ones you like and we'll ask them for availability and a price.",
                     cta="Compare and pick", page="overview", count=n, event_id=eid)

    # 4. Discovery in progress
    if snap.active_agent_run or snap.active_discovery_run:
        return _step("discovery_running", urgency="normal", title="EVENTRA is finding vendors",
                     body="We're searching for venues and suppliers that fit your event. "
                          "You can leave this page — options will be waiting for you.",
                     cta="Watch the progress", page="overview", count=None, event_id=eid)

    # 5./6. Nothing discovered yet
    if not snap.shortlist and not snap.assignments and not snap.any_discovery_attempted:
        details = gates_by_id["details"]
        if details["status"] != "done":
            return _step("complete_details", urgency="normal", title="Finish your event details",
                         body=f"{details['detail']}. EVENTRA needs these to find the right vendors.",
                         cta="Add the details", page="setup", count=None, event_id=eid)
        where = (e.location or "").strip()
        guests = e.guest_count
        budget = format_money(float(e.total_budget), e.currency) if e.total_budget else None
        fit = [p for p in (f"{guests:,} guests" if guests else None, budget) if p]
        body = "We'll search venues and suppliers"
        if where:
            body += f" near {where}"
        if fit:
            body += f" that fit {join_names(fit)}"
        body += "."
        return _step("start_discovery", urgency="normal", title="Let EVENTRA find your vendors",
                     body=body, cta="Start finding vendors", page="overview", count=None, event_id=eid)

    # 7. Waiting on vendor replies
    replies = _vendors_awaiting_reply(snap)
    if replies["failed"] or replies["waiting"]:
        failed, waiting = replies["failed"], replies["waiting"]
        if failed:
            title = f"Couldn't reach {join_names(failed)}"
            body = "The message or call didn't go through. Try again, or contact them another way."
            if waiting:
                body += f" Still waiting to hear from {join_names(waiting)}."
            return _step("awaiting_replies", urgency="attention", title=title, body=body,
                         cta="See what happened", page="conversations", count=len(failed) + len(waiting), event_id=eid)
        n = len(waiting)
        return _step("awaiting_replies", urgency="normal",
                     title=f"Waiting to hear back from {_plural(n, 'vendor')}",
                     body=f"EVENTRA contacted {join_names(waiting)}. Replies and prices will appear here as they come in.",
                     cta="Check messages", page="conversations", count=n, event_id=eid)

    # 8. Quotes to review
    quotes = _open_quotes(snap)
    if quotes:
        n = len(quotes)
        cats = sorted({category_label(q.category) for q in quotes})
        lowest = min(q.quoted_amount for q in quotes if q.quoted_amount is not None)
        body = f"Prices are in for {join_names(cats)}."
        lowest_text = format_money(lowest, quotes[0].currency)
        if lowest_text and n > 1:
            body += f" The lowest is {lowest_text}."
        body += " Compare them and choose who to book."
        return _step("review_quotes", urgency="attention", title=f"{_plural(n, 'quote')} to review",
                     body=body, cta="Compare quotes", page="vendors", count=n, event_id=eid)

    # 9. Plan blocked or missing
    if not snap.tasks:
        return _step("fix_plan_blockers", urgency="normal", title="Create your event plan",
                     body="EVENTRA turns your event into tasks, timings and a budget so nothing gets missed.",
                     cta="Open the plan", page="plan", count=None, event_id=eid)
    if snap.plan_readiness == "BLOCKED":
        n = snap.plan_blocker_count
        return _step("fix_plan_blockers", urgency="attention",
                     title=f"{_plural(n, 'thing')} {'is' if n == 1 else 'are'} holding the plan back",
                     body="Usually a task that still needs a vendor. Each one has a button to fix it.",
                     cta="Fix the plan", page="plan", count=n, event_id=eid)

    # 10. Schedule not worked out
    if gates_by_id["schedule"]["status"] in ("not_started", "blocked"):
        blocked = gates_by_id["schedule"]["status"] == "blocked"
        return _step("compute_schedule", urgency="attention" if blocked else "normal",
                     title="Fix the schedule" if blocked else "Work out the schedule",
                     body=gates_by_id["schedule"]["detail"] + ". " +
                          ("Move or shorten tasks so the event finishes on time." if blocked
                           else "EVENTRA will set times for every task and show what can't slip."),
                     cta="Open the schedule", page="plan", count=None, event_id=eid)

    # 11. Live
    if snap.lifecycle in LIVE_LIFECYCLES:
        return _step("run_event", urgency="normal", title="Your event is live",
                     body="Follow the schedule, vendor arrivals and anything that needs a quick decision.",
                     cta="Open the live view", page="live", count=None, event_id=eid)

    # 12. Ready to go live
    remaining = [g for g in gates_by_id.values() if g["status"] not in ("done", "not_applicable") and g["id"] != "problems"]
    if remaining:
        body = "Still open: " + join_names([g["label"].lower() for g in remaining], limit=4) + ". You can go live once you're happy."
    else:
        body = "Everything is in place. Switch to the live view on the day to follow the event as it happens."
    return _step("go_live", urgency="normal", title="Get ready for the day", body=body,
                 cta="Open the live view", page="live", count=None, event_id=eid)


class NextStepService:
    def __init__(self, db: Session):
        self.db = db

    def build(self, event: Event, snapshot: Optional[EventSnapshot] = None) -> Dict[str, Any]:
        snap = snapshot or load_snapshot(self.db, event)
        gates = compute_gates(snap)
        gates_by_id = {g["id"]: g for g in gates}
        step = choose_step(snap, gates_by_id)
        return {
            "event_id": event.id,
            **step,
            "completed_steps": _completed_steps(snap, gates_by_id),
            "unlocked_pages": _unlocked_pages(snap),
            "progress": gate_progress(gates),
        }
