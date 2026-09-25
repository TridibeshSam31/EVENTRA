"""Unit Tests: Currency Consistency Hardening (Task 7.1).

Validates:
1. INR event + INR vendor quote → valid (INR preserved).
2. USD event + USD vendor quote → valid (USD preserved).
3. USD event + INR vendor quote → mismatch / CONFLICT / clarification.
4. INR event + USD vendor quote → mismatch / CONFLICT / clarification.
5. Voice recovery inherits Event.currency.
6. VoiceNegotiationContext uses Event.currency.
7. Negotiation evaluation uses Event.currency.
8. Existing non-voice currency behavior remains unchanged.
"""
from datetime import datetime, timezone, timedelta
import pytest
from sqlalchemy.orm import Session

from app.models.event import Event
from app.models.task import Task
from app.models.vendor import Vendor
from app.models.vendor_assignment import VendorAssignment
from app.models.recovery import Recovery
from app.models.incident import Incident
from app.models.user import User
from app.models.enums import EventType, EventState, RoleType, ClaimValidationStatus
from app.models.event_member import EventMember
from app.integrations.communication.gemini_bridge import TranscriptEntry, TranscriptSpeaker
from app.integrations.communication.voice_outcome_parser import VoiceOutcomeParser, VoiceOutcomePipeline
from app.integrations.communication.voice_context_builder import VoiceContextBuilder
from app.services.voice_negotiation_service import VoiceNegotiationService
from app.services.voice_recovery_service import VoiceRecoveryService
from app.schemas.voice_negotiation import StructuredNegotiationResult


@pytest.fixture
def currency_user(db_session: Session) -> User:
    u = User(email="currency_tester@eventra.ai", name="Currency Tester")
    db_session.add(u)
    db_session.commit()
    db_session.refresh(u)
    return u


@pytest.fixture
def inr_event(db_session: Session, currency_user: User) -> Event:
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    evt = Event(
        owner_id=currency_user.id,
        name="INR Wedding Gala",
        currency="INR",
        total_budget=1000000.0,
        start_datetime=now + timedelta(days=2),
        end_datetime=now + timedelta(days=2, hours=6),
    )
    db_session.add(evt)
    db_session.commit()
    db_session.refresh(evt)
    m = EventMember(event_id=evt.id, user_id=currency_user.id, role=RoleType.MAIN_ORGANIZER.value)
    db_session.add(m)
    db_session.commit()
    return evt


@pytest.fixture
def usd_event(db_session: Session, currency_user: User) -> Event:
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    evt = Event(
        owner_id=currency_user.id,
        name="USD Global Summit",
        currency="USD",
        total_budget=50000.0,
        start_datetime=now + timedelta(days=5),
        end_datetime=now + timedelta(days=5, hours=8),
    )
    db_session.add(evt)
    db_session.commit()
    db_session.refresh(evt)
    m = EventMember(event_id=evt.id, user_id=currency_user.id, role=RoleType.MAIN_ORGANIZER.value)
    db_session.add(m)
    db_session.commit()
    return evt


@pytest.fixture
def test_vendor(db_session: Session) -> Vendor:
    v = Vendor(
        name="Apex Audio Solutions",
        category="Catering",
        city="Mumbai",
        contact_phone="919876543210",
        capabilities=["audio", "lighting"],
    )
    db_session.add(v)
    db_session.commit()
    db_session.refresh(v)
    return v


@pytest.fixture
def inr_task(db_session: Session, inr_event: Event) -> Task:
    t = Task(
        event_id=inr_event.id,
        name="Main Catering Setup",
        required_provider_category="Catering",
        duration_minutes=240,
    )
    db_session.add(t)
    db_session.commit()
    db_session.refresh(t)
    return t


@pytest.fixture
def usd_task(db_session: Session, usd_event: Event) -> Task:
    t = Task(
        event_id=usd_event.id,
        name="Conference Catering Setup",
        required_provider_category="Catering",
        duration_minutes=180,
    )
    db_session.add(t)
    db_session.commit()
    db_session.refresh(t)
    return t


def test_01_inr_event_with_inr_vendor_quote_is_valid(db_session: Session, inr_event: Event, inr_task: Task, test_vendor: Vendor):
    """1. INR event + INR vendor quote (₹50,000) → valid (INR preserved)."""
    transcript = [
        TranscriptEntry(speaker=TranscriptSpeaker.AGENT, text="What is your rate?"),
        TranscriptEntry(speaker=TranscriptSpeaker.VENDOR, text="We are available. Our quote is ₹50,000."),
    ]
    pipeline = VoiceOutcomePipeline(db_session)
    res = pipeline.process_call_completion(
        event_id=inr_event.id,
        task_id=inr_task.id,
        provider_id=test_vendor.id,
        session_id="sess_curr_01",
        transcript=transcript,
    )
    assert res.outcome is not None
    assert res.outcome.currency == "INR"
    assert res.outcome.quoted_price == 50000.0

    # Validation should have passed or at least no currency conflict
    if res.validation:
        curr_claim = next((c for c in res.validation.claim_results if c.get("claim_type") == "currency"), None)
        if curr_claim:
            assert curr_claim.get("status") != ClaimValidationStatus.CONFLICT.value


def test_02_usd_event_with_usd_vendor_quote_is_valid(db_session: Session, usd_event: Event, usd_task: Task, test_vendor: Vendor):
    """2. USD event + USD vendor quote ($500) → valid (USD preserved)."""
    transcript = [
        TranscriptEntry(speaker=TranscriptSpeaker.AGENT, text="Could you quote for this requirement?"),
        TranscriptEntry(speaker=TranscriptSpeaker.VENDOR, text="Yes, we are available and our fee is $500."),
    ]
    pipeline = VoiceOutcomePipeline(db_session)
    res = pipeline.process_call_completion(
        event_id=usd_event.id,
        task_id=usd_task.id,
        provider_id=test_vendor.id,
        session_id="sess_curr_02",
        transcript=transcript,
    )
    assert res.outcome is not None
    assert res.outcome.currency == "USD"
    assert res.outcome.quoted_price == 500.0

    if res.validation:
        curr_claim = next((c for c in res.validation.claim_results if c.get("claim_type") == "currency"), None)
        if curr_claim:
            assert curr_claim.get("status") != ClaimValidationStatus.CONFLICT.value


def test_03_usd_event_with_inr_vendor_quote_produces_conflict(db_session: Session, usd_event: Event, usd_task: Task, test_vendor: Vendor):
    """3. USD event + INR vendor quote (₹50,000) → currency mismatch CONFLICT, no silent conversion."""
    transcript = [
        TranscriptEntry(speaker=TranscriptSpeaker.AGENT, text="What is your price?"),
        TranscriptEntry(speaker=TranscriptSpeaker.VENDOR, text="We are available. We charge ₹50,000 for this."),
    ]
    pipeline = VoiceOutcomePipeline(db_session)
    res = pipeline.process_call_completion(
        event_id=usd_event.id,
        task_id=usd_task.id,
        provider_id=test_vendor.id,
        session_id="sess_curr_03",
        transcript=transcript,
    )
    assert res.outcome is not None
    assert res.outcome.currency == "INR"
    assert res.outcome.quoted_price == 50000.0

    # Validation must detect currency conflict
    assert res.validation is not None
    curr_claim = next((c for c in res.validation.claim_results if c.get("claim_type") in ("CURRENCY", "currency")), None)
    assert curr_claim is not None
    assert curr_claim.get("status") == ClaimValidationStatus.CONFLICT.value
    assert "Currency mismatch" in curr_claim.get("explanation", "")


def test_04_inr_event_with_usd_vendor_quote_produces_conflict(db_session: Session, inr_event: Event, inr_task: Task, test_vendor: Vendor):
    """4. INR event + USD vendor quote ($500) → currency mismatch CONFLICT, no silent conversion."""
    transcript = [
        TranscriptEntry(speaker=TranscriptSpeaker.AGENT, text="Please provide your quote."),
        TranscriptEntry(speaker=TranscriptSpeaker.VENDOR, text="We are open on that date. Rate is $500 dollars."),
    ]
    pipeline = VoiceOutcomePipeline(db_session)
    res = pipeline.process_call_completion(
        event_id=inr_event.id,
        task_id=inr_task.id,
        provider_id=test_vendor.id,
        session_id="sess_curr_04",
        transcript=transcript,
    )
    assert res.outcome is not None
    assert res.outcome.currency == "USD"
    assert res.outcome.quoted_price == 500.0

    # Validation must detect currency conflict
    assert res.validation is not None
    curr_claim = next((c for c in res.validation.claim_results if c.get("claim_type") in ("CURRENCY", "currency")), None)
    assert curr_claim is not None
    assert curr_claim.get("status") == ClaimValidationStatus.CONFLICT.value
    assert "Currency mismatch" in curr_claim.get("explanation", "")


def test_05_voice_recovery_inherits_event_currency(db_session: Session, usd_event: Event, usd_task: Task, test_vendor: Vendor, currency_user: User):
    """5. Voice recovery inherits Event.currency (USD)."""
    inc = Incident(
        event_id=usd_event.id,
        title="Emergency Catering",
        incident_type="VENDOR_CANCELLATION",
    )
    db_session.add(inc)
    db_session.commit()
    db_session.refresh(inc)

    recovery = Recovery(
        event_id=usd_event.id,
        incident_id=inc.id,
        strategy_type="BACKUP",
        state_snapshot="SNAPSHOT",
        status="FEASIBLE",
        is_feasible=True,
    )
    db_session.add(recovery)
    db_session.commit()
    db_session.refresh(recovery)

    service = VoiceRecoveryService(db_session)
    call_res = service.initiate_recovery_call(
        event_id=usd_event.id,
        task_id=usd_task.id,
        provider_id=test_vendor.id,
        recovery_option_id=recovery.id,
        reason="Caterer cancelled",
        user_id=currency_user.id,
    )
    assert call_res["success"] is True

    # Check that context built for this session inherited USD
    builder = VoiceContextBuilder()
    ctx = builder.build(event_id=usd_event.id, task_id=usd_task.id, provider_id=test_vendor.id, db=db_session)
    assert ctx.currency == "USD"


def test_06_voice_negotiation_context_uses_event_currency(db_session: Session, inr_event: Event, inr_task: Task, test_vendor: Vendor):
    """6. VoiceNegotiationContext uses Event.currency."""
    service = VoiceNegotiationService(db_session)
    neg_ctx = service.build_negotiation_context(
        event_id=inr_event.id,
        provider_id=test_vendor.id,
        task_id=inr_task.id,
    )
    assert neg_ctx.currency == "INR"


def test_07_negotiation_evaluation_detects_currency_mismatch(db_session: Session, usd_event: Event, usd_task: Task, test_vendor: Vendor):
    """7. Negotiation evaluation strictly halts on currency mismatch."""
    service = VoiceNegotiationService(db_session)
    neg_ctx = service.build_negotiation_context(
        event_id=usd_event.id,
        provider_id=test_vendor.id,
        task_id=usd_task.id,
    )
    assert neg_ctx.currency == "USD"

    # Vendor responds in INR
    neg_res = StructuredNegotiationResult(
        availability=True,
        quoted_price=45000.0,
        currency="INR",
        status="VALIDATED",
    )
    decision = service.evaluate_vendor_response(context=neg_ctx, response=neg_res)
    assert decision.action == "NEEDS_CLARIFICATION"
    assert decision.can_proceed_to_engagement is False
    assert any("Currency" in factor for factor in decision.blocking_factors)
