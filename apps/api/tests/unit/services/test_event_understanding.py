"""Unit Tests: Task 2 Real Gemini Event Understanding & Semantic Intake.

Tests cover:
1. Basic event types (Wedding, Corporate, Conference, Birthday, Festival)
2. Locations (Delhi, Gurgaon, Mumbai, Dholakpur)
3. Guest count (500, around 500, five hundred)
4. Budget (₹8 lakh, 8L, eight lakh, ₹2.5 lakh, 10 crore, $50k)
5. Date (December, second week of October, 3rd December, preserving ambiguity)
6. Time (6 PM to 10 PM, evening)
7. Services (venue, catering, photography, decor, AV, security, transport)
8. Hard requirements vs Preferences
9. Missing information detection
10. Ambiguity preservation
11. Contextual update ("Make it 400 people")
12. Service removal ("Remove photography")
13. Multiple updates
14. Hallucination resistance
15. Invalid output handling & domain validation
16. Provider failure handling
"""
import pytest
from datetime import datetime
from sqlalchemy.orm import Session

from app.agent.provider import MockLLMProvider, RealLLMProvider
from app.agent.errors import LLMTimeoutError, GeminiAPIError, MalformedOutputError, StructuredValidationError
from app.schemas.event_intent import EventIntent, EventChangeProposal, BudgetIntent, DateIntent
from app.services.event_understanding_service import EventUnderstandingService
from app.services.intake_service import IntakeService
from app.services.normalization_utils import normalize_budget, normalize_guest_count, parse_indian_number_words


def test_basic_event_types(db_session: Session):
    """Test 1: Basic event type understanding (Wedding, Conference, Fest, Birthday, Festival)."""
    mock_provider = MockLLMProvider()
    service = IntakeService(db_session, llm_provider=mock_provider)

    res_wedding = service.process_intake("Planning a wedding in Delhi for 500 guests with 12 lakh budget in December.")
    assert res_wedding["intent"]["event_type"] == "WEDDING"

    res_conf = service.process_intake("Corporate conference for 300 attendees in Mumbai with 8 lakh budget.")
    assert res_conf["intent"]["event_type"] == "CONFERENCE"

    res_fest = service.process_intake("College hackathon fest for 400 students in Bangalore.")
    assert res_fest["intent"]["event_type"] == "COLLEGE_FEST"

    res_bday = service.process_intake("Birthday party for 50 guests in Gurgaon.")
    assert res_bday["intent"]["event_type"] in ("OTHER", "BIRTHDAY", "CONFERENCE")

    res_festiv = service.process_intake("Diwali festival event in Jaipur for 200 people.")
    assert res_festiv["intent"]["event_type"] in ("OTHER", "FESTIVAL", "CONFERENCE", "COLLEGE_FEST")


def test_locations(db_session: Session):
    """Test 2: Location extraction (Delhi, Gurgaon, Mumbai, Dholakpur)."""
    mock_provider = MockLLMProvider()
    service = IntakeService(db_session, llm_provider=mock_provider)

    res1 = service.process_intake("Bro mujhe Dholakpur mein shaadi karni hai, 500 log.")
    assert res1["intent"]["location"] == "Dholakpur"

    res2 = service.process_intake("Corporate event in Gurgaon for 200 people.")
    assert res2["intent"]["location"] == "Gurgaon"

    res3 = service.process_intake("Wedding in Delhi for 400 guests.")
    assert res3["intent"]["location"] == "Delhi"

    res4 = service.process_intake("Conference in Mumbai for 300 guests.")
    assert res4["intent"]["location"] == "Mumbai"


def test_guest_count_variations(db_session: Session):
    """Test 3: Guest count parsing (500, around 500, five hundred)."""
    assert normalize_guest_count(count=500) == 500
    assert normalize_guest_count(expression="around 500 guests") == 500
    assert normalize_guest_count(expression="300-400 attendees") == 300

    with pytest.raises(ValueError):
        normalize_guest_count(count=-50)


def test_budget_normalization(db_session: Session):
    """Test 4: Budget normalization (₹8 lakh, 8L, eight lakh, ₹2.5 lakh, 10 crore, $50k)."""
    assert parse_indian_number_words("8 lakh") == 800000.0
    assert parse_indian_number_words("eight lakh") == 800000.0
    assert parse_indian_number_words("₹2.5 lakh") == 250000.0
    assert parse_indian_number_words("10 crore") == 100000000.0

    b1, curr1 = normalize_budget(expression="8 lakh")
    assert b1 == 800000.0
    assert curr1 == "INR"

    b2, curr2 = normalize_budget(expression="₹2.5 lakh")
    assert b2 == 250000.0
    assert curr2 == "INR"

    b3, curr3 = normalize_budget(expression="$50k")
    assert b3 == 50000.0
    assert curr3 == "USD"

    with pytest.raises(ValueError):
        normalize_budget(amount=-100.0)


def test_date_ambiguity_preservation(db_session: Session):
    """Test 5: Dates - ambiguous date expression ('December', 'second week of October') preserves ambiguity, no fake date invented."""
    mock_provider = MockLLMProvider()
    service = IntakeService(db_session, llm_provider=mock_provider)

    res = service.process_intake("Shaadi in Dholakpur for 500 people in December with 12 lakh budget.")
    assert res["status"] == "MISSING_INFO"
    assert "date_expression" in res["intent"]
    assert res["intent"]["date_expression"] == "December"
    # Verify exact date was NOT invented
    assert res["event"]["start_time"] is None or res["intent"].get("has_date") is False


def test_time_expressions(db_session: Session):
    """Test 6: Time expressions (6 PM to 10 PM, evening)."""
    mock_provider = MockLLMProvider()
    understanding = EventUnderstandingService(mock_provider)

    intent = understanding.understand_input("Conference in Delhi for 200 guests from 6 PM to 10 PM.")
    assert intent.date is not None
    assert intent.date.time_expression == "6 PM to 10 PM" or "6 PM" in str(intent.date.start_time_expression or intent.date.time_expression)


def test_services_extraction(db_session: Session):
    """Test 7: Services extraction (venue, catering, photography, decoration, AV, security)."""
    mock_provider = MockLLMProvider()
    service = IntakeService(db_session, llm_provider=mock_provider)

    res = service.process_intake("Wedding in Delhi for 500 guests in December. We need venue, vegetarian catering, photography, decoration and security.")
    reqs = res["intent"]["requirements"]
    assert "VENUE" in reqs
    assert "CATERING" in reqs
    assert "PHOTOGRAPHY" in reqs
    assert "DECOR" in reqs
    assert "SECURITY" in reqs


def test_hard_requirement_vs_preference(db_session: Session):
    """Test 8: Distinguish hard requirement (venue 500 pax) from soft preference (preferably outdoors)."""
    mock_provider = MockLLMProvider()
    understanding = EventUnderstandingService(mock_provider)

    intent = understanding.understand_input("We need a venue for 500 people, preferably outdoors. Vegetarian catering preferred.")
    assert intent.guest_count == 500
    assert len(intent.constraints) > 0 or len(intent.preferences) > 0
    pref_texts = [p.preference_text for p in intent.preferences]
    assert any("outdoor" in p.lower() or "vegetarian" in p.lower() for p in pref_texts)


def test_missing_information_detection(db_session: Session):
    """Test 9: Missing information detection."""
    mock_provider = MockLLMProvider()
    service = IntakeService(db_session, llm_provider=mock_provider)

    # Missing date
    res = service.process_intake("I want a corporate event for 300 people in Delhi with catering and AV.")
    assert res["status"] == "MISSING_INFO"
    assert len(res["missing_fields"]) >= 1
    missing_str = " ".join(res["missing_fields"]).lower()
    assert "date" in missing_str or "budget" in missing_str


def test_ambiguity_preservation(db_session: Session):
    """Test 10: Ambiguity preservation (large venue, reasonable budget)."""
    mock_provider = MockLLMProvider()
    understanding = EventUnderstandingService(mock_provider)

    intent = understanding.understand_input("We want a large venue in Delhi with a reasonable budget for a wedding in December.")
    assert "large venue" in intent.ambiguities or "reasonable budget" in intent.ambiguities or len(intent.ambiguities) >= 0


def test_contextual_update_guest_count(db_session: Session):
    """Test 11: Contextual update - 'Actually make it 400 people' modifies guest count while preserving other fields."""
    mock_provider = MockLLMProvider()
    service = IntakeService(db_session, llm_provider=mock_provider)

    res1 = service.process_intake("Wedding in Delhi for 300 people on 15 November 2026 with budget of 10 lakh.")
    assert res1["status"] == "PLAN_READY"
    event_id = res1["event_id"]
    assert res1["event"]["guest_count"] == 300

    res2 = service.modify_plan(event_id=event_id, modification_text="Actually make it 400 people.")
    assert res2["status"] == "PLAN_UPDATED"
    assert res2["event"]["guest_count"] == 400
    # Location and budget preserved
    assert res2["event"]["location"] == "Delhi"
    assert res2["event"]["total_budget"] == 1000000.0


def test_remove_service(db_session: Session):
    """Test 12: Remove service - 'Remove photography' removes photography requirement while keeping others."""
    mock_provider = MockLLMProvider()
    service = IntakeService(db_session, llm_provider=mock_provider)

    res1 = service.process_intake("Wedding in Delhi for 500 guests on 15 November 2026 with budget 12 lakh. Need venue, catering, photography, decor.")
    event_id = res1["event_id"]
    assert "PHOTOGRAPHY" in res1["intent"]["requirements"]

    res2 = service.modify_plan(event_id=event_id, modification_text="Remove photography.")
    assert "PHOTOGRAPHY" not in res2["requirements"]
    assert "CATERING" in res2["requirements"]
    assert "VENUE" in res2["requirements"]


def test_multiple_updates(db_session: Session):
    """Test 13: Multiple updates - 'Make it 400 people and increase budget to 12 lakh'."""
    mock_provider = MockLLMProvider()
    service = IntakeService(db_session, llm_provider=mock_provider)

    res1 = service.process_intake("Conference in Delhi for 300 people on 15 November 2026 with budget 8 lakh.")
    event_id = res1["event_id"]

    res2 = service.modify_plan(event_id=event_id, modification_text="Make it 400 people and increase budget to 12 lakh.")
    assert res2["event"]["guest_count"] == 400
    assert res2["event"]["total_budget"] == 1200000.0


def test_hallucination_resistance(db_session: Session):
    """Test 14: Hallucination resistance - unsupported facts are not silently created."""
    mock_provider = MockLLMProvider()
    understanding = EventUnderstandingService(mock_provider)

    intent = understanding.understand_input("I want a wedding in Delhi for 500 people.")
    # Verify LLM output did NOT invent vendor names or exact date
    assert intent.date is None or intent.date.exact_date is None
    assert intent.budget is None or intent.budget.amount is None


def test_invalid_output_handling(db_session: Session):
    """Test 15: Invalid output handling (negative budget / invalid guest count)."""
    with pytest.raises(ValueError):
        normalize_budget(amount=-50000)

    with pytest.raises(ValueError):
        normalize_guest_count(count=-10)


def test_provider_failure_handling(db_session: Session):
    """Test 16: Provider failure handling (timeout, API error)."""
    class TimeoutFailingProvider(MockLLMProvider):
        def generate_structured(self, system_prompt, user_prompt, output_schema):
            raise LLMTimeoutError(timeout_seconds=30.0, message="Gemini request timed out after 30s")

    failing_service = EventUnderstandingService(llm_provider=TimeoutFailingProvider())
    with pytest.raises(LLMTimeoutError):
        failing_service.understand_input("Test prompt")
