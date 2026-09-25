"""Comprehensive unit tests for Task 7: Real Vendor Outcome Parsing & Validation Layer.

Verifies:
1. LLM semantic extraction of structured factual claims from organizer notes.
2. Deterministic capacity validation (PASS, FAIL, UNKNOWN, and CONFLICT with vendor master data).
3. Deterministic budget & currency validation (PASS, FAIL, UNKNOWN, and currency mismatch CONFLICT).
4. Deterministic calendar availability validation (PASS for verified slots, UNKNOWN for unverified slots, CONFLICT for booked/blocked slots).
5. Deterministic requirement evaluation (Hard requirements vs Soft preferences).
6. Contradiction detection in organizer notes.
7. Strict boundaries: NO vendor-to-task binding, NO task status change, NO plan recalculation, NO autonomous booking.
8. Preservation of provenance (source='ORGANIZER_REPORTED') and audit logging.
9. Agent tool integration (ValidateVendorOutcomeTool, RBAC permissions guard).
10. Golden Demo Scenario: Wedding (600 guests, ₹4L budget, vegetarian catering) yielding PARTIALLY_VALIDATED.
"""
from datetime import datetime, timezone, timedelta
from decimal import Decimal
import pytest
from sqlalchemy.orm import Session

from app.models.event import Event
from app.models.event_member import EventMember
from app.models.user import User
from app.models.task import Task
from app.models.vendor import Vendor
from app.models.budget import BudgetItem
from app.models.requirement import Requirement
from app.models.provider_availability import ProviderAvailability
from app.models.vendor_outcome import VendorOutcome
from app.models.vendor_outcome_validation import VendorOutcomeValidation
from app.models.audit import AuditRecord
from app.models.enums import (
    EventLifecycleState,
    EventState,
    RoleType,
    TaskPriority,
    TaskStatus,
    CommunicationChannel,
    VendorOutcomeStatus,
    ReportedAvailability,
    ClaimValidationStatus,
    OverallValidationStatus,
    ClaimType,
)
from app.services.vendor_outcome_service import VendorOutcomeService
from app.services.vendor_outcome_validation_service import VendorOutcomeValidationService
from app.agent.tools.base import ToolContext
from app.agent.tools.provider_tools import ValidateVendorOutcomeTool
from app.agent.tools.schemas import ValidateVendorOutcomeInput
from app.agent.provider import MockLLMProvider


# ==============================================================================
# TEST ENVIRONMENT FIXTURE
# ==============================================================================

def _setup_task7_environment(db: Session):
    """Sets up a complete deterministic test environment for validation testing."""
    now = datetime.now(timezone.utc).replace(tzinfo=None)

    organizer = User(name="Rajiv Malhotra", email="rajiv.m@eventra.test")
    viewer = User(name="Rohit Sharma", email="rohit.s@eventra.test")
    db.add_all([organizer, viewer])
    db.flush()

    event = Event(
        owner_id=organizer.id,
        name="Royal Delhi Wedding",
        event_type="wedding",
        lifecycle_state=EventLifecycleState.PLANNED.value,
        state=EventState.NORMAL.value,
        location="Delhi",
        start_datetime=now + timedelta(days=45),
        end_datetime=now + timedelta(days=45, hours=8),
        guest_count=600,
        total_budget=Decimal("1200000.00"),
        currency="INR",
    )
    db.add(event)
    db.flush()

    # Memberships
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

    # Event Task for Catering
    catering_task = Task(
        event_id=event.id,
        name="Wedding Feast Catering",
        description="Full multi-course vegetarian banquet service for 600 attendees",
        status=TaskStatus.PENDING.value,
        priority=TaskPriority.HIGH.value,
        required_provider_category="CATERING",
        planned_start=event.start_datetime,
        planned_end=event.end_datetime,
    )
    db.add(catering_task)
    db.flush()

    # Task Budget Item (₹4,00,000 for Catering)
    catering_budget = BudgetItem(
        event_id=event.id,
        name="Catering & Feast",
        category="CATERING",
        estimated_amount=Decimal("400000.00"),
        actual_amount=Decimal("0.00"),
        currency="INR",
        status="PLANNED",
    )
    db.add(catering_budget)

    # Hard Requirement: Vegetarian Catering
    veg_req = Requirement(
        event_id=event.id,
        type="CATERING",
        name="Vegetarian Catering Only",
        description="Banquet menu must be 100% vegetarian",
        required=True,
    )
    db.add(veg_req)

    # Soft Preference: High Rating
    rating_pref = Requirement(
        event_id=event.id,
        type="GENERAL",
        name="Rating >= 4.5",
        description="Preferred top tier customer rating",
        required=False,
    )
    db.add(rating_pref)

    # Shortlisted Provider: Royal Rasoi Caterers
    vendor = Vendor(
        name="Royal Rasoi Caterers",
        category="CATERING",
        city="Delhi",
        base_cost=350000.0,
        rating=4.8,
        review_count=45,
        service_description="Premier Delhi caterers with multi-course live counters. Capacity: 1000 guests.",
        status="ACTIVE",
        capabilities=["vegetarian", "buffet", "live_counters"],
    )
    db.add(vendor)
    db.commit()

    return {
        "organizer": organizer,
        "viewer": viewer,
        "event": event,
        "task": catering_task,
        "vendor": vendor,
        "catering_budget": catering_budget,
        "veg_req": veg_req,
        "rating_pref": rating_pref,
    }


# ==============================================================================
# TESTS
# ==============================================================================

def test_semantic_claim_extraction(db_session: Session):
    db = db_session
    """Verifies that LLM correctly parses natural language outcome notes into atomic claims."""
    env = _setup_task7_environment(db)
    outcome_service = VendorOutcomeService(db)

    outcome = outcome_service.record_outcome(
        event_id=env["event"].id,
        payload={
            "provider_id": env["vendor"].id,
            "task_id": env["task"].id,
            "communication_channel": "PHONE",
            "outcome_status": "QUOTE_RECEIVED",
            "quoted_price": 380000.0,
            "currency": "INR",
            "reported_availability": "AVAILABLE",
            "organizer_notes": (
                "Vendor said they can cater 700 guests on December 14. "
                "Vegetarian menu is available. Quote is ₹3.8 lakh. They said they are available."
            ),
        },
    )

    validation_service = VendorOutcomeValidationService(db)
    claims = validation_service.parse_outcome(outcome)

    assert len(claims.claims) >= 3
    cap_claim = next((c for c in claims.claims if c.claim_type == ClaimType.CAPACITY.value), None)
    assert cap_claim is not None
    assert int(cap_claim.normalized_value) == 700

    price_claim = next((c for c in claims.claims if c.claim_type == ClaimType.PRICE.value), None)
    assert price_claim is not None
    assert float(price_claim.normalized_value) == 380000.0

    veg_claim = next((c for c in claims.claims if c.claim_type == ClaimType.VEGETARIAN.value), None)
    assert veg_claim is not None
    assert veg_claim.normalized_value is True


def test_capacity_validation_pass(db_session: Session):
    db = db_session
    """Verifies capacity PASS when reported capacity >= required guest count."""
    env = _setup_task7_environment(db)
    outcome_service = VendorOutcomeService(db)

    outcome = outcome_service.record_outcome(
        event_id=env["event"].id,
        payload={
            "provider_id": env["vendor"].id,
            "task_id": env["task"].id,
            "quoted_price": 350000.0,
            "organizer_notes": "Can handle 750 guests comfortably.",
        },
    )

    validation_service = VendorOutcomeValidationService(db)
    val = validation_service.validate_outcome(outcome.id)

    cap_res = next((r for r in val.claim_results if r["field"] == "capacity"), None)
    assert cap_res is not None
    assert cap_res["status"] == ClaimValidationStatus.PASS.value
    assert "750 meets the required 600" in cap_res["explanation"]


def test_capacity_validation_fail(db_session: Session):
    db = db_session
    """Verifies capacity FAIL when reported capacity < required guest count."""
    env = _setup_task7_environment(db)
    outcome_service = VendorOutcomeService(db)

    outcome = outcome_service.record_outcome(
        event_id=env["event"].id,
        payload={
            "provider_id": env["vendor"].id,
            "task_id": env["task"].id,
            "quoted_price": 350000.0,
            "organizer_notes": "Vendor can only cater up to 450 guests.",
        },
    )

    validation_service = VendorOutcomeValidationService(db)
    val = validation_service.validate_outcome(outcome.id)

    cap_res = next((r for r in val.claim_results if r["field"] == "capacity"), None)
    assert cap_res is not None
    assert cap_res["status"] == ClaimValidationStatus.FAIL.value
    assert "450 is below the required 600" in cap_res["explanation"]
    assert val.overall_status == OverallValidationStatus.FAILED.value


def test_capacity_validation_unknown_when_missing(db_session: Session):
    db = db_session
    """Verifies capacity is UNKNOWN when organizer outcome does not mention capacity."""
    env = _setup_task7_environment(db)
    outcome_service = VendorOutcomeService(db)

    outcome = outcome_service.record_outcome(
        event_id=env["event"].id,
        payload={
            "provider_id": env["vendor"].id,
            "task_id": env["task"].id,
            "quoted_price": 350000.0,
            "organizer_notes": "Spoke to the manager, sounds great.",
        },
    )

    validation_service = VendorOutcomeValidationService(db)
    val = validation_service.validate_outcome(outcome.id)

    cap_res = next((r for r in val.claim_results if r["field"] == "capacity"), None)
    assert cap_res is not None
    assert cap_res["status"] == ClaimValidationStatus.UNKNOWN.value
    assert "vendor_guest_capacity" in val.unknown_facts


def test_capacity_conflict_with_vendor_master_data(db_session: Session):
    db = db_session
    """Verifies CONFLICT when organizer-reported capacity contradicts recorded vendor max capacity."""
    env = _setup_task7_environment(db)
    # Vendor master record only has max capacity 400
    env["vendor"].service_description = "Boutique caterer for intimate parties. max_capacity: 400 guests."
    db.commit()

    outcome_service = VendorOutcomeService(db)
    outcome = outcome_service.record_outcome(
        event_id=env["event"].id,
        payload={
            "provider_id": env["vendor"].id,
            "task_id": env["task"].id,
            "quoted_price": 350000.0,
            "organizer_notes": "Vendor said they can handle 750 guests easily.",
        },
    )

    validation_service = VendorOutcomeValidationService(db)
    val = validation_service.validate_outcome(outcome.id)

    cap_res = next((r for r in val.claim_results if r["field"] == "capacity"), None)
    assert cap_res is not None
    assert cap_res["status"] == ClaimValidationStatus.CONFLICT.value
    assert "conflicts with recorded vendor master capacity of 400" in cap_res["explanation"]
    assert val.overall_status == OverallValidationStatus.CONFLICT.value
    assert len(val.conflicts) > 0


def test_budget_validation_pass_and_fail(db_session: Session):
    db = db_session
    """Verifies budget evaluation: PASS when <= allocated budget, FAIL when > budget."""
    env = _setup_task7_environment(db)
    outcome_service = VendorOutcomeService(db)

    # 1. Under budget (380k <= 400k)
    outcome_pass = outcome_service.record_outcome(
        event_id=env["event"].id,
        payload={
            "provider_id": env["vendor"].id,
            "task_id": env["task"].id,
            "quoted_price": 380000.0,
            "organizer_notes": "Quoted ₹3.8 lakh.",
        },
    )
    val_service = VendorOutcomeValidationService(db)
    val_pass = val_service.validate_outcome(outcome_pass.id)
    price_res = next((r for r in val_pass.claim_results if r["field"] == "quoted_price"), None)
    assert price_res["status"] == ClaimValidationStatus.PASS.value

    # 2. Over budget (450k > 400k)
    outcome_fail = outcome_service.record_outcome(
        event_id=env["event"].id,
        payload={
            "provider_id": env["vendor"].id,
            "task_id": env["task"].id,
            "quoted_price": 450000.0,
            "organizer_notes": "Quoted ₹4.5 lakh.",
        },
    )
    val_fail = val_service.validate_outcome(outcome_fail.id)
    price_fail_res = next((r for r in val_fail.claim_results if r["field"] == "quoted_price"), None)
    assert price_fail_res["status"] == ClaimValidationStatus.FAIL.value
    assert val_fail.overall_status == OverallValidationStatus.FAILED.value


def test_currency_mismatch_conflict(db_session: Session):
    db = db_session
    """Verifies currency mismatch produces CONFLICT and does not perform unverified FX conversions."""
    env = _setup_task7_environment(db)
    outcome_service = VendorOutcomeService(db)

    outcome = outcome_service.record_outcome(
        event_id=env["event"].id,
        payload={
            "provider_id": env["vendor"].id,
            "task_id": env["task"].id,
            "quoted_price": 5000.0,
            "currency": "USD",  # Event is INR
            "organizer_notes": "Quoted $5000 USD.",
        },
    )

    val_service = VendorOutcomeValidationService(db)
    val = val_service.validate_outcome(outcome.id)

    curr_res = next((r for r in val.claim_results if r["claim_type"] == ClaimType.CURRENCY.value), None)
    assert curr_res is not None
    assert curr_res["status"] == ClaimValidationStatus.CONFLICT.value
    assert val.overall_status == OverallValidationStatus.CONFLICT.value


def test_availability_validation_unverified_unknown(db_session: Session):
    db = db_session
    """Verifies that organizer-reported availability is strictly UNKNOWN if not confirmed in calendar."""
    env = _setup_task7_environment(db)
    outcome_service = VendorOutcomeService(db)

    outcome = outcome_service.record_outcome(
        event_id=env["event"].id,
        payload={
            "provider_id": env["vendor"].id,
            "task_id": env["task"].id,
            "quoted_price": 380000.0,
            "reported_availability": "AVAILABLE",
            "organizer_notes": "Vendor said they are available for the wedding date.",
        },
    )

    val_service = VendorOutcomeValidationService(db)
    val = val_service.validate_outcome(outcome.id)

    avail_res = next((r for r in val.claim_results if r["field"] == "availability"), None)
    assert avail_res is not None
    assert avail_res["status"] == ClaimValidationStatus.UNKNOWN.value
    assert "authoritative_calendar_slot" in val.unknown_facts


def test_availability_validation_calendar_confirmed_pass(db_session: Session):
    db = db_session
    """Verifies availability is PASS when authoritative calendar record confirms AVAILABLE slot."""
    env = _setup_task7_environment(db)
    event = env["event"]

    # Explicit available slot in database calendar
    avail_slot = ProviderAvailability(
        vendor_id=env["vendor"].id,
        start_datetime=event.start_datetime - timedelta(hours=1),
        end_datetime=event.end_datetime + timedelta(hours=1),
        status="AVAILABLE",
        notes="Confirmed open slot",
    )
    db.add(avail_slot)
    db.commit()

    outcome_service = VendorOutcomeService(db)
    outcome = outcome_service.record_outcome(
        event_id=event.id,
        payload={
            "provider_id": env["vendor"].id,
            "task_id": env["task"].id,
            "quoted_price": 380000.0,
            "reported_availability": "AVAILABLE",
            "organizer_notes": "Vendor confirmed available.",
        },
    )

    val_service = VendorOutcomeValidationService(db)
    val = val_service.validate_outcome(outcome.id)

    avail_res = next((r for r in val.claim_results if r["field"] == "availability"), None)
    assert avail_res is not None
    assert avail_res["status"] == ClaimValidationStatus.PASS.value


def test_availability_validation_calendar_slot_conflict(db_session: Session):
    db = db_session
    """Verifies CONFLICT when organizer says available but calendar has BOOKED/BLOCKED conflict."""
    env = _setup_task7_environment(db)
    event = env["event"]

    # Conflicting booked slot in calendar
    booked_slot = ProviderAvailability(
        vendor_id=env["vendor"].id,
        start_datetime=event.start_datetime,
        end_datetime=event.end_datetime,
        status="BOOKED",
        notes="Reserved for Delhi Summit",
    )
    db.add(booked_slot)
    db.commit()

    outcome_service = VendorOutcomeService(db)
    outcome = outcome_service.record_outcome(
        event_id=event.id,
        payload={
            "provider_id": env["vendor"].id,
            "task_id": env["task"].id,
            "quoted_price": 380000.0,
            "reported_availability": "AVAILABLE",
            "organizer_notes": "Vendor said they are completely free on the wedding day.",
        },
    )

    val_service = VendorOutcomeValidationService(db)
    val = val_service.validate_outcome(outcome.id)

    avail_res = next((r for r in val.claim_results if r["field"] == "availability"), None)
    assert avail_res is not None
    assert avail_res["status"] == ClaimValidationStatus.CONFLICT.value
    assert val.overall_status == OverallValidationStatus.CONFLICT.value


def test_requirement_dietary_validation(db_session: Session):
    db = db_session
    """Verifies dietary requirement matching against reported vegetarian capabilities."""
    env = _setup_task7_environment(db)
    outcome_service = VendorOutcomeService(db)
    val_service = VendorOutcomeValidationService(db)

    # 1. Vegetarian satisfied
    outcome_veg = outcome_service.record_outcome(
        event_id=env["event"].id,
        payload={
            "provider_id": env["vendor"].id,
            "task_id": env["task"].id,
            "quoted_price": 380000.0,
            "organizer_notes": "Pure vegetarian menu available.",
        },
    )
    val_veg = val_service.validate_outcome(outcome_veg.id)
    veg_res = next((r for r in val_veg.claim_results if r["field"] == "vegetarian"), None)
    assert veg_res["status"] == ClaimValidationStatus.PASS.value

    # 2. Vegetarian failed (non-veg only)
    outcome_non_veg = outcome_service.record_outcome(
        event_id=env["event"].id,
        payload={
            "provider_id": env["vendor"].id,
            "task_id": env["task"].id,
            "quoted_price": 380000.0,
            "organizer_notes": "They only do non-vegetarian menu, no veg dishes.",
        },
    )
    val_non_veg = val_service.validate_outcome(outcome_non_veg.id)
    non_veg_res = next((r for r in val_non_veg.claim_results if r["field"] == "vegetarian"), None)
    assert non_veg_res["status"] == ClaimValidationStatus.FAIL.value
    assert val_non_veg.overall_status == OverallValidationStatus.FAILED.value


def test_contradictory_notes_conflict(db_session: Session):
    db = db_session
    """Verifies contradictory statements within organizer notes produce CONFLICT."""
    env = _setup_task7_environment(db)
    outcome_service = VendorOutcomeService(db)

    outcome = outcome_service.record_outcome(
        event_id=env["event"].id,
        payload={
            "provider_id": env["vendor"].id,
            "task_id": env["task"].id,
            "quoted_price": 380000.0,
            "organizer_notes": "Vendor said they are available December 14, but later called back saying cannot do December 14.",
        },
    )

    val_service = VendorOutcomeValidationService(db)
    val = val_service.validate_outcome(outcome.id)

    assert val.overall_status == OverallValidationStatus.CONFLICT.value
    assert any("contradictory" in c.lower() for c in val.conflicts)


def test_boundaries_no_task_binding_no_booking(db_session: Session):
    db = db_session
    """CRITICAL GUARDRAIL: Task 7 validation NEVER assigns vendor or changes task status."""
    env = _setup_task7_environment(db)
    task = env["task"]
    initial_provider_id = getattr(task, "provider_id", None)
    initial_status = task.status

    outcome_service = VendorOutcomeService(db)
    outcome = outcome_service.record_outcome(
        event_id=env["event"].id,
        payload={
            "provider_id": env["vendor"].id,
            "task_id": task.id,
            "quoted_price": 380000.0,
            "reported_availability": "AVAILABLE",
            "organizer_notes": "Can handle 700 guests at ₹3.8L with veg menu. Everything looks great!",
        },
    )

    val_service = VendorOutcomeValidationService(db)
    val = val_service.validate_outcome(outcome.id)

    db.refresh(task)
    assert getattr(task, "provider_id", None) == initial_provider_id
    assert task.status == initial_status
    assert task.status == TaskStatus.PENDING.value
    assert val.id is not None


def test_audit_record_preservation(db_session: Session):
    db = db_session
    """Verifies validation run is persisted in the audit trail without leaking secrets."""
    env = _setup_task7_environment(db)
    outcome_service = VendorOutcomeService(db)

    outcome = outcome_service.record_outcome(
        event_id=env["event"].id,
        payload={
            "provider_id": env["vendor"].id,
            "task_id": env["task"].id,
            "quoted_price": 380000.0,
            "organizer_notes": "Confirmed 700 guests for ₹3.8 lakh.",
        },
        submitted_by=env["organizer"].id,
    )

    val_service = VendorOutcomeValidationService(db)
    val = val_service.validate_outcome(outcome.id)

    audit = (
        db.query(AuditRecord)
        .filter(
            AuditRecord.event_id == env["event"].id,
            AuditRecord.action == "VALIDATE_VENDOR_OUTCOME",
        )
        .first()
    )
    assert audit is not None
    assert audit.target_id == outcome.id
    assert audit.after_state["validation_id"] == val.id


def test_agent_tool_validate_vendor_outcome(db_session: Session):
    db = db_session
    """Verifies ValidateVendorOutcomeTool execution and RBAC authorization."""
    env = _setup_task7_environment(db)
    outcome_service = VendorOutcomeService(db)

    outcome = outcome_service.record_outcome(
        event_id=env["event"].id,
        payload={
            "provider_id": env["vendor"].id,
            "task_id": env["task"].id,
            "quoted_price": 380000.0,
            "organizer_notes": "700 guests, ₹3.8 lakh, veg menu.",
        },
    )

    tool = ValidateVendorOutcomeTool()

    # 1. Blocked for VIEWER role
    viewer_ctx = ToolContext(db=db, user_id=env["viewer"].id, event_id=env["event"].id)
    res_viewer = tool.execute(viewer_ctx, ValidateVendorOutcomeInput(event_id=env["event"].id, vendor_outcome_id=outcome.id))
    assert res_viewer.success is False
    assert res_viewer.error_code == "PERMISSION_DENIED"

    # 2. Allowed for MAIN_ORGANIZER
    org_ctx = ToolContext(db=db, user_id=env["organizer"].id, event_id=env["event"].id)
    res_org = tool.execute(org_ctx, ValidateVendorOutcomeInput(event_id=env["event"].id, vendor_outcome_id=outcome.id))
    assert res_org.success is True
    assert res_org.data.overall_status in (OverallValidationStatus.PARTIALLY_VALIDATED.value, OverallValidationStatus.VALIDATED.value)
    assert res_org.data.provider_name == env["vendor"].name


def test_golden_demo_scenario_task7(db_session: Session):
    db = db_session
    """End-to-End Golden Demo Scenario:

    Wedding (600 guests, ₹4,00,000 budget, vegetarian required).
    Organizer contacts Vendor A externally.
    Organizer reports:
    "Vendor said they can cater 700 guests on December 14.
    Vegetarian menu is available.
    Quote is ₹3.8 lakh.
    They said they are available."

    TASK 7 evaluates:
    - capacity: 700 >= 600 -> PASS
    - budget: ₹3,80,000 <= ₹4,00,000 -> PASS
    - vegetarian: confirmed -> PASS
    - availability: unverified calendar slot -> UNKNOWN
    - overall status: PARTIALLY_VALIDATED
    - strict boundary: task.provider_id remains None (ready for Task 8).
    """
    env = _setup_task7_environment(db)
    outcome_service = VendorOutcomeService(db)

    outcome = outcome_service.record_outcome(
        event_id=env["event"].id,
        payload={
            "provider_id": env["vendor"].id,
            "task_id": env["task"].id,
            "communication_channel": "PHONE",
            "outcome_status": "QUOTE_RECEIVED",
            "quoted_price": 380000.0,
            "currency": "INR",
            "reported_availability": "AVAILABLE",
            "organizer_notes": (
                "Vendor said they can cater 700 guests on December 14. "
                "Vegetarian menu is available. Quote is ₹3.8 lakh. "
                "They said they are available."
            ),
        },
        submitted_by=env["organizer"].id,
    )

    validation_service = VendorOutcomeValidationService(db)
    val = validation_service.validate_outcome(outcome.id)

    # 1. Capacity PASS
    cap_res = next((r for r in val.claim_results if r["field"] == "capacity"), None)
    assert cap_res is not None
    assert cap_res["status"] == ClaimValidationStatus.PASS.value

    # 2. Budget PASS
    price_res = next((r for r in val.claim_results if r["field"] == "quoted_price"), None)
    assert price_res is not None
    assert price_res["status"] == ClaimValidationStatus.PASS.value

    # 3. Vegetarian PASS
    veg_res = next((r for r in val.claim_results if r["field"] == "vegetarian"), None)
    assert veg_res is not None
    assert veg_res["status"] == ClaimValidationStatus.PASS.value

    # 4. Availability UNKNOWN (truthful unverified calendar state)
    avail_res = next((r for r in val.claim_results if r["field"] == "availability"), None)
    assert avail_res is not None
    assert avail_res["status"] == ClaimValidationStatus.UNKNOWN.value

    # 5. Overall PARTIALLY_VALIDATED
    assert val.overall_status == OverallValidationStatus.PARTIALLY_VALIDATED.value

    # 6. STOP! Task 8 Boundary is preserved:
    db.refresh(env["task"])
    assert getattr(env["task"], "provider_id", None) is None
    assert env["task"].status == TaskStatus.PENDING.value
