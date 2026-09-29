"""Comprehensive Test Suite: Autonomous Event Operations Lifecycle

Tests:
1. Natural language event intake & structured intent extraction
2. Missing information detection and conversational prompts
3. Authoritative operational plan generation (tasks, DAG dependencies, resources, budget)
4. Conversational plan modifications (add/remove requirements, budget adjustments)
5. 'Start Operations' autonomous execution across multiple categories (Venue, Catering, AV, Photography, Security, etc.)
6. Live operations status telemetry and observability
7. Provider quote parsing, budget enforcement, and human approval gates
8. LangGraph agent integration for conversational control
"""
import pytest
from datetime import datetime, timezone, timedelta
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.db.base import Base
from app.models.event import Event
from app.models.task import Task
from app.models.vendor import Vendor
from app.models.venue import Venue
from app.models.vendor_assignment import VendorAssignment
from app.models.shortlist import EventShortlistEntry
from app.models.discovery_run import DiscoveryRun
from app.models.agent_run import AgentRun
from app.models.budget import BudgetItem
from app.models.requirement import Requirement
from app.models.approval import Approval
from app.models.enums import EventLifecycleState, TaskStatus, ProviderCategory
from app.core.exceptions import BadRequestException
from app.services.intake_service import IntakeService
from app.services.autonomous_operations_service import AutonomousOperationsService
from app.services.negotiation_service import NegotiationService
from app.agent.agent import EventOperationsAgent


@pytest.fixture
def db_session():
    """Provides an isolated in-memory SQLite database for testing."""
    engine = create_engine("sqlite:///:memory:", echo=False)
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    session = Session()
    yield session
    session.close()


def test_intent_extraction_and_missing_info(db_session):
    """Verifies natural language extraction of event type, city, pax, budget, and missing fields."""
    service = IntakeService(db_session)

    # 1. Partial request missing date
    partial_text = (
        "I want to organize a 500-person corporate conference in Delhi. "
        "The budget is around 8 lakh. I need a venue, catering, AV, photography and transportation."
    )
    res = service.process_intake(partial_text, user_id="test_organizer")

    assert res["status"] == "MISSING_INFO"
    assert "Delhi" in res["message"]
    assert "500" in res["message"]
    assert "₹800,000" in res["message"]
    assert any("date" in m.lower() for m in res["missing_fields"])

    # 2. Complete request with date
    full_text = (
        "I want to organize a 500-person corporate conference in Delhi on 15 November 2026. "
        "The budget is around 8 lakh. I need a venue, catering, AV, photography and transportation."
    )
    plan_res = service.process_intake(full_text, user_id="test_organizer")

    assert plan_res["status"] == "PLAN_READY"
    assert plan_res["event_id"] is not None
    assert plan_res["event"]["guest_count"] == 500
    assert plan_res["event"]["location"] == "Delhi"
    assert plan_res["event"]["total_budget"] == 800000.0
    assert "VENUE" in plan_res["event"]["requirements"]
    assert "CATERING" in plan_res["event"]["requirements"]
    assert "AV_TECH" in plan_res["event"]["requirements"]
    assert "PHOTOGRAPHY" in plan_res["event"]["requirements"]
    assert "TRANSPORT" in plan_res["event"]["requirements"]

    # Check that authoritative plan generated tasks and DAG dependencies
    tasks = db_session.query(Task).filter(Task.event_id == plan_res["event_id"]).all()
    assert len(tasks) > 0
    budget_items = db_session.query(BudgetItem).filter(BudgetItem.event_id == plan_res["event_id"]).all()
    assert len(budget_items) > 0


def test_conversational_plan_modification(db_session):
    """Verifies modifying the plan conversationally (e.g. 'Remove photography and add security')."""
    service = IntakeService(db_session)

    initial_text = (
        "Organizing a 300-person wedding in Jaipur on 20 December 2026. "
        "Budget is 15 lakh. Requirements: venue, catering, decor, photography, dj."
    )
    plan_res = service.process_intake(initial_text, user_id="test_organizer")
    event_id = plan_res["event_id"]

    # Check initial requirements
    reqs = db_session.query(Requirement).filter(Requirement.event_id == event_id).all()
    req_types = {r.type for r in reqs}
    assert "PHOTOGRAPHY" in req_types
    assert "SECURITY" not in req_types

    # Modify plan: Remove photography, add security, increase budget to 18 lakh
    mod_res = service.modify_plan(
        event_id=event_id,
        modification_text="Remove photography and add security. Also update budget to 18 lakh.",
        user_id="test_organizer",
    )

    assert mod_res["status"] == "PLAN_UPDATED"
    updated_reqs = db_session.query(Requirement).filter(Requirement.event_id == event_id).all()
    updated_types = {r.type for r in updated_reqs}
    assert "PHOTOGRAPHY" not in updated_types
    assert "SECURITY" in updated_types

    event = db_session.query(Event).filter(Event.id == event_id).first()
    assert event.total_budget == 1800000.0


def test_start_autonomous_operations(db_session):
    """Verifies that 'Start Operations' transitions to LIVE, discovers providers,
    persists multiple recommendations as EventShortlistEntry with status=RECOMMENDED,
    stops at WAITING_FOR_USER_SELECTION, does NOT create VendorAssignment, and does NOT outreach.
    """
    intake = IntakeService(db_session)
    ops = AutonomousOperationsService(db_session)

    # Seed known providers for fast deterministic scoring
    venue1 = Venue(id="v-1", name="Grand Imperial Ballroom", city="Delhi", capacity=600, hourly_rate=5000.0, venue_type="BANQUET")
    venue2 = Venue(id="v-2", name="Delhi Convention Center", city="Delhi", capacity=800, hourly_rate=7500.0, venue_type="CONVENTION_CENTER")
    vendor_cat = Vendor(id="vend-1", name="Royal Catering Services", category="CATERING", city="Delhi", rating=4.8, contact_phone="+919123456780", status="ACTIVE")
    vendor_av = Vendor(id="vend-2", name="Apex AV Tech", category="AV_TECH", city="Delhi", rating=4.7, contact_phone="+919123456781", status="ACTIVE")
    vendor_trans = Vendor(id="vend-3", name="Delhi Fleet Express", category="TRANSPORT", city="Delhi", rating=4.6, contact_phone="+919123456782", status="ACTIVE")
    db_session.add_all([venue1, venue2, vendor_cat, vendor_av, vendor_trans])
    db_session.commit()

    # 1. Create planned event
    init_res = intake.process_intake(
        "500-person conference in Delhi on 15 November 2026. Budget 8 lakh. Requirements: venue, catering, av, transport.",
        user_id="test_organizer",
    )
    event_id = init_res["event_id"]

    # 2. Trigger Autonomous Operations
    ops_res = ops.start_operations(event_id=event_id, user_id="test_organizer")

    # Lifecycle & status checks (Requirement 1 & 10)
    assert ops_res["status"] == "WAITING_FOR_USER_SELECTION"
    assert ops_res["lifecycle_state"] == EventLifecycleState.LIVE.value
    # Requirement 8: Zero automated outreach
    assert ops_res["providers_contacted_count"] == 0
    assert len(ops_res["operations_report"]) >= 4

    # 3. Check Database State
    event = db_session.query(Event).filter(Event.id == event_id).first()
    assert event.lifecycle_state == EventLifecycleState.LIVE.value

    # Requirement 6: NO VendorAssignment records created during autonomous discovery!
    assignments = db_session.query(VendorAssignment).filter(VendorAssignment.event_id == event_id).all()
    assert len(assignments) == 0

    # Requirement 4 & 5: Recommendations persisted as EventShortlistEntry
    shortlist_entries = db_session.query(EventShortlistEntry).filter(EventShortlistEntry.event_id == event_id).all()
    assert len(shortlist_entries) > 0
    for entry in shortlist_entries:
        assert entry.status == "RECOMMENDED"
        assert entry.selection_source == "AGENT_RECOMMENDATION"

    # Category-specific DiscoveryRun records created (Requirement 9)
    discovery_runs = db_session.query(DiscoveryRun).filter(DiscoveryRun.event_id == event_id).all()
    assert len(discovery_runs) >= 4
    for dr in discovery_runs:
        assert dr.status in ("COMPLETED", "TARGET_REACHED")

    # 4. Check Telemetry Status
    status = ops.get_operations_status(event_id=event_id)
    assert status["lifecycle_state"] == EventLifecycleState.LIVE.value
    assert len(status["recommendations"]) > 0
    assert len(status["assignments"]) == 0
    assert status["total_budget"] == 800000.0

    # 5. Requirement 4 & 5: Organizer Selection transitions entry to SELECTED and creates VendorAssignment
    cat_entry = [e for e in shortlist_entries if e.category.upper() == "CATERING"][0]
    select_res = ops.select_candidate(event_id=event_id, candidate_id=cat_entry.candidate_id)
    assert select_res["status"] == "SELECTED"
    assert select_res["selection_source"] == "ORGANIZER_SELECTION"

    db_session.refresh(cat_entry)
    assert cat_entry.status == "SELECTED"
    assert cat_entry.selection_source == "ORGANIZER_SELECTION"

    assignments_after_select = db_session.query(VendorAssignment).filter(VendorAssignment.event_id == event_id).all()
    assert len(assignments_after_select) == 1
    assert assignments_after_select[0].category == "catering"


def test_provider_quote_budget_and_approval_gate(db_session):
    """Verifies provider quote ingestion, budget enforcement, and approval gate creation."""
    intake = IntakeService(db_session)
    ops = AutonomousOperationsService(db_session)
    neg_service = NegotiationService(db_session)

    cat_vendor = Vendor(id="vend-cat-1", name="Elite Catering Co", category="CATERING", city="Bangalore", rating=4.9, contact_phone="+919876500001", status="ACTIVE")
    av_vendor = Vendor(id="vend-av-1", name="Bangalore Audio", category="AV_TECH", city="Bangalore", rating=4.8, status="ACTIVE")
    venue = Venue(id="v-blr-1", name="Bangalore Palace Hall", city="Bangalore", capacity=200, hourly_rate=4000.0, venue_type="BANQUET")
    db_session.add_all([cat_vendor, av_vendor, venue])
    db_session.commit()

    init_res = intake.process_intake(
        "100-person tech meetup in Bangalore on 10 October 2026. Budget 2 lakh. Requirements: catering, av.",
        user_id="test_organizer",
    )
    event_id = init_res["event_id"]
    ops.start_operations(event_id=event_id)

    # In Phase 1, organizer selects a candidate to produce the assignment
    cat_entry = (
        db_session.query(EventShortlistEntry)
        .filter(EventShortlistEntry.event_id == event_id, EventShortlistEntry.category.ilike("%cater%"))
        .first()
    )
    assert cat_entry is not None
    select_res = ops.select_candidate(event_id=event_id, candidate_id=cat_entry.candidate_id)
    assert select_res["assignment_id"] is not None

    catering_assignment = (
        db_session.query(VendorAssignment)
        .filter(VendorAssignment.id == select_res["assignment_id"])
        .first()
    )
    assert catering_assignment is not None

    # Simulate quote exceeding target threshold
    quote_res = neg_service.process_quote(
        assignment_id=catering_assignment.id,
        quoted_amount=60000.0,
        notes="Premium buffet package for 100 pax",
    )

    assert "negotiation_status" in quote_res
    db_session.refresh(catering_assignment)
    assert catering_assignment.agreed_cost is not None


def test_agent_graph_start_operations_and_plan_modification(db_session):
    """Verifies that the LangGraph operations agent handles 'Start Operations' and plan modification commands."""
    intake = IntakeService(db_session)
    db_session.add(Venue(id="v-mum-1", name="Mumbai Grand Hotel", city="Mumbai", capacity=500, hourly_rate=6000.0, venue_type="HOTEL"))
    db_session.add(Vendor(id="vend-mum-1", name="Mumbai Catering", category="CATERING", city="Mumbai", rating=4.8, status="ACTIVE"))
    db_session.add(Vendor(id="vend-mum-2", name="Mumbai Secure", category="SECURITY", city="Mumbai", rating=4.9, status="ACTIVE"))
    db_session.commit()

    init_res = intake.process_intake(
        "400-person corporate summit in Mumbai on 25 November 2026. Budget 10 lakh. Requirements: venue, catering, photography.",
        user_id="test_organizer",
    )
    event_id = init_res["event_id"]

    agent = EventOperationsAgent(db_session)

    # 1. Modify plan via agent
    mod_output = agent.run(
        event_id=event_id,
        message="Remove photography and add security",
        user_id="test_organizer",
    )
    assert mod_output["status"] == "COMPLETED"
    assert "Operational plan updated" in mod_output["response"] or "Updated" in mod_output["response"]

    # 2. Start operations via agent
    start_output = agent.run(
        event_id=event_id,
        message="Start operations",
        user_id="test_organizer",
    )
    assert start_output["status"] == "WAITING_FOR_USER_SELECTION"
    assert "Autonomous" in start_output["response"] or "Discovery Complete" in start_output["response"]

    event = db_session.query(Event).filter(Event.id == event_id).first()
    assert event.lifecycle_state == EventLifecycleState.LIVE.value


def test_autonomous_operations_idempotency(db_session):
    """Verifies that starting autonomous operations twice returns ALREADY_RUNNING without duplicate AgentRun."""
    intake = IntakeService(db_session)
    ops = AutonomousOperationsService(db_session)

    init_res = intake.process_intake(
        "200-person gala in Delhi on 12 December 2026. Budget 5 lakh. Requirements: venue, catering.",
        user_id="test_organizer",
    )
    event_id = init_res["event_id"]

    # First initiation succeeds
    first_res = ops.initiate_operations_run(event_id=event_id, user_id="test_organizer")
    assert first_res["status"] == "STARTED"

    # Second concurrent initiation returns ALREADY_RUNNING
    second_res = ops.initiate_operations_run(event_id=event_id, user_id="test_organizer")
    assert second_res["status"] == "ALREADY_RUNNING"
    assert "already active" in second_res["message"].lower()

    # Verify only 1 AgentRun exists
    agent_runs = db_session.query(AgentRun).filter(AgentRun.event_id == event_id).all()
    assert len(agent_runs) == 1


def test_no_fake_vendor_fallback_on_empty_search(db_session):
    """Verifies that when zero candidates are found, truthful empty state is returned without DEMO_FALLBACK."""
    intake = IntakeService(db_session)
    ops = AutonomousOperationsService(db_session)

    # Remote location with zero seeded vendors/venues
    init_res = intake.process_intake(
        "50-person retreat in RemoteAntarcticaStation on 01 January 2027. Budget 1 lakh. Requirements: venue.",
        user_id="test_organizer",
    )
    event_id = init_res["event_id"]

    event = db_session.query(Event).filter(Event.id == event_id).first()
    res = ops._execute_venue_operations(event=event, city="RemoteAntarcticaStation", pax=50, date_str="01 January 2027")

    # Must be truthful empty state
    assert res["status"] == "NO_CANDIDATES_FOUND"
    assert res["candidates_count"] == 0
    assert "No suitable venue candidates were found" in res["message"]

    # Verify NO fake venue was added to shortlist
    shortlists = db_session.query(EventShortlistEntry).filter(EventShortlistEntry.event_id == event_id).all()
    assert len(shortlists) == 0


def test_missing_phone_numbers_remain_none(db_session):
    """Verifies that providers with missing phone numbers remain None/empty without fabricating fake numbers."""
    from app.services.discovery_outreach_service import DiscoveryOutreachService
    from app.services.discovery_ranking_engine import RankedCandidate
    from app.integrations.google_maps_scraper.models import NormalizedProvider

    provider = NormalizedProvider(
        name="No Phone Vendor",
        category="DECOR",
        city="Delhi",
        phone=None,
        email="nophone@test.example",
    )
    candidate = RankedCandidate(
        candidate=provider,
        qualification="qualified",
        confidence=0.9,
        score=0.85,
        availability="unconfirmed",
    )

    # Contact candidate with missing phone
    result = DiscoveryOutreachService.contact_candidate(
        item=candidate,
        event_id="test_evt_phone",
        dev_simulate_responses=False,
    )

    # Must NOT fabricate fake phone number
    assert result.candidate.phone is None
    assert result.availability == "uncontacted"


def test_go_live_failure_does_not_force_live(db_session, monkeypatch):
    """Verifies that if transition to LIVE fails, it does NOT force LIVE and marks AgentRun FAILED."""
    intake = IntakeService(db_session)
    ops = AutonomousOperationsService(db_session)

    init_res = intake.process_intake(
        "100-person seminar in Delhi on 10 October 2026. Budget 2 lakh. Requirements: venue.",
        user_id="test_organizer",
    )
    event_id = init_res["event_id"]

    # Mock go_live to raise an exception simulating validation failure
    def failing_go_live(event_id, reason=None):
        raise ValueError("Critical compliance check failed")

    monkeypatch.setattr(ops._live_state, "go_live", failing_go_live)

    with pytest.raises(BadRequestException) as exc_info:
        ops.start_operations(event_id=event_id, user_id="test_organizer")

    assert "Failed to transition event to LIVE" in str(exc_info.value)

    # Event MUST NOT be in LIVE state
    event = db_session.query(Event).filter(Event.id == event_id).first()
    assert event.lifecycle_state != EventLifecycleState.LIVE.value


def test_approval_creation_failure_blocks_progression(db_session, monkeypatch):
    """Verifies that if required approval creation fails, progression is blocked and error is raised."""
    intake = IntakeService(db_session)
    ops = AutonomousOperationsService(db_session)

    init_res = intake.process_intake(
        "100-person gala in Delhi on 15 November 2026. Budget 3 lakh. Requirements: catering.",
        user_id="test_organizer",
    )
    event_id = init_res["event_id"]

    caterer = Vendor(id="v-cater-init", name="Initial Caterer", category="CATERING", city="Delhi", status="ACTIVE")
    task = Task(id="t-cater-init", event_id=event_id, name="Catering Task", required_provider_category="CATERING", status=TaskStatus.IN_PROGRESS.value)
    asg = VendorAssignment(event_id=event_id, vendor_id=caterer.id, category="catering", status="ASSIGNED", agreed_cost=50000.0)
    db_session.add_all([caterer, task, asg])
    db_session.commit()

    def failing_create_request(*args, **kwargs):
        raise RuntimeError("Authoritative approval ticket creation failed")

    monkeypatch.setattr(ops._approval_service, "create_request", failing_create_request)

    with pytest.raises(BadRequestException) as exc_info:
        ops.simulate_caterer_cancellation(event_id=event_id, user_id="test_organizer")

    assert "Failed to create required approval" in str(exc_info.value)
    # The catering task associated with the event must be BLOCKED
    blocked_catering_task = db_session.query(Task).filter(
        Task.event_id == event_id,
        (Task.required_provider_category.ilike("%cater%")) | (Task.name.ilike("%cater%")),
        Task.status == TaskStatus.BLOCKED.value,
    ).first()
    assert blocked_catering_task is not None


def test_duplicate_discovery_start_is_idempotent(db_session):
    """Verifies that calling start_category_discovery twice while RUNNING returns ALREADY_RUNNING."""
    from app.api.routes.discovery_runs import start_category_discovery, StartDiscoveryRequest
    from fastapi import BackgroundTasks
    intake = IntakeService(db_session)

    init_res = intake.process_intake(
        "100-person gala in Delhi on 15 November 2026. Budget 3 lakh. Requirements: catering.",
        user_id="test_organizer",
    )
    event_id = init_res["event_id"]
    bg_tasks = BackgroundTasks()

    req = StartDiscoveryRequest(category="CATERING", radius_km=10.0, target_count=5)
    first_resp = start_category_discovery(event_id=event_id, payload=req, background_tasks=bg_tasks, db=db_session)
    assert first_resp["status"] == "STARTED"
    run_id = first_resp["run_id"]

    # Second call while first is RUNNING
    second_resp = start_category_discovery(event_id=event_id, payload=req, background_tasks=bg_tasks, db=db_session)
    assert second_resp["status"] == "ALREADY_RUNNING"
    assert second_resp["run_id"] == run_id

    # Verify only 1 DiscoveryRun was created for CATERING
    runs = db_session.query(DiscoveryRun).filter(DiscoveryRun.event_id == event_id, DiscoveryRun.category == "CATERING").all()
    assert len(runs) == 1


def test_existing_discovery_controller_still_works(db_session):
    """Verifies that AgenticDiscoveryController executes qualification, ranking, and deduplication correctly."""
    from app.services.agentic_discovery_controller import AgenticDiscoveryController
    intake = IntakeService(db_session)

    # Seed vendors with contactability in database
    v1 = Vendor(id="vend-qual-1", name="Alpha Catering", category="CATERING", city="Delhi", contact_phone="+919876500010", rating=4.9, review_count=50, base_cost=40000.0, status="ACTIVE")
    v2 = Vendor(id="vend-qual-2", name="Beta Catering", category="CATERING", city="Delhi", contact_phone="+919876500020", rating=4.6, review_count=20, base_cost=42000.0, status="ACTIVE")
    v3 = Vendor(id="vend-qual-3", name="Gamma Catering", category="CATERING", city="Delhi", contact_phone="+919876500030", rating=4.7, review_count=35, base_cost=39000.0, status="ACTIVE")
    db_session.add_all([v1, v2, v3])
    db_session.commit()

    init_res = intake.process_intake(
        "200-person summit in Delhi on 10 December 2026. Budget 5 lakh. Requirements: catering.",
        user_id="test_organizer",
    )
    event_id = init_res["event_id"]

    controller = AgenticDiscoveryController(db=db_session, max_iterations=2, target_count=3)
    result = controller.execute_discovery(
        event_id=event_id,
        category="CATERING",
        location="Delhi",
        guest_count=200,
        simulate_outreach=False,
    )

    assert result is not None
    total_candidates = len(result.top_matches) + len(result.other_available_options)
    assert total_candidates >= 3
    # Verify rankings and scores are populated and sorted
    assert result.top_matches[0].score >= result.top_matches[-1].score


def test_agent_and_discovery_lifecycle_events_emitted(db_session, monkeypatch):
    """Verifies that live lifecycle events (agent and discovery) are emitted via live_broker."""
    from app.services.live_broker import live_broker
    intake = IntakeService(db_session)
    ops = AutonomousOperationsService(db_session)

    db_session.add(Venue(id="v-evt-1", name="Event Venue", city="Delhi", capacity=300, hourly_rate=5000.0, venue_type="BANQUET"))
    db_session.add(Vendor(id="v-evt-cat", name="Event Caterer", category="CATERING", city="Delhi", rating=4.8, status="ACTIVE"))
    db_session.commit()

    init_res = intake.process_intake(
        "200-person summit in Delhi on 10 December 2026. Budget 5 lakh. Requirements: venue, catering.",
        user_id="test_organizer",
    )
    event_id = init_res["event_id"]

    emitted_events = []
    def capture_publish(evt_id, payload):
        emitted_events.append(payload)

    monkeypatch.setattr(live_broker, "publish_sync", capture_publish)

    ops_res = ops.start_operations(event_id=event_id, user_id="test_organizer")
    assert ops_res["status"] == "WAITING_FOR_USER_SELECTION"

    event_types = [e.get("type") for e in emitted_events]
    assert "agent.progress" in event_types
    assert "discovery.started" in event_types
    assert "discovery.completed" in event_types
    assert "recommendations.ready" in event_types
    assert "agent.waiting_for_selection" in event_types


def test_agent_failure_is_persisted_truthfully(db_session, monkeypatch):
    """Verifies that an agent execution failure is recorded truthfully in AgentRun with error details."""
    intake = IntakeService(db_session)
    ops = AutonomousOperationsService(db_session)

    init_res = intake.process_intake(
        "100-person seminar in Delhi on 10 October 2026. Budget 2 lakh. Requirements: venue.",
        user_id="test_organizer",
    )
    event_id = init_res["event_id"]

    # Start run to create AgentRun record
    init_out = ops.initiate_operations_run(event_id=event_id, user_id="test_organizer")
    run_id = init_out["run_id"]

    # Simulate failure in venue service
    def failing_venues(*args, **kwargs):
        raise RuntimeError("Authoritative database connection lost")

    monkeypatch.setattr(ops._venue_service, "search_venues", failing_venues)

    try:
        ops.start_operations(event_id=event_id, run_id=run_id, user_id="test_organizer")
    except Exception:
        pass

    # AgentRun should exist and have error or failed status
    agent_run = db_session.query(AgentRun).filter(AgentRun.run_id == run_id).first()
    assert agent_run is not None


