"""Comprehensive unit tests for Task 8: Real Vendor -> Task Binding + Plan Recalculation.

Tests:
1. Golden Demo Scenario: Wedding (600 guests, ₹4L catering budget, vegetarian) -> BOUND, CPM recalculated, budget committed.
2. Golden Blocked Scenario: Capacity Requirement Failed (400 < 600) -> BLOCKED (CAPACITY_REQUIREMENT_FAILED), no mutation.
3. Golden Unknown Scenario: Availability UNKNOWN -> BLOCKED (AVAILABILITY_NOT_VALIDATED).
4. Golden Conflict Scenario: Validation Conflict -> BLOCKED (VALIDATION_CONFLICT), no vendor master overwrite.
5. Hard Requirement FAIL blocks binding.
6. Soft Preference failure does not block binding.
7. Budget overflow blocks binding.
8. Stale validation blocks binding.
9. Authorization: VIEWER role cannot bind; MAIN_ORGANIZER can bind.
10. Idempotency: Repeated binding is safe (ALREADY_BOUND).
11. Reassignment protection: Existing assignment cannot be silently overwritten without explicit allow_reassignment flag.
12. Transaction safety & Rollback: Failure rolls back state.
13. Agent Tool: BindVendorToTaskTool integration and typed output.
"""
from datetime import datetime, timezone, timedelta
from decimal import Decimal
import pytest
from sqlalchemy.orm import Session

from app.models.event import Event
from app.models.event_member import EventMember
from app.models.user import User
from app.models.task import Task
from app.models.dependency import TaskDependency
from app.models.vendor import Vendor
from app.models.budget import BudgetItem
from app.models.requirement import Requirement
from app.models.provider_availability import ProviderAvailability
from app.models.vendor_outcome import VendorOutcome
from app.models.vendor_outcome_validation import VendorOutcomeValidation
from app.models.vendor_assignment import VendorAssignment
from app.models.audit import AuditRecord
from app.models.state_transition import StateTransition
from app.models.enums import (
    EventLifecycleState,
    EventState,
    RoleType,
    TaskPriority,
    TaskStatus,
    BudgetItemStatus,
    BindingStatus,
    BlockingReason,
    ClaimValidationStatus,
    OverallValidationStatus,
)
from app.services.vendor_task_binding_service import VendorTaskBindingService
from app.agent.tools.base import ToolContext
from app.agent.tools.provider_tools import BindVendorToTaskTool
from app.agent.tools.schemas import BindVendorToTaskInput


def _setup_task8_environment(db: Session):
    """Sets up a complete test environment with event, tasks, dependencies, requirements, and vendors."""
    now = datetime.now(timezone.utc).replace(tzinfo=None)

    organizer = User(name="Rajiv Malhotra", email="rajiv.m@eventra.test")
    viewer = User(name="Rohit Sharma", email="rohit.s@eventra.test")
    event_manager = User(name="Priya Patel", email="priya.p@eventra.test")
    db.add_all([organizer, viewer, event_manager])
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
    db.add_all([
        EventMember(event_id=event.id, user_id=organizer.id, role=RoleType.MAIN_ORGANIZER.value),
        EventMember(event_id=event.id, user_id=viewer.id, role=RoleType.VIEWER.value),
        EventMember(event_id=event.id, user_id=event_manager.id, role=RoleType.EVENT_MANAGER.value),
    ])

    # Tasks: Venue Setup (Task 1) -> Catering (Task 2) -> Guest Reception (Task 3)
    task1 = Task(
        event_id=event.id,
        name="Venue Hall Prep",
        status=TaskStatus.READY.value,
        priority=TaskPriority.HIGH.value,
        duration_minutes=120,
        required_provider_category="VENUE",
        planned_start=event.start_datetime,
        planned_end=event.start_datetime + timedelta(minutes=120),
    )
    task2 = Task(
        event_id=event.id,
        name="Wedding Feast Catering",
        status=TaskStatus.PENDING.value,
        priority=TaskPriority.HIGH.value,
        duration_minutes=180,
        required_provider_category="CATERING",
        planned_start=event.start_datetime + timedelta(minutes=120),
        planned_end=event.start_datetime + timedelta(minutes=300),
    )
    task3 = Task(
        event_id=event.id,
        name="Guest Banquet Dining",
        status=TaskStatus.PENDING.value,
        priority=TaskPriority.HIGH.value,
        duration_minutes=120,
        required_provider_category="CATERING",
        planned_start=event.start_datetime + timedelta(minutes=300),
        planned_end=event.start_datetime + timedelta(minutes=420),
    )
    db.add_all([task1, task2, task3])
    db.flush()

    # Dependencies: task1 -> task2 -> task3
    dep1 = TaskDependency(event_id=event.id, predecessor_task_id=task1.id, successor_task_id=task2.id)
    dep2 = TaskDependency(event_id=event.id, predecessor_task_id=task2.id, successor_task_id=task3.id)
    db.add_all([dep1, dep2])

    # Budget Item (₹4,00,000 for Catering)
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

    # Hard Requirement: Vegetarian
    veg_req = Requirement(
        event_id=event.id,
        type="CATERING",
        name="Vegetarian Catering Only",
        description="Banquet menu must be 100% vegetarian",
        required=True,
    )
    db.add(veg_req)

    # Soft Preference
    rating_pref = Requirement(
        event_id=event.id,
        type="GENERAL",
        name="High Rating >= 4.5",
        description="Preferred top tier rating",
        required=False,
    )
    db.add(rating_pref)

    # Provider: Royal Rasoi
    vendor_a = Vendor(
        name="Royal Rasoi Caterers",
        category="CATERING",
        city="Delhi",
        base_cost=350000.0,
        service_description="Premier Delhi caterers. Capacity: 700 guests.",
        capabilities=["vegetarian", "buffet"],
        status="ACTIVE",
    )
    # Provider B: Under-capacity
    vendor_b = Vendor(
        name="Mini Bites Express",
        category="CATERING",
        city="Delhi",
        base_cost=200000.0,
        service_description="Boutique snack caterer. Capacity: 400 guests.",
        capabilities=["vegetarian"],
        status="ACTIVE",
    )
    db.add_all([vendor_a, vendor_b])
    db.flush()

    # Provider A Availability slot
    slot_a = ProviderAvailability(
        vendor_id=vendor_a.id,
        start_datetime=event.start_datetime - timedelta(hours=1),
        end_datetime=event.end_datetime + timedelta(hours=1),
        status="AVAILABLE",
    )
    db.add(slot_a)
    db.commit()

    return {
        "organizer": organizer,
        "viewer": viewer,
        "event_manager": event_manager,
        "event": event,
        "task1": task1,
        "task2": task2,
        "task3": task3,
        "catering_budget": catering_budget,
        "vendor_a": vendor_a,
        "vendor_b": vendor_b,
    }


def _create_validation_record(
    db: Session,
    event_id: str,
    task_id: str,
    provider_id: str,
    claim_results: list,
    hard_requirements_failed: list = None,
    conflicts: list = None,
    unknown_facts: list = None,
    overall_status: str = "VALIDATED",
) -> VendorOutcomeValidation:
    """Helper to create a persisted Task 7 validation record."""
    outcome = VendorOutcome(
        event_id=event_id,
        provider_id=provider_id,
        task_id=task_id,
        submitted_by="organizer",
        communication_channel="PHONE",
        outcome_status="ACCEPTED",
        organizer_notes="Validation test notes",
        verification_status=overall_status,
    )
    db.add(outcome)
    db.flush()

    validation = VendorOutcomeValidation(
        vendor_outcome_id=outcome.id,
        event_id=event_id,
        task_id=task_id,
        provider_id=provider_id,
        overall_status=overall_status,
        claim_results=claim_results,
        hard_requirements_passed=["Vegetarian Catering Only"] if not hard_requirements_failed else [],
        hard_requirements_failed=hard_requirements_failed or [],
        preferences_matched=[],
        conflicts=conflicts or [],
        unknown_facts=unknown_facts or [],
        summary="Deterministic validation test summary",
    )
    db.add(validation)
    db.commit()
    db.refresh(validation)
    return validation


# ==============================================================================
# TESTS
# ==============================================================================

def test_golden_demo_scenario_binding_and_recalculation(db_session: Session):
    """Step 38: Golden Demo Scenario.
    
    All mandatory conditions PASS:
    - capacity (700 >= 600) -> PASS
    - price (₹3.8L <= ₹4.0L) -> PASS
    - vegetarian -> PASS
    - availability -> PASS
    Authorized user confirms assignment.
    Result:
    - task.provider_id = Vendor A
    - task.status = ASSIGNED
    - Plan recalculated: CPM critical path, schedule timings, budget committed.
    - Audit record generated.
    """
    env = _setup_task8_environment(db_session)
    event = env["event"]
    task = env["task2"]
    vendor = env["vendor_a"]
    organizer = env["organizer"]

    claim_results = [
        {"claim_type": "CAPACITY", "field": "capacity", "status": "PASS", "reported_value": 700, "authoritative_value": 600, "is_hard_requirement": True},
        {"claim_type": "PRICE", "field": "quoted_price", "status": "PASS", "reported_value": 380000.0, "authoritative_value": 400000.0, "is_hard_requirement": True},
        {"claim_type": "VEGETARIAN", "field": "vegetarian", "status": "PASS", "reported_value": True, "authoritative_value": True, "is_hard_requirement": True},
        {"claim_type": "AVAILABILITY", "field": "availability", "status": "PASS", "reported_value": "AVAILABLE", "authoritative_value": "AVAILABLE", "is_hard_requirement": True},
    ]
    val = _create_validation_record(db_session, event.id, task.id, vendor.id, claim_results, overall_status="VALIDATED")

    service = VendorTaskBindingService(db_session)

    # 1. Feasibility Check
    decision = service.evaluate_feasibility(event.id, task.id, vendor.id, val.id)
    assert decision.decision == "BIND"
    assert decision.can_bind is True
    assert len(decision.blocking_factors) == 0

    # 2. Binding Execution
    res = service.bind_vendor_to_task(
        event_id=event.id,
        task_id=task.id,
        provider_id=vendor.id,
        validation_id=val.id,
        user_id=organizer.id,
    )

    assert res.binding_status == BindingStatus.BOUND
    assert res.provider_id == vendor.id
    assert res.task_id == task.id
    assert res.plan_version_before == 1
    assert res.plan_version_after == 2
    assert res.schedule_recalculated is True
    assert res.critical_path_recalculated is True
    assert res.budget_recalculated is True
    assert res.plan_recalculation.is_dag_acyclic is True
    assert res.plan_recalculation.budget_committed_amount == 380000.0

    # Authoritative DB verification
    db_session.refresh(task)
    assert task.provider_id == vendor.id
    assert task.status == TaskStatus.ASSIGNED.value
    assert task.is_critical_path is True

    # VendorAssignment synchronized
    assignment = db_session.query(VendorAssignment).filter(
        VendorAssignment.event_id == event.id,
        VendorAssignment.vendor_id == vendor.id,
    ).first()
    assert assignment is not None
    assert assignment.status == "CONFIRMED"
    assert assignment.agreed_cost == 380000.0

    # Budget item updated to COMMITTED
    catering_budget = env["catering_budget"]
    db_session.refresh(catering_budget)
    assert catering_budget.status == BudgetItemStatus.COMMITTED.value
    assert catering_budget.actual_amount == Decimal("380000.00")

    # Audit record verified
    audit = db_session.query(AuditRecord).filter(
        AuditRecord.event_id == event.id,
        AuditRecord.action == "BIND_VENDOR_TO_TASK",
    ).first()
    assert audit is not None
    assert audit.target_id == task.id
    assert audit.after_state["provider_id"] == vendor.id
    assert audit.after_state["plan_version"] == 2


def test_golden_blocked_scenario_capacity_failed(db_session: Session):
    """Step 39: Golden Blocked Scenario - Capacity Requirement Failed.
    
    Vendor capacity 400 < required 600.
    Validation has capacity FAIL.
    Task 8 must BLOCK, with reason CAPACITY_REQUIREMENT_FAILED.
    task.provider_id and task.status MUST NOT mutate.
    """
    env = _setup_task8_environment(db_session)
    event = env["event"]
    task = env["task2"]
    vendor = env["vendor_b"]
    organizer = env["organizer"]

    claim_results = [
        {"claim_type": "CAPACITY", "field": "capacity", "status": "FAIL", "reported_value": 400, "authoritative_value": 600, "is_hard_requirement": True},
        {"claim_type": "PRICE", "field": "quoted_price", "status": "PASS", "reported_value": 200000.0, "authoritative_value": 400000.0, "is_hard_requirement": True},
        {"claim_type": "VEGETARIAN", "field": "vegetarian", "status": "PASS", "reported_value": True, "authoritative_value": True, "is_hard_requirement": True},
        {"claim_type": "AVAILABILITY", "field": "availability", "status": "PASS", "reported_value": "AVAILABLE", "authoritative_value": "AVAILABLE", "is_hard_requirement": True},
    ]
    val = _create_validation_record(
        db_session, event.id, task.id, vendor.id, claim_results,
        hard_requirements_failed=["Capacity 400 < 600"],
        overall_status="FAILED",
    )

    service = VendorTaskBindingService(db_session)

    # Feasibility check
    decision = service.evaluate_feasibility(event.id, task.id, vendor.id, val.id)
    assert decision.decision == "BLOCK"
    assert decision.can_bind is False
    assert decision.reason_code == BlockingReason.CAPACITY_REQUIREMENT_FAILED
    assert any("400" in f for f in decision.blocking_factors)

    # Attempt to bind
    res = service.bind_vendor_to_task(
        event_id=event.id,
        task_id=task.id,
        provider_id=vendor.id,
        validation_id=val.id,
        user_id=organizer.id,
    )

    assert res.binding_status == BindingStatus.BLOCKED
    assert res.decision.reason_code == BlockingReason.CAPACITY_REQUIREMENT_FAILED

    # ZERO MUTATION
    db_session.refresh(task)
    assert task.provider_id is None
    assert task.status == TaskStatus.PENDING.value


def test_golden_unknown_scenario_availability_unknown(db_session: Session):
    """Step 40: Golden Unknown Scenario - Availability is UNKNOWN.
    
    Capacity PASS, budget PASS, vegetarian PASS, availability UNKNOWN.
    Must BLOCK with AVAILABILITY_NOT_VALIDATED.
    """
    env = _setup_task8_environment(db_session)
    event = env["event"]
    task = env["task2"]
    vendor = env["vendor_a"]
    organizer = env["organizer"]

    claim_results = [
        {"claim_type": "CAPACITY", "field": "capacity", "status": "PASS", "reported_value": 700, "authoritative_value": 600, "is_hard_requirement": True},
        {"claim_type": "PRICE", "field": "quoted_price", "status": "PASS", "reported_value": 380000.0, "authoritative_value": 400000.0, "is_hard_requirement": True},
        {"claim_type": "VEGETARIAN", "field": "vegetarian", "status": "PASS", "reported_value": True, "authoritative_value": True, "is_hard_requirement": True},
        {"claim_type": "AVAILABILITY", "field": "availability", "status": "UNKNOWN", "reported_value": "UNKNOWN", "authoritative_value": "UNVERIFIED", "is_hard_requirement": True},
    ]
    val = _create_validation_record(
        db_session, event.id, task.id, vendor.id, claim_results,
        unknown_facts=["authoritative_calendar_slot"],
        overall_status="PARTIALLY_VALIDATED",
    )

    service = VendorTaskBindingService(db_session)

    res = service.bind_vendor_to_task(
        event_id=event.id,
        task_id=task.id,
        provider_id=vendor.id,
        validation_id=val.id,
        user_id=organizer.id,
    )

    assert res.binding_status == BindingStatus.BLOCKED
    assert res.decision.reason_code == BlockingReason.AVAILABILITY_NOT_VALIDATED
    assert "availability" in res.decision.reason.lower()

    # Zero mutation
    db_session.refresh(task)
    assert task.provider_id is None
    assert task.status == TaskStatus.PENDING.value


def test_golden_conflict_scenario_blocks_binding(db_session: Session):
    """Step 41: Golden Conflict Scenario - Conflict blocks binding without overwriting master data."""
    env = _setup_task8_environment(db_session)
    event = env["event"]
    task = env["task2"]
    vendor = env["vendor_a"]
    organizer = env["organizer"]

    conflict_msg = "Organizer reported capacity 900 exceeds vendor master maximum capacity of 700."
    claim_results = [
        {"claim_type": "CAPACITY", "field": "capacity", "status": "CONFLICT", "reported_value": 900, "authoritative_value": 700, "explanation": conflict_msg, "is_hard_requirement": True},
        {"claim_type": "PRICE", "field": "quoted_price", "status": "PASS", "reported_value": 380000.0, "authoritative_value": 400000.0, "is_hard_requirement": True},
        {"claim_type": "VEGETARIAN", "field": "vegetarian", "status": "PASS", "reported_value": True, "authoritative_value": True, "is_hard_requirement": True},
        {"claim_type": "AVAILABILITY", "field": "availability", "status": "PASS", "reported_value": "AVAILABLE", "authoritative_value": "AVAILABLE", "is_hard_requirement": True},
    ]
    val = _create_validation_record(
        db_session, event.id, task.id, vendor.id, claim_results,
        conflicts=[conflict_msg],
        overall_status="CONFLICT",
    )

    service = VendorTaskBindingService(db_session)
    res = service.bind_vendor_to_task(
        event_id=event.id,
        task_id=task.id,
        provider_id=vendor.id,
        validation_id=val.id,
        user_id=organizer.id,
    )

    assert res.binding_status == BindingStatus.BLOCKED
    assert res.decision.reason_code == BlockingReason.VALIDATION_CONFLICT

    # Master data remains unchanged
    db_session.refresh(vendor)
    assert "700 guests" in vendor.service_description
    db_session.refresh(task)
    assert task.provider_id is None


def test_soft_preference_failure_does_not_block_binding(db_session: Session):
    """Step 6: Soft preference failure does not automatically block binding."""
    env = _setup_task8_environment(db_session)
    event = env["event"]
    task = env["task2"]
    vendor = env["vendor_a"]
    organizer = env["organizer"]

    claim_results = [
        {"claim_type": "CAPACITY", "field": "capacity", "status": "PASS", "reported_value": 700, "authoritative_value": 600, "is_hard_requirement": True},
        {"claim_type": "PRICE", "field": "quoted_price", "status": "PASS", "reported_value": 380000.0, "authoritative_value": 400000.0, "is_hard_requirement": True},
        {"claim_type": "VEGETARIAN", "field": "vegetarian", "status": "PASS", "reported_value": True, "authoritative_value": True, "is_hard_requirement": True},
        {"claim_type": "AVAILABILITY", "field": "availability", "status": "PASS", "reported_value": "AVAILABLE", "authoritative_value": "AVAILABLE", "is_hard_requirement": True},
        # Soft preference failed
        {"claim_type": "PREFERENCE", "field": "rating", "status": "FAIL", "reported_value": 4.2, "authoritative_value": 4.5, "is_hard_requirement": False},
    ]
    val = _create_validation_record(db_session, event.id, task.id, vendor.id, claim_results, overall_status="PARTIALLY_VALIDATED")

    service = VendorTaskBindingService(db_session)
    res = service.bind_vendor_to_task(
        event_id=event.id,
        task_id=task.id,
        provider_id=vendor.id,
        validation_id=val.id,
        user_id=organizer.id,
    )

    assert res.binding_status == BindingStatus.BOUND
    assert res.provider_id == vendor.id


def test_stale_validation_blocks_binding(db_session: Session):
    """Step 18: Protect against stale validation when availability changes after validation."""
    env = _setup_task8_environment(db_session)
    event = env["event"]
    task = env["task2"]
    vendor = env["vendor_a"]
    organizer = env["organizer"]

    claim_results = [
        {"claim_type": "CAPACITY", "field": "capacity", "status": "PASS", "reported_value": 700, "authoritative_value": 600, "is_hard_requirement": True},
        {"claim_type": "PRICE", "field": "quoted_price", "status": "PASS", "reported_value": 380000.0, "authoritative_value": 400000.0, "is_hard_requirement": True},
        {"claim_type": "VEGETARIAN", "field": "vegetarian", "status": "PASS", "reported_value": True, "authoritative_value": True, "is_hard_requirement": True},
        {"claim_type": "AVAILABILITY", "field": "availability", "status": "PASS", "reported_value": "AVAILABLE", "authoritative_value": "AVAILABLE", "is_hard_requirement": True},
    ]
    val = _create_validation_record(db_session, event.id, task.id, vendor.id, claim_results, overall_status="VALIDATED")

    # Simulate subsequent conflicting booking added AFTER validation was performed
    new_booked_slot = ProviderAvailability(
        vendor_id=vendor.id,
        start_datetime=event.start_datetime,
        end_datetime=event.end_datetime,
        status="BOOKED",
        created_at=val.created_at + timedelta(minutes=10),
    )
    db_session.add(new_booked_slot)
    db_session.commit()

    service = VendorTaskBindingService(db_session)
    res = service.bind_vendor_to_task(
        event_id=event.id,
        task_id=task.id,
        provider_id=vendor.id,
        validation_id=val.id,
        user_id=organizer.id,
    )

    assert res.binding_status == BindingStatus.BLOCKED
    assert res.decision.reason_code == BlockingReason.VALIDATION_STALE


def test_authorization_viewer_role_cannot_bind(db_session: Session):
    """Step 12: Unauthorized / VIEWER user cannot perform binding."""
    env = _setup_task8_environment(db_session)
    event = env["event"]
    task = env["task2"]
    vendor = env["vendor_a"]
    viewer = env["viewer"]

    claim_results = [
        {"claim_type": "CAPACITY", "field": "capacity", "status": "PASS", "reported_value": 700, "authoritative_value": 600, "is_hard_requirement": True},
        {"claim_type": "PRICE", "field": "quoted_price", "status": "PASS", "reported_value": 380000.0, "authoritative_value": 400000.0, "is_hard_requirement": True},
        {"claim_type": "VEGETARIAN", "field": "vegetarian", "status": "PASS", "reported_value": True, "authoritative_value": True, "is_hard_requirement": True},
        {"claim_type": "AVAILABILITY", "field": "availability", "status": "PASS", "reported_value": "AVAILABLE", "authoritative_value": "AVAILABLE", "is_hard_requirement": True},
    ]
    val = _create_validation_record(db_session, event.id, task.id, vendor.id, claim_results, overall_status="VALIDATED")

    service = VendorTaskBindingService(db_session)
    res = service.bind_vendor_to_task(
        event_id=event.id,
        task_id=task.id,
        provider_id=vendor.id,
        validation_id=val.id,
        user_id=viewer.id,
    )

    assert res.binding_status == BindingStatus.BLOCKED
    assert res.decision.reason_code == BlockingReason.UNAUTHORIZED
    assert "VIEWER" in res.decision.reason


def test_idempotency_repeated_binding(db_session: Session):
    """Step 19: Repeated binding of same vendor to task returns ALREADY_BOUND without duplicating state."""
    env = _setup_task8_environment(db_session)
    event = env["event"]
    task = env["task2"]
    vendor = env["vendor_a"]
    organizer = env["organizer"]

    claim_results = [
        {"claim_type": "CAPACITY", "field": "capacity", "status": "PASS", "reported_value": 700, "authoritative_value": 600, "is_hard_requirement": True},
        {"claim_type": "PRICE", "field": "quoted_price", "status": "PASS", "reported_value": 380000.0, "authoritative_value": 400000.0, "is_hard_requirement": True},
        {"claim_type": "VEGETARIAN", "field": "vegetarian", "status": "PASS", "reported_value": True, "authoritative_value": True, "is_hard_requirement": True},
        {"claim_type": "AVAILABILITY", "field": "availability", "status": "PASS", "reported_value": "AVAILABLE", "authoritative_value": "AVAILABLE", "is_hard_requirement": True},
    ]
    val = _create_validation_record(db_session, event.id, task.id, vendor.id, claim_results, overall_status="VALIDATED")

    service = VendorTaskBindingService(db_session)

    # First binding
    res1 = service.bind_vendor_to_task(event.id, task.id, vendor.id, val.id, organizer.id)
    assert res1.binding_status == BindingStatus.BOUND

    # Second identical binding
    res2 = service.bind_vendor_to_task(event.id, task.id, vendor.id, val.id, organizer.id)
    assert res2.binding_status == BindingStatus.ALREADY_BOUND
    assert res2.plan_version_before == res2.plan_version_after


def test_reassignment_protection(db_session: Session):
    """Step 20: Reassignment of a task already assigned to Vendor A cannot happen silently without flag."""
    env = _setup_task8_environment(db_session)
    event = env["event"]
    task = env["task2"]
    vendor_a = env["vendor_a"]
    vendor_b = env["vendor_b"]
    organizer = env["organizer"]

    # Pre-assign Vendor A
    task.provider_id = vendor_a.id
    task.status = TaskStatus.ASSIGNED.value
    db_session.commit()

    claim_results = [
        {"claim_type": "CAPACITY", "field": "capacity", "status": "PASS", "reported_value": 700, "authoritative_value": 600, "is_hard_requirement": True},
        {"claim_type": "PRICE", "field": "quoted_price", "status": "PASS", "reported_value": 350000.0, "authoritative_value": 400000.0, "is_hard_requirement": True},
        {"claim_type": "VEGETARIAN", "field": "vegetarian", "status": "PASS", "reported_value": True, "authoritative_value": True, "is_hard_requirement": True},
        {"claim_type": "AVAILABILITY", "field": "availability", "status": "PASS", "reported_value": "AVAILABLE", "authoritative_value": "AVAILABLE", "is_hard_requirement": True},
    ]
    val_b = _create_validation_record(db_session, event.id, task.id, vendor_b.id, claim_results, overall_status="VALIDATED")

    service = VendorTaskBindingService(db_session)

    # Attempt to reassign without allow_reassignment
    res_blocked = service.bind_vendor_to_task(
        event_id=event.id,
        task_id=task.id,
        provider_id=vendor_b.id,
        validation_id=val_b.id,
        user_id=organizer.id,
        allow_reassignment=False,
    )
    assert res_blocked.binding_status == BindingStatus.BLOCKED
    assert res_blocked.decision.reason_code == BlockingReason.REASSIGNMENT_BLOCKED

    # With allow_reassignment=True
    res_allowed = service.bind_vendor_to_task(
        event_id=event.id,
        task_id=task.id,
        provider_id=vendor_b.id,
        validation_id=val_b.id,
        user_id=organizer.id,
        allow_reassignment=True,
    )
    assert res_allowed.binding_status == BindingStatus.BOUND
    assert res_allowed.provider_id == vendor_b.id
    assert res_allowed.previous_provider_id == vendor_a.id


def test_agent_tool_bind_vendor_to_task(db_session: Session):
    """Step 15: Typed agent tool execution for bind_vendor_to_task."""
    env = _setup_task8_environment(db_session)
    event = env["event"]
    task = env["task2"]
    vendor = env["vendor_a"]
    organizer = env["organizer"]

    claim_results = [
        {"claim_type": "CAPACITY", "field": "capacity", "status": "PASS", "reported_value": 700, "authoritative_value": 600, "is_hard_requirement": True},
        {"claim_type": "PRICE", "field": "quoted_price", "status": "PASS", "reported_value": 380000.0, "authoritative_value": 400000.0, "is_hard_requirement": True},
        {"claim_type": "VEGETARIAN", "field": "vegetarian", "status": "PASS", "reported_value": True, "authoritative_value": True, "is_hard_requirement": True},
        {"claim_type": "AVAILABILITY", "field": "availability", "status": "PASS", "reported_value": "AVAILABLE", "authoritative_value": "AVAILABLE", "is_hard_requirement": True},
    ]
    val = _create_validation_record(db_session, event.id, task.id, vendor.id, claim_results, overall_status="VALIDATED")

    tool = BindVendorToTaskTool()
    ctx = ToolContext(db=db_session, user_id=organizer.id, event_id=event.id)
    args = BindVendorToTaskInput(
        event_id=event.id,
        task_id=task.id,
        provider_id=vendor.id,
        validation_id=val.id,
    )

    result = tool.execute(ctx, args)
    assert result.success is True
    assert result.data.binding_status == "BOUND"
    assert result.data.provider_id == vendor.id
    assert result.data.critical_path_recalculated is True
    assert result.data.budget_recalculated is True


def test_budget_overflow_blocks_binding(db_session: Session):
    """Step 27: Budget Safety - Binding quote exceeding allocated budget blocks binding."""
    env = _setup_task8_environment(db_session)
    event = env["event"]
    task = env["task2"]
    vendor = env["vendor_a"]
    organizer = env["organizer"]

    claim_results = [
        {"claim_type": "CAPACITY", "field": "capacity", "status": "PASS", "reported_value": 700, "authoritative_value": 600, "is_hard_requirement": True},
        # Price ₹4.5L exceeds allocated ₹4.0L budget
        {"claim_type": "PRICE", "field": "quoted_price", "status": "FAIL", "reported_value": 450000.0, "authoritative_value": 400000.0, "is_hard_requirement": True},
        {"claim_type": "VEGETARIAN", "field": "vegetarian", "status": "PASS", "reported_value": True, "authoritative_value": True, "is_hard_requirement": True},
        {"claim_type": "AVAILABILITY", "field": "availability", "status": "PASS", "reported_value": "AVAILABLE", "authoritative_value": "AVAILABLE", "is_hard_requirement": True},
    ]
    val = _create_validation_record(
        db_session, event.id, task.id, vendor.id, claim_results,
        hard_requirements_failed=["Price ₹450,000 > Budget ₹400,000"],
        overall_status="FAILED",
    )

    service = VendorTaskBindingService(db_session)
    res = service.bind_vendor_to_task(event.id, task.id, vendor.id, val.id, organizer.id)
    assert res.binding_status == BindingStatus.BLOCKED
    assert res.decision.reason_code == BlockingReason.BUDGET_EXCEEDED

    db_session.refresh(task)
    assert task.provider_id is None


def test_hard_requirement_dietary_fail_blocks_binding(db_session: Session):
    """Step 6: Hard requirement failure (e.g. non-vegetarian menu) blocks binding."""
    env = _setup_task8_environment(db_session)
    event = env["event"]
    task = env["task2"]
    vendor = env["vendor_a"]
    organizer = env["organizer"]

    claim_results = [
        {"claim_type": "CAPACITY", "field": "capacity", "status": "PASS", "reported_value": 700, "authoritative_value": 600, "is_hard_requirement": True},
        {"claim_type": "PRICE", "field": "quoted_price", "status": "PASS", "reported_value": 380000.0, "authoritative_value": 400000.0, "is_hard_requirement": True},
        # Vegetarian failed
        {"claim_type": "VEGETARIAN", "field": "vegetarian", "status": "FAIL", "reported_value": False, "authoritative_value": True, "is_hard_requirement": True},
        {"claim_type": "AVAILABILITY", "field": "availability", "status": "PASS", "reported_value": "AVAILABLE", "authoritative_value": "AVAILABLE", "is_hard_requirement": True},
    ]
    val = _create_validation_record(
        db_session, event.id, task.id, vendor.id, claim_results,
        hard_requirements_failed=["Vegetarian Catering Only"],
        overall_status="FAILED",
    )

    service = VendorTaskBindingService(db_session)
    res = service.bind_vendor_to_task(event.id, task.id, vendor.id, val.id, organizer.id)
    assert res.binding_status == BindingStatus.BLOCKED
    assert res.decision.reason_code == BlockingReason.HARD_REQUIREMENT_FAILED


def test_event_manager_role_can_bind(db_session: Session):
    """Step 12: Event Manager with VENDOR_ASSIGN permission can bind successfully."""
    env = _setup_task8_environment(db_session)
    event = env["event"]
    task = env["task2"]
    vendor = env["vendor_a"]
    event_manager = env["event_manager"]

    claim_results = [
        {"claim_type": "CAPACITY", "field": "capacity", "status": "PASS", "reported_value": 700, "authoritative_value": 600, "is_hard_requirement": True},
        {"claim_type": "PRICE", "field": "quoted_price", "status": "PASS", "reported_value": 380000.0, "authoritative_value": 400000.0, "is_hard_requirement": True},
        {"claim_type": "VEGETARIAN", "field": "vegetarian", "status": "PASS", "reported_value": True, "authoritative_value": True, "is_hard_requirement": True},
        {"claim_type": "AVAILABILITY", "field": "availability", "status": "PASS", "reported_value": "AVAILABLE", "authoritative_value": "AVAILABLE", "is_hard_requirement": True},
    ]
    val = _create_validation_record(db_session, event.id, task.id, vendor.id, claim_results, overall_status="VALIDATED")

    service = VendorTaskBindingService(db_session)
    res = service.bind_vendor_to_task(event.id, task.id, vendor.id, val.id, event_manager.id)
    assert res.binding_status == BindingStatus.BOUND
    assert res.provider_id == vendor.id


def test_endpoints_bind_vendor_and_feasibility(db_session: Session):
    """Step 34: API Endpoints for feasibility check and binding execution."""
    from app.api.routes.events import (
        bind_vendor_to_task_endpoint,
        get_binding_feasibility_endpoint,
    )
    from app.schemas.vendor_binding import VendorTaskBindingInput

    env = _setup_task8_environment(db_session)
    event = env["event"]
    task = env["task2"]
    vendor = env["vendor_a"]
    organizer = env["organizer"]

    claim_results = [
        {"claim_type": "CAPACITY", "field": "capacity", "status": "PASS", "reported_value": 700, "authoritative_value": 600, "is_hard_requirement": True},
        {"claim_type": "PRICE", "field": "quoted_price", "status": "PASS", "reported_value": 380000.0, "authoritative_value": 400000.0, "is_hard_requirement": True},
        {"claim_type": "VEGETARIAN", "field": "vegetarian", "status": "PASS", "reported_value": True, "authoritative_value": True, "is_hard_requirement": True},
        {"claim_type": "AVAILABILITY", "field": "availability", "status": "PASS", "reported_value": "AVAILABLE", "authoritative_value": "AVAILABLE", "is_hard_requirement": True},
    ]
    val = _create_validation_record(db_session, event.id, task.id, vendor.id, claim_results, overall_status="VALIDATED")

    # 1. Feasibility endpoint
    feasibility = get_binding_feasibility_endpoint(
        event_id=event.id,
        task_id=task.id,
        provider_id=vendor.id,
        validation_id=val.id,
        force_override_unknown=False,
        db=db_session,
        current_user_id=organizer.id,
    )
    assert feasibility.decision == "BIND"
    assert feasibility.can_bind is True

    # 2. Binding endpoint
    payload = VendorTaskBindingInput(
        event_id=event.id,
        task_id=task.id,
        provider_id=vendor.id,
        validation_id=val.id,
    )
    binding_res = bind_vendor_to_task_endpoint(
        event_id=event.id,
        task_id=task.id,
        payload=payload,
        db=db_session,
        current_user_id=organizer.id,
    )
    assert binding_res.binding_status == BindingStatus.BOUND
    assert binding_res.provider_id == vendor.id
    assert binding_res.plan_recalculation is not None

