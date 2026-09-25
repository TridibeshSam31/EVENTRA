"""Comprehensive unit tests for Task 9: Real Final Execution Plan.

Tests (8 scenarios):
1. Golden Demo Scenario: READY Wedding plan with Royal Rasoi catering assigned.
2. Partially Ready Scenario: Non-critical task unassigned → PARTIALLY_READY + warnings.
3. Blocked Scenario: Critical path task unassigned → BLOCKED.
4. Budget Exceeded Scenario: Committed spend exceeds ceiling → BLOCKED.
5. Event Deadline Violation Scenario: Task planned_end > event.end_datetime → BLOCKED.
6. Topological Execution Sequence Validation.
7. Idempotency Test: plan compiled twice produces identical readiness, no state mutation.
8. Agent Tool: GenerateFinalExecutionPlanTool typed integration.
"""
from datetime import datetime, timezone, timedelta
from decimal import Decimal
import pytest
from sqlalchemy.orm import Session

from app.models.event import Event
from app.models.task import Task
from app.models.dependency import TaskDependency
from app.models.vendor import Vendor
from app.models.budget import BudgetItem
from app.models.vendor_assignment import VendorAssignment
from app.models.resource import Resource
from app.models.user import User
from app.models.enums import (
    EventLifecycleState,
    EventState,
    TaskStatus,
    TaskPriority,
    BudgetItemStatus,
)
from app.services.final_execution_plan_service import FinalExecutionPlanService
from app.schemas.execution_plan import PlanReadiness, FinalExecutionPlan
from app.agent.tools.base import ToolContext
from app.agent.tools.planning_tools import GenerateFinalExecutionPlanTool
from app.schemas.execution_plan import GenerateFinalExecutionPlanInput


def _base_event(db: Session, now: datetime) -> Event:
    """Creates a Royal Delhi Wedding event for golden demo scenario testing."""
    user = User(name="Ankit Sharma", email="ankit.s@eventra.test")
    db.add(user)
    db.flush()

    event = Event(
        owner_id=user.id,
        name="Royal Delhi Wedding",
        event_type="wedding",
        lifecycle_state=EventLifecycleState.PLANNED.value,
        state=EventState.NORMAL.value,
        location="Taj Palace, New Delhi",
        start_datetime=now + timedelta(days=30),
        end_datetime=now + timedelta(days=30, hours=8),
        guest_count=600,
        total_budget=Decimal("1200000.00"),
        currency="INR",
    )
    db.add(event)
    db.flush()
    return event


def _add_tasks_and_deps(db: Session, event: Event, base: datetime):
    """Adds 3 tasks: Venue Prep → Catering Setup → Guest Reception, with dependencies."""
    task1 = Task(
        event_id=event.id,
        name="Venue Hall Prep",
        status=TaskStatus.ASSIGNED.value,
        priority=TaskPriority.HIGH.value,
        duration_minutes=120,
        required_provider_category="VENUE",
        slack_minutes=0,
        is_critical_path=True,
        planned_start=base,
        planned_end=base + timedelta(minutes=120),
    )
    task2 = Task(
        event_id=event.id,
        name="Catering Setup",
        status=TaskStatus.ASSIGNED.value,
        priority=TaskPriority.CRITICAL.value,
        duration_minutes=90,
        required_provider_category="CATERING",
        slack_minutes=0,
        is_critical_path=True,
        planned_start=base + timedelta(minutes=120),
        planned_end=base + timedelta(minutes=210),
    )
    task3 = Task(
        event_id=event.id,
        name="Guest Reception",
        status=TaskStatus.PENDING.value,
        priority=TaskPriority.MEDIUM.value,
        duration_minutes=60,
        required_provider_category=None,
        slack_minutes=30,
        is_critical_path=False,
        planned_start=base + timedelta(minutes=210),
        planned_end=base + timedelta(minutes=270),
    )
    db.add_all([task1, task2, task3])
    db.flush()

    dep1 = TaskDependency(
        event_id=event.id,
        predecessor_task_id=task1.id,
        successor_task_id=task2.id,
        dependency_type="FINISH_TO_START",
        lag_minutes=0,
    )
    dep2 = TaskDependency(
        event_id=event.id,
        predecessor_task_id=task2.id,
        successor_task_id=task3.id,
        dependency_type="FINISH_TO_START",
        lag_minutes=0,
    )
    db.add_all([dep1, dep2])
    db.flush()
    return task1, task2, task3


def _add_vendors(db: Session, event: Event, task1: Task, task2: Task) -> tuple:
    """Creates and assigns Royal Rasoi catering vendor and Mahal venue vendor."""
    venue_vendor = Vendor(
        name="Taj Mahal Banquet",
        category="VENUE",
        status="ACTIVE",
        max_capacity=800,
        base_price=Decimal("500000.00"),
        currency="INR",
    )
    catering_vendor = Vendor(
        name="Royal Rasoi Caterers",
        category="CATERING",
        status="ACTIVE",
        max_capacity=700,
        base_price=Decimal("380000.00"),
        currency="INR",
        cuisine_types=["Indian"],
        dietary_options=["vegetarian"],
    )
    db.add_all([venue_vendor, catering_vendor])
    db.flush()

    task1.provider_id = venue_vendor.id
    task2.provider_id = catering_vendor.id

    db.add(VendorAssignment(
        event_id=event.id,
        vendor_id=venue_vendor.id,
        category="VENUE",
        status="CONFIRMED",
        agreed_cost=500000.0,
    ))
    db.add(VendorAssignment(
        event_id=event.id,
        vendor_id=catering_vendor.id,
        category="CATERING",
        status="CONFIRMED",
        agreed_cost=380000.0,
    ))
    db.flush()
    return venue_vendor, catering_vendor


def _add_budget_items(db: Session, event: Event):
    """Adds COMMITTED and PLANNED budget line items."""
    db.add(BudgetItem(
        event_id=event.id,
        name="Venue Hire",
        category="VENUE",
        estimated_amount=Decimal("500000.00"),
        actual_amount=Decimal("500000.00"),
        currency="INR",
        status=BudgetItemStatus.COMMITTED.value,
    ))
    db.add(BudgetItem(
        event_id=event.id,
        name="Catering Services",
        category="CATERING",
        estimated_amount=Decimal("400000.00"),
        actual_amount=Decimal("380000.00"),
        currency="INR",
        status=BudgetItemStatus.COMMITTED.value,
    ))
    db.flush()


# ==============================================================================
# TEST 1: Golden Demo — READY plan, Royal Rasoi assigned, CPM verified
# ==============================================================================
def test_golden_demo_scenario_ready_plan(db_session: Session):
    """Golden demo: All critical tasks assigned, budget within limits → READY."""
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    event = _base_event(db_session, now)
    base = event.start_datetime
    task1, task2, task3 = _add_tasks_and_deps(db_session, event, base)
    _add_vendors(db_session, event, task1, task2)
    _add_budget_items(db_session, event)

    service = FinalExecutionPlanService(db_session)
    plan = service.compile_plan(event_id=event.id, user_id="system")

    # Validate plan structure
    assert isinstance(plan, FinalExecutionPlan)
    assert plan.event_id == event.id
    assert plan.event_summary.event_name == "Royal Delhi Wedding"
    assert plan.event_summary.guest_count == 600

    # Readiness
    assert plan.readiness_status == PlanReadiness.READY, f"Expected READY but got {plan.readiness_status}: blockers={[b.message for b in plan.blockers]}"

    # Task sequence: 3 tasks, in topological order
    assert len(plan.tasks) == 3
    task_names = [t.task_name for t in plan.tasks]
    venue_idx = task_names.index("Venue Hall Prep")
    catering_idx = task_names.index("Catering Setup")
    reception_idx = task_names.index("Guest Reception")
    assert venue_idx < catering_idx < reception_idx, f"Topological order violated: {task_names}"

    # Vendor assignments
    catering_task = next(t for t in plan.tasks if "Catering" in t.task_name)
    assert catering_task.is_assigned is True
    assert catering_task.assigned_provider_name == "Royal Rasoi Caterers"
    assert catering_task.assigned_provider_category == "CATERING"
    assert catering_task.is_critical_path is True
    assert catering_task.slack_minutes == 0

    # Critical path
    assert len(plan.critical_path) >= 2
    cp_names = [c.task_name for c in plan.critical_path]
    assert "Venue Hall Prep" in cp_names
    assert "Catering Setup" in cp_names

    # Budget
    assert plan.budget_summary.total_budget == Decimal("1200000.00")
    assert plan.budget_summary.is_over_budget is False

    # No blockers
    assert len(plan.blockers) == 0

    # Idempotency: plan_version does not change
    plan2 = service.compile_plan(event_id=event.id, user_id="system")
    assert plan2.plan_version == plan.plan_version
    assert plan2.readiness_status == plan.readiness_status


# ==============================================================================
# TEST 2: Partially Ready — non-critical task unassigned → PARTIALLY_READY
# ==============================================================================
def test_partially_ready_non_critical_unassigned(db_session: Session):
    """Non-critical task without assigned vendor → PARTIALLY_READY + warning, not BLOCKED."""
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    event = _base_event(db_session, now)
    base = event.start_datetime

    # Add only two tasks: critical path assigned, but one non-critical with required category unassigned
    task1 = Task(
        event_id=event.id,
        name="Venue Hall Prep",
        status=TaskStatus.ASSIGNED.value,
        priority=TaskPriority.HIGH.value,
        duration_minutes=120,
        required_provider_category="VENUE",
        slack_minutes=0,
        is_critical_path=True,
        planned_start=base,
        planned_end=base + timedelta(minutes=120),
    )
    task2 = Task(
        event_id=event.id,
        name="Photography Setup",
        status=TaskStatus.PENDING.value,
        priority=TaskPriority.MEDIUM.value,
        duration_minutes=60,
        required_provider_category="PHOTOGRAPHY",
        slack_minutes=60,
        is_critical_path=False,
        planned_start=base + timedelta(minutes=120),
        planned_end=base + timedelta(minutes=180),
    )
    db_session.add_all([task1, task2])
    db_session.flush()

    venue_vendor = Vendor(name="Grand Ballroom Venue", category="VENUE", status="ACTIVE")
    db_session.add(venue_vendor)
    db_session.flush()
    task1.provider_id = venue_vendor.id
    db_session.add(VendorAssignment(event_id=event.id, vendor_id=venue_vendor.id, category="VENUE", status="CONFIRMED", agreed_cost=300000.0))
    db_session.flush()

    service = FinalExecutionPlanService(db_session)
    plan = service.compile_plan(event_id=event.id, user_id="system")

    assert plan.readiness_status == PlanReadiness.PARTIALLY_READY, f"Got {plan.readiness_status}: blockers={[b.message for b in plan.blockers]}"
    assert len(plan.blockers) == 0  # Not a blocker since task is non-critical

    # Should have a warning about the unassigned photographer
    warning_codes = [w.reason_code for w in plan.warnings]
    assert "NON_CRITICAL_TASK_UNASSIGNED" in warning_codes

    # Photography task should be unassigned
    photo_task = next(t for t in plan.tasks if "Photography" in t.task_name)
    assert photo_task.is_assigned is False
    assert photo_task.readiness_state == "UNASSIGNED"


# ==============================================================================
# TEST 3: Blocked — Critical path task unassigned
# ==============================================================================
def test_blocked_critical_task_unassigned(db_session: Session):
    """Critical path task with required vendor category but no provider → BLOCKED."""
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    event = _base_event(db_session, now)
    base = event.start_datetime

    task1 = Task(
        event_id=event.id,
        name="Catering Setup",
        status=TaskStatus.PENDING.value,
        priority=TaskPriority.CRITICAL.value,
        duration_minutes=90,
        required_provider_category="CATERING",
        slack_minutes=0,
        is_critical_path=True,
        planned_start=base,
        planned_end=base + timedelta(minutes=90),
    )
    db_session.add(task1)
    db_session.flush()

    service = FinalExecutionPlanService(db_session)
    plan = service.compile_plan(event_id=event.id, user_id="system")

    assert plan.readiness_status == PlanReadiness.BLOCKED, f"Expected BLOCKED, got {plan.readiness_status}"

    # There must be an UNASSIGNED_CRITICAL_TASK blocker
    blocker_codes = [b.reason_code for b in plan.blockers]
    assert "UNASSIGNED_CRITICAL_TASK" in blocker_codes


# ==============================================================================
# TEST 4: Budget Exceeded → BLOCKED
# ==============================================================================
def test_blocked_budget_exceeded(db_session: Session):
    """Committed spend exceeds total event budget → BLOCKED with BUDGET_EXCEEDED."""
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    event = _base_event(db_session, now)
    # Set budget lower than commitments
    event.total_budget = Decimal("100000.00")
    db_session.flush()

    base = event.start_datetime
    task1 = Task(
        event_id=event.id,
        name="Catering Setup",
        status=TaskStatus.ASSIGNED.value,
        priority=TaskPriority.CRITICAL.value,
        duration_minutes=90,
        required_provider_category="CATERING",
        slack_minutes=0,
        is_critical_path=True,
        planned_start=base,
        planned_end=base + timedelta(minutes=90),
    )
    db_session.add(task1)
    db_session.flush()

    vendor = Vendor(name="Royal Rasoi Caterers", category="CATERING", status="ACTIVE")
    db_session.add(vendor)
    db_session.flush()
    task1.provider_id = vendor.id

    db_session.add(VendorAssignment(
        event_id=event.id,
        vendor_id=vendor.id,
        category="CATERING",
        status="CONFIRMED",
        agreed_cost=500000.0,  # More than total_budget of 100000
    ))
    db_session.flush()

    service = FinalExecutionPlanService(db_session)
    plan = service.compile_plan(event_id=event.id, user_id="system")

    assert plan.readiness_status == PlanReadiness.BLOCKED
    blocker_codes = [b.reason_code for b in plan.blockers]
    assert "BUDGET_EXCEEDED" in blocker_codes
    assert plan.budget_summary.is_over_budget is True


# ==============================================================================
# TEST 5: Event Deadline Violation → BLOCKED
# ==============================================================================
def test_blocked_event_deadline_violation(db_session: Session):
    """Task planned_end beyond event end_datetime → BLOCKED with EVENT_DEADLINE_VIOLATION."""
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    event = _base_event(db_session, now)
    base = event.start_datetime

    # Task ends after event.end_datetime (event is 8 hours, task ends in 9 hours)
    task1 = Task(
        event_id=event.id,
        name="Late Task",
        status=TaskStatus.PENDING.value,
        priority=TaskPriority.HIGH.value,
        duration_minutes=60,
        required_provider_category=None,
        slack_minutes=0,
        is_critical_path=True,
        planned_start=base,
        planned_end=base + timedelta(hours=9),  # exceeds event.end_datetime (base + 8h)
    )
    db_session.add(task1)
    db_session.flush()

    service = FinalExecutionPlanService(db_session)
    plan = service.compile_plan(event_id=event.id, user_id="system")

    assert plan.readiness_status == PlanReadiness.BLOCKED
    blocker_codes = [b.reason_code for b in plan.blockers]
    assert "EVENT_DEADLINE_VIOLATION" in blocker_codes


# ==============================================================================
# TEST 6: Topological Execution Sequence
# ==============================================================================
def test_topological_execution_sequence(db_session: Session):
    """Tasks are compiled in topological order (predecessors before successors)."""
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    event = _base_event(db_session, now)
    base = event.start_datetime
    task1, task2, task3 = _add_tasks_and_deps(db_session, event, base)
    _add_vendors(db_session, event, task1, task2)

    service = FinalExecutionPlanService(db_session)
    plan = service.compile_plan(event_id=event.id, user_id="system")

    task_ids_in_order = [t.task_id for t in plan.tasks]
    assert task_ids_in_order.index(task1.id) < task_ids_in_order.index(task2.id), "task1 must come before task2"
    assert task_ids_in_order.index(task2.id) < task_ids_in_order.index(task3.id), "task2 must come before task3"

    # Verify predecessor/successor links
    t2_compiled = next(t for t in plan.tasks if t.task_id == task2.id)
    t2_pred_ids = [p.task_id for p in t2_compiled.predecessors]
    assert task1.id in t2_pred_ids

    t1_compiled = next(t for t in plan.tasks if t.task_id == task1.id)
    t1_succ_ids = [s.task_id for s in t1_compiled.successors]
    assert task2.id in t1_succ_ids


# ==============================================================================
# TEST 7: Idempotency — No state mutation on repeated calls
# ==============================================================================
def test_idempotency_no_state_mutation(db_session: Session):
    """Calling compile_plan twice produces identical output without mutating state."""
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    event = _base_event(db_session, now)
    base = event.start_datetime
    task1, task2, task3 = _add_tasks_and_deps(db_session, event, base)
    _add_vendors(db_session, event, task1, task2)
    _add_budget_items(db_session, event)

    service = FinalExecutionPlanService(db_session)
    plan_a = service.compile_plan(event_id=event.id, user_id="system")
    plan_b = service.compile_plan(event_id=event.id, user_id="system")

    # Plan version must not change between calls (read-only)
    assert plan_a.plan_version == plan_b.plan_version, f"Plan version changed: {plan_a.plan_version} → {plan_b.plan_version}"

    # Readiness must be identical
    assert plan_a.readiness_status == plan_b.readiness_status

    # Same number of tasks
    assert len(plan_a.tasks) == len(plan_b.tasks)

    # Same critical path tasks
    cp_ids_a = {c.task_id for c in plan_a.critical_path}
    cp_ids_b = {c.task_id for c in plan_b.critical_path}
    assert cp_ids_a == cp_ids_b

    # No state transitions were added
    from app.models.state_transition import StateTransition
    count = db_session.query(StateTransition).filter(StateTransition.event_id == event.id).count()
    assert count == 0  # No state transitions from read-only compilation


# ==============================================================================
# TEST 8: Agent Tool Integration
# ==============================================================================
def test_agent_tool_generate_final_execution_plan(db_session: Session):
    """GenerateFinalExecutionPlanTool executes cleanly and returns FinalExecutionPlan."""
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    event = _base_event(db_session, now)
    base = event.start_datetime
    task1, task2, task3 = _add_tasks_and_deps(db_session, event, base)
    _add_vendors(db_session, event, task1, task2)
    _add_budget_items(db_session, event)

    tool = GenerateFinalExecutionPlanTool()
    ctx = ToolContext(db=db_session, user_id="system", event_id=event.id)
    args = GenerateFinalExecutionPlanInput(event_id=event.id)

    result = tool.execute(ctx, args)

    assert result.success is True, f"Tool failed: {result.error}"
    assert result.data is not None
    assert isinstance(result.data, FinalExecutionPlan)
    assert result.data.event_id == event.id
    assert result.data.readiness_status in (PlanReadiness.READY, PlanReadiness.PARTIALLY_READY, PlanReadiness.BLOCKED, PlanReadiness.INCOMPLETE)


# ==============================================================================
# TEST 9: Registry Integration
# ==============================================================================
def test_registry_contains_generate_final_execution_plan():
    """AgentToolRegistry includes generate_final_execution_plan tool."""
    from app.agent.tools.registry import create_default_tool_registry
    registry = create_default_tool_registry()
    assert registry.has_tool("generate_final_execution_plan"), "generate_final_execution_plan tool not found in registry"
    tool = registry.get("generate_final_execution_plan")
    assert tool.access_mode.value == "READ_ONLY"
    assert tool.category.value == "PLANNING"


# ==============================================================================
# TEST 10: Event Summary fields
# ==============================================================================
def test_event_summary_fields(db_session: Session):
    """Event summary in FinalExecutionPlan exposes all required fields."""
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    event = _base_event(db_session, now)

    service = FinalExecutionPlanService(db_session)
    plan = service.compile_plan(event_id=event.id, user_id="system")

    es = plan.event_summary
    assert es.event_id == event.id
    assert es.event_name == "Royal Delhi Wedding"
    assert es.guest_count == 600
    assert es.total_budget == Decimal("1200000.00")
    assert es.currency == "INR"
    assert "Taj Palace" in (es.location or "")
    assert es.start_datetime is not None
    assert es.end_datetime is not None


# ==============================================================================
# TEST 11: Budget Summary Precision
# ==============================================================================
def test_budget_summary_decimal_precision(db_session: Session):
    """Budget summary uses Decimal precision and computes remaining correctly."""
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    event = _base_event(db_session, now)
    _add_budget_items(db_session, event)

    service = FinalExecutionPlanService(db_session)
    plan = service.compile_plan(event_id=event.id, user_id="system")

    bs = plan.budget_summary
    assert bs.total_budget == Decimal("1200000.00")
    assert isinstance(bs.total_committed, Decimal)
    assert isinstance(bs.remaining_budget, Decimal)
    # With ₹880k committed and ₹1.2M budget, remaining should be positive
    assert bs.remaining_budget >= Decimal("0.00"), f"remaining_budget negative: {bs.remaining_budget}"


# ==============================================================================
# TEST 12: Checkpoints are generated from scheduled tasks
# ==============================================================================
def test_execution_checkpoints_generated(db_session: Session):
    """Execution checkpoints are generated for tasks with planned_start times."""
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    event = _base_event(db_session, now)
    base = event.start_datetime
    task1, task2, task3 = _add_tasks_and_deps(db_session, event, base)
    _add_vendors(db_session, event, task1, task2)

    service = FinalExecutionPlanService(db_session)
    plan = service.compile_plan(event_id=event.id, user_id="system")

    # Must have at least 3 checkpoints (one START per task with scheduled time)
    assert len(plan.execution_checkpoints) >= 3

    checkpoint_types = {cp.checkpoint_type for cp in plan.execution_checkpoints}
    assert "START" in checkpoint_types

    # Verify deadline checkpoint exists
    deadline_cps = [cp for cp in plan.execution_checkpoints if cp.checkpoint_type == "DEADLINE"]
    assert len(deadline_cps) == 1, "Expected exactly one DEADLINE checkpoint"


# ==============================================================================
# TEST 13: Operational Focus Summary
# ==============================================================================
def test_operational_focus_summary_populated(db_session: Session):
    """Operational focus summary is populated and references readiness status."""
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    event = _base_event(db_session, now)
    base = event.start_datetime
    task1, task2, task3 = _add_tasks_and_deps(db_session, event, base)
    _add_vendors(db_session, event, task1, task2)
    _add_budget_items(db_session, event)

    service = FinalExecutionPlanService(db_session)
    plan = service.compile_plan(event_id=event.id, user_id="system")

    assert plan.operational_focus is not None
    assert len(plan.operational_focus) > 20
    # Should mention plan version and readiness
    assert "v" in plan.operational_focus or "READY" in plan.operational_focus


# ==============================================================================
# TEST 14: Incomplete Plan — No Tasks
# ==============================================================================
def test_incomplete_plan_no_tasks(db_session: Session):
    """Event with no tasks produces BLOCKED (NO_TASKS_DEFINED)."""
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    event = _base_event(db_session, now)

    service = FinalExecutionPlanService(db_session)
    plan = service.compile_plan(event_id=event.id, user_id="system")

    assert plan.readiness_status == PlanReadiness.BLOCKED
    blocker_codes = [b.reason_code for b in plan.blockers]
    assert "NO_TASKS_DEFINED" in blocker_codes


# ==============================================================================
# TEST 15: API Endpoint
# ==============================================================================
def test_api_endpoint_get_execution_plan(test_client, db_session: Session):
    """GET /api/events/{event_id}/execution-plan returns 200 with FinalExecutionPlan."""
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    event = _base_event(db_session, now)
    db_session.commit()

    response = test_client.get(f"/api/events/{event.id}/execution-plan")
    assert response.status_code == 200
    data = response.json()
    assert data["event_id"] == event.id
    assert "readiness_status" in data
    assert "tasks" in data
    assert "budget_summary" in data
    assert "critical_path" in data


# ==============================================================================
# TEST 16: Invalid authoritative graph is reported, never repaired
# ==============================================================================
def test_cycle_blocks_plan_generation_without_reordering(db_session: Session):
    """A cycle in Task 8 state is a blocker; Task 9 must not repair it."""
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    event = _base_event(db_session, now)
    base = event.start_datetime
    first = Task(event_id=event.id, name="First", duration_minutes=30, slack_minutes=0,
                 is_critical_path=True, planned_start=base, planned_end=base + timedelta(minutes=30))
    second = Task(event_id=event.id, name="Second", duration_minutes=30, slack_minutes=0,
                  is_critical_path=True, planned_start=base + timedelta(minutes=30),
                  planned_end=base + timedelta(minutes=60))
    db_session.add_all([first, second])
    db_session.flush()
    db_session.add_all([
        TaskDependency(event_id=event.id, predecessor_task_id=first.id, successor_task_id=second.id),
        TaskDependency(event_id=event.id, predecessor_task_id=second.id, successor_task_id=first.id),
    ])
    db_session.flush()

    plan = FinalExecutionPlanService(db_session).compile_plan(event.id, user_id="system")

    assert plan.readiness_status == PlanReadiness.BLOCKED
    assert any(blocker.reason_code == "DAG_CYCLE_DETECTED" for blocker in plan.blockers)
    assert plan.is_consistent is False


# ==============================================================================
# TEST 17: Task provider must match an authoritative assignment record
# ==============================================================================
def test_missing_vendor_assignment_record_blocks_plan(db_session: Session):
    """Task.provider_id alone is not treated as an authoritative binding."""
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    event = _base_event(db_session, now)
    vendor = Vendor(name="Unrecorded Caterer", category="CATERING", status="ACTIVE")
    db_session.add(vendor)
    db_session.flush()
    task = Task(
        event_id=event.id, name="Catering", status=TaskStatus.ASSIGNED.value,
        duration_minutes=60, required_provider_category="CATERING", slack_minutes=0,
        is_critical_path=True, planned_start=event.start_datetime,
        planned_end=event.start_datetime + timedelta(minutes=60), provider_id=vendor.id,
    )
    db_session.add(task)
    db_session.flush()

    plan = FinalExecutionPlanService(db_session).compile_plan(event.id, user_id="system")

    assert plan.readiness_status == PlanReadiness.BLOCKED
    assert any(blocker.reason_code == "ASSIGNMENT_RECORD_MISSING" for blocker in plan.blockers)


# ==============================================================================
# TEST 18: Missing CPM state remains visible and is never recalculated by Task 9
# ==============================================================================
def test_missing_cpm_state_is_warning_and_does_not_mutate_task(db_session: Session):
    """The read-only compiler cannot calculate or persist CPM values on behalf of Task 8."""
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    event = _base_event(db_session, now)
    task = Task(
        event_id=event.id, name="Uncalculated Task", duration_minutes=30,
        planned_start=event.start_datetime, planned_end=event.start_datetime + timedelta(minutes=30),
        slack_minutes=None, is_critical_path=False,
    )
    db_session.add(task)
    db_session.flush()

    plan = FinalExecutionPlanService(db_session).compile_plan(event.id, user_id="system")

    assert any(warning.reason_code == "CPM_STATE_UNAVAILABLE" for warning in plan.warnings)
    assert task.slack_minutes is None
    assert task.is_critical_path is False
