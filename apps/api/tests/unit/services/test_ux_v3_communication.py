"""UX v3 communication: no-reply follow-up, quote comparison, quote changes, negotiation round cap.

All providers are mocked (conftest disables OpenWA / Twilio); nothing is sent to real vendors.
"""
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.activity_log import EventActivityLog
from app.models.approval import Approval
from app.models.budget import BudgetItem
from app.models.communication_attempt import CommunicationAttempt
from app.models.enums import EventState, EventType, NegotiationStatus
from app.models.event import Event
from app.models.notification import Notification
from app.models.shortlist import EventShortlistEntry
from app.models.vendor import Vendor
from app.models.vendor_assignment import VendorAssignment
from app.services import outreach_followup_sweeper
from app.services.negotiation_service import NegotiationService
from app.services.quotes_service import apply_quote, list_quotes
from app.services.vendor_outreach_service import VendorOutreachService, reply_state


def naive_now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


@pytest.fixture
def event(db_session: Session) -> Event:
    ev = Event(
        name="Delhi Summit",
        event_type=EventType.CONFERENCE,
        state=EventState.NORMAL,
        location="Delhi",
        total_budget=500000.0,
        owner_id="organizer_alice",
        start_datetime=datetime.now(timezone.utc) + timedelta(days=20),
        end_datetime=datetime.now(timezone.utc) + timedelta(days=21),
    )
    db_session.add(ev)
    db_session.commit()
    db_session.refresh(ev)
    return ev


@pytest.fixture
def vendor(db_session: Session) -> Vendor:
    v = Vendor(name="Royal Feast", category="catering", city="Delhi", base_cost=80000.0,
               contact_phone="+919800000001", status="ACTIVE", source="SYSTEM")
    db_session.add(v)
    db_session.commit()
    db_session.refresh(v)
    return v


@pytest.fixture
def entry(db_session: Session, event: Event) -> EventShortlistEntry:
    e = EventShortlistEntry(event_id=event.id, candidate_id="cand-1", category="CATERING",
                            candidate_name="Royal Feast", status="SELECTED", candidate_data={})
    db_session.add(e)
    db_session.commit()
    db_session.refresh(e)
    return e


def _attempt(db: Session, event: Event, entry: EventShortlistEntry, channel: str, status: str,
             hours_ago: float, details=None) -> CommunicationAttempt:
    a = CommunicationAttempt(
        event_id=event.id, shortlist_entry_id=entry.id, channel=channel, status=status,
        provider="mock", provider_ref=f"ref-{channel}", destination="+919800000001",
        contact_name="Royal Feast", attempt_count=1, details=details or {},
        last_attempt_at=naive_now() - timedelta(hours=hours_ago),
    )
    db.add(a)
    db.commit()
    db.refresh(a)
    return a


# ---------------------------------------------------------------------------
# No-reply state
# ---------------------------------------------------------------------------

def test_reply_state_nothing_sent_reports_nothing():
    assert reply_state(None, None) == {"awaiting_reply_since": None, "follow_up_due_at": None, "no_reply": False}


def test_reply_state_waiting_then_overdue(db_session, event, entry):
    wa = _attempt(db_session, event, entry, "WHATSAPP", "DELIVERED", hours_ago=2)
    state = reply_state(wa, None)
    assert state["awaiting_reply_since"] is not None
    assert state["no_reply"] is False

    later = naive_now() + timedelta(hours=settings.OUTREACH_NO_REPLY_HOURS)
    assert reply_state(wa, None, now=later)["no_reply"] is True


def test_reply_state_clears_when_vendor_replied(db_session, event, entry):
    wa = _attempt(db_session, event, entry, "WHATSAPP", "REPLIED", hours_ago=20)
    assert reply_state(wa, None)["no_reply"] is False
    assert reply_state(wa, None)["awaiting_reply_since"] is None


def test_completed_call_with_vendor_speech_counts_as_reply(db_session, event, entry):
    wa = _attempt(db_session, event, entry, "WHATSAPP", "DELIVERED", hours_ago=20)
    call = _attempt(db_session, event, entry, "CALL", "COMPLETED", hours_ago=19,
                    details={"transcript": [{"speaker": "VENDOR", "text": "Yes we are free"}]})
    assert reply_state(wa, call)["no_reply"] is False


def test_unanswered_call_does_not_count_as_reply(db_session, event, entry):
    call = _attempt(db_session, event, entry, "CALL", "NO_ANSWER", hours_ago=20)
    assert reply_state(None, call)["no_reply"] is True


def test_followup_restarts_the_clock(db_session, event, entry):
    recent = int((datetime.now(timezone.utc) - timedelta(hours=1)).timestamp())
    wa = _attempt(db_session, event, entry, "WHATSAPP", "READ", hours_ago=20,
                  details={"followups": [{"text": "hi again", "t": recent}]})
    assert reply_state(wa, None)["no_reply"] is False


def test_communication_summary_exposes_reply_fields(db_session, event, entry):
    _attempt(db_session, event, entry, "WHATSAPP", "SENT", hours_ago=10)
    summary = VendorOutreachService(db_session).summary(entry)
    assert summary["no_reply"] is True
    assert summary["awaiting_reply_since"] and summary["follow_up_due_at"]


# ---------------------------------------------------------------------------
# Sweeper
# ---------------------------------------------------------------------------

def test_sweeper_alerts_once_and_never_messages_vendor(db_session, event, entry, monkeypatch):
    _attempt(db_session, event, entry, "WHATSAPP", "DELIVERED", hours_ago=10)
    sent = []
    monkeypatch.setattr(VendorOutreachService, "send_whatsapp_followup",
                        lambda *a, **k: sent.append(a) or {})
    monkeypatch.setattr(settings, "OUTREACH_AUTO_FOLLOW_UP", False)

    assert outreach_followup_sweeper.sweep_once(db=db_session) == 1
    assert outreach_followup_sweeper.sweep_once(db=db_session) == 0  # not again for the same outreach

    notes = db_session.query(Notification).filter(Notification.event_id == event.id).all()
    assert len(notes) == 1 and "No reply from Royal Feast" in notes[0].title
    acts = db_session.query(EventActivityLog).filter(EventActivityLog.action == "VENDOR_NO_REPLY").all()
    assert len(acts) == 1
    assert sent == []  # auto follow-up is off by default


def test_sweeper_auto_follow_up_only_when_enabled(db_session, event, entry, monkeypatch):
    _attempt(db_session, event, entry, "WHATSAPP", "DELIVERED", hours_ago=10)
    sent = []
    monkeypatch.setattr(VendorOutreachService, "send_whatsapp_followup",
                        lambda self, ev, en, text, actor_id: sent.append(text) or {})
    monkeypatch.setattr(settings, "OUTREACH_AUTO_FOLLOW_UP", True)

    outreach_followup_sweeper.sweep_once(db=db_session)
    outreach_followup_sweeper.sweep_once(db=db_session)
    assert len(sent) == 1


def test_sweeper_ignores_recent_and_replied(db_session, event, entry):
    _attempt(db_session, event, entry, "WHATSAPP", "DELIVERED", hours_ago=1)
    assert outreach_followup_sweeper.sweep_once(db=db_session) == 0


# ---------------------------------------------------------------------------
# Quotes
# ---------------------------------------------------------------------------

def _assignment(db: Session, event: Event, vendor: Vendor, **kw) -> VendorAssignment:
    data = dict(event_id=event.id, vendor_id=vendor.id, category="catering", status="REQUESTED",
                negotiation_status=NegotiationStatus.QUOTATION_RECEIVED.value, currency="INR")
    data.update(kw)
    a = VendorAssignment(**data)
    db.add(a)
    db.commit()
    db.refresh(a)
    return a


def test_list_quotes_orders_and_groups(db_session, event, vendor):
    other = Vendor(name="Capital Catering", category="catering", city="Delhi", base_cost=1.0,
                   contact_phone="+919800000002", status="ACTIVE", source="SYSTEM")
    db_session.add(other)
    db_session.add(BudgetItem(event_id=event.id, name="Food", category="CATERING", estimated_amount=120000))
    db_session.commit()
    _assignment(db_session, event, vendor, quoted_amount=95000.0, max_approved_amount=100000.0)
    _assignment(db_session, event, other, quoted_amount=None)

    out = list_quotes(db_session, event.id)
    assert [i["vendor_name"] for i in out["items"]] == ["Royal Feast", "Capital Catering"]
    first = out["items"][0]
    assert first["within_cap"] is True and first["cap"] == 100000.0
    assert out["items"][1]["quoted_amount"] is None  # never invented
    cat = out["by_category"]["CATERING"]
    assert cat == {"count": 2, "quoted": 1, "lowest": 95000.0, "category_budget": 120000.0}


def test_quotes_endpoint(test_client, db_session, event, vendor):
    _assignment(db_session, event, vendor, quoted_amount=50000.0)
    res = test_client.get(f"/api/events/{event.id}/quotes?category=CATERING")
    assert res.status_code == 200
    assert res.json()["items"][0]["quoted_amount"] == 50000.0
    assert test_client.get("/api/events/missing/quotes").status_code == 404


def test_quote_change_tracks_previous_and_logs(db_session, event, vendor):
    a = _assignment(db_session, event, vendor, quoted_amount=80000.0)
    change = apply_quote(db_session, a, 90000.0)
    db_session.commit()
    assert change and change["from"] == 80000.0 and change["to"] == 90000.0
    assert a.provider_response_summary["previous_amount"] == 80000.0
    act = db_session.query(EventActivityLog).filter(EventActivityLog.action == "QUOTE_CHANGED").one()
    assert "₹80,000 → ₹90,000" in act.summary
    assert list_quotes(db_session, event.id)["items"][0]["previous_amount"] == 80000.0


def test_same_quote_is_not_a_change(db_session, event, vendor):
    a = _assignment(db_session, event, vendor, quoted_amount=80000.0)
    assert apply_quote(db_session, a, 80000.0) is None


def test_quote_change_on_confirmed_booking_requires_new_approval(db_session, event, vendor):
    a = _assignment(db_session, event, vendor, quoted_amount=80000.0, status="CONFIRMED",
                    negotiation_status="APPROVED", agreed_cost=80000.0)
    apply_quote(db_session, a, 88000.0)
    db_session.commit()
    db_session.refresh(a)
    assert a.negotiation_status == "AWAITING_APPROVAL"
    approval = db_session.get(Approval, a.approval_id)
    assert approval is not None and approval.status == "PENDING"
    assert approval.requested_action["type"] == "RECONFIRM_CHANGED_QUOTE"
    assert approval.requested_action["previous_amount"] == 80000.0


def test_provider_response_keeps_previous_amount(db_session, event, vendor):
    a = _assignment(db_session, event, vendor, quoted_amount=70000.0, max_approved_amount=100000.0,
                    target_amount=60000.0)
    NegotiationService(db_session).process_provider_response(
        a.id, "We can do it for 75000", is_simulation=True,
        structured_offer={"availability": True, "quoted_amount": 75000.0},
    )
    db_session.refresh(a)
    assert a.quoted_amount == 75000.0
    assert a.provider_response_summary["previous_amount"] == 70000.0


# ---------------------------------------------------------------------------
# Negotiation round cap
# ---------------------------------------------------------------------------

def test_negotiation_stops_at_round_cap(db_session, event, vendor, monkeypatch):
    monkeypatch.setattr(settings, "NEGOTIATION_MAX_ROUNDS", 2)
    a = _assignment(db_session, event, vendor, quoted_amount=150000.0, max_approved_amount=100000.0,
                    target_amount=80000.0, negotiation_status=NegotiationStatus.NEGOTIATING.value,
                    negotiation_round="2")
    sent = []
    svc = NegotiationService(db_session)
    monkeypatch.setattr(svc._comm, "send_message", lambda **k: sent.append(k))

    result = svc.negotiate(a.id)
    db_session.refresh(a)
    assert result["action"] == "ROUND_LIMIT_REACHED"
    assert sent == []  # no counter-offer sent
    assert a.negotiation_control == "HUMAN"
    assert a.negotiation_status != NegotiationStatus.CONFIRMED.value  # never auto-accepts
    notes = db_session.query(Notification).filter(Notification.event_id == event.id).all()
    assert any("needs you" in n.title for n in notes)


def test_negotiation_below_cap_still_counters(db_session, event, vendor, monkeypatch):
    monkeypatch.setattr(settings, "NEGOTIATION_MAX_ROUNDS", 4)
    a = _assignment(db_session, event, vendor, quoted_amount=150000.0, max_approved_amount=100000.0,
                    target_amount=80000.0, negotiation_status=NegotiationStatus.NEGOTIATING.value,
                    negotiation_round="1")
    result = NegotiationService(db_session).negotiate(a.id)
    assert result["action"] == "COUNTER_OFFER_SENT"
    assert result["round"] == 2
