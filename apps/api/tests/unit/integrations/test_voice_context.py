"""Unit tests for EVENTRA Voice Context Builder & Security Boundaries (Task 4).

Verifies:
1. Valid event/task/provider context resolution from authoritative DB and parameters.
2. Context contains only whitelisted fields.
3. Explicit security test: Over-rich objects strip total_budget, internal_margin, credentials, etc.
4. Missing event fails closed safely.
5. Missing task fails closed safely.
6. Invalid provider/task relationship fails closed safely.
7. Negotiation context is included only when explicitly authorized.
8. Unauthorized negotiation data is rejected/removed.
9. Context size is bounded.
10. Gemini receives the expected sanitized context and guardrail prompts.
11. Two simultaneous calls receive completely isolated contexts without cross-leakage.
12. Transcript correlation retains all 6 identifiers: session_id, event_id, task_id, provider_id, call_sid, stream_sid.
13. Current Gemini Live model configuration defaults to gemini-3.8-live.
"""
from datetime import datetime, timezone
from decimal import Decimal
import json
import pytest
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.event import Event
from app.models.task import Task
from app.models.vendor import Vendor
from app.models.vendor_assignment import VendorAssignment
from app.integrations.communication.exotel_gateway import ExotelVoiceSession
from app.integrations.communication.gemini_bridge import (
    GeminiLiveBridge,
    TranscriptEntry,
    TranscriptSpeaker,
    build_vendor_system_prompt,
)
from app.integrations.communication.voice_context_builder import (
    AuthorizedNegotiationContext,
    SanitizedVoiceContext,
    VoiceContextBuilder,
    VoiceContextValidationError,
)


# ---------------------------------------------------------------------------
# 1. Authoritative DB Context Tests
# ---------------------------------------------------------------------------

def test_valid_event_task_provider_context_db(db_session: Session):
    """Verify context builder resolves authoritative data from DB models."""
    # Seed event
    event = Event(
        name="Annual Leadership Summit",
        description="Internal corporate conference",
        event_type="CONFERENCE",
        location="Grand Hyatt, Ballroom A, Mumbai",
        start_datetime=datetime(2026, 11, 20, 10, 0, tzinfo=timezone.utc),
        end_datetime=datetime(2026, 11, 20, 18, 0, tzinfo=timezone.utc),
        guest_count=250,
        total_budget=Decimal("750000.00"),
    )
    db_session.add(event)
    db_session.commit()

    # Seed vendor
    vendor = Vendor(
        name="Apex Audio Visuals",
        category="AV_AND_SOUND",
        city="Mumbai",
        contact_phone="+919876543210",
        capabilities=["4K Projection", "Line Array Audio", "Wireless Mics"],
    )
    db_session.add(vendor)
    db_session.commit()

    # Seed task
    task = Task(
        event_id=event.id,
        name="Ballroom Stage Sound and AV Setup",
        description="Supply and operate line array PA and 4 wireless lapel mics",
        required_provider_category="AV_AND_SOUND",
        duration_minutes=120,
        provider_id=vendor.id,
    )
    db_session.add(task)
    db_session.commit()

    builder = VoiceContextBuilder()
    ctx = builder.build(
        event_id=event.id,
        task_id=task.id,
        provider_id=vendor.id,
        session_id="sess_123",
        call_sid="call_abc",
        stream_sid="stream_xyz",
        db=db_session,
    )

    assert ctx.session_id == "sess_123"
    assert ctx.event_id == event.id
    assert ctx.task_id == task.id
    assert ctx.provider_id == vendor.id
    assert ctx.event_name == "Annual Leadership Summit"
    assert ctx.event_date == "2026-11-20"
    assert ctx.event_time_window == "10:00"
    assert ctx.event_location == "Grand Hyatt, Ballroom A, Mumbai"
    assert ctx.guest_count == 250
    assert ctx.task_name == "Ballroom Stage Sound and AV Setup"
    assert ctx.service_category == "AV_AND_SOUND"
    assert ctx.duration_minutes == 120
    assert ctx.vendor_name == "Apex Audio Visuals"
    assert ctx.vendor_phone == "+919876543210"
    assert "Line Array Audio" in ctx.required_capabilities

    # Verify sensitive budget is NOT present
    dumped = ctx.model_dump()
    assert "750000" not in json.dumps(dumped)
    assert "total_budget" not in dumped


def test_missing_event_fails_safely(db_session: Session):
    """Verify non-existent event ID fails closed."""
    builder = VoiceContextBuilder()
    with pytest.raises(VoiceContextValidationError) as exc:
        builder.build(event_id="non_existent_event_id", db=db_session)
    assert "Authoritative Event 'non_existent_event_id' not found" in str(exc.value)


def test_missing_task_fails_safely(db_session: Session):
    """Verify non-existent task ID fails closed."""
    builder = VoiceContextBuilder()
    with pytest.raises(VoiceContextValidationError) as exc:
        builder.build(task_id="non_existent_task_id", db=db_session)
    assert "Authoritative Task 'non_existent_task_id' not found" in str(exc.value)


def test_invalid_task_event_relationship_fails_safely(db_session: Session):
    """Verify task belonging to Event A cannot be associated with Event B."""
    evt_a = Event(name="Event A", total_budget=Decimal("1000"))
    evt_b = Event(name="Event B", total_budget=Decimal("2000"))
    db_session.add_all([evt_a, evt_b])
    db_session.commit()

    task_a = Task(event_id=evt_a.id, name="Task for Event A")
    db_session.add(task_a)
    db_session.commit()

    builder = VoiceContextBuilder()
    with pytest.raises(VoiceContextValidationError) as exc:
        builder.build(event_id=evt_b.id, task_id=task_a.id, db=db_session)
    assert "belongs to event" in str(exc.value)


def test_invalid_provider_task_relationship_fails_safely(db_session: Session):
    """Verify task already bound to Vendor A cannot be queried against Vendor B."""
    evt = Event(name="Conference", total_budget=Decimal("5000"))
    vendor_a = Vendor(name="Vendor A", category="SOUND", city="Delhi")
    vendor_b = Vendor(name="Vendor B", category="SOUND", city="Delhi")
    db_session.add_all([evt, vendor_a, vendor_b])
    db_session.commit()

    task = Task(event_id=evt.id, name="Sound Task", provider_id=vendor_a.id)
    db_session.add(task)
    db_session.commit()

    builder = VoiceContextBuilder()
    with pytest.raises(VoiceContextValidationError) as exc:
        builder.build(event_id=evt.id, task_id=task.id, provider_id=vendor_b.id, db=db_session)
    assert "assigned to vendor" in str(exc.value)


# ---------------------------------------------------------------------------
# 2. Explicit Security & Sensitivity Tests
# ---------------------------------------------------------------------------

def test_security_over_rich_event_strips_sensitive_data():
    """SECURITY TEST: Verify over-rich dictionary strips all internal margins, budgets, notes, credentials."""
    over_rich_params = {
        "event_id": "evt_999",
        "task_id": "tsk_888",
        "provider_id": "prv_777",
        "vendor_name": "Premium Florists",
        "task_name": "Stage Floral Arch",
        "event_name": "High Profile Gala",
        # Sensitive fields that must NEVER appear
        "total_budget": 1200000,
        "organizer_budget": 1200000,
        "internal_margin": 0.25,
        "target_margin": 0.30,
        "internal_notes": "Organizer has high budget, negotiate down from 40k max",
        "private_notes": "Do not mention competitor quote of 32k",
        "alternative_vendor_quotes": [{"vendor": "Rival", "quote": 32000}],
        "quotes_comparison": "Rival is cheaper by 8000",
        "max_approved_amount": 40000,
        "recovery_strategy": "FAILOVER_P3_AGENT",
        "risk_score": 0.82,
        "credentials": "Bearer secret_api_token_value",
        "api_key": "gemini_secret_live_key_xyz",
        "auth_token": "bearer_internal_token",
        "approval_state": "PENDING_FINANCE_SIGN_OFF",
    }

    builder = VoiceContextBuilder()
    ctx = builder.build(
        event_id="evt_999",
        task_id="tsk_888",
        provider_id="prv_777",
        session_id="sess_sec_test",
        custom_parameters=over_rich_params,
    )

    dumped = ctx.model_dump()
    dumped_str = json.dumps(dumped).lower()

    # Assert no sensitive key or value made it into the context object
    forbidden_tokens = [
        "1200000",
        "internal_margin",
        "0.25",
        "organizer has high budget",
        "competitor quote",
        "secret_api_token",
        "gemini_secret",
        "failover_p3",
        "pending_finance",
        "40000",
    ]
    for token in forbidden_tokens:
        assert token not in dumped_str, f"Forbidden token '{token}' leaked into context!"

    # Assert prompt generation is also clean
    prompt = build_vendor_system_prompt(ctx).lower()
    for token in forbidden_tokens:
        assert token not in prompt, f"Forbidden token '{token}' leaked into prompt!"


# ---------------------------------------------------------------------------
# 3. Negotiation Authority Tests
# ---------------------------------------------------------------------------

def test_negotiation_included_only_when_explicitly_authorized():
    """Verify negotiation position is communicated ONLY when explicitly authorized by EVENTRA."""
    builder = VoiceContextBuilder()

    # Case A: Explicitly authorized
    auth_data = {
        "authorized": True,
        "target_price": 45000.0,
        "currency": "INR",
        "constraints": ["Includes transportation and setup"],
    }
    ctx_authorized = builder.build(
        session_id="sess_neg_1",
        negotiation_auth=auth_data,
        custom_parameters={"task_name": "Sound Setup", "vendor_name": "Live Audio"},
    )
    assert ctx_authorized.negotiation.authorized is True
    assert ctx_authorized.negotiation.target_price == 45000.0
    prompt_auth = build_vendor_system_prompt(ctx_authorized)
    assert "45000.0 inr" in prompt_auth.lower()
    assert "target rate" in prompt_auth.lower()

    # Case B: Not authorized
    unauth_data = {
        "authorized": False,
        "target_price": 45000.0,
    }
    ctx_unauthorized = builder.build(
        session_id="sess_neg_2",
        negotiation_auth=unauth_data,
        custom_parameters={"task_name": "Sound Setup", "vendor_name": "Live Audio"},
    )
    assert ctx_unauthorized.negotiation.authorized is False
    assert ctx_unauthorized.negotiation.target_price is None
    prompt_unauth = build_vendor_system_prompt(ctx_unauthorized)
    assert "not authorized to propose or agree to any pricing numbers" in prompt_unauth.lower()
    assert "45000" not in prompt_unauth


def test_unauthorized_negotiation_data_rejected_or_removed():
    """Verify malicious or unverified negotiation data cannot inject numbers."""
    builder = VoiceContextBuilder()

    # Malicious payload missing 'authorized: True'
    bad_payload = {
        "target_price": 30000.0,
        "internal_margin": 0.15,
        "total_budget": 500000,
    }
    ctx = builder.build(
        session_id="sess_bad_neg",
        negotiation_auth=bad_payload,
        custom_parameters={"vendor_name": "Decor Direct"},
    )

    assert ctx.negotiation.authorized is False
    assert ctx.negotiation.target_price is None


# ---------------------------------------------------------------------------
# 4. Context Size Bounding Test
# ---------------------------------------------------------------------------

def test_context_size_is_bounded():
    """Verify oversized descriptions or prompt injections are rejected."""
    builder = VoiceContextBuilder(max_char_limit=1000)
    huge_description = "A" * 1500

    with pytest.raises(VoiceContextValidationError) as exc:
        builder.build(
            session_id="sess_huge",
            custom_parameters={"task_description": huge_description},
        )
    assert "exceeds maximum character limit" in str(exc.value)


# ---------------------------------------------------------------------------
# 5. Gemini Integration & Isolation Tests
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_concurrent_calls_receive_isolated_contexts():
    """Verify two concurrent calls operate completely isolated contexts without cross-leakage."""
    class DummyWs:
        async def send_text(self, t): pass

    s1 = ExotelVoiceSession(websocket=DummyWs(), session_id="call_alpha")
    s1.stream_sid = "sid_alpha"
    s1.custom_parameters = {
        "event_name": "Medical Tech Expo",
        "task_name": "Booth Fabrication",
        "vendor_name": "Stands R Us",
    }

    s2 = ExotelVoiceSession(websocket=DummyWs(), session_id="call_beta")
    s2.stream_sid = "sid_beta"
    s2.custom_parameters = {
        "event_name": "Beach Wedding",
        "task_name": "Fairy Lights Canopy",
        "vendor_name": "Coastal Illumination",
    }

    bridge1 = GeminiLiveBridge(session=s1, client_factory=lambda: None)
    bridge2 = GeminiLiveBridge(session=s2, client_factory=lambda: None)

    # Context 1 checks
    assert bridge1.sanitized_context.event_name == "Medical Tech Expo"
    assert bridge1.sanitized_context.vendor_name == "Stands R Us"
    assert "Stands R Us" in bridge1.system_prompt
    assert "Coastal Illumination" not in bridge1.system_prompt

    # Context 2 checks
    assert bridge2.sanitized_context.event_name == "Beach Wedding"
    assert bridge2.sanitized_context.vendor_name == "Coastal Illumination"
    assert "Coastal Illumination" in bridge2.system_prompt
    assert "Stands R Us" not in bridge2.system_prompt


def test_transcript_correlation_retains_all_six_identifiers():
    """Verify conversation state maintains all 6 identifiers for Task 5 correlation."""
    class DummyWs:
        async def send_text(self, t): pass

    s = ExotelVoiceSession(websocket=DummyWs(), session_id="sess_corr_123")
    s.call_sid = "call_corr_456"
    s.stream_sid = "stream_corr_789"
    s.custom_parameters = {
        "event_id": "evt_111",
        "task_id": "tsk_222",
        "provider_id": "prv_333",
        "vendor_name": "Rapid Sound",
    }

    bridge = GeminiLiveBridge(session=s, client_factory=lambda: None)
    state = bridge.get_conversation_state()

    assert state["session_id"] == "sess_corr_123"
    assert state["call_sid"] == "call_corr_456"
    assert state["stream_sid"] == "stream_corr_789"
    assert state["event_id"] == "evt_111"
    assert state["task_id"] == "tsk_222"
    assert state["provider_id"] == "prv_333"
    assert "status" in state
    assert "turn_count" in state
    assert "duration_seconds" in state
    assert "transcript_turns" in state


def test_current_gemini_model_configuration():
    """Verify default Gemini Live model configuration is updated to gemini-3.8-live."""
    assert settings.GEMINI_LIVE_MODEL == "gemini-3.8-live"

    class DummyWs:
        async def send_text(self, t): pass

    s = ExotelVoiceSession(websocket=DummyWs())
    bridge = GeminiLiveBridge(session=s, client_factory=lambda: None)
    assert bridge.model == "gemini-3.8-live"
