"""Unit tests: UX v3 approval presentation fields + approval expiry (docs/contracts/ux-v3-api.md §1, §6)."""
from datetime import datetime, timedelta
from decimal import Decimal

import pytest
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.approval import Approval
from app.models.budget import BudgetItem
from app.models.enums import EventState, RoleType, TaskPriority
from app.models.event import Event
from app.models.event_member import EventMember
from app.models.shortlist import EventShortlistEntry
from app.models.task import Task
from app.models.user import User
from app.models.vendor import Vendor
from app.models.vendor_assignment import VendorAssignment
from app.schemas.approval import ApprovalRequestCreate
from app.services.approval_presenter import ApprovalPresenter, format_money
from app.services.approval_service import ApprovalService, compute_approval_expiry, utc_now


def _ctx(db: Session, start_in_days: float | None = 30):
    organizer = User(name="Organizer", email="org@ux3.demo")
    collaborator = User(name="Collaborator", email="collab@ux3.demo")
    db.add_all([organizer, collaborator])
    db.commit()
    event = Event(
        owner_id=organizer.id,
        name="Delhi Wedding",
        state=EventState.NORMAL.value,
        total_budget=Decimal("500000.00"),
        currency="INR",
        start_datetime=(utc_now() + timedelta(days=start_in_days)) if start_in_days is not None else None,
    )
    db.add(event)
    db.commit()
    db.add_all([
        EventMember(event_id=event.id, user_id=organizer.id, role=RoleType.MAIN_ORGANIZER.value),
        EventMember(event_id=event.id, user_id=collaborator.id, role=RoleType.COLLABORATOR.value),
    ])
    task = Task(event_id=event.id, name="Dinner Service", priority=TaskPriority.HIGH.value,
                required_provider_category="CATERING", is_critical_path=True, slack_minutes=0)
    caterer = Vendor(name="Royal Feast", category="CATERING", city="Delhi")
    backup = Vendor(name="Spice Route", category="CATERING", city="Delhi")
    db.add_all([task, caterer, backup])
    db.add(BudgetItem(event_id=event.id, name="Catering", category="CATERING",
                      estimated_amount=Decimal("120000.00"), currency="INR"))
    db.commit()
    return {"event": event, "organizer": organizer, "collaborator": collaborator,
            "task": task, "caterer": caterer, "backup": backup}


def _approval(db: Session, event: Event, requester: User, **kw) -> Approval:
    a = Approval(event_id=event.id, requester_id=requester.id, status="PENDING",
                 state_snapshot="snap", impact_level=kw.pop("impact_level", "MAJOR"), **kw)
    db.add(a)
    db.commit()
    return a


# ── money formatting ───────────────────────────────────────────────

def test_format_money_indian_grouping():
    assert format_money(Decimal("8500000"), "INR") == "₹85,00,000"
    assert format_money(Decimal("85000"), "INR") == "₹85,000"
    assert format_money(Decimal("999"), "INR") == "₹999"
    assert format_money(Decimal("1500"), "USD") == "USD 1,500"
    assert format_money(None, "INR") is None


# ── presentation ───────────────────────────────────────────────────

def test_outreach_approval_is_described_without_money(db_session: Session):
    ctx = _ctx(db_session)
    a = _approval(db_session, ctx["event"], ctx["organizer"], action_type="COMMUNICATION_OUTREACH",
                  target_type="TRANSPORT", target_id="cand-1",
                  requested_action={"candidate_id": "cand-1", "candidate_name": "Car-Van-Bus Rental",
                                    "category": "TRANSPORT", "provider_id": None})
    out = ApprovalPresenter(db_session).present(a)
    assert out["summary"] == "Contact Car-Van-Bus Rental (Transport) on WhatsApp and by phone"
    assert out["vendor_name"] == "Car-Van-Bus Rental"
    assert out["category"] == "TRANSPORT"
    assert out["channel"] == "WHATSAPP_AND_CALL"
    assert out["involves_money"] is False
    assert out["amount"] is None and out["currency"] is None
    assert out["budget_impact"] is None
    assert "Nothing is booked" in out["on_approve"]
    assert "won't be contacted" in out["on_reject"]
    assert out["reversible"] is False


def test_provider_engagement_reads_amount_from_linked_assignment(db_session: Session):
    ctx = _ctx(db_session)
    asg = VendorAssignment(event_id=ctx["event"].id, vendor_id=ctx["caterer"].id, category="CATERING",
                           status="REQUESTED", quoted_amount=85000.0, currency="INR")
    db_session.add(asg)
    db_session.commit()
    a = _approval(db_session, ctx["event"], ctx["organizer"], action_type="PROVIDER_ENGAGEMENT",
                  target_type="VENDOR_ASSIGNMENT", target_id=asg.id,
                  requested_action={"type": "CONFIRM_PROVIDER_ENGAGEMENT"})  # no amount in payload
    out = ApprovalPresenter(db_session).present(a)
    assert out["involves_money"] is True
    assert out["amount"] == 85000.0
    assert out["currency"] == "INR"
    assert out["vendor_name"] == "Royal Feast"
    assert out["summary"] == "Accept Royal Feast's quote of ₹85,000 for catering"
    bi = out["budget_impact"]
    assert bi["category"] == "CATERING"
    assert bi["category_budget"] == 120000.0
    assert bi["committed_before"] == 0.0
    assert bi["committed_after"] == 85000.0
    assert bi["total_budget"] == 500000.0
    assert bi["over_category_budget"] is False
    assert "confirmation message" in out["on_approve"]


def test_reassign_vendor_replaces_committed_cost_and_flags_overrun(db_session: Session):
    ctx = _ctx(db_session)
    # Current caterer already confirmed at 100k in the same category.
    db_session.add(VendorAssignment(event_id=ctx["event"].id, vendor_id=ctx["caterer"].id, category="CATERING",
                                    status="CONFIRMED", agreed_cost=100000.0))
    db_session.commit()
    a = _approval(db_session, ctx["event"], ctx["organizer"], action_type="REASSIGN_VENDOR",
                  target_type="TASK", target_id=ctx["task"].id,
                  requested_action={"new_vendor_id": ctx["backup"].id, "task_id": ctx["task"].id,
                                    "agreed_cost": 130000.0})
    out = ApprovalPresenter(db_session).present(a)
    assert out["vendor_name"] == "Spice Route"
    assert out["category"] == "CATERING"
    assert out["amount"] == 130000.0
    bi = out["budget_impact"]
    # ActionService reuses the category's assignment and overwrites its agreed cost.
    assert bi["committed_before"] == 100000.0
    assert bi["committed_after"] == 130000.0
    assert bi["over_category_budget"] is True
    assert out["summary"] == "Switch catering to Spice Route at ₹1,30,000"


def test_unknown_amount_is_never_invented(db_session: Session):
    ctx = _ctx(db_session)
    a = _approval(db_session, ctx["event"], ctx["organizer"], action_type="CONTRACT_VENDOR",
                  target_type="VENDOR", target_id=ctx["caterer"].id,
                  requested_action={"vendor_id": ctx["caterer"].id, "category": "CATERING"})
    out = ApprovalPresenter(db_session).present(a)
    assert out["involves_money"] is True
    assert out["amount"] is None
    assert out["budget_impact"] is None
    assert out["summary"] == "Book Royal Feast for catering"


def test_list_endpoint_returns_computed_fields(test_client, db_session: Session):
    ctx = _ctx(db_session)
    _approval(db_session, ctx["event"], ctx["organizer"], action_type="COMMUNICATION_OUTREACH",
              target_type="DECOR", target_id="cand-9",
              requested_action={"candidate_id": "cand-9", "candidate_name": "Bloom Decor", "category": "DECOR"})
    res = test_client.get(f"/api/events/{ctx['event'].id}/approvals", headers={"x-user-id": ctx["organizer"].id})
    assert res.status_code == 200, res.text
    item = res.json()["items"][0]
    assert item["summary"] == "Contact Bloom Decor (Décor) on WhatsApp and by phone"
    assert item["reversible"] is False
    assert item["involves_money"] is False
    # existing fields unchanged
    assert item["action_type"] == "COMMUNICATION_OUTREACH"
    assert item["impact_level"] == "MAJOR"


# ── expiry ─────────────────────────────────────────────────────────

def test_expiry_uses_ttl_by_impact_level():
    now = datetime(2026, 11, 1, 10, 0, 0)
    far_start = now + timedelta(days=30)
    assert compute_approval_expiry("MINOR", far_start, now) == now + timedelta(hours=settings.APPROVAL_TTL_HOURS_MINOR)
    assert compute_approval_expiry("MAJOR", far_start, now) == now + timedelta(hours=settings.APPROVAL_TTL_HOURS_MAJOR)
    assert compute_approval_expiry("CRITICAL", far_start, now) == now + timedelta(hours=settings.APPROVAL_TTL_HOURS_CRITICAL)
    assert compute_approval_expiry("MAJOR", None, now) == now + timedelta(hours=settings.APPROVAL_TTL_HOURS_MAJOR)


def test_expiry_never_later_than_event_start_but_never_born_expired():
    now = datetime(2026, 11, 1, 10, 0, 0)
    soon = now + timedelta(hours=3)
    assert compute_approval_expiry("MAJOR", soon, now) == soon  # capped at start
    started = now - timedelta(hours=1)  # live event: plain TTL, not already expired
    assert compute_approval_expiry("MAJOR", started, now) == now + timedelta(hours=settings.APPROVAL_TTL_HOURS_MAJOR)


def test_created_requests_carry_expiry(db_session: Session):
    ctx = _ctx(db_session, start_in_days=0.25)  # event starts in 6 h
    svc = ApprovalService(db_session)
    a = svc.create_request(
        event_id=ctx["event"].id,
        requester_id=ctx["collaborator"].id,
        data=ApprovalRequestCreate(action_type="REASSIGN_VENDOR", target_type="TASK", target_id=ctx["task"].id,
                                   requested_action={"new_vendor_id": ctx["backup"].id, "agreed_cost": 1500.0}),
    )
    assert a.expires_at is not None
    assert a.expires_at <= ctx["event"].start_datetime + timedelta(seconds=1)

    o, created = svc.create_communication_outreach_approval(
        event_id=ctx["event"].id, candidate_id="cand-x", requester_id=ctx["organizer"].id,
        candidate_name="Bloom Decor", category="DECOR",
    )
    assert created and o.expires_at is not None


def test_expired_outreach_does_not_block_a_new_request_and_is_mirrored(db_session: Session):
    ctx = _ctx(db_session)
    entry = EventShortlistEntry(event_id=ctx["event"].id, candidate_id="cand-7", candidate_name="Bloom Decor",
                                category="DECOR", status="SELECTED", candidate_data={})
    db_session.add(entry)
    db_session.commit()
    svc = ApprovalService(db_session)
    first, created = svc.create_communication_outreach_approval(
        event_id=ctx["event"].id, candidate_id="cand-7", requester_id=ctx["organizer"].id,
        candidate_name="Bloom Decor", category="DECOR",
    )
    assert created
    entry.candidate_data = {"communication": {"approval_id": first.id, "approval_status": "PENDING",
                                              "overall_status": "PENDING_APPROVAL"}}
    db_session.commit()

    svc.expire(ctx["event"].id, first.id)
    db_session.refresh(entry)
    comm = entry.candidate_data["communication"]
    assert comm["approval_status"] == "EXPIRED"
    assert comm["overall_status"] == "EXPIRED"

    second, created_again = svc.create_communication_outreach_approval(
        event_id=ctx["event"].id, candidate_id="cand-7", requester_id=ctx["organizer"].id,
        candidate_name="Bloom Decor", category="DECOR",
    )
    assert created_again and second.id != first.id and second.status == "PENDING"


def test_sweeper_expires_and_reminds_new_style_approvals(db_session: Session, monkeypatch):
    from app.services import approval_escalation_service as esc

    ctx = _ctx(db_session)
    now = utc_now()
    expired = _approval(db_session, ctx["event"], ctx["organizer"], action_type="COMMUNICATION_OUTREACH",
                        target_type="DECOR", target_id="c1", requested_action={},
                        created_at=now - timedelta(hours=30), expires_at=now - timedelta(hours=6))
    halfway = _approval(db_session, ctx["event"], ctx["organizer"], action_type="COMMUNICATION_OUTREACH",
                        target_type="DECOR", target_id="c2", requested_action={},
                        created_at=now - timedelta(hours=13), expires_at=now + timedelta(hours=11))

    reminded = []
    monkeypatch.setattr(esc.ApprovalEscalationService, "_handle_reminder", lambda self, a: reminded.append(a.id))
    monkeypatch.setattr(esc.ApprovalEscalationService, "_resolve_escalation_recipients", lambda self, a: [])
    counts = esc.ApprovalEscalationService(db_session).sweep_pending_approvals()

    db_session.refresh(expired)
    assert expired.status == "EXPIRED"
    assert counts["expired"] == 1
    assert counts["reminded"] == 1 and reminded == [halfway.id]
