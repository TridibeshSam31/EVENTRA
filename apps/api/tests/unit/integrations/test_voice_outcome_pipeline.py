"""Comprehensive unit tests for Task 5: Gemini Voice Transcript → Structured Vendor Outcome Pipeline.

Verifies:
1. Clear availability statement → candidate availability claim (AVAILABLE)
2. Clear price statement → candidate price claim (quoted_price=50000.0, currency="INR")
3. Capacity statement → candidate capacity claim (capacity=500)
4. Ambiguous statement → uncertainty preserved ("around 50k", "probably Saturday", "let me check")
5. Vendor claim does not automatically become authoritative (verification_status="UNVERIFIED", source="AI_VOICE_CALL")
6. Voice provenance is preserved (source="AI_VOICE_CALL", channel="PHONE", session_id, call_sid, stream_sid)
7. All correlation IDs are preserved (event_id, task_id, provider_id, session_id, call_sid, stream_sid)
8. Existing deterministic validation is invoked (VendorOutcomeValidationService)
9. Existing VendorTaskBindingService is invoked only after validation and with authorization
10. Empty transcript handled safely
11. Missing task/event/provider handled safely
12. Parser failure handled safely
13. Validation failure does not bind vendor
14. Duplicate call completion is idempotent
15. Sensitive EVENTRA context never enters outcome/parser payload
16. End-to-end mocked flow: Transcript → Candidate VendorOutcome → Existing validation → Existing binding
17. Validated voice claim without required engagement/approval does NOT assign vendor
18. Validated voice claim with viewer authorization is BLOCKED
19. Validated voice claim with pre-approved engagement CAN bind vendor
20. Existing non-voice vendor outcome behavior remains strictly ORGANIZER_REPORTED
"""
from datetime import datetime, timezone, timedelta
from decimal import Decimal
from unittest.mock import MagicMock, patch
import pytest
from sqlalchemy.orm import Session

from app.core.exceptions import BadRequestException
from app.models.approval import Approval
from app.models.event import Event
from app.models.event_member import EventMember
from app.models.user import User
from app.models.task import Task
from app.models.vendor import Vendor
from app.models.vendor_outcome import VendorOutcome
from app.models.vendor_outcome_validation import VendorOutcomeValidation
from app.models.vendor_assignment import VendorAssignment
from app.models.budget import BudgetItem
from app.models.provider_availability import ProviderAvailability
from app.models.enums import (
    BindingStatus,
    BlockingReason,
    EventLifecycleState,
    EventState,
    RoleType,
    TaskPriority,
    TaskStatus,
    CommunicationChannel,
    VendorOutcomeStatus,
    ReportedAvailability,
)
from app.integrations.communication.gemini_bridge import (
    TranscriptEntry,
    TranscriptSpeaker,
)
from app.integrations.communication.voice_context_builder import (
    SanitizedVoiceContext,
    AuthorizedNegotiationContext,
)
from app.integrations.communication.voice_outcome_parser import (
    ParsedVoiceOutcome,
    VoiceOutcomeParser,
    VoiceOutcomePipeline,
    VoiceOutcomeResult,
)
from app.services.vendor_outcome_service import VendorOutcomeService
from app.schemas.vendor_outcome import VendorOutcomeCreate


def _setup_test_environment(db: Session):
    """Creates a deterministic test environment with User, Event, Task, Vendor, Budget, and Calendar slot."""
    now = datetime.now(timezone.utc).replace(tzinfo=None)

    organizer = User(name="Test Organizer", email="organizer@eventra.test")
    viewer = User(name="Viewer User", email="viewer@eventra.test")
    db.add_all([organizer, viewer])
    db.flush()

    event = Event(
        owner_id=organizer.id,
        name="Annual Tech Gala 2026",
        event_type="gala",
        lifecycle_state=EventLifecycleState.PLANNED.value,
        state=EventState.NORMAL.value,
        location="Bengaluru",
        start_datetime=now + timedelta(days=30),
        end_datetime=now + timedelta(days=30, hours=6),
        guest_count=500,
        total_budget=Decimal("500000.00"),
        currency="INR",
    )
    db.add(event)
    db.flush()

    org_member = EventMember(
        event_id=event.id,
        user_id=organizer.id,
        role=RoleType.MAIN_ORGANIZER.value,
    )
    viewer_member = EventMember(
        event_id=event.id,
        user_id=viewer.id,
        role=RoleType.VIEWER.value,
    )
    db.add_all([org_member, viewer_member])

    task = Task(
        event_id=event.id,
        name="Audio Visual & Stage Setup",
        description="Stage lighting, LED screens, sound consoles for 500 attendees",
        status=TaskStatus.READY.value,
        priority=TaskPriority.HIGH.value,
        required_provider_category="audio_visual",
        duration_minutes=300,
    )
    db.add(task)
    db.flush()

    vendor = Vendor(
        name="Bangalore Sound & Light Pros",
        category="audio_visual",
        city="Bengaluru",
        address="Koramangala, Bengaluru",
        base_cost=45000.0,
        rating=4.9,
        review_count=85,
        status="ACTIVE",
        capabilities=["stage_lighting", "led_screens", "sound_consoles"],
        service_description="Top-tier concert and event stage equipment rentals.",
    )
    db.add(vendor)
    db.flush()

    budget_item = BudgetItem(
        event_id=event.id,
        name="Audio Visual Budget",
        category="audio_visual",
        estimated_amount=Decimal("80000.00"),
        actual_amount=Decimal("0.00"),
        currency="INR",
        status="PLANNED",
    )
    db.add(budget_item)

    slot = ProviderAvailability(
        vendor_id=vendor.id,
        start_datetime=event.start_datetime - timedelta(hours=2),
        end_datetime=event.end_datetime + timedelta(hours=2),
        status="AVAILABLE",
    )
    db.add(slot)
    db.commit()

    return {
        "organizer": organizer,
        "viewer": viewer,
        "event": event,
        "task": task,
        "vendor": vendor,
        "budget_item": budget_item,
        "slot": slot,
    }


# ==============================================================================
# TEST CASES
# ==============================================================================

def test_01_clear_availability_statement_extracts_candidate_claim():
    """1. Clear availability statement → candidate availability claim (AVAILABLE)."""
    parser = VoiceOutcomeParser()
    transcript = [
        TranscriptEntry(
            speaker=TranscriptSpeaker.AGENT,
            text="Hello, we are inquiring about your availability for an event on October 25th in Bengaluru.",
        ),
        TranscriptEntry(
            speaker=TranscriptSpeaker.VENDOR,
            text="Yes, we are available on that date and can take this event.",
        ),
    ]

    parsed = parser.parse(transcript)
    assert parsed.reported_availability == ReportedAvailability.AVAILABLE.value
    assert parsed.outcome_status == VendorOutcomeStatus.AVAILABLE.value
    assert not any("conditional" in u.lower() for u in parsed.uncertainties)


def test_02_clear_price_statement_extracts_candidate_price_claim():
    """2. Clear price statement → candidate price claim (quoted_price=50000.0, currency=INR)."""
    parser = VoiceOutcomeParser()
    transcript = [
        TranscriptEntry(
            speaker=TranscriptSpeaker.AGENT,
            text="What would be your total quote for the lighting and sound setup?",
        ),
        TranscriptEntry(
            speaker=TranscriptSpeaker.VENDOR,
            text="Our total charge for this setup would be ₹50,000 including technician support.",
        ),
    ]

    parsed = parser.parse(transcript)
    assert parsed.quoted_price == 50000.0
    assert parsed.currency == "INR"
    assert parsed.outcome_status == VendorOutcomeStatus.QUOTE_RECEIVED.value


def test_03_capacity_statement_extracts_candidate_capacity_claim():
    """3. Capacity statement → candidate capacity claim."""
    parser = VoiceOutcomeParser()
    transcript = [
        TranscriptEntry(
            speaker=TranscriptSpeaker.VENDOR,
            text="Yes, our sound system can easily cover 500 guests in an auditorium hall.",
        ),
    ]

    parsed = parser.parse(transcript)
    assert parsed.capacity == 500


def test_04_ambiguous_statement_preserves_uncertainty():
    """4. Ambiguous statement → uncertainty preserved.
    Expressions like 'around 50k', 'probably Saturday', 'let me check' must NOT become exact authoritative facts.
    """
    parser = VoiceOutcomeParser()

    # Ambiguous price
    ambiguous_price_transcript = [
        TranscriptEntry(
            speaker=TranscriptSpeaker.VENDOR,
            text="It would be somewhere around 50k, but I am not completely sure.",
        ),
    ]
    parsed_price = parser.parse(ambiguous_price_transcript)
    assert parsed_price.quoted_price is None  # Ambiguity preserved, not set to exact float
    assert len(parsed_price.uncertainties) > 0
    assert any("ambiguous price" in u.lower() for u in parsed_price.uncertainties)

    # Ambiguous availability
    ambiguous_avail_transcript = [
        TranscriptEntry(
            speaker=TranscriptSpeaker.VENDOR,
            text="Let me check our schedule, probably we can do it, maybe Saturday works.",
        ),
    ]
    parsed_avail = parser.parse(ambiguous_avail_transcript)
    assert parsed_avail.reported_availability == ReportedAvailability.CONDITIONAL.value
    assert any("conditional or tentative" in u.lower() for u in parsed_avail.uncertainties)


def test_05_vendor_claim_does_not_automatically_become_authoritative(db_session: Session):
    """5. Vendor claim does not automatically become authoritative (source=AI_VOICE_CALL, unverified)."""
    env = _setup_test_environment(db_session)
    pipeline = VoiceOutcomePipeline(db_session)

    transcript = [
        TranscriptEntry(
            speaker=TranscriptSpeaker.VENDOR,
            text="Yes, we are available and our price is ₹40,000.",
        ),
    ]

    result = pipeline.process_call_completion(
        session_id="session-auth-check-001",
        event_id=env["event"].id,
        task_id=env["task"].id,
        provider_id=env["vendor"].id,
        call_sid="call-exotel-auth-001",
        stream_sid="stream-exotel-auth-001",
        transcript=transcript,
        auto_bind=False,
    )

    outcome: VendorOutcome = result.outcome
    assert outcome.source == "AI_VOICE_CALL"
    # Verification status is determined strictly by deterministic validation, not Gemini
    assert outcome.verification_status in ("UNVERIFIED", "PARTIALLY_VALIDATED", "VALIDATED")
    assert outcome.communication_channel == CommunicationChannel.PHONE.value
    # Voice outcome submission does not directly mutate task state
    assert env["task"].provider_id is None
    assert env["task"].status == TaskStatus.READY.value


def test_06_voice_provenance_is_preserved(db_session: Session):
    """6. Voice provenance is preserved in outcome record with AI_VOICE_CALL."""
    env = _setup_test_environment(db_session)
    pipeline = VoiceOutcomePipeline(db_session)

    transcript = [
        TranscriptEntry(
            speaker=TranscriptSpeaker.VENDOR,
            text="Yes, we are available on that weekend.",
        ),
    ]

    result = pipeline.process_call_completion(
        session_id="session-prov-001",
        event_id=env["event"].id,
        task_id=env["task"].id,
        provider_id=env["vendor"].id,
        call_sid="call-sid-prov-001",
        stream_sid="stream-sid-prov-001",
        transcript=transcript,
        auto_bind=False,
    )

    outcome: VendorOutcome = result.outcome
    assert outcome.source == "AI_VOICE_CALL"
    assert outcome.vendor_response is not None
    assert outcome.vendor_response["session_id"] == "session-prov-001"
    assert outcome.vendor_response["call_sid"] == "call-sid-prov-001"
    assert outcome.vendor_response["stream_sid"] == "stream-sid-prov-001"
    assert outcome.vendor_response["provenance"]["source"] == "AI_VOICE_CALL"
    assert outcome.vendor_response["provenance"]["channel"] == "EXOTEL_AGENTSTREAM_GEMINI_LIVE"


def test_07_all_correlation_ids_are_preserved(db_session: Session):
    """7. All correlation IDs are preserved across the result and models."""
    env = _setup_test_environment(db_session)
    pipeline = VoiceOutcomePipeline(db_session)

    transcript = [
        TranscriptEntry(
            speaker=TranscriptSpeaker.VENDOR,
            text="Confirmed, we can do it.",
        ),
    ]

    result = pipeline.process_call_completion(
        session_id="sess-corr-123",
        event_id=env["event"].id,
        task_id=env["task"].id,
        provider_id=env["vendor"].id,
        call_sid="call-corr-456",
        stream_sid="stream-corr-789",
        transcript=transcript,
        auto_bind=False,
    )

    assert result.session_id == "sess-corr-123"
    assert result.event_id == env["event"].id
    assert result.task_id == env["task"].id
    assert result.provider_id == env["vendor"].id

    outcome = result.outcome
    assert outcome.event_id == env["event"].id
    assert outcome.task_id == env["task"].id
    assert outcome.provider_id == env["vendor"].id


def test_08_existing_deterministic_validation_is_invoked(db_session: Session):
    """8. Existing deterministic validation is invoked (VendorOutcomeValidationService)."""
    env = _setup_test_environment(db_session)
    pipeline = VoiceOutcomePipeline(db_session)

    transcript = [
        TranscriptEntry(
            speaker=TranscriptSpeaker.VENDOR,
            text="Yes, we are available and our fee is 45000.",
        ),
    ]

    result = pipeline.process_call_completion(
        session_id="session-val-001",
        event_id=env["event"].id,
        task_id=env["task"].id,
        provider_id=env["vendor"].id,
        call_sid="call-val-001",
        stream_sid="stream-val-001",
        transcript=transcript,
        auto_bind=False,
    )

    assert result.validation is not None
    assert isinstance(result.validation, VendorOutcomeValidation)
    assert result.validation.vendor_outcome_id == result.outcome_id
    assert result.validation.event_id == env["event"].id
    assert result.validation.overall_status in ("VALIDATED", "PARTIALLY_VALIDATED", "FAILED", "CONFLICT", "INSUFFICIENT_INFORMATION")


def test_09_existing_task_binding_service_invoked_after_validation(db_session: Session):
    """9. Existing VendorTaskBindingService is invoked only after validation with organizer authorization."""
    env = _setup_test_environment(db_session)
    pipeline = VoiceOutcomePipeline(db_session)

    transcript = [
        TranscriptEntry(
            speaker=TranscriptSpeaker.VENDOR,
            text="Yes, we are available and our total quote is ₹45,000.",
        ),
    ]

    result = pipeline.process_call_completion(
        session_id="session-bind-001",
        event_id=env["event"].id,
        task_id=env["task"].id,
        provider_id=env["vendor"].id,
        call_sid="call-bind-001",
        stream_sid="stream-bind-001",
        transcript=transcript,
        authorizing_user_id=env["organizer"].id,
        auto_bind=True,
    )

    assert result.validation is not None
    assert result.binding_decision is not None
    assert hasattr(result.binding_decision, "can_bind")
    assert result.is_bound is True


def test_10_empty_transcript_handled_safely(db_session: Session):
    """10. Empty transcript handled safely without exceptions."""
    env = _setup_test_environment(db_session)
    pipeline = VoiceOutcomePipeline(db_session)

    result = pipeline.process_call_completion(
        session_id="session-empty-001",
        event_id=env["event"].id,
        task_id=env["task"].id,
        provider_id=env["vendor"].id,
        call_sid="call-empty-001",
        stream_sid="stream-empty-001",
        transcript=[],
        auto_bind=False,
    )

    assert result.outcome_id is not None
    assert result.outcome.outcome_status == VendorOutcomeStatus.NO_RESPONSE.value
    assert result.outcome.reported_availability == ReportedAvailability.UNKNOWN.value
    assert result.outcome.quoted_price is None


def test_11_missing_task_event_provider_handled_safely(db_session: Session):
    """11. Missing task/event/provider handled safely (fails closed)."""
    pipeline = VoiceOutcomePipeline(db_session)

    # Missing event_id
    with pytest.raises(BadRequestException) as exc_info:
        pipeline.process_call_completion(
            session_id="sess-missing-event",
            event_id=None,
            provider_id="some-provider",
        )
    assert "event_id is required" in str(exc_info.value)

    # Missing provider_id
    with pytest.raises(BadRequestException) as exc_info2:
        pipeline.process_call_completion(
            session_id="sess-missing-provider",
            event_id="some-event",
            provider_id=None,
        )
    assert "provider_id is required" in str(exc_info2.value)

    # Missing session_id
    with pytest.raises(BadRequestException) as exc_info3:
        pipeline.process_call_completion(
            session_id=None,
            event_id="some-event",
            provider_id="some-provider",
        )
    assert "session_id is required" in str(exc_info3.value)


def test_12_parser_failure_handled_safely():
    """12. Parser failure handled safely (empty or malformed entries)."""
    parser = VoiceOutcomeParser()

    # None transcript
    parsed_none = parser.parse([])
    assert parsed_none.reported_availability == ReportedAvailability.UNKNOWN.value

    # Transcript with only agent speech
    agent_only = [
        TranscriptEntry(
            speaker=TranscriptSpeaker.AGENT,
            text="Hello? Are you there?",
        )
    ]
    parsed_agent = parser.parse(agent_only)
    assert parsed_agent.outcome_status == VendorOutcomeStatus.NO_RESPONSE.value
    assert parsed_agent.reported_availability == ReportedAvailability.UNKNOWN.value


def test_13_validation_failure_does_not_bind_vendor(db_session: Session):
    """13. Validation failure does not bind vendor (e.g. unavailable vendor)."""
    env = _setup_test_environment(db_session)
    pipeline = VoiceOutcomePipeline(db_session)

    transcript = [
        TranscriptEntry(
            speaker=TranscriptSpeaker.VENDOR,
            text="No, we are not available and already booked up for that date.",
        ),
    ]

    result = pipeline.process_call_completion(
        session_id="session-unavail-001",
        event_id=env["event"].id,
        task_id=env["task"].id,
        provider_id=env["vendor"].id,
        call_sid="call-unavail-001",
        stream_sid="stream-unavail-001",
        transcript=transcript,
        authorizing_user_id=env["organizer"].id,
        auto_bind=True,
    )

    assert result.is_bound is False
    assert result.binding_decision is not None
    assert result.binding_decision.can_bind is False
    assert result.binding_result is None


def test_14_duplicate_call_completion_is_idempotent(db_session: Session):
    """14. Duplicate call completion is idempotent (no duplicate DB outcomes)."""
    env = _setup_test_environment(db_session)
    pipeline = VoiceOutcomePipeline(db_session)

    transcript = [
        TranscriptEntry(
            speaker=TranscriptSpeaker.VENDOR,
            text="Yes, we are available and our fee is 40000.",
        ),
    ]

    # First completion
    res1 = pipeline.process_call_completion(
        session_id="session-idem-001",
        event_id=env["event"].id,
        task_id=env["task"].id,
        provider_id=env["vendor"].id,
        call_sid="call-idem-001",
        stream_sid="stream-idem-001",
        transcript=transcript,
        auto_bind=False,
    )
    assert res1.idempotent_replay is False

    # Second completion with same session_id
    res2 = pipeline.process_call_completion(
        session_id="session-idem-001",
        event_id=env["event"].id,
        task_id=env["task"].id,
        provider_id=env["vendor"].id,
        call_sid="call-idem-001",
        stream_sid="stream-idem-001",
        transcript=transcript,
        auto_bind=False,
    )
    assert res2.idempotent_replay is True
    assert res2.outcome_id == res1.outcome_id

    # Verify only ONE outcome was persisted
    count = (
        db_session.query(VendorOutcome)
        .filter(
            VendorOutcome.event_id == env["event"].id,
            VendorOutcome.provider_id == env["vendor"].id,
        )
        .count()
    )
    assert count == 1


def test_15_sensitive_eventra_context_never_enters_outcome_or_parser_payload(db_session: Session):
    """15. Sensitive EVENTRA context never enters outcome/parser payload."""
    env = _setup_test_environment(db_session)
    pipeline = VoiceOutcomePipeline(db_session)

    # Create sanitized context with explicit negotiation bounds
    sanitized = SanitizedVoiceContext(
        session_id="session-sec-001",
        event_id=env["event"].id,
        task_id=env["task"].id,
        provider_id=env["vendor"].id,
        event_name="Annual Tech Gala 2026",
        event_type="gala",
        event_city="Bengaluru",
        task_name="Audio Visual & Stage Setup",
        task_category="audio_visual",
        service_requirements="Stage lighting, LED screens, sound consoles",
        guest_count=500,
        event_date="2026-10-25",
        event_time_window="18:00 - 23:00",
        vendor_name="Bangalore Sound & Light Pros",
        authorized_negotiation=AuthorizedNegotiationContext(
            is_authorized=True,
            target_budget=40000.0,
            hard_max_budget=50000.0,
            currency="INR",
        ),
    )

    transcript = [
        TranscriptEntry(
            speaker=TranscriptSpeaker.VENDOR,
            text="Yes, we can do it for ₹48,000.",
        ),
    ]

    result = pipeline.process_call_completion(
        session_id="session-sec-001",
        event_id=env["event"].id,
        task_id=env["task"].id,
        provider_id=env["vendor"].id,
        call_sid="call-sec-001",
        stream_sid="stream-sec-001",
        transcript=transcript,
        sanitized_context=sanitized,
        auto_bind=False,
    )

    outcome = result.outcome
    notes = outcome.organizer_notes
    resp_str = str(outcome.vendor_response)

    # Invariants: internal budget, margins, credentials, or private strategy MUST NOT leak
    forbidden_terms = [
        "total_budget",
        "internal_margin",
        "target_budget",
        "hard_max_budget",
        "organizer_notes",
        "api_key",
        "token",
        "secret",
    ]
    for term in forbidden_terms:
        assert term not in notes.lower(), f"Forbidden internal term '{term}' leaked in organizer notes!"
        assert term not in resp_str.lower(), f"Forbidden internal term '{term}' leaked in vendor response payload!"


def test_16_end_to_end_mocked_flow(db_session: Session):
    """16. End-to-end mocked flow: Transcript → Candidate VendorOutcome → Existing validation → Authorized binding."""
    env = _setup_test_environment(db_session)
    pipeline = VoiceOutcomePipeline(db_session)

    transcript = [
        TranscriptEntry(
            speaker=TranscriptSpeaker.AGENT,
            text="Hello from EVENTRA. We are calling regarding the AV setup for our Tech Gala on October 25th.",
        ),
        TranscriptEntry(
            speaker=TranscriptSpeaker.VENDOR,
            text="Yes, we are available on that date and we can take this.",
        ),
        TranscriptEntry(
            speaker=TranscriptSpeaker.AGENT,
            text="Could you provide a quote for the complete stage lighting and sound setup for 500 guests?",
        ),
        TranscriptEntry(
            speaker=TranscriptSpeaker.VENDOR,
            text="We can provide setup for 500 guests for ₹45,000 total.",
        ),
    ]

    result = pipeline.process_call_completion(
        session_id="session-e2e-001",
        event_id=env["event"].id,
        task_id=env["task"].id,
        provider_id=env["vendor"].id,
        call_sid="call-e2e-001",
        stream_sid="stream-e2e-001",
        transcript=transcript,
        authorizing_user_id=env["organizer"].id,
        auto_bind=True,
    )

    # 1. Candidate outcome created
    assert result.outcome_id is not None
    assert result.outcome.outcome_status == VendorOutcomeStatus.QUOTE_RECEIVED.value
    assert result.outcome.quoted_price == 45000.0
    assert result.outcome.reported_availability == ReportedAvailability.AVAILABLE.value
    assert result.outcome.source == "AI_VOICE_CALL"
    assert result.outcome.verification_status in ("VALIDATED", "PARTIALLY_VALIDATED")

    # 2. Existing validation executed
    assert result.validation is not None
    assert result.validation.overall_status in ("VALIDATED", "PARTIALLY_VALIDATED")

    # 3. Existing binding evaluated and performed
    assert result.binding_decision is not None
    assert result.binding_decision.can_bind is True
    assert result.is_bound is True
    assert result.binding_result is not None
    assert result.binding_result.binding_status == BindingStatus.BOUND


def test_17_validated_voice_claim_without_authorization_does_not_bind(db_session: Session):
    """17. Validated voice claim without required engagement/approval does NOT assign vendor."""
    env = _setup_test_environment(db_session)
    pipeline = VoiceOutcomePipeline(db_session)

    transcript = [
        TranscriptEntry(
            speaker=TranscriptSpeaker.VENDOR,
            text="Yes, we can do it for ₹45,000.",
        ),
    ]

    # Call completed without authorizing organizer or pre-approved engagement
    result = pipeline.process_call_completion(
        session_id="session-no-auth-001",
        event_id=env["event"].id,
        task_id=env["task"].id,
        provider_id=env["vendor"].id,
        call_sid="call-no-auth-001",
        stream_sid="stream-no-auth-001",
        transcript=transcript,
        authorizing_user_id=None,
        auto_bind=True,
    )

    # Outcome is recorded and validated
    assert result.outcome_id is not None
    assert result.outcome.source == "AI_VOICE_CALL"
    assert result.validation is not None

    # But binding is strictly BLOCKED due to missing authorization/approval
    assert result.is_bound is False
    assert result.binding_decision is not None
    assert result.binding_decision.can_bind is False
    assert result.binding_decision.reason_code == BlockingReason.APPROVAL_REQUIRED
    assert "requires explicit organizer authorization" in result.binding_decision.reason

    # Task is NOT assigned in the database
    db_session.refresh(env["task"])
    assert env["task"].provider_id is None
    assert env["task"].status == TaskStatus.READY.value


def test_18_validated_voice_claim_with_viewer_authorization_is_blocked(db_session: Session):
    """18. Validated voice claim with read-only viewer authorization is BLOCKED."""
    env = _setup_test_environment(db_session)
    pipeline = VoiceOutcomePipeline(db_session)

    transcript = [
        TranscriptEntry(
            speaker=TranscriptSpeaker.VENDOR,
            text="Yes, we can do it for ₹45,000.",
        ),
    ]

    # Viewer attempts to authorize binding
    result = pipeline.process_call_completion(
        session_id="session-viewer-auth-001",
        event_id=env["event"].id,
        task_id=env["task"].id,
        provider_id=env["vendor"].id,
        call_sid="call-viewer-auth-001",
        stream_sid="stream-viewer-auth-001",
        transcript=transcript,
        authorizing_user_id=env["viewer"].id,
        auto_bind=True,
    )

    assert result.is_bound is False
    assert result.binding_decision is not None
    assert result.binding_decision.can_bind is False
    assert result.binding_decision.reason_code == BlockingReason.UNAUTHORIZED
    assert "VIEWER" in result.binding_decision.reason

    # Task remains unassigned
    db_session.refresh(env["task"])
    assert env["task"].provider_id is None


def test_19_validated_voice_claim_with_pre_approved_engagement_binds(db_session: Session):
    """19. Validated voice claim with pre-approved engagement CAN bind vendor."""
    env = _setup_test_environment(db_session)
    pipeline = VoiceOutcomePipeline(db_session)

    # Pre-create confirmed VendorAssignment in DB (approved engagement)
    assignment = VendorAssignment(
        event_id=env["event"].id,
        vendor_id=env["vendor"].id,
        category="audio_visual",
        status="CONFIRMED",
        negotiation_status="CONFIRMED",
        agreed_cost=45000.0,
    )
    db_session.add(assignment)
    db_session.commit()

    transcript = [
        TranscriptEntry(
            speaker=TranscriptSpeaker.VENDOR,
            text="Yes, we can do it for ₹45,000.",
        ),
    ]

    # Call completion without passing authorizing_user_id, but pre-approved engagement exists
    result = pipeline.process_call_completion(
        session_id="session-preapproved-001",
        event_id=env["event"].id,
        task_id=env["task"].id,
        provider_id=env["vendor"].id,
        call_sid="call-preapproved-001",
        stream_sid="stream-preapproved-001",
        transcript=transcript,
        authorizing_user_id=None,
        auto_bind=True,
    )

    assert result.is_bound is True
    assert result.binding_result is not None
    assert result.binding_result.binding_status == BindingStatus.BOUND

    # Task is now assigned in the database
    db_session.refresh(env["task"])
    assert env["task"].provider_id == env["vendor"].id
    assert env["task"].status == TaskStatus.ASSIGNED.value


def test_20_existing_non_voice_vendor_outcome_behavior_remains_unchanged(db_session: Session):
    """20. Existing non-voice vendor outcome behavior remains strictly ORGANIZER_REPORTED."""
    env = _setup_test_environment(db_session)
    service = VendorOutcomeService(db_session)

    # Standard non-voice outcome submission
    payload = VendorOutcomeCreate(
        provider_id=env["vendor"].id,
        task_id=env["task"].id,
        communication_channel=CommunicationChannel.PHONE.value,
        outcome_status=VendorOutcomeStatus.AVAILABLE.value,
        quoted_price=45000.0,
        currency="INR",
        reported_availability=ReportedAvailability.AVAILABLE.value,
        organizer_notes="Spoke to vendor directly over phone.",
    )

    outcome = service.record_outcome(
        event_id=env["event"].id,
        payload=payload,
        submitted_by=env["organizer"].id,
    )

    assert outcome.source == "ORGANIZER_REPORTED"
    assert outcome.verification_status == "UNVERIFIED"
    assert outcome.communication_channel == CommunicationChannel.PHONE.value
