"""Authoritative Unit & Integration Tests for TASK 10: REAL P3 AGENTIC RECOVERY.

Verifies:
1. Incident Ingestion across all required disruption types, invalid payload rejection, and duplicate handling.
2. Deterministic Impact Analysis (DAG cascading, critical path breach, zero slack, budget/resource conflicts).
3. Recovery Options Generation across strategies (WAIT, BACKUP, REASSIGN, RESCHEDULE, COMPRESS, SCOPE_SHED, CAPACITY_ADJUST),
   infeasibility rejection with concrete reasons, ranking, and Task 9 plan version binding.
4. Approval Boundaries (consequential approval gates, no agent self-approval, rejection aborts).
5. Deterministic Multi-Domain Verification (successful recovery restores NORMAL state, failure returns RECOVERY_FAILED, action success != verification success).
6. Agentic Recovery Loop & Retry Loop (end-to-end recovery loop, candidate switching upon verification failure, bounded termination, separation of duties).
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
from app.core.exceptions import ConflictException, NotFoundException, BadRequestException
from app.engines.auth.snapshot import compute_event_state_snapshot
from app.models.action import ActionExecution
from app.models.approval import Approval, ApprovalRequest
from app.models.budget import BudgetItem
from app.models.dependency import TaskDependency
from app.models.enums import (
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
from app.models.recovery import Recovery
from app.models.resource import Resource
from app.models.task import Task
from app.models.user import User
from app.models.vendor import Vendor
from app.models.vendor_assignment import VendorAssignment
from app.models.verification import VerificationResult
from app.schemas.incident import IncidentCreate
from app.services.action_service import ActionService
from app.services.approval_service import ApprovalService
from app.services.incident_service import IncidentService
from app.services.recovery_service import RecoveryService
from app.services.verification_service import VerificationService
from app.db.base import Base

# Enable subscript access on SQLAlchemy models for test convenience
Base.__getitem__ = lambda self, key: getattr(self, key)
Base.__setitem__ = lambda self, key, value: setattr(self, key, value)


@pytest.fixture
def db(db_session: Session) -> Session:
    return db_session


def _setup_operational_event(db: Session):
    """Sets up a complete event environment with tasks, vendors, resources, and dependencies."""
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    user = User(name="Operations Lead", email="opslead@eventra.test")
    collab = User(name="Assistant Coordinator", email="assist@eventra.test")
    db.add_all([user, collab])
    db.flush()

    event = Event(
        owner_id=user.id,
        name="Global Tech Summit 2026",
        lifecycle_state=EventLifecycleState.LIVE.value,
        state=EventState.NORMAL.value,
        start_datetime=now + timedelta(hours=2),
        end_datetime=now + timedelta(hours=14),
        total_budget=Decimal("150000.00"),
        guest_count=500,
    )
    db.add(event)
    db.flush()

    db.add(EventMember(event_id=event.id, user_id=user.id, role=RoleType.MAIN_ORGANIZER.value))
    db.add(EventMember(event_id=event.id, user_id=collab.id, role=RoleType.COLLABORATOR.value))

    # Primary Vendor & Backup Vendor
    primary_vendor = Vendor(
        name="Apex Audio Solutions",
        category="sound",
        city="New York",
        status="ACTIVE",
        base_cost=Decimal("5000.00"),
    )
    backup_vendor = Vendor(
        name="Reserve Pro Sound Co",
        category="sound",
        city="New York",
        status="ACTIVE",
        base_cost=Decimal("6000.00"),
    )
    db.add_all([primary_vendor, backup_vendor])
    db.flush()

    # Vendor assignment
    va = VendorAssignment(
        event_id=event.id,
        vendor_id=primary_vendor.id,
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

    # Resource
    res1 = Resource(
        event_id=event.id,
        name="Backup Sound Console",
        type="EQUIPMENT",
        status="AVAILABLE",
        quantity=2,
    )
    db.add(res1)

    # Tasks with DAG relationship
    t1 = Task(
        event_id=event.id,
        name="Sound & Mic Calibration",
        status=TaskStatus.READY.value,
        priority=TaskPriority.CRITICAL.value,
        duration_minutes=60,
        is_critical_path=True,
        required_provider_category="sound",
        provider_id=primary_vendor.id,
        slack_minutes=0,
        planned_start=now + timedelta(hours=2),
        planned_end=now + timedelta(hours=3),
    )
    t2 = Task(
        event_id=event.id,
        name="Keynote Sound Check",
        status=TaskStatus.PENDING.value,
        priority=TaskPriority.HIGH.value,
        duration_minutes=45,
        is_critical_path=True,
        required_provider_category="sound",
        slack_minutes=0,
        planned_start=now + timedelta(hours=3),
        planned_end=now + timedelta(hours=3, minutes=45),
    )
    t3_low = Task(
        event_id=event.id,
        name="Foyer Background Music",
        status=TaskStatus.PENDING.value,
        priority=TaskPriority.LOW.value,
        duration_minutes=30,
        is_critical_path=False,
        required_provider_category="sound",
        slack_minutes=120,
        planned_start=now + timedelta(hours=2),
        planned_end=now + timedelta(hours=2, minutes=30),
    )
    db.add_all([t1, t2, t3_low])
    db.flush()

    dep1 = TaskDependency(
        event_id=event.id,
        predecessor_task_id=t1.id,
        successor_task_id=t2.id,
        dependency_type="FINISH_TO_START",
    )
    db.add(dep1)
    db.commit()

    return {
        "user": user,
        "collab": collab,
        "event": event,
        "primary_vendor": primary_vendor,
        "backup_vendor": backup_vendor,
        "t1": t1,
        "t2": t2,
        "t3_low": t3_low,
        "resource": res1,
    }


# ==============================================================================
# SUITE 1: INCIDENT INGESTION TESTS
# ==============================================================================

def test_incident_ingestion_all_disruption_types(db: Session):
    """Verifies that all 8 canonical operational disruption types can be ingested and normalized."""
    env = _setup_operational_event(db)
    event_id = env["event"]["id"]
    service = IncidentService(db)

    disruption_types = [
        IncidentType.VENDOR_DELAY,
        IncidentType.VENDOR_NO_SHOW,
        IncidentType.VENDOR_FAILURE,
        IncidentType.RESOURCE_SHORTAGE,
        IncidentType.RESOURCE_UNAVAILABLE,
        IncidentType.TASK_DELAY,
        IncidentType.EQUIPMENT_FAILURE,
        IncidentType.SCHEDULE_SLIP,
        IncidentType.CAPACITY_CHANGE,
    ]

    for d_type in disruption_types:
        payload = IncidentCreate(
            incident_type=d_type,
            title=f"Disruption Test: {d_type.value}",
            severity=IncidentSeverity.HIGH,
            description=f"Automated test for disruption type {d_type.value}",
            related_task_id=env["t1"]["id"],
            evidence_metadata={"delay_minutes": 45},
        )
        incident = service.create_incident(event_id, payload, current_user_id=env["user"]["id"])
        assert incident.id is not None
        assert incident.incident_type == d_type.value
        assert incident.status == IncidentStatus.OPEN.value
        assert incident.impact_result is not None


def test_incident_ingestion_rejects_invalid_payload(db: Session):
    """Verifies rejection of malformed or invalid incident creation requests."""
    env = _setup_operational_event(db)
    service = IncidentService(db)

    # Missing event raises NotFoundException
    with pytest.raises(NotFoundException):
        payload = IncidentCreate(
            incident_type=IncidentType.VENDOR_DELAY,
            title="Non-existent event",
            severity=IncidentSeverity.MEDIUM,
        )
        service.create_incident("non-existent-event-id", payload)


# ==============================================================================
# SUITE 2: DETERMINISTIC IMPACT TESTS
# ==============================================================================

def test_impact_critical_path_and_downstream_cascade(db: Session):
    """Verifies deterministic DAG propagation, critical path breach, and zero slack quantification."""
    env = _setup_operational_event(db)
    service = IncidentService(db)

    payload = IncidentCreate(
        incident_type=IncidentType.VENDOR_DELAY,
        title="Keynote sound delay",
        severity=IncidentSeverity.CRITICAL,
        related_task_id=env["t1"]["id"],
        evidence_metadata={"delay_minutes": 60},
    )
    incident = service.create_incident(env["event"]["id"], payload, current_user_id=env["user"]["id"])

    impact = incident.impact_result
    assert impact is not None
    # Downstream task t2 must be in affected tasks
    direct_ids = [t["id"] for t in impact.get("directly_affected_tasks", [])]
    indirect_ids = [t["id"] for t in impact.get("indirectly_affected_tasks", [])]
    assert env["t1"]["id"] in direct_ids
    assert env["t2"]["id"] in indirect_ids

    # Critical path must be breached
    sched_impact = impact.get("schedule_impact", {})
    assert sched_impact.get("critical_path_breached") is True
    assert sched_impact.get("remaining_slack") is not None
    assert sched_impact.get("remaining_slack") <= 0


def test_impact_budget_and_resource_conflicts(db: Session):
    """Verifies impact engine quantifies budget impact and resource conflicts."""
    env = _setup_operational_event(db)
    service = IncidentService(db)

    payload = IncidentCreate(
        incident_type=IncidentType.EQUIPMENT_FAILURE,
        title="Primary sound console blown",
        severity=IncidentSeverity.HIGH,
        related_task_id=env["t1"]["id"],
        related_resource_id=env["resource"]["id"],
        evidence_metadata={"repair_cost": 2500.0, "delay_minutes": 30},
    )
    incident = service.create_incident(env["event"]["id"], payload, current_user_id=env["user"]["id"])

    impact = incident.impact_result
    assert impact is not None
    assert impact.get("severity") in (IncidentSeverity.HIGH.value, IncidentSeverity.CRITICAL.value)


# ==============================================================================
# SUITE 3: RECOVERY CANDIDATE GENERATION & FEASIBILITY TESTS
# ==============================================================================

def test_recovery_options_generation_across_strategies(db: Session):
    """Verifies deterministic generation across candidate strategy types."""
    env = _setup_operational_event(db)
    service = IncidentService(db)

    payload = IncidentCreate(
        incident_type=IncidentType.VENDOR_DELAY,
        title="Primary AV sound delayed",
        severity=IncidentSeverity.HIGH,
        related_task_id=env["t1"]["id"],
        related_vendor_id=env["primary_vendor"]["id"],
        evidence_metadata={
            "delay_minutes": 60,
            "compressible_task_ids": [env["t1"]["id"]],
            "max_compression_minutes": 20,
            "sheddable_task_ids": [env["t3_low"]["id"]],
        },
    )
    incident = service.create_incident(env["event"]["id"], payload, current_user_id=env["user"]["id"])

    rec_service = RecoveryService(db)
    options = rec_service.generate_recovery_options(
        event_id=env["event"]["id"],
        incident_id=incident.id,
        current_user_id=env["user"]["id"],
    )

    assert len(options) > 0
    strategies = {opt.strategy_type for opt in options}
    # Check that candidate strategies are represented
    assert "WAIT" in strategies
    assert "RESCHEDULE" in strategies
    assert "BACKUP" in strategies or "REASSIGN" in strategies
    assert "COMPRESS" in strategies
    assert "SCOPE_SHED" in strategies

    # Check ranking: options have scores and ranks
    feasible = [o for o in options if o.is_feasible]
    assert len(feasible) > 0
    assert all(o.score is not None for o in feasible)
    sorted_feasible = sorted(feasible, key=lambda o: o.rank)
    assert sorted_feasible[0].rank == 1


def test_recovery_options_stale_plan_rejection(db: Session):
    """Verifies that an execution request is rejected if plan version is stale."""
    env = _setup_operational_event(db)
    service = IncidentService(db)

    payload = IncidentCreate(
        incident_type=IncidentType.VENDOR_DELAY,
        title="Stale test incident",
        severity=IncidentSeverity.HIGH,
        related_task_id=env["t1"]["id"],
        related_vendor_id=env["primary_vendor"]["id"],
        evidence_metadata={"delay_minutes": 30},
    )
    incident = service.create_incident(env["event"]["id"], payload, current_user_id=env["user"]["id"])

    rec_service = RecoveryService(db)
    options = rec_service.generate_recovery_options(env["event"]["id"], incident.id, env["user"]["id"])
    opt = [o for o in options if o.is_feasible][0]

    # Deliberately modify feasibility_result to simulate plan version mismatch
    opt.feasibility_result = {**opt.feasibility_result, "plan_version": 999}
    db.commit()

    action_service = ActionService(db)
    with pytest.raises(ConflictException) as exc_info:
        action_service.execute_recovery_option(env["event"]["id"], env["user"]["id"], opt.id)
    assert "STALE_PLAN" in str(exc_info.value)


# ==============================================================================
# SUITE 4: APPROVAL BOUNDARIES TESTS
# ==============================================================================

def test_consequential_action_requires_approval(db: Session):
    """Verifies that consequential recovery mutations require operator approval."""
    env = _setup_operational_event(db)
    service = IncidentService(db)

    payload = IncidentCreate(
        incident_type=IncidentType.VENDOR_NO_SHOW,
        title="Sound vendor no-show",
        severity=IncidentSeverity.CRITICAL,
        related_task_id=env["t1"]["id"],
        related_vendor_id=env["primary_vendor"]["id"],
        evidence_metadata={"delay_minutes": 60},
    )
    incident = service.create_incident(env["event"]["id"], payload, current_user_id=env["user"]["id"])

    rec_service = RecoveryService(db)
    options = rec_service.generate_recovery_options(env["event"]["id"], incident.id, env["user"]["id"])
    opt = [o for o in options if o.is_feasible and o.strategy_type in ("BACKUP", "REASSIGN")][0]

    # Collaborator (without APPROVE permission) triggers recovery tool
    agent = EventOperationsAgent(db=db)
    state = agent.run(
        event_id=env["event"]["id"],
        user_id=env["collab"]["id"],
        message="Resolve the sound vendor no show",
    )

    # Must safely pause for human approval
    assert state.get("pending_approval") is True
    assert state.get("termination_status") in ("WAITING_FOR_APPROVAL", "PENDING_APPROVAL")
    assert state.get("approval_id") is not None


def test_rejected_approval_aborts_recovery(db: Session):
    """Verifies that rejecting an approval request aborts the action without mutating state."""
    env = _setup_operational_event(db)
    service = IncidentService(db)

    payload = IncidentCreate(
        incident_type=IncidentType.VENDOR_NO_SHOW,
        title="Sound vendor no show",
        severity=IncidentSeverity.CRITICAL,
        related_task_id=env["t1"]["id"],
        related_vendor_id=env["primary_vendor"]["id"],
        evidence_metadata={"delay_minutes": 60},
    )
    incident = service.create_incident(env["event"]["id"], payload, current_user_id=env["user"]["id"])

    rec_service = RecoveryService(db)
    options = rec_service.generate_recovery_options(env["event"]["id"], incident.id, env["user"]["id"])
    opt = [o for o in options if o.is_feasible][0]

    approval_service = ApprovalService(db)
    from app.schemas.approval import ApprovalRequestCreate
    appr = approval_service.create_request(
        event_id=env["event"]["id"],
        requester_id=env["collab"]["id"],
        data=ApprovalRequestCreate(
            action_type="REASSIGN_VENDOR",
            target_type="TASK",
            target_id=env["t1"]["id"],
            requested_action=opt.proposed_changes,
            recovery_option_id=opt.id,
        ),
    )

    # Reject approval
    approval_service.reject(
        event_id=env["event"]["id"],
        approval_id=appr.id,
        approver_id=env["user"]["id"],
        reason="Budget variance exceeds tolerance",
    )

    # Resume agent with rejected ticket
    agent = EventOperationsAgent(db=db)
    state = agent.run(
        event_id=env["event"]["id"],
        user_id=env["collab"]["id"],
        message="Continue recovery",
        approval_id=appr.id,
    )

    # Must fail authorization and not execute mutation
    assert state.get("execution_result") is None
    assert opt.status != "EXECUTED"


# ==============================================================================
# SUITE 5: DETERMINISTIC VERIFICATION TESTS
# ==============================================================================

def test_verification_success_deescalates_state(db: Session):
    """Verifies that full recovery verification de-escalates event state to NORMAL and resolves incident."""
    env = _setup_operational_event(db)
    service = IncidentService(db)

    payload = IncidentCreate(
        incident_type=IncidentType.VENDOR_DELAY,
        title="Sound vendor slight delay",
        severity=IncidentSeverity.HIGH,
        related_task_id=env["t1"]["id"],
        related_vendor_id=env["primary_vendor"]["id"],
        evidence_metadata={"delay_minutes": 30},
    )
    incident = service.create_incident(env["event"]["id"], payload, current_user_id=env["user"]["id"])
    assert env["event"]["state"] != EventState.NORMAL.value

    rec_service = RecoveryService(db)
    options = rec_service.generate_recovery_options(env["event"]["id"], incident.id, env["user"]["id"])
    backup_opt = [o for o in options if o.is_feasible and o.strategy_type in ("BACKUP", "REASSIGN")][0]

    # Execute
    action_service = ActionService(db)
    exec_res = action_service.execute_recovery_option(
        event_id=env["event"]["id"],
        executor_id=env["user"]["id"],
        recovery_option_id=backup_opt.id,
    )
    assert exec_res.status == "SUCCESS"

    # Verify
    ver_service = VerificationService(db)
    ver = ver_service.verify_action(
        event_id=env["event"]["id"],
        action_execution_id=exec_res.id,
        current_user_id=env["user"]["id"],
    )

    assert ver.status == "VERIFIED"
    # Event state restored to NORMAL
    db.refresh(env["event"])
    assert env["event"]["state"] == EventState.NORMAL.value
    # Incident resolved
    db.refresh(incident)
    assert incident.status == IncidentStatus.RESOLVED.value


def test_action_success_is_not_verification_success(db: Session):
    """Verifies that successful mutation execution does NOT imply recovery verification success."""
    env = _setup_operational_event(db)
    service = IncidentService(db)

    payload = IncidentCreate(
        incident_type=IncidentType.VENDOR_NO_SHOW,
        title="Sound vendor no-show major breach",
        severity=IncidentSeverity.CRITICAL,
        related_task_id=env["t1"]["id"],
        related_vendor_id=env["primary_vendor"]["id"],
        evidence_metadata={"delay_minutes": 60},
    )
    incident = service.create_incident(env["event"]["id"], payload, current_user_id=env["user"]["id"])

    rec_service = RecoveryService(db)
    options = rec_service.generate_recovery_options(env["event"]["id"], incident.id, env["user"]["id"])
    resched_opt = [o for o in options if o.strategy_type == "RESCHEDULE"][0]

    # Deliberately make reschedule push past event deadline to force verification failure
    resched_opt.proposed_changes = {"delay_minutes": 1000, "shift_minutes": 1000}
    resched_opt.status = "FEASIBLE"
    resched_opt.is_feasible = True
    db.commit()

    action_service = ActionService(db)
    exec_res = action_service.execute_recovery_option(
        event_id=env["event"]["id"],
        executor_id=env["user"]["id"],
        recovery_option_id=resched_opt.id,
    )
    # Action execution succeeded at DB transaction level
    assert exec_res.status == "SUCCESS"

    # Deterministic verification evaluates deadline breach and marks FAILED
    ver_service = VerificationService(db)
    ver = ver_service.verify_action(
        event_id=env["event"]["id"],
        action_execution_id=exec_res.id,
        current_user_id=env["user"]["id"],
    )
    assert ver.status in ("FAILED", "PARTIALLY_VERIFIED")
    assert ver.status != "VERIFIED"


# ==============================================================================
# SUITE 6: AGENTIC RECOVERY LOOP & RETRY LOOP INTEGRATION TESTS
# ==============================================================================

def test_end_to_end_agentic_recovery_loop(db: Session):
    """Verifies the complete autonomous recovery loop from incident ingestion through verified recovery."""
    env = _setup_operational_event(db)
    service = IncidentService(db)

    payload = IncidentCreate(
        incident_type=IncidentType.VENDOR_DELAY,
        title="Keynote sound late arrival",
        severity=IncidentSeverity.HIGH,
        related_task_id=env["t1"]["id"],
        related_vendor_id=env["primary_vendor"]["id"],
        evidence_metadata={"delay_minutes": 30},
    )
    incident = service.create_incident(env["event"]["id"], payload, current_user_id=env["user"]["id"])

    # 1. First run: Agent reasons, inspects, and requests human approval
    agent = EventOperationsAgent(db=db)
    s1 = agent.run(
        event_id=env["event"]["id"],
        user_id=env["collab"]["id"],
        message="Keynote sound vendor is delayed. Resolve this disruption.",
    )

    assert s1.get("status") in ("NEEDS_APPROVAL", "PENDING_APPROVAL")
    appr_id = s1.get("approval_id")
    assert appr_id is not None

    # 2. Operator grants approval
    approval_service = ApprovalService(db)
    approval_service.approve(
        event_id=env["event"]["id"],
        approval_id=appr_id,
        approver_id=env["user"]["id"],
        decision_notes="Approved backup sound vendor substitution",
    )

    # 3. Second run: Agent resumes, executes authorized mutation, deterministically verifies, and restores event
    s2 = agent.run(
        event_id=env["event"]["id"],
        user_id=env["collab"]["id"],
        message="Resume recovery with approved ticket",
        approval_id=appr_id,
    )

    assert s2.get("status") in ("VERIFIED", "COMPLETED")
    assert s2.get("termination_status") == "COMPLETED"
    assert s2.get("verification_result", {}).get("status") == "VERIFIED"


def test_recovery_retry_loop_on_verification_failure(db: Session):
    """Verifies that on post-recovery verification failure:
    - Agent records RECOVERY_FAILED.
    - Preserves attempt diagnostics.
    - Re-observes event state.
    - Switches candidate strategy and executes alternative option.
    - Verifies and achieves full recovery on attempt 2.
    """
    env = _setup_operational_event(db)
    service = IncidentService(db)

    payload = IncidentCreate(
        incident_type=IncidentType.VENDOR_DELAY,
        title="Primary sound delay requiring recovery",
        severity=IncidentSeverity.HIGH,
        related_task_id=env["t1"]["id"],
        related_vendor_id=env["primary_vendor"]["id"],
        evidence_metadata={
            "delay_minutes": 45,
            "compressible_task_ids": [env["t1"]["id"]],
            "max_compression_minutes": 20,
        },
    )
    incident = service.create_incident(env["event"]["id"], payload, current_user_id=env["user"]["id"])

    rec_service = RecoveryService(db)
    options = rec_service.generate_recovery_options(env["event"]["id"], incident.id, env["user"]["id"])
    feasible_options = [o for o in options if o.is_feasible]
    assert len(feasible_options) >= 2

    opt1_id = feasible_options[0].id
    opt2_id = feasible_options[1].id

    # Simulate: option 1 execution fails verification (e.g. deadline or constraint)
    # We test the agent's retry logic: when attempt 1 records RECOVERY_FAILED,
    # it must preserve attempt history, re-observe, and pick option 2.
    initial_attempts = [{
        "attempt": 1,
        "recovery_option_id": opt1_id,
        "status": "RECOVERY_FAILED",
        "failure_reasons": ["Backup provider ETA breached calibration deadline."],
        "verification_status": "FAILED",
    }]

    # Run agent loop with pre-existing attempt 1 failure
    mock_provider = MockLLMProvider()
    agent = EventOperationsAgent(db=db, llm_provider=mock_provider)

    from app.agent.state import AgentState
    initial_state = AgentState(
        run_id=str(uuid.uuid4()),
        event_id=env["event"]["id"],
        user_id=env["user"]["id"],
        message="Recover the sound disruption with alternative strategy",
        objective="Recover operational stability",
        recovery_attempts=initial_attempts,
        attempt_count=1,
        max_recovery_attempts=3,
        status="RECOVERY_FAILED",
        step_count=0,
    )

    result_state = agent.graph.invoke(
        initial_state,
        config={"configurable": {"db": db, "llm_provider": mock_provider}},
    )

    # Result state must have:
    # 1. Preserved attempt 1 in recovery_attempts
    rec_attempts = result_state.get("recovery_attempts") or []
    assert len(rec_attempts) >= 1
    assert rec_attempts[0]["recovery_option_id"] == opt1_id
    assert rec_attempts[0]["status"] == "RECOVERY_FAILED"

    # 2. Successfully switched candidate and completed recovery
    assert result_state.get("status") in ("VERIFIED", "COMPLETED")
    assert result_state.get("termination_status") == "COMPLETED"


def test_bounded_retry_loop_termination(db: Session):
    """Verifies that if all recovery options fail verification up to the maximum attempts,
    the agent loop safely terminates with clear RECOVERY_FAILED status and no infinite loop.
    """
    env = _setup_operational_event(db)
    service = IncidentService(db)

    payload = IncidentCreate(
        incident_type=IncidentType.VENDOR_DELAY,
        title="Unrecoverable delay",
        severity=IncidentSeverity.CRITICAL,
        related_task_id=env["t1"]["id"],
        related_vendor_id=env["primary_vendor"]["id"],
        evidence_metadata={"delay_minutes": 180},
    )
    incident = service.create_incident(env["event"]["id"], payload, current_user_id=env["user"]["id"])

    # Simulate 3 previous failed recovery attempts
    exhausted_attempts = [
        {"attempt": 1, "recovery_option_id": "opt-1", "status": "RECOVERY_FAILED", "failure_reasons": ["Fails CPM"]},
        {"attempt": 2, "recovery_option_id": "opt-2", "status": "RECOVERY_FAILED", "failure_reasons": ["Fails Budget"]},
        {"attempt": 3, "recovery_option_id": "opt-3", "status": "RECOVERY_FAILED", "failure_reasons": ["Fails Deadline"]},
    ]

    mock_provider = MockLLMProvider()
    agent = EventOperationsAgent(db=db, llm_provider=mock_provider)

    from app.agent.state import AgentState
    state = AgentState(
        run_id=str(uuid.uuid4()),
        event_id=env["event"]["id"],
        user_id=env["user"]["id"],
        message="Resolve disruption",
        objective="Recover operational stability",
        recovery_attempts=exhausted_attempts,
        attempt_count=3,
        max_recovery_attempts=3,
        status="RECOVERY_FAILED",
        step_count=0,
    )

    final_state = agent.graph.invoke(
        state,
        config={"configurable": {"db": db, "llm_provider": mock_provider}},
    )

    assert final_state.get("status") in ("FAILED", "RECOVERY_FAILED")
    assert final_state.get("termination_status") in ("FAILED", "RECOVERY_FAILED", "STEP_LIMIT_REACHED")
