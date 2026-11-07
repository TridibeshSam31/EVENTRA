"""Event readiness gates (UX v3 §2, docs/contracts/ux-v3-api.md).

Answers the organizer's question "will my event happen?" as a short checklist of
deterministic gates computed from existing data. Read-only: no writes, no plan
generation, no outreach. Missing information is reported as such, never guessed.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Any, Dict, List, Optional, Set

from sqlalchemy.orm import Session

from app.models.agent_run import AgentRun
from app.models.approval import Approval
from app.models.budget import BudgetItem
from app.models.communication_attempt import CommunicationAttempt
from app.models.discovery_run import DiscoveryRun
from app.models.event import Event
from app.models.incident import Incident
from app.models.requirement import Requirement
from app.models.shortlist import EventShortlistEntry
from app.models.task import Task
from app.models.vendor_assignment import VendorAssignment

logger = logging.getLogger("eventra.readiness")

# ── Shared vocabulary ────────────────────────────────────────────────────────

LIVE_LIFECYCLES = {"LIVE", "INCIDENT", "EMERGENCY"}
DONE_LIFECYCLES = {"CONCLUDED", "CANCELLED"}
OPEN_INCIDENT_EXCLUDED = {"RESOLVED", "DISMISSED"}
SERIOUS_SEVERITIES = {"HIGH", "CRITICAL", "EMERGENCY"}
ACTIVE_AGENT_STATUSES = {"RUNNING", "INITIALIZED", "DISCOVERING", "CANCELLING"}
# Discovery runs are only treated as "running" if they changed recently; old rows stuck in
# RUNNING (e.g. from a crashed process) must not keep the organizer waiting forever.
DISCOVERY_STALE_AFTER = timedelta(minutes=15)

WHATSAPP_REPLIED = {"REPLIED"}
CALL_ANSWERED = {"COMPLETED"}
ATTEMPT_FAILED = {"FAILED", "UNAVAILABLE", "BUSY", "NO_ANSWER", "CANCELED", "NO_CONVERSATION"}

QUOTE_OPEN_NEGOTIATION = {
    "AVAILABLE",
    "QUOTATION_RECEIVED",
    "NEGOTIATING",
    "COUNTER_OFFER_SENT",
    "AWAITING_APPROVAL",
}

# Task, shortlist, assignment and vendor rows use different spellings for the same
# category. Collapse them to one key so gates can match them up.
_CATEGORY_ALIASES = {
    "DECORATION": "DECOR",
    "DECORATIONS": "DECOR",
    "MUSIC": "DJ_MUSIC",
    "DJ": "DJ_MUSIC",
    "DJ_AND_MUSIC": "DJ_MUSIC",
    "TRANSPORTATION": "TRANSPORT",
    "AUDIO_VISUAL": "AV",
    "AV_TECH": "AV",
    "PHOTO": "PHOTOGRAPHY",
    "VENUES": "VENUE",
}

_CATEGORY_LABELS = {
    "VENUE": "Venue",
    "CATERING": "Catering",
    "DECOR": "Décor",
    "DJ_MUSIC": "Music",
    "TRANSPORT": "Transport",
    "PHOTOGRAPHY": "Photography",
    "LIGHTING": "Lighting",
    "AV": "AV",
    "SECURITY": "Security",
    "INTERNET": "Internet",
    "STAGE": "Stage",
    "LOGISTICS": "Logistics",
    "EQUIPMENT": "Equipment",
}


def canonical_category(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    key = str(value).strip().upper().replace("-", "_").replace(" ", "_").replace("&", "AND")
    return _CATEGORY_ALIASES.get(key, key)


def category_label(value: Optional[str]) -> str:
    key = canonical_category(value)
    if not key:
        return "Other"
    return _CATEGORY_LABELS.get(key, key.replace("_", " ").capitalize())


def join_names(names: List[str], limit: int = 3) -> str:
    names = [n for n in names if n]
    if not names:
        return ""
    if len(names) <= limit:
        if len(names) == 1:
            return names[0]
        return ", ".join(names[:-1]) + " and " + names[-1]
    return ", ".join(names[:limit]) + f" and {len(names) - limit} more"


def format_money(amount: Optional[float], currency: Optional[str]) -> Optional[str]:
    if amount is None:
        return None
    cur = (currency or "INR").upper()
    symbol = {"INR": "₹", "USD": "$", "EUR": "€", "GBP": "£"}.get(cur)
    whole = int(round(float(amount)))
    if cur == "INR":
        s = str(abs(whole))
        if len(s) > 3:
            head, tail = s[:-3], s[-3:]
            groups = []
            while len(head) > 2:
                groups.insert(0, head[-2:])
                head = head[:-2]
            if head:
                groups.insert(0, head)
            s = ",".join(groups + [tail])
        text = s
    else:
        text = f"{abs(whole):,}"
    sign = "-" if whole < 0 else ""
    return f"{sign}{symbol}{text}" if symbol else f"{sign}{cur} {text}"


def _naive_utc_now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _to_naive_utc(value: Optional[datetime]) -> Optional[datetime]:
    if value is None:
        return None
    if value.tzinfo is not None:
        return value.astimezone(timezone.utc).replace(tzinfo=None)
    return value


# ── Snapshot of everything the gates & next step need (one set of queries) ────


@dataclass
class EventSnapshot:
    event: Event
    now: datetime
    tasks: List[Task] = field(default_factory=list)
    assignments: List[VendorAssignment] = field(default_factory=list)
    shortlist: List[EventShortlistEntry] = field(default_factory=list)
    approvals: List[Approval] = field(default_factory=list)
    attempts: List[CommunicationAttempt] = field(default_factory=list)
    incidents: List[Incident] = field(default_factory=list)
    budget_items: List[BudgetItem] = field(default_factory=list)
    venue_requirement: Optional[Requirement] = None
    active_agent_run: bool = False
    active_discovery_run: bool = False
    any_discovery_attempted: bool = False
    plan_readiness: Optional[str] = None  # READY | PARTIALLY_READY | BLOCKED | INCOMPLETE | None (unknown)
    plan_blocker_count: int = 0
    plan_warning_count: int = 0

    @property
    def lifecycle(self) -> str:
        return (self.event.lifecycle_state or "").upper()

    @property
    def open_incidents(self) -> List[Incident]:
        return [i for i in self.incidents if (i.status or "").upper() not in OPEN_INCIDENT_EXCLUDED]

    @property
    def pending_approvals(self) -> List[Approval]:
        return [a for a in self.approvals if (a.status or "").upper() == "PENDING"]

    @property
    def scheduled_tasks(self) -> List[Task]:
        return [t for t in self.tasks if t.planned_start and t.planned_end]

    def confirmed_categories(self) -> Set[str]:
        out: Set[str] = set()
        for a in self.assignments:
            if (a.status or "").upper() == "CONFIRMED" or (a.negotiation_status or "").upper() == "CONFIRMED":
                cat = canonical_category(a.category)
                if cat:
                    out.add(cat)
        return out

    def required_vendor_categories(self) -> List[str]:
        """Categories the plan needs a provider for, excluding the venue (its own gate)."""
        seen: List[str] = []
        for t in self.tasks:
            cat = canonical_category(t.required_provider_category)
            if cat and cat != "VENUE" and cat not in seen:
                seen.append(cat)
        return seen

    def venue_required(self) -> bool:
        if self.venue_requirement is not None:
            return True
        if any(canonical_category(t.required_provider_category) == "VENUE" for t in self.tasks):
            return True
        return any(canonical_category(e.category) == "VENUE" for e in self.shortlist)

    def attempts_by_entry(self) -> Dict[str, List[CommunicationAttempt]]:
        grouped: Dict[str, List[CommunicationAttempt]] = {}
        for a in self.attempts:
            key = a.shortlist_entry_id or a.vendor_id or a.id
            grouped.setdefault(key, []).append(a)
        return grouped


def _plan_status(db: Session, event_id: str) -> tuple[Optional[str], int, int]:
    """Readiness from the deterministic execution-plan compiler (read-only)."""
    try:
        from app.services.final_execution_plan_service import FinalExecutionPlanService

        plan = FinalExecutionPlanService(db).compile_plan(event_id=event_id, user_id=None)
        status = getattr(plan.readiness_status, "value", plan.readiness_status)
        return str(status).upper(), len(plan.blockers or []), len(plan.warnings or [])
    except Exception as exc:  # unknown is better than wrong
        logger.warning("Could not compile plan readiness for event %s: %s", event_id, exc)
        return None, 0, 0


def load_snapshot(db: Session, event: Event, now: Optional[datetime] = None) -> EventSnapshot:
    now = now or _naive_utc_now()
    eid = event.id
    snap = EventSnapshot(event=event, now=now)
    snap.tasks = db.query(Task).filter(Task.event_id == eid).all()
    snap.assignments = db.query(VendorAssignment).filter(VendorAssignment.event_id == eid).all()
    snap.shortlist = db.query(EventShortlistEntry).filter(EventShortlistEntry.event_id == eid).all()
    snap.approvals = db.query(Approval).filter(Approval.event_id == eid).all()
    snap.attempts = db.query(CommunicationAttempt).filter(CommunicationAttempt.event_id == eid).all()
    snap.incidents = db.query(Incident).filter(Incident.event_id == eid).all()
    snap.budget_items = db.query(BudgetItem).filter(BudgetItem.event_id == eid).all()
    snap.venue_requirement = (
        db.query(Requirement).filter(Requirement.event_id == eid, Requirement.type == "VENUE").first()
    )

    snap.active_agent_run = (
        db.query(AgentRun.id)
        .filter(AgentRun.event_id == eid, AgentRun.status.in_(list(ACTIVE_AGENT_STATUSES)))
        .first()
        is not None
    )
    stale_cutoff = now - DISCOVERY_STALE_AFTER
    snap.active_discovery_run = (
        db.query(DiscoveryRun.id)
        .filter(
            DiscoveryRun.event_id == eid,
            DiscoveryRun.status == "RUNNING",
            DiscoveryRun.updated_at >= stale_cutoff,
        )
        .first()
        is not None
    )
    snap.any_discovery_attempted = (
        snap.active_agent_run
        or db.query(DiscoveryRun.id).filter(DiscoveryRun.event_id == eid).first() is not None
        or db.query(AgentRun.id).filter(AgentRun.event_id == eid).first() is not None
    )

    if snap.tasks:
        snap.plan_readiness, snap.plan_blocker_count, snap.plan_warning_count = _plan_status(db, eid)
    else:
        snap.plan_readiness = "INCOMPLETE"
    return snap


# ── Gates ────────────────────────────────────────────────────────────────────


def _action(label: str, page: str, event_id: str) -> Dict[str, str]:
    return {"label": label, "page": page, "path": page_path(page, event_id)}


PAGE_PATHS = {
    "overview": "/events/{id}",
    "vendors": "/events/{id}/vendors",
    "venue": "/events/{id}/venue",
    "decisions": "/events/{id}/approvals",
    "plan": "/events/{id}/plan",
    "budget": "/events/{id}/budget",
    "conversations": "/events/{id}/conversations",
    "live": "/events/{id}/live",
    "problems": "/events/{id}/incidents",
    "setup": "/events/{id}/setup",
    "report": "/events/{id}/report",
}


def page_path(page: str, event_id: str) -> str:
    return PAGE_PATHS[page].format(id=event_id)


def gate_details(snap: EventSnapshot) -> Dict[str, Any]:
    e = snap.event
    missing = []
    if not e.start_datetime:
        missing.append("date")
    if not (e.location or "").strip():
        missing.append("city")
    if not e.guest_count or e.guest_count <= 0:
        missing.append("guest count")
    if not e.total_budget or Decimal(str(e.total_budget)) <= 0:
        missing.append("budget")
    total = 4
    if not missing:
        return {
            "id": "details",
            "label": "Event details complete",
            "status": "done",
            "detail": "Date, city, guest count and budget are set",
            "progress": {"done": total, "total": total},
            "action": None,
        }
    return {
        "id": "details",
        "label": "Event details complete",
        "status": "in_progress",
        "detail": "Still missing: " + join_names(missing, limit=4),
        "progress": {"done": total - len(missing), "total": total},
        "action": _action("Add missing details", "setup", e.id),
    }


def gate_plan(snap: EventSnapshot) -> Dict[str, Any]:
    eid = snap.event.id
    base = {"id": "plan", "label": "Plan ready", "progress": None}
    if not snap.tasks:
        return {**base, "status": "not_started", "detail": "No plan yet", "action": _action("Create the plan", "plan", eid)}
    r = snap.plan_readiness
    if r == "READY":
        return {**base, "status": "done", "detail": f"{len(snap.tasks)} tasks, nothing blocking", "action": None}
    if r == "BLOCKED":
        n = snap.plan_blocker_count
        return {
            **base,
            "status": "blocked",
            "detail": f"{n} thing{'s' if n != 1 else ''} blocking the plan",
            "action": _action("Fix what's blocking", "plan", eid),
        }
    if r == "PARTIALLY_READY":
        n = snap.plan_warning_count
        detail = f"{len(snap.tasks)} tasks; {n} warning{'s' if n != 1 else ''} to review" if n else f"{len(snap.tasks)} tasks; some still need a vendor"
        return {**base, "status": "in_progress", "detail": detail, "action": _action("Review the plan", "plan", eid)}
    if r == "INCOMPLETE":
        return {**base, "status": "not_started", "detail": "The plan has no tasks yet", "action": _action("Create the plan", "plan", eid)}
    return {**base, "status": "in_progress", "detail": "Plan status couldn't be checked right now", "action": _action("Open the plan", "plan", eid)}


def gate_venue(snap: EventSnapshot) -> Dict[str, Any]:
    eid = snap.event.id
    base = {"id": "venue", "label": "Venue confirmed", "progress": None}
    req = snap.venue_requirement
    if req is not None and isinstance(req.value, dict) and req.value.get("venue_id"):
        name = req.value.get("venue_name") or "Venue"
        return {**base, "status": "done", "detail": f"{name} is locked in", "action": None}
    for a in snap.assignments:
        if canonical_category(a.category) == "VENUE" and (
            (a.status or "").upper() == "CONFIRMED" or (a.negotiation_status or "").upper() == "CONFIRMED"
        ):
            return {**base, "status": "done", "detail": "Venue booking confirmed", "action": None}
    if not snap.venue_required():
        return {**base, "status": "not_applicable", "detail": "This plan doesn't need a venue booking", "action": None}
    venue_entries = [e for e in snap.shortlist if canonical_category(e.category) == "VENUE"]
    picked = [e for e in venue_entries if (e.status or "").upper() == "SELECTED"]
    if picked:
        return {
            **base,
            "status": "in_progress",
            "detail": f"You picked {picked[0].candidate_name or 'a venue'}; not confirmed yet",
            "action": _action("Confirm the venue", "venue", eid),
        }
    if venue_entries:
        n = len(venue_entries)
        return {
            **base,
            "status": "in_progress",
            "detail": f"{n} venue option{'s' if n != 1 else ''} to choose from",
            "action": _action("Choose a venue", "venue", eid),
        }
    return {**base, "status": "not_started", "detail": "No venue chosen yet", "action": _action("Find a venue", "venue", eid)}


def gate_vendors(snap: EventSnapshot) -> Dict[str, Any]:
    eid = snap.event.id
    base = {"id": "vendors", "label": "Vendors booked"}
    required = snap.required_vendor_categories()
    if not required:
        if not snap.tasks:
            return {**base, "status": "not_started", "detail": "Vendors are worked out once the plan exists", "progress": None, "action": None}
        return {**base, "status": "not_applicable", "detail": "This plan doesn't need outside vendors", "progress": None, "action": None}
    confirmed = snap.confirmed_categories()
    booked = [c for c in required if c in confirmed]
    total = len(required)
    progress = {"done": len(booked), "total": total}
    if len(booked) == total:
        return {**base, "status": "done", "detail": f"All {total} categories booked", "progress": progress, "action": None}
    detail = f"{len(booked)} of {total} categories booked"
    if booked:
        detail += f" ({join_names([category_label(c) for c in booked])})"
    any_activity = bool(booked) or any(
        canonical_category(e.category) in required for e in snap.shortlist
    )
    return {
        **base,
        "status": "in_progress" if any_activity else "not_started",
        "detail": detail,
        "progress": progress,
        "action": _action("Book remaining vendors", "vendors", eid),
    }


def gate_schedule(snap: EventSnapshot) -> Dict[str, Any]:
    eid = snap.event.id
    base = {"id": "schedule", "label": "Schedule works", "progress": None}
    if not snap.tasks:
        return {**base, "status": "not_started", "detail": "Needs a plan first", "action": None}
    scheduled = snap.scheduled_tasks
    if not scheduled:
        return {**base, "status": "not_started", "detail": "Times haven't been worked out yet", "action": _action("Work out the schedule", "plan", eid)}
    e = snap.event
    project_end = max(t.planned_end for t in scheduled)
    if e.end_datetime and project_end > e.end_datetime:
        over = int((project_end - e.end_datetime).total_seconds() // 60)
        return {
            **base,
            "status": "blocked",
            "detail": f"Runs {over} min past the event's end time",
            "action": _action("Adjust the schedule", "plan", eid),
        }
    if len(scheduled) < len(snap.tasks):
        missing = len(snap.tasks) - len(scheduled)
        return {
            **base,
            "status": "in_progress",
            "detail": f"{missing} task{'s' if missing != 1 else ''} not scheduled yet",
            "action": _action("Work out the schedule", "plan", eid),
        }
    detail = "Everything fits in the event window" if e.end_datetime else "All tasks have times"
    return {**base, "status": "done", "detail": detail, "action": None}


def gate_budget(snap: EventSnapshot) -> Dict[str, Any]:
    eid = snap.event.id
    e = snap.event
    base = {"id": "budget", "label": "Within budget", "progress": None}
    total = Decimal(str(e.total_budget or 0))
    if total <= 0:
        return {**base, "status": "not_started", "detail": "No budget set", "action": _action("Set a budget", "setup", eid)}
    if not snap.budget_items:
        return {**base, "status": "in_progress", "detail": "No costs estimated yet", "action": _action("Open the budget", "budget", eid)}
    try:
        from app.engines.budget.validator import BudgetValidator

        violations = BudgetValidator().validate_budget(total, snap.budget_items)
    except Exception as exc:
        logger.warning("Budget validation failed for event %s: %s", eid, exc)
        return {**base, "status": "in_progress", "detail": "Budget couldn't be checked right now", "action": _action("Open the budget", "budget", eid)}
    if violations:
        first = violations[0]
        desc = getattr(first, "description", None) or "Costs exceed the budget"
        more = f" (+{len(violations) - 1} more)" if len(violations) > 1 else ""
        return {**base, "status": "blocked", "detail": f"{desc}{more}", "action": _action("Review the budget", "budget", eid)}
    return {
        **base,
        "status": "done",
        "detail": f"Estimated costs fit within {format_money(float(total), e.currency)}",
        "action": None,
    }


def gate_problems(snap: EventSnapshot) -> Dict[str, Any]:
    eid = snap.event.id
    base = {"id": "problems", "label": "No open problems", "progress": None}
    open_ = snap.open_incidents
    if not open_:
        return {**base, "status": "done", "detail": "Nothing needs fixing", "action": None}
    serious = [i for i in open_ if (i.severity or "").upper() in SERIOUS_SEVERITIES]
    n = len(open_)
    if serious:
        return {
            **base,
            "status": "blocked",
            "detail": f"{len(serious)} serious problem{'s' if len(serious) != 1 else ''}: {serious[0].title}",
            "action": _action("Fix it now", "problems", eid),
        }
    return {
        **base,
        "status": "in_progress",
        "detail": f"{n} minor problem{'s' if n != 1 else ''} open",
        "action": _action("Review problems", "problems", eid),
    }


GATE_ORDER = ("details", "plan", "venue", "vendors", "schedule", "budget", "problems")


def compute_gates(snap: EventSnapshot) -> List[Dict[str, Any]]:
    return [
        gate_details(snap),
        gate_plan(snap),
        gate_venue(snap),
        gate_vendors(snap),
        gate_schedule(snap),
        gate_budget(snap),
        gate_problems(snap),
    ]


def days_until(snap: EventSnapshot) -> Optional[int]:
    start = _to_naive_utc(snap.event.start_datetime)
    if not start:
        return None
    return (start.date() - snap.now.date()).days


def overall_status(snap: EventSnapshot, gates: List[Dict[str, Any]]) -> str:
    if snap.lifecycle in DONE_LIFECYCLES:
        return "DONE"
    if snap.lifecycle in LIVE_LIFECYCLES:
        return "LIVE"
    applicable = [g for g in gates if g["status"] != "not_applicable"]
    if any(g["status"] == "blocked" for g in applicable):
        return "BLOCKED"
    if applicable and all(g["status"] == "done" for g in applicable):
        return "READY"
    # "Started" means real planning/booking work exists — not just details, a budget or no problems.
    started = any(
        g["status"] in ("done", "in_progress") for g in applicable if g["id"] in ("plan", "venue", "vendors", "schedule")
    )
    if not started:
        return "NOT_STARTED"
    d = days_until(snap)
    if d is not None and d <= 7:
        return "AT_RISK"
    return "IN_PROGRESS"


def gate_progress(gates: List[Dict[str, Any]]) -> Dict[str, int]:
    applicable = [g for g in gates if g["status"] != "not_applicable"]
    return {"done": sum(1 for g in applicable if g["status"] == "done"), "total": len(applicable)}


class ReadinessService:
    def __init__(self, db: Session):
        self.db = db

    def build(self, event: Event, snapshot: Optional[EventSnapshot] = None) -> Dict[str, Any]:
        snap = snapshot or load_snapshot(self.db, event)
        gates = compute_gates(snap)
        return {
            "event_id": event.id,
            "status": overall_status(snap, gates),
            "days_until_event": days_until(snap),
            "gates": gates,
        }
