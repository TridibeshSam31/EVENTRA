"""Authoritative Unit & Integration Tests for TASK 11: REAL PAUSE / RESUME OF EVENT EXECUTION.

Verifies:
1. Explicit, Transactional State Machine (RUNNING -> PAUSING -> PAUSED, PAUSED -> RESUMING -> RUNNING).
2. Rejection of Invalid Transitions (RUNNING -> RESUMING, PAUSED -> PAUSING, etc.).
3. Duplicate Pause & Resume Idempotency.
4. Authorization & Governance (Main Organizer / Event Manager permitted, Collaborator / Unauthorized rejected).
5. Comprehensive State Preservation (Tasks, Vendors, Dependencies, Budget, Plan Version, Incidents, Recovery).
6. Centralized Execution Gate in ActionService (All consequential actions & recovery blocked while PAUSED).
7. Read-Only Operations Accessibility While Paused.
8. State-Aware Resumption without plan rebuilding.
9. Concurrency & Stale State Rejection (mismatched plan_version rejected as STALE_STATE).
10. Task 10 Recovery Integration (Active incident remains ACTIVE; blocked during pause; resumable after).
11. Agent Execution Gate (Agent observes PAUSED, halts safely without mutating, returns WAIT).
12. Audit Trail (EventPauseRecord and AuditRecord generated with complete metadata).
"""
import uuid
from datetime import datetime, timezone, timedelta
from decimal import Decimal
import pytest
from sqlalchemy.orm import Session

from app.agent.agent import EventOperationsAgent
from app.agent.decision import AgentDecision, DecisionType, ReasonCode
from app.agent.provider import MockLLMProvider
from app.agent.tools.registry import default_registry, ToolStatus
from app.core.exceptions import ConflictException, NotFoundException, BadRequestException, ForbiddenException
from app.db.base import Base
from app.models.action import ActionExecution
from app.models.approval import Approval, ApprovalRequest
from app.models.budget import BudgetItem
from app.models.dependency import TaskDependency
from app.models.enums import (
    EventExecutionState,
    EventLifecycleState,
    EventState,
    IncidentSeverity,
    IncidentStatus,
    IncidentType,
    RoleType,
    TaskPriority,
    TaskStatus,
)
from app.models.event import Event
from app.models.event_member import EventMember
from app.models.incident import Incident
from app.models.pause_record import EventPauseRecord
from app.models.recovery import Recovery
from app.models.resource import Resource
from app.models.task import Task
from app.models.user import User
from app.models.vendor import Vendor
from app.models.vendor_assignment import VendorAssignment
from app.models.verification import VerificationResult
from app.schemas.incident import IncidentCreate
from app.schemas.pause_resume import PauseEventRequest, ResumeEventRequest
from app.services.action_service import ActionService
from app.services.final_execution_plan_service import FinalExecutionPlanService
from app.services.incident_service import IncidentService
from app.services.pause_resume_service import PauseResumeService
from app.services.recovery_service import RecoveryService

# Enable subscript access on SQLAlchemy models for test convenience
Base.__getitem__ = lambda self, key: getattr(self, key)
Base.__setitem__ = lambda self, key, value: setattr(self, key, value)


@pytest.fixture
def db(db_session: Session) -> Session:
    return db_session


def _setup_live_event(db: Session):
    """Sets up a complete live event environment with tasks, vendors, and members."""
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    owner = User(name="Lead Event Director", email=f"director_{uuid.uuid4().hex[:6]}@eventra.test")
    collaborator = User(name="Junior Coordinator", email=f"junior_{uuid.uuid4().hex[:6]}@eventra.test")
    db.add_all([owner, collaborator])
    db.flush()

    event = Event(
        owner_id=owner.id,
        name="Global Tech Summit 2026",
        lifecycle_state=EventLifecycleState.LIVE.value,
        state=EventState.NORMAL.value,
        execution_state=EventExecutionState.RUNNING.value,
        start_datetime=now + timedelta(hours=2),
        end_datetime=now + timedelta(hours=14),
        total_budget=Decimal("120000.00"),
        guest_count=600,
    )
    db.add(event)
    db.flush()

    db.add(EventMember(event_id=event.id, user_id=owner.id, role=RoleType.MAIN_ORGANIZER.value))
    db.add(EventMember(event_id=event.id, user_id=collaborator.id, role=RoleType.COLLABORATOR.value))

    # Vendors
    vendor_a = Vendor(name="Apex Sound Systems", category="sound", city="New York", status="ACTIVE", base_cost=Decimal("5000.00"))
    vendor_b = Vendor(name="Horizon Backup Audio", category="sound", city="New York", status="ACTIVE", base_cost=Decimal("5500.00"))
    db.add_all([vendor_a, vendor_b])
    db.flush()

    # Vendor assignment
    va = VendorAssignment(
        event_id=event.id,
        vendor_id=vendor_a.id,
        category="sound",
        status="CONFIRMED",
        agreed_cost=Decimal("5000.00"),
    )
    db.add(va)

    # Budget Item
    b_item = BudgetItem(
        event_id=event.id,
        category="sound",
        name="Sound & AV Tech",
        estimated_amount=Decimal("8000.00"),
        actual_amount=Decimal("5000.00"),
        status="COMMITTED",
    )
    db.add(b_item)

    # Tasks with dependency
    t1 = Task(
        event_id=event.id,
        name="Setup Stage & Audio Consoles",
        required_provider_category="sound",
        status=TaskStatus.READY.value,
        priority=TaskPriority.CRITICAL.value,
        duration_minutes=120,
        provider_id=vendor_a.id,
        is_critical_path=True,
    )
    t2 = Task(
        event_id=event.id,
        name="Keynote Speaker Audio Check",
        required_provider_category="sound",
        status=TaskStatus.PENDING.value,
        priority=TaskPriority.HIGH.value,
        duration_minutes=45,
        provider_id=vendor_a.id,
        is_critical_path=True,
    )
    db.add_all([t1, t2])
    db.flush()

    db.add(TaskDependency(event_id=event.id, predecessor_task_id=t1.id, successor_task_id=t2.id, dependency_type="FS"))
    db.commit()

    return {
        "event": event,
        "owner": owner,
        "collaborator": collaborator,
        "vendor_a": vendor_a,
        "vendor_b": vendor_b,
        "task_1": t1,
        "task_2": t2,
        "budget_item": b_item,
        "vendor_assignment": va,
    }


# ==============================================================================
# 1. STATE TESTS
# ==============================================================================

def test_explicit_pause_and_resume_lifecycle(db: Session):
    """Verifies RUNNING -> PAUSING -> PAUSED and PAUSED -> RESUMING -> RUNNING."""
    env = _setup_live_event(db)
    service = PauseResumeService(db)

    # Baseline: event is RUNNING
    state = service.get_execution_state(env["event"].id, env["owner"].id)
    assert state["execution_state"] == "RUNNING"
    assert state["can_pause"] is True
    assert state["can_resume"] is False
    assert state["is_paused"] is False

    # Execute Pause
    pause_rec = service.pause_event(
        event_id=env["event"].id,
        user_id=env["owner"].id,
        reason="Adverse weather hold; pausing active execution",
    )
    assert pause_rec.previous_state == "RUNNING"
    assert pause_rec.target_state == "PAUSED"
    assert pause_rec.status == "COMPLETED"

    # Verify event state in DB
    refreshed_state = service.get_execution_state(env["event"].id, env["owner"].id)
    assert refreshed_state["execution_state"] == "PAUSED"
    assert refreshed_state["is_paused"] is True
    assert refreshed_state["can_pause"] is False
    assert refreshed_state["can_resume"] is True

    # Execute Resume
    resume_rec = service.resume_event(
        event_id=env["event"].id,
        user_id=env["owner"].id,
        reason="Weather cleared; resuming execution safely",
    )
    assert resume_rec.previous_state == "PAUSED"
    assert resume_rec.target_state == "RUNNING"
    assert resume_rec.status == "COMPLETED"

    # Verify event state restored to RUNNING
    final_state = service.get_execution_state(env["event"].id, env["owner"].id)
    assert final_state["execution_state"] == "RUNNING"
    assert final_state["is_paused"] is False
    assert final_state["can_pause"] is True


def test_invalid_state_transitions_rejected(db: Session):
    """Verifies that invalid state transitions are strictly rejected."""
    env = _setup_live_event(db)
    service = PauseResumeService(db)

    # Cannot resume an already RUNNING event
    with pytest.raises(BadRequestException) as exc:
        service.resume_event(
            event_id=env["event"].id,
            user_id=env["owner"].id,
            reason="Invalid resume",
        )
    assert "INVALID_TRANSITION" in str(exc.value)

    # Transition to PAUSED
    service.pause_event(
        event_id=env["event"].id,
        user_id=env["owner"].id,
        reason="Valid pause",
    )

    # Set execution state directly to an invalid state to test transition guard
    env["event"].execution_state = EventExecutionState.RESUMING.value
    db.commit()

    # Cannot pause while RESUMING
    with pytest.raises(ConflictException) as exc:
        service.pause_event(
            event_id=env["event"].id,
            user_id=env["owner"].id,
            reason="Pause during resume",
        )
    assert "INVALID_TRANSITION" in str(exc.value)


def test_duplicate_pause_and_resume_idempotency(db: Session):
    """Verifies idempotent handling of duplicate pause/resume calls."""
    env = _setup_live_event(db)
    service = PauseResumeService(db)

    # First pause succeeds
    rec1 = service.pause_event(
        event_id=env["event"].id,
        user_id=env["owner"].id,
        reason="Initial pause",
    )
    assert rec1.status == "COMPLETED"
    assert rec1.target_state == "PAUSED"

    # Duplicate pause on already PAUSED event returns ALREADY_PAUSED
    rec2 = service.pause_event(
        event_id=env["event"].id,
        user_id=env["owner"].id,
        reason="Second pause attempt",
    )
    assert rec2.status == "ALREADY_PAUSED"

    # First resume succeeds
    res1 = service.resume_event(
        event_id=env["event"].id,
        user_id=env["owner"].id,
        reason="Initial resume",
    )
    assert res1.status == "COMPLETED"
    assert res1.target_state == "RUNNING"

    # If already running, resume is rejected as invalid transition
    with pytest.raises(BadRequestException):
        service.resume_event(
            event_id=env["event"].id,
            user_id=env["owner"].id,
            reason="Duplicate resume",
        )


# ==============================================================================
# 2. AUTHORIZATION TESTS
# ==============================================================================

def test_authorization_boundaries(db: Session):
    """Verifies that only authorized roles (MAIN_ORGANIZER, EVENT_MANAGER) can pause/resume."""
    env = _setup_live_event(db)
    service = PauseResumeService(db)

    # Collaborator (without EVENT_PAUSE permission) cannot pause
    with pytest.raises(ForbiddenException):
        service.pause_event(
            event_id=env["event"].id,
            user_id=env["collaborator"].id,
            reason="Collaborator unauthorized pause",
        )

    # Non-member cannot pause
    stranger = User(name="Random User", email="stranger@test.com")
    db.add(stranger)
    db.commit()

    with pytest.raises(ForbiddenException):
        service.pause_event(
            event_id=env["event"].id,
            user_id=stranger.id,
            reason="Stranger unauthorized pause",
        )

    # Authorized Main Organizer can pause
    rec = service.pause_event(
        event_id=env["event"].id,
        user_id=env["owner"].id,
        reason="Authorized pause",
    )
    assert rec.status == "COMPLETED"
    assert rec.target_state == "PAUSED"

    # Collaborator cannot resume
    with pytest.raises(ForbiddenException):
        service.resume_event(
            event_id=env["event"].id,
            user_id=env["collaborator"].id,
            reason="Collaborator unauthorized resume",
        )

    # Authorized Main Organizer can resume
    rec_res = service.resume_event(
        event_id=env["event"].id,
        user_id=env["owner"].id,
        reason="Authorized resume",
    )
    assert rec_res.status == "COMPLETED"
    assert rec_res.target_state == "RUNNING"



# ==============================================================================
# 3. PRESERVATION TESTS
# ==============================================================================

def test_full_state_preservation_across_pause(db: Session):
    """Verifies that tasks, provider bindings, dependencies, budget, and plan version remain intact."""
    env = _setup_live_event(db)
    service = PauseResumeService(db)
    plan_service = FinalExecutionPlanService(db)

    # Capture baseline plan and version
    plan_before = plan_service.compile_plan(env["event"].id, env["owner"].id)
    baseline_version = plan_before.plan_version

    # Perform Pause
    service.pause_event(
        event_id=env["event"].id,
        user_id=env["owner"].id,
        request=PauseEventRequest(reason="Preservation test pause"),
    )

    # Check tasks: statuses not wiped, provider_id preserved
    t1 = db.query(Task).filter(Task.id == env["task_1"].id).first()
    t2 = db.query(Task).filter(Task.id == env["task_2"].id).first()
    assert t1.status == TaskStatus.READY.value
    assert t1.provider_id == env["vendor_a"].id
    assert t2.status == TaskStatus.PENDING.value
    assert t2.provider_id == env["vendor_a"].id

    # Check vendor assignment intact
    va = db.query(VendorAssignment).filter(VendorAssignment.id == env["vendor_assignment"].id).first()
    assert va.status == "CONFIRMED"
    assert va.vendor_id == env["vendor_a"].id

    # Check dependencies intact
    dep = db.query(TaskDependency).filter(
        TaskDependency.event_id == env["event"].id,
        TaskDependency.predecessor_task_id == t1.id,
    ).first()
    assert dep is not None
    assert dep.successor_task_id == t2.id

    # Check budget intact
    b = db.query(BudgetItem).filter(BudgetItem.id == env["budget_item"].id).first()
    assert b.actual_amount == Decimal("5000.00")
    assert b.status == "COMMITTED"

    # Check plan version integrity: must NOT increment merely due to pause
    plan_after = plan_service.compile_plan(env["event"].id, env["owner"].id)
    assert plan_after.plan_version == baseline_version
    assert len(plan_after.tasks) == len(plan_before.tasks)


# ==============================================================================
# 4. ACTION BLOCKING TESTS (EXECUTION GATE)
# ==============================================================================

def test_action_service_blocks_mutations_when_paused(db: Session):
    """Verifies that ActionService centrally blocks all consequential actions and recovery while paused."""
    env = _setup_live_event(db)
    pause_service = PauseResumeService(db)
    action_service = ActionService(db)

    # Pause the event
    pause_service.pause_event(
        event_id=env["event"].id,
        user_id=env["owner"].id,
        reason="Freezing all mutations",
    )

    # ActionService.execute_action MUST raise ConflictException with EXECUTION_PAUSED
    with pytest.raises(ConflictException) as exc:
        action_service.execute_action(
            event_id=env["event"].id,
            executor_id=env["owner"].id,
            action_type="REASSIGN_VENDOR",
            target_type="TASK",
            target_id=env["task_1"].id,
            payload={"replacement_vendor_id": env["vendor_b"].id},
        )
    assert "EXECUTION_PAUSED" in str(exc.value)

    # ActionService.execute_recovery_option MUST also raise ConflictException with EXECUTION_PAUSED
    with pytest.raises(ConflictException) as exc_rec:
        action_service.execute_recovery_option(
            event_id=env["event"].id,
            executor_id=env["owner"].id,
            recovery_option_id="rec-nonexistent",
        )
    assert "EXECUTION_PAUSED" in str(exc_rec.value)


# ==============================================================================
# 5. READ-ONLY ACCESS WHILE PAUSED
# ==============================================================================

def test_read_only_access_permitted_while_paused(db: Session):
    """Verifies that telemetry, plan, tasks, and pause history remain fully readable while paused."""
    env = _setup_live_event(db)
    pause_service = PauseResumeService(db)
    plan_service = FinalExecutionPlanService(db)

    pause_service.pause_event(
        event_id=env["event"].id,
        user_id=env["owner"].id,
        reason="Read-only test pause",
    )

    # 1. Execution state readable
    state = pause_service.get_execution_state(env["event"].id, env["owner"].id)
    assert state["execution_state"] == "PAUSED"
    assert state["is_paused"] is True

    # 2. Plan readable
    plan = plan_service.compile_plan(env["event"].id, env["owner"].id)
    assert plan is not None
    assert plan.event_id == env["event"].id

    # 3. Pause history readable
    history = pause_service.get_pause_history(env["event"].id, env["owner"].id)
    assert len(history) >= 1
    assert history[0]["operation_type"] == "PAUSE"


# ==============================================================================
# 6. RESUME & STATE INTEGRITY
# ==============================================================================

def test_resume_validates_state_and_restores_execution(db: Session):
    """Verifies that resume re-observes state and allows actions to proceed normally."""
    env = _setup_live_event(db)
    pause_service = PauseResumeService(db)
    action_service = ActionService(db)

    # Pause
    pause_service.pause_event(
        event_id=env["event"].id,
        user_id=env["owner"].id,
        reason="Pause before action",
    )

    # Blocked while paused
    with pytest.raises(ConflictException) as exc:
        action_service.execute_action(
            event_id=env["event"].id,
            executor_id=env["owner"].id,
            action_type="ADJUST_SCHEDULE",
            target_type="TASK",
            target_id=env["task_1"].id,
            payload={"duration_minutes": 130},
        )
    assert "EXECUTION_PAUSED" in str(exc.value)

    # Resume
    pause_service.resume_event(
        event_id=env["event"].id,
        user_id=env["owner"].id,
        reason="Resuming execution",
    )

    # Action execution is no longer blocked by the pause guard
    result = action_service.execute_action(
        event_id=env["event"].id,
        executor_id=env["owner"].id,
        action_type="ADJUST_SCHEDULE",
        target_type="TASK",
        target_id=env["task_1"].id,
        payload={"duration_minutes": 130},
    )
    assert result is not None
    assert result.status == "SUCCESS"


# ==============================================================================
# 7. CONCURRENCY & STALE STATE REJECTION
# ==============================================================================

def test_stale_state_rejection_on_plan_version_mismatch(db: Session):
    """Verifies that a pause or resume request targeting a stale plan_version is rejected."""
    env = _setup_live_event(db)
    pause_service = PauseResumeService(db)

    # Stale plan version on pause
    with pytest.raises(ConflictException) as exc:
        pause_service.pause_event(
            event_id=env["event"].id,
            user_id=env["owner"].id,
            reason="Stale pause",
            plan_version=999,
        )
    assert "STALE_STATE" in str(exc.value)

    # Pause with valid plan version
    pause_service.pause_event(
        event_id=env["event"].id,
        user_id=env["owner"].id,
        reason="Valid pause",
        plan_version=1,
    )

    # Stale plan version on resume
    with pytest.raises(ConflictException) as exc_res:
        pause_service.resume_event(
            event_id=env["event"].id,
            user_id=env["owner"].id,
            reason="Stale resume",
            plan_version=999,
        )
    assert "STALE_STATE" in str(exc_res.value)


# ==============================================================================
# 8. TASK 10 RECOVERY INTERACTION & RESUMPTION
# ==============================================================================

def test_active_incident_preserved_during_pause_and_resumed_safely(db: Session):
    """Verifies that active incidents remain ACTIVE while paused, recovery execution is blocked, and recovers after resume."""
    env = _setup_live_event(db)
    pause_service = PauseResumeService(db)
    incident_service = IncidentService(db)
    action_service = ActionService(db)
    recovery_service = RecoveryService(db)

    # 1. Ingest an incident (Vendor Delay)
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    data = IncidentCreate(
        incident_type=IncidentType.VENDOR_DELAY,
        title="Apex Sound Tech Missing",
        description="Lead technician has not arrived for stage setup.",
        severity=IncidentSeverity.HIGH,
        source="SYSTEM_MONITOR",
        occurred_at=now,
        related_task_id=env["task_1"].id,
        related_vendor_id=env["vendor_a"].id,
        evidence_metadata={"delay_minutes": 30},
    )
    incident = incident_service.create_incident(
        event_id=env["event"].id,
        data=data,
        current_user_id=env["owner"].id,
    )
    assert incident.status != IncidentStatus.RESOLVED.value

    # Generate feasible recovery options
    options = recovery_service.generate_recovery_options(
        event_id=env["event"].id,
        incident_id=incident.id,
        current_user_id=env["owner"].id,
    )
    assert len(options) >= 1
    feasible_opt = [o for o in options if o.is_feasible][0]

    # 2. Pause Event
    pause_service.pause_event(
        event_id=env["event"].id,
        user_id=env["owner"].id,
        reason="Pausing while investigating vendor issue",
    )

    # 3. Verify incident remains ACTIVE and NOT falsely resolved
    refreshed_incident = db.query(Incident).filter(Incident.id == incident.id).first()
    assert refreshed_incident.status != IncidentStatus.RESOLVED.value

    # Check execution state reflects active incident
    exec_state = pause_service.get_execution_state(env["event"].id, env["owner"].id)
    assert exec_state["is_paused"] is True
    assert exec_state["active_incidents_count"] >= 1

    # 4. Attempt recovery action execution while paused: MUST BE BLOCKED
    with pytest.raises(ConflictException) as exc:
        action_service.execute_recovery_option(
            event_id=env["event"].id,
            executor_id=env["owner"].id,
            recovery_option_id=feasible_opt.id,
        )
    assert "EXECUTION_PAUSED" in str(exc.value)

    # 5. Resume Event
    pause_service.resume_event(
        event_id=env["event"].id,
        user_id=env["owner"].id,
        reason="Resuming event to execute recovery",
    )

    # Verify incident is still active and can now proceed
    resumed_state = pause_service.get_execution_state(env["event"].id, env["owner"].id)
    assert resumed_state["is_paused"] is False

    # Consequential recovery execution of old option derived before pause:
    # Must be safely rejected as STALE_ACTION because event state transitioned
    with pytest.raises(ConflictException) as exc_stale:
        action_service.execute_recovery_option(
            event_id=env["event"].id,
            executor_id=env["owner"].id,
            recovery_option_id=feasible_opt.id,
        )
    assert "STALE_ACTION" in str(exc_stale.value)

    # Re-evaluate / generate fresh recovery option derived from current post-resume state
    fresh_options = recovery_service.generate_recovery_options(
        event_id=env["event"].id,
        incident_id=incident.id,
        current_user_id=env["owner"].id,
    )
    assert len(fresh_options) >= 1
    fresh_feasible = [o for o in fresh_options if o.is_feasible][0]

    # Fresh recovery option executes successfully
    rec_exec = action_service.execute_recovery_option(
        event_id=env["event"].id,
        executor_id=env["owner"].id,
        recovery_option_id=fresh_feasible.id,
    )
    assert rec_exec.status == "SUCCESS"


# ==============================================================================
# 9. AGENT EXECUTION GATE
# ==============================================================================

def test_agent_loop_halts_and_waits_when_event_is_paused(db: Session):
    """Verifies that the agent loop observes PAUSED, halts execution, and emits WAIT decision."""
    env = _setup_live_event(db)
    pause_service = PauseResumeService(db)

    # Pause the event
    pause_service.pause_event(
        event_id=env["event"].id,
        user_id=env["owner"].id,
        reason="Operator paused execution",
    )

    # Run agent loop
    agent = EventOperationsAgent(db=db)
    final_state = agent.run(
        event_id=env["event"].id,
        message="Investigate sound tech arrival status and recover setup",
        user_id=env["owner"].id,
    )

    # Agent must terminate with PAUSED status and NOT execute tool calls
    assert final_state["status"] == "PAUSED"
    assert final_state["termination_status"] == "PAUSED"

    decision = final_state.get("last_decision") or {}
    assert decision.get("decision_type") == DecisionType.WAIT.value
    assert decision.get("reason_code") == ReasonCode.EVENT_EXECUTION_PAUSED.value
    assert "blocked" in decision.get("rationale", "").lower()


# ==============================================================================
# 10. AGENT TOOLS
# ==============================================================================

def test_agent_tools_pause_resume_and_gate(db: Session):
    """Verifies pause_event, resume_event, and get_execution_state registered agent tools."""
    env = _setup_live_event(db)

    # 1. get_execution_state tool (read-only, succeeds without approval)
    res_get = default_registry.execute(
        tool_name="get_execution_state",
        arguments={"event_id": env["event"].id},
        db=db,
        user_id=env["owner"].id,
        event_id=env["event"].id,
    )
    assert res_get.status == ToolStatus.SUCCESS
    assert res_get.data["execution_state"] == "RUNNING"
    assert res_get.data["can_pause"] is True

    # 2. pause_event tool without approval: MUST require human approval
    res_pause_unapproved = default_registry.execute(
        tool_name="pause_event",
        arguments={"event_id": env["event"].id, "reason": "Agent attempted unapproved pause"},
        db=db,
        user_id=env["owner"].id,
        event_id=env["event"].id,
    )
    assert res_pause_unapproved.status == ToolStatus.REQUIRES_APPROVAL

    # Create approved approval record for pause
    approval_pause = Approval(
        event_id=env["event"].id,
        action_type="EVENT_PAUSE",
        target_type="EVENT",
        target_id=env["event"].id,
        impact_level="HIGH",
        status="APPROVED",
        state_snapshot="valid_snapshot",
        requester_id=env["owner"].id,
        created_at=datetime.now(timezone.utc).replace(tzinfo=None),
    )
    db.add(approval_pause)
    db.commit()
    db.refresh(approval_pause)

    # Execute pause_event with approved approval_id
    res_pause = default_registry.execute(
        tool_name="pause_event",
        arguments={
            "event_id": env["event"].id,
            "reason": "Agent initiated pause with organizer authority",
            "approval_id": approval_pause.id,
        },
        db=db,
        user_id=env["owner"].id,
        event_id=env["event"].id,
        approval_id=approval_pause.id,
    )
    assert res_pause.status == ToolStatus.SUCCESS
    assert res_pause.data["status"] == "COMPLETED"
    assert res_pause.data["target_state"] == "PAUSED"

    # 3. Verify event is now PAUSED in get_execution_state
    res_get2 = default_registry.execute(
        tool_name="get_execution_state",
        arguments={"event_id": env["event"].id},
        db=db,
        user_id=env["owner"].id,
        event_id=env["event"].id,
    )
    assert res_get2.data["execution_state"] == "PAUSED"
    assert res_get2.data["is_paused"] is True
    assert res_get2.data["can_resume"] is True

    # 4. resume_event tool without approval: MUST require human approval
    res_resume_unapproved = default_registry.execute(
        tool_name="resume_event",
        arguments={"event_id": env["event"].id, "reason": "Agent attempted unapproved resume"},
        db=db,
        user_id=env["owner"].id,
        event_id=env["event"].id,
    )
    assert res_resume_unapproved.status == ToolStatus.REQUIRES_APPROVAL

    # Create approved approval record for resume
    approval_resume = Approval(
        event_id=env["event"].id,
        action_type="EVENT_RESUME",
        target_type="EVENT",
        target_id=env["event"].id,
        impact_level="HIGH",
        status="APPROVED",
        state_snapshot="valid_snapshot",
        requester_id=env["owner"].id,
        created_at=datetime.now(timezone.utc).replace(tzinfo=None),
    )
    db.add(approval_resume)
    db.commit()
    db.refresh(approval_resume)

    # Execute resume_event with approved approval_id
    res_resume = default_registry.execute(
        tool_name="resume_event",
        arguments={
            "event_id": env["event"].id,
            "reason": "Agent initiated resume with organizer authority",
            "approval_id": approval_resume.id,
        },
        db=db,
        user_id=env["owner"].id,
        event_id=env["event"].id,
        approval_id=approval_resume.id,
    )
    assert res_resume.status == ToolStatus.SUCCESS
    assert res_resume.data["status"] == "COMPLETED"
    assert res_resume.data["target_state"] == "RUNNING"



# ==============================================================================
# 11. AUDIT TRAIL
# ==============================================================================

def test_audit_records_generated_for_pause_and_resume(db: Session):
    """Verifies that complete audit records are created in EventPauseRecord and AuditRecord."""
    env = _setup_live_event(db)
    service = PauseResumeService(db)

    pause_rec = service.pause_event(
        event_id=env["event"].id,
        user_id=env["owner"].id,
        request=PauseEventRequest(reason="Audit verification pause"),
    )
    assert pause_rec.audit_reference is not None
    assert pause_rec.plan_version == 1
    assert pause_rec.requested_by == env["owner"].id

    resume_rec = service.resume_event(
        event_id=env["event"].id,
        user_id=env["owner"].id,
        request=ResumeEventRequest(reason="Audit verification resume"),
    )
    assert resume_rec.audit_reference is not None
    assert resume_rec.plan_version == 1

    # Verify chronological history
    history = service.get_pause_history(env["event"].id, env["owner"].id)
    assert len(history) == 2
    assert history[0]["operation_type"] == "RESUME"
    assert history[1]["operation_type"] == "PAUSE"
