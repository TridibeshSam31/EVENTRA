"""Unit Tests for EVENTRA Voice-First Event Intake (Part 1, 2, 3).

Verifies:
1. SpeechProvider interface & error handling (Part 1).
2. Realistic multilingual fixtures (Hindi, Hinglish, English) producing correct fields (Part 2).
3. Missing budget yields budget in missing_fields, not an invented number (Part 2).
4. preview creates zero Event rows (Part 2).
5. confirm creates exactly one event matching typed-intake result (Part 3).
6. Activity stream log records voice intake with detected language (Part 3).
"""
import pytest
from datetime import datetime
from sqlalchemy.orm import Session
from fastapi.testclient import TestClient

from app.models.event import Event
from app.models.activity_log import EventActivityLog
from app.services.speech_service import (
    SpeechProvider,
    TranscriptResult,
    GeminiSpeechProvider,
    WhisperSpeechProvider,
    get_speech_provider,
)
from app.api.routes.intake import (
    VoicePreviewRequest,
    VoiceConfirmRequest,
    preview_voice_intake,
    confirm_voice_intake,
)
from app.services.intake_service import IntakeService
from app.agent.provider import MockLLMProvider


def test_speech_provider_missing_key_fails_loudly():
    """Part 1: If configured provider has no key, fail loudly with clear error (no fake silent transcript)."""
    gemini_prov = GeminiSpeechProvider(api_key=None)
    gemini_prov.api_key = None
    with pytest.raises(ValueError, match="Gemini API key is not configured"):
        gemini_prov.transcribe(audio_bytes=b"dummy-audio-bytes", mime_type="audio/webm")

    whisper_prov = WhisperSpeechProvider(api_key=None)
    whisper_prov.api_key = None
    with pytest.raises(ValueError, match="OpenAI API key is not configured"):
        whisper_prov.transcribe(audio_bytes=b"dummy-audio-bytes", mime_type="audio/webm")


def test_speech_provider_interface_contract():
    """Part 1: Verify TranscriptResult data contract."""
    res = TranscriptResult(
        text="नमस्ते शादी",
        detected_language="hi",
        english_text="Hello wedding",
        confidence=0.95,
        provider="gemini",
    )
    assert res.text == "नमस्ते शादी"
    assert res.detected_language == "hi"
    assert res.english_text == "Hello wedding"
    assert res.confidence == 0.95
    assert res.provider == "gemini"


def test_transcribe_endpoint_validations(client: TestClient):
    """Part 1: Validate allowed audio mime types and rejection of empty/invalid files."""
    # 1. Invalid mime type
    res = client.post(
        "/api/events/intake/voice/transcribe",
        files={"file": ("test.txt", b"plain text is not audio", "text/plain")},
        headers={"x-user-id": "test_operator"},
    )
    assert res.status_code == 400
    assert "Unsupported audio format" in res.json()["detail"]

    # 2. Corrupt / empty audio
    res_empty = client.post(
        "/api/events/intake/voice/transcribe",
        files={"file": ("test.webm", b"", "audio/webm")},
        headers={"x-user-id": "test_operator"},
    )
    assert res_empty.status_code == 400
    assert "empty or corrupt" in res_empty.json()["detail"].lower()


def test_voice_preview_hindi_fixture(db_session: Session):
    """Part 2: Hindi transcript producing correct fields, quotes, and provenance."""
    # Realistic fixture: Hindi speech with English rendering from STT
    req = VoicePreviewRequest(
        transcript="नमस्ते, हमें दिल्ली में 15 नवंबर को 500 लोगों के लिए एक भव्य शादी आयोजित करनी है, हमारा कुल बजट 25 लाख रुपये है।",
        english_text="Hello, we want to organize a grand wedding in Delhi on 15 November for 500 people, our total budget is 25 lakh rupees.",
        detected_language="hi",
    )

    preview = preview_voice_intake(req, db=db_session)

    # 1. Verification of fields
    assert preview.fields["event_type"].value == "WEDDING"
    assert preview.fields["event_type"].source == "stated"

    assert preview.fields["location"].value == "Delhi"
    assert preview.fields["location"].source == "stated"
    assert "दिल्ली" in (preview.fields["location"].evidence_quote or "") or "Delhi" in (preview.fields["location"].evidence_quote or "")

    assert preview.fields["guest_count"].value == 500
    assert preview.fields["guest_count"].source == "stated"

    assert preview.fields["total_budget"].value == 2500000.0
    assert preview.fields["total_budget"].source == "stated"
    assert preview.fields["currency"].value == "INR"

    # Name is inferred / suggested because user did not state an explicit event title
    assert preview.fields["name"].source == "inferred"
    assert "Wedding" in preview.fields["name"].value

    assert preview.detected_language == "hi"


def test_voice_preview_hinglish_fixture(db_session: Session):
    """Part 2: Hinglish code-switching transcript producing correct fields."""
    req = VoicePreviewRequest(
        transcript="Humein Delhi me ek grand wedding plan karni hai 15 November ko 500 logo ke liye. Total budget 25 lakh rupees hai, catering chahiye.",
        english_text="We want to plan a grand wedding in Delhi on 15 November for 500 people. Total budget is 25 lakh rupees, need catering.",
        detected_language="hi-en",
    )

    preview = preview_voice_intake(req, db=db_session)

    assert preview.fields["event_type"].value == "WEDDING"
    assert preview.fields["location"].value == "Delhi"
    assert preview.fields["guest_count"].value == 500
    assert preview.fields["total_budget"].value == 2500000.0
    assert preview.fields["currency"].value == "INR"
    assert preview.detected_language == "hi-en"
    assert len(preview.suggestions) > 0  # AI proposed typical suggestions like photography, decor


def test_voice_preview_english_fixture(db_session: Session):
    """Part 2: English transcript producing correct fields."""
    req = VoicePreviewRequest(
        transcript="We are planning a technology conference in Mumbai on 3rd December 2026 for 300 attendees with a total budget of 8 lakh INR. We need AV tech and catering.",
        english_text="We are planning a technology conference in Mumbai on 3rd December 2026 for 300 attendees with a total budget of 8 lakh INR. We need AV tech and catering.",
        detected_language="en",
    )

    preview = preview_voice_intake(req, db=db_session)

    assert preview.fields["event_type"].value == "CONFERENCE"
    assert preview.fields["location"].value == "Mumbai"
    assert preview.fields["guest_count"].value == 300
    assert preview.fields["total_budget"].value == 800000.0
    assert preview.fields["currency"].value == "INR"


def test_voice_preview_missing_budget_not_guessed(db_session: Session):
    """Part 2 Hard Rule: A transcript with a missing budget must yield budget in missing_fields, not a guessed number."""
    # Note: 400 students is guest count, no budget is spoken
    req = VoicePreviewRequest(
        transcript="We want to organize a college hackathon fest in Bangalore for 400 students next week.",
        english_text="We want to organize a college hackathon fest in Bangalore for 400 students next week.",
        detected_language="en",
    )

    preview = preview_voice_intake(req, db=db_session)

    # Budget must NOT be invented
    assert preview.fields["total_budget"].value is None
    assert preview.fields["total_budget"].source == "default"

    # Must be flagged in missing_fields and clarifying_questions
    assert any("budget" in mf.lower() for mf in preview.missing_fields)
    assert any("budget" in q.lower() for q in preview.clarifying_questions)


def test_voice_preview_creates_zero_event_rows(db_session: Session):
    """Part 2 & Part 3: preview must NEVER persist or modify any Event rows."""
    initial_event_count = db_session.query(Event).count()

    req = VoicePreviewRequest(
        transcript="Humein Delhi me ek grand wedding plan karni hai 15 November ko 500 logo ke liye. Total budget 25 lakh rupees hai.",
        english_text="We want to plan a grand wedding in Delhi on 15 November for 500 people. Total budget is 25 lakh rupees.",
        detected_language="hi-en",
    )

    preview = preview_voice_intake(req, db=db_session)
    assert preview is not None

    after_event_count = db_session.query(Event).count()
    # Strictly zero new Event rows
    assert after_event_count == initial_event_count


def test_voice_confirm_creates_exactly_one_event_and_matches_typed_intake(db_session: Session):
    """Part 3: confirm creates exactly one event, matches typed intake result, and logs activity."""
    initial_event_count = db_session.query(Event).count()
    initial_logs_count = db_session.query(EventActivityLog).count()

    confirm_req = VoiceConfirmRequest(
        fields={
            "name": "Delhi Royal Wedding 2026",
            "event_type": "WEDDING",
            "location": "Delhi",
            "guest_count": 500,
            "total_budget": 2500000.0,
            "currency": "INR",
            "date_expression": "15 November 2026",
            "requirements": ["CATERING"],
        },
        accepted_suggestions=["sug_decor", "sug_photography"],
        detected_language="hi-en",
        original_transcript="Humein Delhi me ek grand wedding plan karni hai 15 November ko 500 logo ke liye. Total budget 25 lakh rupees hai.",
    )

    result = confirm_voice_intake(
        req=confirm_req,
        db=db_session,
        current_user_id="test_organizer_voice",
    )

    # 1. Assert exactly one event row was created
    new_event_count = db_session.query(Event).count()
    assert new_event_count == initial_event_count + 1

    event_id = result.get("event_id") or result["event"]["id"]
    event = db_session.query(Event).filter(Event.id == event_id).first()
    assert event is not None
    assert event.name == "Delhi Royal Wedding 2026"
    assert event.event_type == "WEDDING"
    assert event.location == "Delhi"
    assert event.guest_count == 500
    assert float(event.total_budget) == 2500000.0
    assert event.currency == "INR"

    # Plan was generated
    assert result["status"] == "PLAN_READY"
    assert result.get("plan") is not None

    # 2. Assert activity log recorded voice intake confirmation
    log = db_session.query(EventActivityLog).filter(
        EventActivityLog.event_id == event.id,
        EventActivityLog.action == "VOICE_INTAKE_CONFIRMED",
    ).first()
    assert log is not None
    assert log.actor == "ORGANIZER"
    assert "voice intake" in log.summary.lower()
    assert log.details.get("detected_language") == "hi-en"
    assert "Delhi Royal Wedding 2026" in log.details.get("canonical_summary")

    # 3. Compare with typed intake for equivalent summary
    typed_service = IntakeService(db_session)
    typed_result = typed_service.process_intake(
        message="Organize a WEDDING named 'Delhi Royal Wedding 2026' in Delhi for 500 attendees on 15 November 2026. Budget: 2500000.0 INR. Required services: Catering, Decor, Photography.",
        force_plan=True,
        user_id="test_organizer_typed",
    )
    typed_event_id = typed_result.get("event_id") or typed_result["event"]["id"]
    typed_event = db_session.query(Event).filter(Event.id == typed_event_id).first()

    assert event.event_type == typed_event.event_type
    assert event.location == typed_event.location
    assert event.guest_count == typed_event.guest_count
    assert float(event.total_budget) == float(typed_event.total_budget)
    assert event.currency == typed_event.currency
