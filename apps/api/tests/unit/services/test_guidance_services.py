"""Tests for UX v3 guidance: readiness gates, next step priority, event report."""
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest

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
from app.models.vendor import Vendor
from app.models.vendor_assignment import VendorAssignment
from app.services import readiness_service
from app.services.next_step_service import NextStepService
from app.services.readiness_service import (
    ReadinessService,
    canonical_category,
    format_money,
    load_snapshot,
)
from app.services.report_service import ReportService


def _now():
    return datetime.now(timezone.utc).replace(tzinfo=None)


@pytest.fixture(autouse=True)
def _plan_ready(monkeypatch):
    """Default: plan compiler reports READY; individual tests override."""
    monkeypatch.setattr(readiness_service, "_plan_status", lambda db, eid: ("READY", 0, 0))


def _set_plan(monkeypatch, status, blockers=0, warnings=0):
    monkeypatch.setattr(readiness_service, "_plan_status", lambda db, eid: (status, blockers, warnings))


def make_event(db, **kw):
    start = _now() + timedelta(days=30)
    defaults = dict(
        name="Spring Fest",
        event_type="COLLEGE_FEST",
        location="Delhi",
        guest_count=1000,
        total_budget=Decimal("500000"),
        currency="INR",
        start_datetime=start,
        end_datetime=start + timedelta(hours=12),
        lifecycle_state="PLANNED",
    )
    defaults.update(kw)
    ev = Event(**defaults)
    db.add(ev)
    db.commit()
    return ev


def add_task(db, ev, name="Catering setup", category="catering", scheduled=True, **kw):
    t = Task(event_id=ev.id, name=name, required_provider_category=category, duration_minutes=60, **kw)
    if scheduled:
        t.planned_start = ev.start_datetime
        t.planned_end = ev.start_datetime + timedelta(hours=1)
    db.add(t)
    db.commit()
    return t


def add_vendor(db, name="Royal Caterers", category="CATERING"):
    v = Vendor(name=name, category=category, city="Delhi")
    db.add(v)
    db.commit()
    return v


def add_entry(db, ev, name="Royal Caterers", category="CATERING", status="RECOMMENDED"):
    e = EventShortlistEntry(event_id=ev.id, candidate_id=f"c-{name}", candidate_name=name, category=category, status=status)
    db.add(e)
    db.commit()
    return e


def add_approval(db, ev, name="Royal Caterers", status="PENDING", action="COMMUNICATION_OUTREACH"):
    a = Approval(
        event_id=ev.id,
        requester_id="default-operator",
        action_type=action,
        target_type="CATERING",
        impact_level="MAJOR",
        requested_action={"candidate_name": name},
        status=status,
        state_snapshot="x",
    )
    db.add(a)
    db.commit()
    return a


def next_step(db, ev):
    return NextStepService(db).build(ev)


def gates(db, ev):
    return {g["id"]: g for g in ReadinessService(db).build(ev)["gates"]}


# ── helpers ──────────────────────────────────────────────────────────────────


def test_category_aliases_collapse():
    assert canonical_category("decoration") == "DECOR"
    assert canonical_category("music") == canonical_category("DJ_MUSIC")
    assert canonical_category("transportation") == canonical_category("transport")


def test_format_money_inr_grouping():
    assert format_money(500000, "INR") == "₹5,00,000"
    assert format_money(85000, "INR") == "₹85,000"
    assert format_money(None, "INR") is None


# ── next step: priority branches ─────────────────────────────────────────────


def test_event_done_wins_over_everything(db_session):
    ev = make_event(db_session, lifecycle_state="CONCLUDED")
    add_approval(db_session, ev)
    step = next_step(db_session, ev)
    assert step["step_id"] == "event_done"
    assert step["page"] == "report"
    assert "report" in step["unlocked_pages"]


def test_serious_problem_first(db_session):
    ev = make_event(db_session)
    add_approval(db_session, ev)
    db_session.add(Incident(event_id=ev.id, incident_type="VENDOR_CANCELLATION", severity="CRITICAL",
                            title="Caterer cancelled", status="OPEN"))
    db_session.commit()
    step = next_step(db_session, ev)
    assert step["step_id"] == "resolve_problem"
    assert step["urgency"] == "critical"
    assert step["title"] == "Caterer cancelled"
    assert step["path"].endswith("/incidents")
    assert "problems" in step["unlocked_pages"]


def test_minor_problem_does_not_take_over(db_session):
    ev = make_event(db_session)
    add_approval(db_session, ev)
    db_session.add(Incident(event_id=ev.id, incident_type="OTHER", severity="LOW", title="Small", status="OPEN"))
    db_session.commit()
    assert next_step(db_session, ev)["step_id"] == "approve_requests"


def test_approvals_waiting(db_session):
    ev = make_event(db_session)
    add_approval(db_session, ev, "Royal Caterers")
    add_approval(db_session, ev, "Bright Lights")
    add_approval(db_session, ev, "Old one", status="APPROVED")
    step = next_step(db_session, ev)
    assert step["step_id"] == "approve_requests"
    assert step["count"] == 2
    assert "2 vendors are waiting for your OK" == step["title"]
    assert "Royal Caterers" in step["body"] and "Bright Lights" in step["body"]
    assert step["path"].endswith("/approvals")
    assert "decisions" in step["unlocked_pages"]


def test_pick_vendors(db_session):
    ev = make_event(db_session)
    add_entry(db_session, ev, "Royal Caterers", "CATERING")
    add_entry(db_session, ev, "Picked Decor", "DECOR", status="SELECTED")
    add_entry(db_session, ev, "Other Decor", "DECOR")
    step = next_step(db_session, ev)
    assert step["step_id"] == "pick_vendors"
    assert step["count"] == 1  # décor already has a pick
    assert "Catering" in step["title"]


def test_discovery_running(db_session):
    ev = make_event(db_session)
    db_session.add(AgentRun(run_id="run-1", event_id=ev.id, status="DISCOVERING"))
    db_session.commit()
    assert next_step(db_session, ev)["step_id"] == "discovery_running"


def test_stale_discovery_run_is_ignored(db_session):
    ev = make_event(db_session)
    old = _now() - timedelta(hours=3)
    db_session.add(DiscoveryRun(event_id=ev.id, category="CATERING", status="RUNNING", created_at=old, updated_at=old))
    db_session.commit()
    step = next_step(db_session, ev)
    assert step["step_id"] != "discovery_running"


def test_complete_details_before_discovery(db_session):
    ev = make_event(db_session, location=None, guest_count=0)
    step = next_step(db_session, ev)
    assert step["step_id"] == "complete_details"
    assert "city" in step["body"] and "guest count" in step["body"]
    assert step["path"].endswith("/setup")


def test_start_discovery(db_session):
    ev = make_event(db_session)
    step = next_step(db_session, ev)
    assert step["step_id"] == "start_discovery"
    assert "Delhi" in step["body"] and "1,000 guests" in step["body"] and "₹5,00,000" in step["body"]
    assert step["stage"] == "DISCOVER"


def _contacted(db, ev, name, statuses):
    entry = add_entry(db, ev, name, "CATERING", status="SELECTED")
    for channel, status in statuses:
        db.add(CommunicationAttempt(event_id=ev.id, shortlist_entry_id=entry.id, channel=channel, status=status))
    db.commit()
    return entry


def test_awaiting_replies(db_session):
    ev = make_event(db_session)
    _contacted(db_session, ev, "Royal Caterers", [("WHATSAPP", "DELIVERED")])
    step = next_step(db_session, ev)
    assert step["step_id"] == "awaiting_replies"
    assert step["urgency"] == "normal"
    assert "Royal Caterers" in step["body"]
    assert "conversations" in step["unlocked_pages"]


def test_failed_contact_needs_attention(db_session):
    ev = make_event(db_session)
    _contacted(db_session, ev, "Royal Caterers", [("WHATSAPP", "FAILED"), ("CALL", "NO_ANSWER")])
    step = next_step(db_session, ev)
    assert step["step_id"] == "awaiting_replies"
    assert step["urgency"] == "attention"
    assert step["title"].startswith("Couldn't reach")


def test_replied_vendor_is_not_waiting(db_session):
    ev = make_event(db_session)
    add_task(db_session, ev)
    _contacted(db_session, ev, "Royal Caterers", [("WHATSAPP", "REPLIED")])
    assert next_step(db_session, ev)["step_id"] != "awaiting_replies"


def test_review_quotes(db_session):
    ev = make_event(db_session)
    add_task(db_session, ev)
    v1, v2 = add_vendor(db_session, "A"), add_vendor(db_session, "B")
    add_entry(db_session, ev, "A", "CATERING", status="SELECTED")
    for v, amt in ((v1, 90000.0), (v2, 85000.0)):
        db_session.add(VendorAssignment(event_id=ev.id, vendor_id=v.id, category="catering", status="REQUESTED",
                                        negotiation_status="QUOTATION_RECEIVED", quoted_amount=amt, currency="INR"))
    db_session.commit()
    step = next_step(db_session, ev)
    assert step["step_id"] == "review_quotes"
    assert step["count"] == 2
    assert "₹85,000" in step["body"]


def test_fix_plan_when_no_tasks(db_session):
    ev = make_event(db_session)
    v = add_vendor(db_session)
    db_session.add(VendorAssignment(event_id=ev.id, vendor_id=v.id, category="catering", status="CONFIRMED"))
    db_session.commit()
    step = next_step(db_session, ev)
    assert step["step_id"] == "fix_plan_blockers"
    assert step["title"] == "Create your event plan"


def test_fix_plan_blockers(db_session, monkeypatch):
    _set_plan(monkeypatch, "BLOCKED", blockers=3)
    ev = make_event(db_session)
    add_task(db_session, ev)
    add_entry(db_session, ev, "A", "CATERING", status="SELECTED")
    step = next_step(db_session, ev)
    assert step["step_id"] == "fix_plan_blockers"
    assert step["count"] == 3
    assert step["path"].endswith("/plan")


def test_compute_schedule(db_session):
    ev = make_event(db_session)
    add_task(db_session, ev, scheduled=False)
    add_entry(db_session, ev, "A", "CATERING", status="SELECTED")
    step = next_step(db_session, ev)
    assert step["step_id"] == "compute_schedule"


def test_run_event_when_live(db_session):
    ev = make_event(db_session, lifecycle_state="LIVE")
    add_task(db_session, ev)
    add_entry(db_session, ev, "A", "CATERING", status="SELECTED")
    step = next_step(db_session, ev)
    assert step["step_id"] == "run_event"
    assert "live" in step["unlocked_pages"]


def test_go_live_when_nothing_else(db_session):
    ev = make_event(db_session)
    add_task(db_session, ev)
    v = add_vendor(db_session)
    add_entry(db_session, ev, "Royal Caterers", "CATERING", status="SELECTED")
    db_session.add(VendorAssignment(event_id=ev.id, vendor_id=v.id, category="catering", status="CONFIRMED", agreed_cost=80000))
    db_session.commit()
    step = next_step(db_session, ev)
    assert step["step_id"] == "go_live"
    assert step["stage"] == "READY"
    assert "vendors_booked" in step["completed_steps"]
    assert "live" in step["unlocked_pages"]


def test_unlocked_pages_minimal(db_session):
    ev = make_event(db_session)
    pages = next_step(db_session, ev)["unlocked_pages"]
    assert pages == ["overview", "setup", "vendors", "venue", "plan"]


def test_next_step_is_side_effect_free(db_session):
    ev = make_event(db_session)
    add_approval(db_session, ev)
    before = db_session.query(Approval).count()
    next_step(db_session, ev)
    ReadinessService(db_session).build(ev)
    assert db_session.query(Approval).count() == before
    assert not db_session.new and not db_session.dirty


# ── readiness gates ──────────────────────────────────────────────────────────


def test_details_gate(db_session):
    assert gates(db_session, make_event(db_session))["details"]["status"] == "done"
    g = gates(db_session, make_event(db_session, total_budget=Decimal("0")))["details"]
    assert g["status"] == "in_progress" and "budget" in g["detail"] and g["action"]["page"] == "setup"


@pytest.mark.parametrize(
    "plan,expected",
    [("READY", "done"), ("PARTIALLY_READY", "in_progress"), ("BLOCKED", "blocked"), (None, "in_progress")],
)
def test_plan_gate(db_session, monkeypatch, plan, expected):
    _set_plan(monkeypatch, plan, blockers=2)
    ev = make_event(db_session)
    add_task(db_session, ev)
    assert gates(db_session, ev)["plan"]["status"] == expected


def test_plan_gate_without_tasks(db_session):
    assert gates(db_session, make_event(db_session))["plan"]["status"] == "not_started"


def test_venue_gate(db_session):
    ev = make_event(db_session)
    assert gates(db_session, ev)["venue"]["status"] == "not_applicable"

    add_task(db_session, ev, name="Venue walkthrough", category="venue")
    assert gates(db_session, ev)["venue"]["status"] == "not_started"

    add_entry(db_session, ev, "Grand Hall", "VENUE")
    assert gates(db_session, ev)["venue"]["status"] == "in_progress"

    db_session.add(Requirement(event_id=ev.id, type="VENUE", name="Venue", value={"venue_id": "v1", "venue_name": "Grand Hall"}))
    db_session.commit()
    g = gates(db_session, ev)["venue"]
    assert g["status"] == "done" and "Grand Hall" in g["detail"]


def test_vendors_gate_matches_category_spellings(db_session):
    ev = make_event(db_session)
    add_task(db_session, ev, name="Decor", category="decoration")
    add_task(db_session, ev, name="Music", category="music")
    add_task(db_session, ev, name="Venue", category="venue")  # excluded: own gate
    v = add_vendor(db_session, "Decor Co", "DECOR")
    db_session.add(VendorAssignment(event_id=ev.id, vendor_id=v.id, category="decor", status="CONFIRMED"))
    db_session.commit()
    g = gates(db_session, ev)["vendors"]
    assert g["progress"] == {"done": 1, "total": 2}
    assert g["status"] == "in_progress" and "Décor" in g["detail"]


def test_vendors_gate_not_applicable_and_done(db_session):
    ev = make_event(db_session)
    add_task(db_session, ev, name="Briefing", category=None)
    assert gates(db_session, ev)["vendors"]["status"] == "not_applicable"
    add_task(db_session, ev, name="Food", category="catering")
    v = add_vendor(db_session)
    db_session.add(VendorAssignment(event_id=ev.id, vendor_id=v.id, category="catering", negotiation_status="CONFIRMED"))
    db_session.commit()
    assert gates(db_session, ev)["vendors"]["status"] == "done"


def test_schedule_gate(db_session):
    ev = make_event(db_session)
    t = add_task(db_session, ev, scheduled=False)
    assert gates(db_session, ev)["schedule"]["status"] == "not_started"
    t.planned_start = ev.start_datetime
    t.planned_end = ev.end_datetime + timedelta(hours=2)
    db_session.commit()
    g = gates(db_session, ev)["schedule"]
    assert g["status"] == "blocked" and "past" in g["detail"]
    t.planned_end = ev.start_datetime + timedelta(hours=1)
    db_session.commit()
    assert gates(db_session, ev)["schedule"]["status"] == "done"


def test_budget_gate(db_session):
    ev = make_event(db_session, total_budget=Decimal("0"))
    assert gates(db_session, ev)["budget"]["status"] == "not_started"
    ev2 = make_event(db_session, total_budget=Decimal("100000"))
    assert gates(db_session, ev2)["budget"]["status"] == "in_progress"
    db_session.add(BudgetItem(event_id=ev2.id, name="Food", category="CATERING", estimated_amount=Decimal("50000")))
    db_session.commit()
    assert gates(db_session, ev2)["budget"]["status"] == "done"
    db_session.add(BudgetItem(event_id=ev2.id, name="Hall", category="VENUE", estimated_amount=Decimal("90000")))
    db_session.commit()
    assert gates(db_session, ev2)["budget"]["status"] == "blocked"


def test_problems_gate(db_session):
    ev = make_event(db_session)
    assert gates(db_session, ev)["problems"]["status"] == "done"
    db_session.add(Incident(event_id=ev.id, incident_type="OTHER", severity="LOW", title="Small", status="OPEN"))
    db_session.commit()
    assert gates(db_session, ev)["problems"]["status"] == "in_progress"
    db_session.add(Incident(event_id=ev.id, incident_type="VENUE_ISSUE", severity="HIGH", title="Hall flooded", status="ACKNOWLEDGED"))
    db_session.commit()
    g = gates(db_session, ev)["problems"]
    assert g["status"] == "blocked" and "Hall flooded" in g["detail"]


def test_overall_status(db_session):
    assert ReadinessService(db_session).build(make_event(db_session))["status"] == "NOT_STARTED"
    assert ReadinessService(db_session).build(make_event(db_session, lifecycle_state="LIVE"))["status"] == "LIVE"
    assert ReadinessService(db_session).build(make_event(db_session, lifecycle_state="CONCLUDED"))["status"] == "DONE"
    res = ReadinessService(db_session).build(make_event(db_session))
    assert res["days_until_event"] == 30


# ── report ───────────────────────────────────────────────────────────────────


def test_report_aggregates(db_session):
    ev = make_event(db_session, lifecycle_state="CONCLUDED")
    v = add_vendor(db_session, "Royal Caterers")
    db_session.add(VendorAssignment(event_id=ev.id, vendor_id=v.id, category="catering", status="CONFIRMED", agreed_cost=80000))
    db_session.add(BudgetItem(event_id=ev.id, name="Food", category="CATERING", estimated_amount=Decimal("90000")))
    db_session.add(Incident(event_id=ev.id, incident_type="VENDOR_DELAY", severity="HIGH", title="Late", status="RESOLVED",
                            resolution_notes="Backup arrived"))
    add_approval(db_session, ev, status="APPROVED")
    t = add_task(db_session, ev, status="COMPLETED")
    t.actual_end = t.planned_end - timedelta(minutes=5)
    db_session.commit()

    r = ReportService(db_session).build(ev)
    assert r["budget"]["committed"] == 80000
    cat = r["budget"]["spent_by_category"][0]
    assert cat == {"category": "Catering", "estimated": 90000.0, "committed": 80000.0}
    assert r["vendors"][0] == {"name": "Royal Caterers", "category": "Catering", "status": "CONFIRMED", "agreed_cost": 80000}
    assert r["incidents"]["resolved"] == 1 and r["incidents"]["by_type"] == {"VENDOR_DELAY": 1}
    assert r["approvals"]["approved"] == 1
    assert r["timeline"] == {"tasks_total": 1, "tasks_done": 1, "on_time": 1, "late": 0}


def test_report_unknown_budget_is_null(db_session):
    ev = make_event(db_session, total_budget=Decimal("0"))
    r = ReportService(db_session).build(ev)
    assert r["budget"]["total"] is None
    assert r["budget"]["committed"] == 0.0


# ── HTTP ─────────────────────────────────────────────────────────────────────


def test_endpoints(test_client, db_session):
    ev = make_event(db_session)
    for ep in ("readiness", "next-step", "report"):
        res = test_client.get(f"/api/events/{ev.id}/{ep}")
        assert res.status_code == 200, (ep, res.text)
    assert test_client.get(f"/api/events/{ev.id}/next-step").json()["step_id"] == "start_discovery"
    assert test_client.get("/api/events/missing/readiness").status_code == 404
