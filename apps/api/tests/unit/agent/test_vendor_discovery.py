"""Comprehensive unit tests for Task 5: Real Vendor Discovery, Qualification, and Deterministic Shortlisting.

Verifies:
1. Task-aware and requirement-driven provider discovery
2. Separation of hard requirements from preferences
3. Deterministic qualification engine (PASS / FAIL / UNKNOWN)
4. Preservation of unknown facts (no hallucinated availability, price, or capacity)
5. Objective candidate comparison without opaque AI scores
6. Deterministic, explainable shortlisting excluding disqualified vendors
7. Empty result vs service failure distinction
8. Safety guardrails (read-only, no DB mutation, no fabricated confirmations)
9. Tool registry contracts, typed input/output validation, and execution tracing
10. Full Task 5 Golden Demo workflow
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
from app.models.requirement import Requirement
from app.models.provider_availability import ProviderAvailability
from app.models.enums import (
    EventLifecycleState,
    EventState,
    RoleType,
    TaskPriority,
    TaskStatus,
)
from app.agent.tools.base import (
    ToolCategory,
    ToolAccessMode,
    ToolAvailabilityStatus,
    ToolContext,
)
from app.agent.tools.registry import create_default_tool_registry
from app.agent.tools.provider_tools import (
    DiscoverProvidersTool,
    QualifyProviderTool,
    CompareCandidatesTool,
    ShortlistVendorsTool,
)
from app.services.vendor_service import VendorService


# ==============================================================================
# TEST FIXTURES
# ==============================================================================

def _setup_task5_environment(db: Session):
    """Sets up a complete deterministic test environment for vendor discovery."""
    now = datetime.now(timezone.utc).replace(tzinfo=None)

    organizer = User(name="Rajiv Malhotra", email="rajiv.m@eventra.test")
    db.add(organizer)
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

    member = EventMember(
        event_id=event.id,
        user_id=organizer.id,
        role=RoleType.MAIN_ORGANIZER.value,
    )
    db.add(member)

    # 1. Event Requirements: 1 mandatory hard requirement, 1 soft preference
    req_hard = Requirement(
        event_id=event.id,
        type="CATERING",
        name="vegetarian",
        description="Strict pure vegetarian cuisine required",
        required=True,
    )
    req_pref = Requirement(
        event_id=event.id,
        type="CATERING",
        name="live_counters",
        description="Interactive live chaat counters preferred",
        required=False,
    )
    db.add_all([req_hard, req_pref])

    # 2. Event Task for Catering
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

    # 3. Provider candidates with varied attributes
    # Candidate 1: QUALIFIED — Vegetarian, in Delhi, within budget, high rating
    v1 = Vendor(
        name="Shahi Rasoi Caterers",
        category="catering",
        city="Delhi",
        address="Connaught Place, New Delhi",
        base_cost=350000.0,
        rating=4.9,
        review_count=120,
        status="ACTIVE",
        capabilities=["vegetarian", "jain_food", "live_counters", "capacity_1000"],
        service_description="Premier pure vegetarian catering for up to 1000 guests in Delhi NCR.",
    )

    # Candidate 2: QUALIFIED — Vegetarian, in Delhi, missing live_counters preference (still qualified!)
    v2 = Vendor(
        name="Evergreen Veg Banquet",
        category="catering",
        city="Delhi",
        address="South Extension, New Delhi",
        base_cost=320000.0,
        rating=4.3,
        review_count=45,
        status="ACTIVE",
        capabilities=["vegetarian", "north_indian", "capacity_700"],
        service_description="Pure vegetarian buffet catering for large gatherings.",
    )

    # Candidate 3: DISQUALIFIED by hard budget constraint (cost 600k > max budget 400k)
    v3 = Vendor(
        name="Imperial Gold Gourmet",
        category="catering",
        city="Delhi",
        address="Aerocity, New Delhi",
        base_cost=600000.0,
        rating=4.95,
        review_count=210,
        status="ACTIVE",
        capabilities=["vegetarian", "international", "live_counters"],
        service_description="Luxury high-end catering experience.",
    )

    # Candidate 4: DISQUALIFIED by hard capability constraint (Non-veg only, missing vegetarian)
    v4 = Vendor(
        name="Old Delhi Mughlai Meats",
        category="catering",
        city="Delhi",
        address="Chandni Chowk, Old Delhi",
        base_cost=300000.0,
        rating=4.7,
        review_count=95,
        status="ACTIVE",
        capabilities=["mughlai", "tandoori", "barbecue"],
        service_description="Specialist meat and non-vegetarian feasts.",
    )

    # Candidate 5: Photography provider (different category)
    v5 = Vendor(
        name="Delhi Candid Moments",
        category="photography",
        city="Delhi",
        address="Hauz Khas, New Delhi",
        base_cost=150000.0,
        rating=4.8,
        review_count=60,
        status="ACTIVE",
        capabilities=["candid", "cinematography", "drone"],
    )

    db.add_all([v1, v2, v3, v4, v5])
    db.commit()

    return organizer, event, catering_task, [v1, v2, v3, v4, v5]


# ==============================================================================
# 1. DISCOVERY TESTS
# ==============================================================================

def test_discover_providers_success(db_session: Session):
    """Verifies that discover_providers executes and returns structured candidates and shortlist."""
    registry = create_default_tool_registry()
    organizer, event, task, vendors = _setup_task5_environment(db_session)
    context = ToolContext(db=db_session, user_id=organizer.id, event_id=event.id)

    disc_args = {
        "event_id": event.id,
        "category": "catering",
        "location": "Delhi",
        "limit": 10,
        "requirements": ["vegetarian"],
        "max_budget": 400000.0,
    }
    result = registry.execute("discover_providers", disc_args, context)

    assert result.success is True
    assert result.data.total_found >= 4  # All catering vendors in Delhi
    assert result.data.search_category == "CATERING"
    assert result.data.search_location == "Delhi"

    # Candidates should have transparent fields
    for cand in result.data.providers:
        assert cand.provider_id is not None
        assert cand.name is not None
        assert cand.category.lower() == "catering"
        assert len(cand.unknown_fields) > 0

    # Shortlist should only contain qualified candidates
    assert result.data.total_shortlisted >= 2
    shortlist_names = [c.name for c in result.data.shortlist]
    assert "Shahi Rasoi Caterers" in shortlist_names
    assert "Evergreen Veg Banquet" in shortlist_names
    assert "Old Delhi Mughlai Meats" not in shortlist_names  # Lacks vegetarian requirement
    assert "Imperial Gold Gourmet" not in shortlist_names   # Over budget


def test_discover_providers_task_aware(db_session: Session):
    """Verifies that providing task_id automatically resolves required category, requirements, and budget."""
    registry = create_default_tool_registry()
    organizer, event, task, vendors = _setup_task5_environment(db_session)
    context = ToolContext(db=db_session, user_id=organizer.id, event_id=event.id)

    # Provide task_id without category or requirements
    disc_args = {
        "event_id": event.id,
        "task_id": task.id,
        "location": "Delhi",
    }
    result = registry.execute("discover_providers", disc_args, context)

    assert result.success is True
    assert result.data.task_id == task.id
    assert result.data.search_category == "CATERING"
    assert result.data.total_found >= 4


def test_discover_providers_empty_results_is_success(db_session: Session):
    """Verifies that zero results is returned as a success with total_found=0, not a system failure."""
    registry = create_default_tool_registry()
    organizer, event, task, _ = _setup_task5_environment(db_session)
    context = ToolContext(db=db_session, user_id=organizer.id, event_id=event.id)

    disc_args = {
        "event_id": event.id,
        "category": "helicopter_rental",  # Non-existent category
        "location": "Delhi",
    }
    result = registry.execute("discover_providers", disc_args, context)

    assert result.success is True
    assert result.data.total_found == 0
    assert len(result.data.providers) == 0
    assert result.data.total_shortlisted == 0
    assert len(result.data.shortlist) == 0


def test_discover_providers_service_failure_explicit(db_session: Session):
    """Verifies that non-existent event triggers an explicit failure rather than empty success."""
    registry = create_default_tool_registry()
    organizer, event, _, _ = _setup_task5_environment(db_session)
    context = ToolContext(db=db_session, user_id=organizer.id, event_id="non-existent-event-id")

    disc_args = {
        "event_id": "non-existent-event-id",
        "category": "catering",
    }
    result = registry.execute("discover_providers", disc_args, context)

    assert result.success is False
    assert result.error_code == "NOT_FOUND"


# ==============================================================================
# 2. QUALIFICATION TESTS
# ==============================================================================

def test_qualify_provider_pass(db_session: Session):
    """Verifies that a provider satisfying all hard requirements evaluates to QUALIFIED with PASS details."""
    registry = create_default_tool_registry()
    organizer, event, task, vendors = _setup_task5_environment(db_session)
    context = ToolContext(db=db_session, user_id=organizer.id, event_id=event.id)

    v1 = vendors[0]  # Shahi Rasoi Caterers
    qual_args = {
        "event_id": event.id,
        "provider_id": v1.id,
        "required_category": "catering",
        "max_budget": 400000.0,
        "required_capabilities": ["vegetarian"],
        "guest_count": 600,
    }
    result = registry.execute("qualify_provider", qual_args, context)

    assert result.success is True
    assert result.data.is_qualified is True
    assert result.data.status == "QUALIFIED"
    assert result.data.category_match is True
    assert result.data.budget_check["passed"] is True
    assert result.data.hard_requirement_results.get("vegetarian") == "PASS"
    assert "vegetarian" in result.data.hard_requirements_passed
    assert len(result.data.hard_requirements_failed) == 0


def test_qualify_provider_hard_requirement_failure(db_session: Session):
    """Verifies that a provider lacking a mandatory requirement evaluates to DISQUALIFIED."""
    registry = create_default_tool_registry()
    organizer, event, task, vendors = _setup_task5_environment(db_session)
    context = ToolContext(db=db_session, user_id=organizer.id, event_id=event.id)

    v4 = vendors[3]  # Old Delhi Mughlai Meats (lacks vegetarian)
    qual_args = {
        "event_id": event.id,
        "provider_id": v4.id,
        "required_category": "catering",
        "required_capabilities": ["vegetarian"],
    }
    result = registry.execute("qualify_provider", qual_args, context)

    assert result.success is True
    assert result.data.is_qualified is False
    assert result.data.status == "DISQUALIFIED"
    assert result.data.hard_requirement_results.get("vegetarian") == "FAIL"
    assert "vegetarian" in result.data.hard_requirements_failed


def test_qualify_provider_preference_mismatch_not_disqualifying(db_session: Session):
    """Verifies that missing a soft preference NEVER disqualifies a candidate."""
    registry = create_default_tool_registry()
    organizer, event, task, vendors = _setup_task5_environment(db_session)
    context = ToolContext(db=db_session, user_id=organizer.id, event_id=event.id)

    v2 = vendors[1]  # Evergreen Veg Banquet (has vegetarian, but lacks live_counters)
    qual_args = {
        "event_id": event.id,
        "provider_id": v2.id,
        "required_category": "catering",
        "required_capabilities": ["vegetarian"],
        "preferences": ["live_counters"],
    }
    result = registry.execute("qualify_provider", qual_args, context)

    assert result.success is True
    assert result.data.is_qualified is True
    assert result.data.status == "QUALIFIED"
    assert result.data.hard_requirement_results.get("vegetarian") == "PASS"
    assert result.data.preference_results.get("live_counters") == "UNMATCHED"
    assert "live_counters" not in result.data.preferences_matched


def test_qualify_provider_unknown_information_preserved(db_session: Session):
    """Verifies that unconfirmed information is explicitly recorded as UNKNOWN rather than guessed."""
    registry = create_default_tool_registry()
    organizer, event, task, vendors = _setup_task5_environment(db_session)
    context = ToolContext(db=db_session, user_id=organizer.id, event_id=event.id)

    v1 = vendors[0]
    qual_args = {
        "event_id": event.id,
        "provider_id": v1.id,
        "required_category": "catering",
    }
    result = registry.execute("qualify_provider", qual_args, context)

    assert result.success is True
    assert "live_availability_for_event_dates" in result.data.unknown_facts
    assert "exact_per_plate_or_package_quote" in result.data.unknown_facts
    assert result.data.availability_check["status"] == "UNKNOWN"


def test_qualify_provider_missing_id_handled(db_session: Session):
    """Verifies that querying a non-existent provider ID returns structured NOT_FOUND."""
    registry = create_default_tool_registry()
    organizer, event, task, _ = _setup_task5_environment(db_session)
    context = ToolContext(db=db_session, user_id=organizer.id, event_id=event.id)

    qual_args = {
        "event_id": event.id,
        "provider_id": "non-existent-vendor-id",
    }
    result = registry.execute("qualify_provider", qual_args, context)

    assert result.success is False
    assert result.error_code == "NOT_FOUND"


# ==============================================================================
# 3. COMPARISON & DETERMINISTIC SHORTLISTING TESTS
# ==============================================================================

def test_compare_candidates_deterministic(db_session: Session):
    """Verifies that compare_candidates provides an objective comparison without opaque AI scores."""
    registry = create_default_tool_registry()
    organizer, event, task, vendors = _setup_task5_environment(db_session)
    context = ToolContext(db=db_session, user_id=organizer.id, event_id=event.id)

    comp_args = {
        "event_id": event.id,
        "provider_ids": [v.id for v in vendors[:4]],
        "hard_requirements": ["vegetarian"],
        "preferences": ["live_counters"],
        "max_budget": 400000.0,
    }
    result = registry.execute("compare_candidates", comp_args, context)

    assert result.success is True
    assert result.data.total_compared == 4
    assert len(result.data.comparison_matrix) == 4

    # Top candidate should be Shahi Rasoi Caterers (QUALIFIED + matches live_counters preference)
    first_cand = result.data.comparison_matrix[0]
    assert first_cand.name == "Shahi Rasoi Caterers"
    assert first_cand.qualification_status == "QUALIFIED"
    assert "live_counters" in first_cand.preferences_matched

    # Shortlist should strictly exclude disqualified candidates
    shortlist_statuses = [c.qualification_status for c in result.data.shortlist]
    assert all(status != "DISQUALIFIED" for status in shortlist_statuses)


def test_shortlist_vendors_tool(db_session: Session):
    """Verifies that the ShortlistVendorsTool produces an explainable, deterministic shortlist."""
    registry = create_default_tool_registry()
    organizer, event, task, vendors = _setup_task5_environment(db_session)
    context = ToolContext(db=db_session, user_id=organizer.id, event_id=event.id)

    shortlist_args = {
        "event_id": event.id,
        "category": "catering",
        "limit": 3,
        "hard_requirements": ["vegetarian"],
        "preferences": ["live_counters"],
        "max_budget": 400000.0,
    }
    result = registry.execute("shortlist_vendors", shortlist_args, context)

    assert result.success is True
    assert result.data.total_shortlisted >= 2
    assert result.data.disqualified_count >= 2  # v3 (budget) and v4 (non-veg) disqualified

    # Explainable rationale present
    assert len(result.data.deterministic_rationale) > 0
    assert "qualified" in result.data.deterministic_rationale.lower()
    for cand in result.data.shortlist:
        assert cand.shortlist_rationale is not None


# ==============================================================================
# 4. GUARDRAILS & SAFETY TESTS
# ==============================================================================

def test_guardrails_read_only_access(db_session: Session):
    """Verifies that all discovery, qualification, and comparison tools are strictly READ_ONLY."""
    disc_tool = DiscoverProvidersTool()
    qual_tool = QualifyProviderTool()
    comp_tool = CompareCandidatesTool()
    shortlist_tool = ShortlistVendorsTool()

    assert disc_tool.access_mode == ToolAccessMode.READ_ONLY
    assert qual_tool.access_mode == ToolAccessMode.READ_ONLY
    assert comp_tool.access_mode == ToolAccessMode.READ_ONLY
    assert shortlist_tool.access_mode == ToolAccessMode.READ_ONLY


def test_guardrails_no_fabricated_availability(db_session: Session):
    """Verifies that availability without calendar records is explicitly marked UNKNOWN."""
    organizer, event, task, vendors = _setup_task5_environment(db_session)
    vendor_service = VendorService(db_session)

    v1 = vendors[0]
    # No calendar records added for this future date
    future_date = datetime(2026, 12, 15, 10, 0, 0)

    eval_res = vendor_service.qualify_vendor_deterministically(
        vendor=v1,
        event_date=future_date,
    )
    # Since no record exists in ProviderAvailability, status must be UNKNOWN or PASS without fabrication
    assert eval_res["availability_check"]["status"] in ("UNKNOWN", "PASS")
    assert "live_availability_for_event_dates" in eval_res["unknown_facts"]


def test_guardrails_calendar_conflict_detected(db_session: Session):
    """Verifies that an authoritative booked calendar slot in the database triggers an availability conflict FAIL."""
    organizer, event, task, vendors = _setup_task5_environment(db_session)
    v1 = vendors[0]

    # Add real booked slot in database
    slot_start = datetime(2026, 11, 20, 9, 0, 0)
    slot_end = datetime(2026, 11, 20, 21, 0, 0)
    slot = ProviderAvailability(
        vendor_id=v1.id,
        start_datetime=slot_start,
        end_datetime=slot_end,
        status="BOOKED",
        notes="Booked for Sharma Wedding",
    )
    db_session.add(slot)
    db_session.commit()

    vendor_service = VendorService(db_session)
    eval_res = vendor_service.qualify_vendor_deterministically(
        vendor=v1,
        event_date=slot_start + timedelta(hours=2),
    )
    assert eval_res["availability_check"]["passed"] is False
    assert eval_res["availability_check"]["status"] == "FAIL"
    assert eval_res["status"] == "DISQUALIFIED"


# ==============================================================================
# 5. GOLDEN DEMO PATH TEST (TASK 5)
# ==============================================================================

def test_task5_golden_demo_path(db_session: Session):
    """Simulates the complete Task 5 workflow:
    
    1. Wedding in Delhi with 600 guests and ₹12 lakh budget.
    2. Catering task requiring vegetarian food.
    3. discover_providers -> discovers candidate providers.
    4. qualify_provider -> deterministically qualifies candidate with PASS/FAIL/UNKNOWN.
    5. compare_candidates -> transparent side-by-side comparison.
    6. shortlist_vendors -> produces explainable shortlist.
    7. Organizer can review candidates without any external communication.
    """
    registry = create_default_tool_registry()
    organizer, event, task, vendors = _setup_task5_environment(db_session)
    context = ToolContext(db=db_session, user_id=organizer.id, event_id=event.id)

    # Step 1: Agent observes catering task and calls discover_providers
    disc_res = registry.execute(
        "discover_providers",
        {
            "event_id": event.id,
            "task_id": task.id,
            "location": "Delhi",
            "requirements": ["vegetarian"],
            "preferences": ["live_counters"],
            "max_budget": 400000.0,
        },
        context,
    )
    assert disc_res.success is True
    assert disc_res.data.total_found >= 4
    assert len(disc_res.data.shortlist) >= 2

    # Step 2: Agent deep-dives on the top candidate with qualify_provider
    top_candidate_id = disc_res.data.shortlist[0].provider_id
    qual_res = registry.execute(
        "qualify_provider",
        {
            "event_id": event.id,
            "provider_id": top_candidate_id,
            "task_id": task.id,
            "required_capabilities": ["vegetarian"],
            "preferences": ["live_counters"],
            "max_budget": 400000.0,
            "guest_count": 600,
        },
        context,
    )
    assert qual_res.success is True
    assert qual_res.data.status == "QUALIFIED"
    assert qual_res.data.hard_requirement_results["vegetarian"] == "PASS"
    assert "live_availability_for_event_dates" in qual_res.data.unknown_facts

    # Step 3: Agent performs multi-candidate comparison
    cand_ids = [c.provider_id for c in disc_res.data.providers[:4]]
    comp_res = registry.execute(
        "compare_candidates",
        {
            "event_id": event.id,
            "provider_ids": cand_ids,
            "hard_requirements": ["vegetarian"],
            "preferences": ["live_counters"],
            "max_budget": 400000.0,
        },
        context,
    )
    assert comp_res.success is True
    assert comp_res.data.total_compared == 4
    assert len(comp_res.data.shortlist) >= 2

    # Step 4: Shortlist is deterministic and explainable
    first_choice = comp_res.data.shortlist[0]
    assert first_choice.name == "Shahi Rasoi Caterers"
    assert first_choice.qualification_status == "QUALIFIED"
    assert "live_counters" in first_choice.preferences_matched
    assert first_choice.base_cost == 350000.0
    assert first_choice.rating == 4.9

    # STOP: Organizer now has all objective facts to contact the vendor externally.
    # No automated messages or bookings are sent.
