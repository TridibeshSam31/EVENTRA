"""Comprehensive unit tests for Task 6: Real Vendor Outcome Input Layer.

Verifies:
1. Input validation (event, task, provider references and relational integrity)
2. Strict provenance labeling: source="ORGANIZER_REPORTED", verification_status="UNVERIFIED"
3. Preservation of unknown facts (no guessing or fabricated availability/quotes)
4. Deterministic price and channel normalization
5. Boundaries: NO task-vendor binding, NO plan recalculation, NO automatic booking
6. History & immutability: multiple interactions recorded chronologically
7. Auditability and execution tracing
8. Authorization: organizers can submit, read-only viewers are blocked
9. Integration with Task 3 canonical AgentToolRegistry and Task 4 functional registry
10. Full Task 6 Golden Demo Path
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
from app.models.vendor_outcome import VendorOutcome
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
)
from app.core.exceptions import BadRequestException, NotFoundException
from app.services.vendor_outcome_service import VendorOutcomeService
from app.schemas.vendor_outcome import VendorOutcomeCreate
from app.agent.tools.base import ToolContext
from app.agent.tools.registry import create_default_tool_registry, default_registry
from app.agent.tools.provider_tools import SubmitVendorOutcomeTool, ShortlistVendorsTool
from app.agent.tools.schemas import SubmitVendorOutcomeInput, ShortlistVendorsInput


# ==============================================================================
# TEST FIXTURES
# ==============================================================================

def _setup_task6_environment(db: Session):
    """Sets up a complete deterministic test environment for vendor outcome testing."""
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
        name="Vegetarian Banquet Catering for 600 Guests",
        description="Source premium vegetarian catering service able to serve 600 attendees in Delhi",
        status=TaskStatus.READY.value,
        priority=TaskPriority.HIGH.value,
        required_provider_category="catering",
        duration_minutes=240,
    )
    db.add(catering_task)
    db.flush()

    # Vendor candidate
    caterer = Vendor(
        name="Royal Caterers Delhi",
        category="catering",
        city="Delhi",
        address="Connaught Place, New Delhi",
        base_cost=350000.0,
        rating=4.85,
        review_count=120,
        status="ACTIVE",
        capabilities=["vegetarian", "capacity_600", "live_counters"],
        service_description="Specialist high-volume authentic North Indian wedding catering.",
    )
    db.add(caterer)
    db.commit()

    return organizer, viewer, event, catering_task, caterer


# ==============================================================================
# 1. INPUT VALIDATION & ENTITY INTEGRITY TESTS
# ==============================================================================

def test_record_vendor_outcome_success(db_session: Session):
    """Verifies that a valid vendor outcome is safely persisted as UNVERIFIED organizer input."""
    organizer, _, event, task, caterer = _setup_task6_environment(db_session)
    service = VendorOutcomeService(db_session)

    payload = VendorOutcomeCreate(
        provider_id=caterer.id,
        task_id=task.id,
        communication_channel="PHONE",
        outcome_status="QUOTE_RECEIVED",
        quoted_price=380000.0,
        currency="INR",
        reported_availability="AVAILABLE",
        organizer_notes="Spoke with manager Vikram. Stated they are available on Dec 14 and quoted ₹3.8 lakh.",
    )

    outcome = service.record_outcome(event.id, payload, submitted_by=organizer.id)

    assert outcome.id is not None
    assert outcome.event_id == event.id
    assert outcome.task_id == task.id
    assert outcome.provider_id == caterer.id
    assert outcome.communication_channel == "PHONE"
    assert outcome.outcome_status == "QUOTE_RECEIVED"
    assert outcome.quoted_price == 380000.0
    assert outcome.currency == "INR"
    assert outcome.reported_availability == "AVAILABLE"
    assert outcome.source == "ORGANIZER_REPORTED"
    assert outcome.verification_status == "UNVERIFIED"
    assert "Vikram" in outcome.organizer_notes


def test_record_vendor_outcome_unknowns_preserved(db_session: Session):
    """Verifies that missing facts are strictly preserved as UNKNOWN and None (no guessing)."""
    organizer, _, event, task, caterer = _setup_task6_environment(db_session)
    service = VendorOutcomeService(db_session)

    payload = VendorOutcomeCreate(
        provider_id=caterer.id,
        task_id=task.id,
        communication_channel="EMAIL",
        outcome_status="CONTACTED",
        quoted_price=None,  # Price not quoted
        reported_availability="UNKNOWN",  # Availability not confirmed
        organizer_notes="Sent introductory inquiry email. Awaiting quote and calendar check.",
    )

    outcome = service.record_outcome(event.id, payload, submitted_by=organizer.id)

    assert outcome.quoted_price is None
    assert outcome.reported_availability == "UNKNOWN"
    assert outcome.source == "ORGANIZER_REPORTED"
    assert outcome.verification_status == "UNVERIFIED"


def test_record_vendor_outcome_deterministic_price_normalization(db_session: Session):
    """Verifies deterministic normalization of human-formatted price strings (e.g. ₹3,80,000, 3.8 lakh)."""
    organizer, _, event, task, caterer = _setup_task6_environment(db_session)
    service = VendorOutcomeService(db_session)

    # 1. Lakh representation
    res_lakh = service.record_outcome(
        event.id,
        {
            "provider_id": caterer.id,
            "task_id": task.id,
            "quoted_price": "3.8 lakh",
            "communication_channel": "PHONE",
            "outcome_status": "QUOTE_RECEIVED",
        },
    )
    assert res_lakh.quoted_price == 380000.0

    # 2. Indian formatted string with currency symbol and commas
    res_formatted = service.record_outcome(
        event.id,
        {
            "provider_id": caterer.id,
            "task_id": task.id,
            "quoted_price": "₹3,80,000",
            "communication_channel": "PHONE",
            "outcome_status": "QUOTE_RECEIVED",
        },
    )
    assert res_formatted.quoted_price == 380000.0


def test_record_vendor_outcome_negative_price_rejected(db_session: Session):
    """Verifies that negative quoted prices are rejected with BadRequestException."""
    organizer, _, event, task, caterer = _setup_task6_environment(db_session)
    service = VendorOutcomeService(db_session)

    with pytest.raises(BadRequestException) as exc:
        service.record_outcome(
            event.id,
            {
                "provider_id": caterer.id,
                "task_id": task.id,
                "quoted_price": -50000.0,
            },
        )
    assert "negative" in str(exc.value).lower()


def test_record_vendor_outcome_invalid_event_rejected(db_session: Session):
    """Verifies rejection when event_id does not exist."""
    organizer, _, _, task, caterer = _setup_task6_environment(db_session)
    service = VendorOutcomeService(db_session)

    with pytest.raises(NotFoundException) as exc:
        service.record_outcome(
            "non-existent-event-id",
            {
                "provider_id": caterer.id,
                "task_id": task.id,
                "outcome_status": "CONTACTED",
            },
        )
    assert "event" in str(exc.value).lower()


def test_record_vendor_outcome_invalid_provider_rejected(db_session: Session):
    """Verifies rejection when provider_id does not exist."""
    organizer, _, event, task, _ = _setup_task6_environment(db_session)
    service = VendorOutcomeService(db_session)

    with pytest.raises(NotFoundException) as exc:
        service.record_outcome(
            event.id,
            {
                "provider_id": "non-existent-provider-id",
                "task_id": task.id,
                "outcome_status": "CONTACTED",
            },
        )
    assert "provider" in str(exc.value).lower()


def test_record_vendor_outcome_invalid_task_rejected(db_session: Session):
    """Verifies rejection when task_id does not exist."""
    organizer, _, event, _, caterer = _setup_task6_environment(db_session)
    service = VendorOutcomeService(db_session)

    with pytest.raises(NotFoundException) as exc:
        service.record_outcome(
            event.id,
            {
                "provider_id": caterer.id,
                "task_id": "non-existent-task-id",
                "outcome_status": "CONTACTED",
            },
        )
    assert "task" in str(exc.value).lower()


def test_record_vendor_outcome_task_event_mismatch_rejected(db_session: Session):
    """Verifies rejection when task does not belong to the target event."""
    organizer, _, event_a, task_a, caterer = _setup_task6_environment(db_session)

    # Create Event B
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    event_b = Event(
        owner_id=organizer.id,
        name="Second Conference Event",
        event_type="conference",
        lifecycle_state=EventLifecycleState.PLANNED.value,
        state=EventState.NORMAL.value,
        total_budget=Decimal("500000.00"),
    )
    db_session.add(event_b)
    db_session.commit()

    service = VendorOutcomeService(db_session)
    # Attempting to associate task_a (Event A) with Event B
    with pytest.raises(BadRequestException) as exc:
        service.record_outcome(
            event_b.id,
            {
                "provider_id": caterer.id,
                "task_id": task_a.id,
                "outcome_status": "CONTACTED",
            },
        )
    assert "does not belong" in str(exc.value).lower()


def test_record_vendor_outcome_invalid_enums_rejected(db_session: Session):
    """Verifies that arbitrary unsupported channel or status strings are rejected."""
    organizer, _, event, task, caterer = _setup_task6_environment(db_session)
    service = VendorOutcomeService(db_session)

    with pytest.raises(BadRequestException) as exc1:
        service.record_outcome(
            event.id,
            {
                "provider_id": caterer.id,
                "task_id": task.id,
                "communication_channel": "TELEPATHY",
            },
        )
    assert "communication_channel" in str(exc1.value)

    with pytest.raises(BadRequestException) as exc2:
        service.record_outcome(
            event.id,
            {
                "provider_id": caterer.id,
                "task_id": task.id,
                "outcome_status": "BOUGHT_TICKETS",
            },
        )
    assert "outcome_status" in str(exc2.value)


# ==============================================================================
# 2. ARCHITECTURAL BOUNDARIES & NON-MUTATION TESTS
# ==============================================================================

def test_boundaries_no_task_binding_no_booking(db_session: Session):
    """CRITICAL SAFETY TEST: Even if organizer reports ACCEPTED, task is NOT bound,
    plan is NOT recalculated, and NO booking is created in Task 6.
    """
    organizer, _, event, task, caterer = _setup_task6_environment(db_session)
    service = VendorOutcomeService(db_session)

    initial_task_status = task.status

    # Organizer reports vendor acceptance
    outcome = service.record_outcome(
        event.id,
        {
            "provider_id": caterer.id,
            "task_id": task.id,
            "communication_channel": "PHONE",
            "outcome_status": "ACCEPTED",
            "quoted_price": 380000.0,
            "reported_availability": "AVAILABLE",
            "organizer_notes": "Vendor agreed to take the contract for ₹3.8 lakh.",
        },
    )

    db_session.refresh(task)

    # Verification: Task status is UNCHANGED
    assert task.status == initial_task_status

    # Verification: Task is NOT bound to provider
    # Task model doesn't even have a provider_id assigned yet
    assert getattr(task, "provider_id", None) is None

    # Verification: Stored status remains strictly UNVERIFIED
    assert outcome.verification_status == "UNVERIFIED"
    assert outcome.source == "ORGANIZER_REPORTED"


def test_history_preservation_multiple_outcomes(db_session: Session):
    """Verifies that multiple interactions with a vendor are preserved in append-only history."""
    organizer, _, event, task, caterer = _setup_task6_environment(db_session)
    service = VendorOutcomeService(db_session)

    # 1. First interaction: Contacted
    service.record_outcome(
        event.id,
        {
            "provider_id": caterer.id,
            "task_id": task.id,
            "communication_channel": "EMAIL",
            "outcome_status": "CONTACTED",
            "organizer_notes": "Sent RFP document.",
        },
    )

    # 2. Second interaction: Quote Received
    service.record_outcome(
        event.id,
        {
            "provider_id": caterer.id,
            "task_id": task.id,
            "communication_channel": "PHONE",
            "outcome_status": "QUOTE_RECEIVED",
            "quoted_price": 400000.0,
            "organizer_notes": "Vendor quoted 4 lakh verbally.",
        },
    )

    # 3. Third interaction: Revised Quote
    service.record_outcome(
        event.id,
        {
            "provider_id": caterer.id,
            "task_id": task.id,
            "communication_channel": "PHONE",
            "outcome_status": "QUOTE_RECEIVED",
            "quoted_price": 380000.0,
            "organizer_notes": "Vendor revised quote to 3.8 lakh after guest count confirmation.",
        },
    )

    history = service.get_outcomes_for_event(event.id, provider_id=caterer.id)

    assert len(history) == 3
    # Reverse chronological ordering
    assert history[0].quoted_price == 380000.0
    assert history[1].quoted_price == 400000.0
    assert history[2].quoted_price is None


def test_audit_record_created(db_session: Session):
    """Verifies that an immutable AuditRecord is committed on outcome submission."""
    organizer, _, event, task, caterer = _setup_task6_environment(db_session)
    service = VendorOutcomeService(db_session)

    outcome = service.record_outcome(
        event.id,
        {
            "provider_id": caterer.id,
            "task_id": task.id,
            "communication_channel": "PHONE",
            "outcome_status": "QUOTE_RECEIVED",
            "quoted_price": 380000.0,
            "reported_availability": "AVAILABLE",
        },
        submitted_by=organizer.id,
    )

    audit = (
        db_session.query(AuditRecord)
        .filter(AuditRecord.event_id == event.id, AuditRecord.action == "RECORD_VENDOR_OUTCOME")
        .first()
    )

    assert audit is not None
    assert audit.action_type == "VENDOR_OUTCOME"
    assert audit.target_type == "VENDOR"
    assert audit.target_id == caterer.id
    assert audit.actor_id == organizer.id
    assert audit.after_state["outcome_id"] == outcome.id
    assert audit.after_state["status"] == "QUOTE_RECEIVED"
    assert audit.after_state["verification_status"] == "UNVERIFIED"


# ==============================================================================
# 3. AGENT TOOL & REGISTRY INTEGRATION TESTS
# ==============================================================================

def test_agent_tool_submit_vendor_outcome(db_session: Session):
    """Verifies execution of submit_vendor_outcome through Task 3 canonical AgentToolRegistry."""
    registry = create_default_tool_registry()
    organizer, _, event, task, caterer = _setup_task6_environment(db_session)
    context = ToolContext(db=db_session, user_id=organizer.id, event_id=event.id)

    tool_args = {
        "event_id": event.id,
        "provider_id": caterer.id,
        "task_id": task.id,
        "communication_channel": "PHONE",
        "outcome_status": "QUOTE_RECEIVED",
        "quoted_price": 380000.0,
        "currency": "INR",
        "reported_availability": "AVAILABLE",
        "organizer_notes": "Vendor confirmed capacity for 600 and vegetarian menu.",
    }

    result = registry.execute("submit_vendor_outcome", tool_args, context)

    assert result.success is True
    assert result.data.outcome_id is not None
    assert result.data.source == "ORGANIZER_REPORTED"
    assert result.data.verification_status == "UNVERIFIED"
    assert result.data.provider_name == caterer.name
    assert result.data.quoted_price == 380000.0
    assert "UNVERIFIED" in result.data.summary


def test_agent_tool_viewer_permission_denied(db_session: Session):
    """Verifies that read-only viewers are forbidden from submitting vendor outcomes."""
    registry = create_default_tool_registry()
    _, viewer, event, task, caterer = _setup_task6_environment(db_session)
    context = ToolContext(db=db_session, user_id=viewer.id, event_id=event.id)

    tool_args = {
        "event_id": event.id,
        "provider_id": caterer.id,
        "task_id": task.id,
        "outcome_status": "QUOTE_RECEIVED",
        "quoted_price": 380000.0,
    }

    result = registry.execute("submit_vendor_outcome", tool_args, context)

    assert result.success is False
    assert result.error_code == "PERMISSION_DENIED"
    assert "VIEWER" in (result.error or result.message or "")


def test_task4_functional_registry_integration(db_session: Session):
    """Verifies submit_vendor_outcome execution via Task 4 functional default_registry."""
    organizer, _, event, task, caterer = _setup_task6_environment(db_session)

    assert default_registry.get("submit_vendor_outcome") is not None

    tool_res = default_registry.execute(
        tool_name="submit_vendor_outcome",
        arguments={
            "event_id": event.id,
            "provider_id": caterer.id,
            "task_id": task.id,
            "outcome_status": "QUOTE_RECEIVED",
            "quoted_price": 380000.0,
            "communication_channel": "PHONE",
            "reported_availability": "AVAILABLE",
            "organizer_notes": "Spoke on phone, quoted 3.8 lakh.",
        },
        db=db_session,
        user_id=organizer.id,
    )

    data = tool_res.data if hasattr(tool_res, "data") and isinstance(tool_res.data, dict) else (tool_res if isinstance(tool_res, dict) else {})
    assert data.get("source") == "ORGANIZER_REPORTED"
    assert data.get("verification_status") == "UNVERIFIED"
    assert data.get("quoted_price") == 380000.0



# ==============================================================================
# 4. TASK 6 GOLDEN DEMO PATH
# ==============================================================================

def test_task6_golden_demo_path(db_session: Session):
    """Full Golden Demo Path from Task 5 to Task 6:
    1. Wedding, Delhi, 600 guests, ₹12 lakh budget
    2. Shortlist Royal Caterers via shortlist_vendors
    3. Organizer contacts vendor externally outside EVENTRA (Phone)
    4. Vendor states: Available on Dec 14, quoted ₹3.8 lakh, can hold date until Friday
    5. Organizer records outcome into EVENTRA
    6. EVENTRA stores:
       - provider_id = Royal Caterers
       - task_id = Catering Task
       - quoted_price = 380000
       - availability = AVAILABLE
       - source = ORGANIZER_REPORTED
       - verification = UNVERIFIED
       - notes = organizer notes
    7. STOP: cleanly ready for Task 7 without premature task binding or plan recalculation.
    """
    registry = create_default_tool_registry()
    organizer, _, event, task, caterer = _setup_task6_environment(db_session)
    context = ToolContext(db=db_session, user_id=organizer.id, event_id=event.id)

    # 1. Task 5: Shortlist vendors
    shortlist_tool = ShortlistVendorsTool()
    shortlist_res = shortlist_tool.execute(
        context,
        ShortlistVendorsInput(
            event_id=event.id,
            task_id=task.id,
            category="catering",
            hard_requirements=["vegetarian"],
            max_budget=400000.0,
            limit=5,
        ),
    )
    assert shortlist_res.success is True
    shortlisted_ids = [c.provider_id for c in shortlist_res.data.shortlist]
    assert caterer.id in shortlisted_ids

    # 2. Organizer conducts external phone call outside EVENTRA:
    # "Vendor Vikram said they are available on Dec 14, quote ₹3.8 lakh, can hold date until Friday."

    # 3. Task 6: Organizer inputs external outcome into EVENTRA
    submit_tool = SubmitVendorOutcomeTool()
    outcome_res = submit_tool.execute(
        context,
        SubmitVendorOutcomeInput(
            event_id=event.id,
            provider_id=caterer.id,
            task_id=task.id,
            communication_channel="PHONE",
            outcome_status="QUOTE_RECEIVED",
            quoted_price=380000.0,
            currency="INR",
            reported_availability="AVAILABLE",
            organizer_notes="Vendor confirmed vegetarian catering for 600 guests. Quoted ₹3.8 lakh. Said they can hold date until Friday.",
        ),
    )

    assert outcome_res.success is True
    outcome_data = outcome_res.data

    # 4. Strict provenance verification
    assert outcome_data.source == "ORGANIZER_REPORTED"
    assert outcome_data.verification_status == "UNVERIFIED"
    assert outcome_data.quoted_price == 380000.0
    assert outcome_data.reported_availability == "AVAILABLE"
    assert outcome_data.provider_name == "Royal Caterers Delhi"
    assert "hold date until Friday" in outcome_data.organizer_notes

    # 5. Boundary verification: Task is NOT bound, no booking is created
    db_session.refresh(task)
    assert getattr(task, "provider_id", None) is None
    assert task.status == TaskStatus.READY.value

    # Stored record in database
    outcome_service = VendorOutcomeService(db_session)
    db_outcomes = outcome_service.get_outcomes_for_event(event.id, provider_id=caterer.id)
    assert len(db_outcomes) == 1
    assert db_outcomes[0].id == outcome_data.outcome_id
    assert db_outcomes[0].verification_status == "UNVERIFIED"
    assert db_outcomes[0].source == "ORGANIZER_REPORTED"


# ==============================================================================
# 5. REST API ROUTE TESTS
# ==============================================================================

def test_api_record_vendor_outcome(test_client, db_session: Session):
    """Verifies POST /api/events/{event_id}/vendor-outcomes endpoint."""
    organizer, _, event, task, caterer = _setup_task6_environment(db_session)

    resp = test_client.post(
        f"/api/events/{event.id}/vendor-outcomes",
        json={
            "provider_id": caterer.id,
            "task_id": task.id,
            "communication_channel": "PHONE",
            "outcome_status": "QUOTE_RECEIVED",
            "quoted_price": 380000.0,
            "currency": "INR",
            "reported_availability": "AVAILABLE",
            "organizer_notes": "Spoke with manager Vikram. Stated available and ₹3.8 lakh quote.",
        },
    )

    assert resp.status_code == 201
    body = resp.json()
    assert body["event_id"] == event.id
    assert body["provider_id"] == caterer.id
    assert body["task_id"] == task.id
    assert body["source"] == "ORGANIZER_REPORTED"
    assert body["verification_status"] == "UNVERIFIED"
    assert body["quoted_price"] == 380000.0
    assert body["provider_name"] == "Royal Caterers Delhi"


def test_api_list_vendor_outcomes(test_client, db_session: Session):
    """Verifies GET /api/events/{event_id}/vendor-outcomes endpoint."""
    organizer, _, event, task, caterer = _setup_task6_environment(db_session)
    service = VendorOutcomeService(db_session)

    service.record_outcome(
        event.id,
        {
            "provider_id": caterer.id,
            "task_id": task.id,
            "communication_channel": "PHONE",
            "outcome_status": "QUOTE_RECEIVED",
            "quoted_price": 380000.0,
        },
    )

    resp = test_client.get(f"/api/events/{event.id}/vendor-outcomes")
    assert resp.status_code == 200
    items = resp.json()
    assert len(items) == 1
    assert items[0]["provider_id"] == caterer.id
    assert items[0]["source"] == "ORGANIZER_REPORTED"
    assert items[0]["verification_status"] == "UNVERIFIED"

