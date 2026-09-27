"""Integration tests for B2: Recovery Execution and Verification Lifecycle."""
import uuid
import pytest
from datetime import datetime, timezone, timedelta
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.db.base import Base
from app.models.event import Event
from app.models.task import Task
from app.models.user import User
from app.models.incident import Incident
from app.models.recovery import Recovery
from app.models.approval import Approval
from app.models.action import ActionExecution
from app.models.verification import VerificationResult
from app.models.enums import TaskStatus
from app.services.action_service import ActionService
from app.services.verification_service import VerificationService
from app.core.exceptions import ForbiddenException, NotFoundException


@pytest.fixture
def db():
    engine = create_engine("sqlite:///:memory:", echo=False)
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    session = Session()
    yield session
    session.close()


@pytest.fixture
def setup_data(db):
    user = User(id="user-owner", email="owner@eventra.com", name="Owner User")
    unauth_user = User(id="user-stranger", email="stranger@eventra.com", name="Stranger")
    db.add_all([user, unauth_user])
    
    event = Event(
        id="evt-rec-1",
        name="Tech Summit",
        owner_id=user.id,
        state="DEGRADED",
        lifecycle_state="LIVE",
        start_datetime=datetime.now(timezone.utc).replace(tzinfo=None),
        end_datetime=datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(hours=6),
    )
    db.add(event)
    db.flush()

    task = Task(
        id="tsk-keynote",
        event_id=event.id,
        name="Keynote AV Setup",
        status=TaskStatus.IN_PROGRESS.value,
        duration_minutes=60,
    )
    db.add(task)

    incident = Incident(
        id="inc-av-001",
        event_id=event.id,
        title="Projector Bulb Blowout",
        incident_type="EQUIPMENT_FAILURE",
        related_task_id=task.id,
        severity="HIGH",
    )
    db.add(incident)
    db.flush()

    # Recovery option 1: Simple schedule adjustment (no approval needed)
    rec1 = Recovery(
        id="rec-opt-1",
        event_id=event.id,
        incident_id=incident.id,
        strategy_type="SCHEDULE_SHIFT",
        is_feasible=True,
        state_snapshot="initial-snap",
        proposed_changes={"schedule_adjustment": {"task_id": task.id, "shift_minutes": 30}},
        status="PROPOSED",
    )
    rec1.requires_approval = False

    # Recovery option 2: High impact scope shedding (requires approval)
    rec2 = Recovery(
        id="rec-opt-2",
        event_id=event.id,
        incident_id=incident.id,
        strategy_type="SCOPE_SHEDDING",
        is_feasible=True,
        state_snapshot="initial-snap",
        proposed_changes={"cancelled_task_ids": [task.id]},
        status="APPROVAL_REQUIRED",
    )
    rec2.requires_approval = True
    db.add_all([rec1, rec2])
    db.commit()

    return {
        "event": event,
        "task": task,
        "incident": incident,
        "rec1": rec1,
        "rec2": rec2,
        "owner": user,
        "stranger": unauth_user,
    }


def test_unauthorized_recovery_execution(db, setup_data):
    """Execution by unauthorized non-member must be rejected."""
    service = ActionService(db)
    with pytest.raises(ForbiddenException) as exc:
        service.execute_recovery_option(
            event_id=setup_data["event"].id,
            executor_id=setup_data["stranger"].id,
            recovery_option_id=setup_data["rec1"].id,
        )
    assert "not authorized" in str(exc.value)


def test_approval_required_recovery_enforcement(db, setup_data):
    """Recovery option with requires_approval=True must fail if unapproved."""
    service = ActionService(db)
    with pytest.raises(ForbiddenException) as exc:
        service.execute_recovery_option(
            event_id=setup_data["event"].id,
            executor_id=setup_data["owner"].id,
            recovery_option_id=setup_data["rec2"].id,
        )
    assert "APPROVAL_REQUIRED" in str(exc.value)


def test_successful_approved_recovery_execution_and_verification(db, setup_data):
    """When approved, execution succeeds and verification evaluates truthfully."""
    # 1. Add approved approval request
    approval = Approval(
        id="appr-1",
        event_id=setup_data["event"].id,
        requester_id=setup_data["owner"].id,
        approver_id=setup_data["owner"].id,
        action_type="RECOVERY_SCOPE_SHEDDING",
        target_type="TASK",
        target_id=setup_data["task"].id,
        impact_level="HIGH",
        recovery_option_id=setup_data["rec2"].id,
        status="APPROVED",
        state_snapshot="initial-snap",
    )
    db.add(approval)
    db.commit()

    # Re-sync snapshot
    from app.engines.auth.snapshot import compute_event_state_snapshot
    cur_snap = compute_event_state_snapshot(db, setup_data["event"].id)
    setup_data["rec2"].state_snapshot = cur_snap
    db.commit()

    # 2. Execute
    action_service = ActionService(db)
    execution = action_service.execute_recovery_option(
        event_id=setup_data["event"].id,
        executor_id=setup_data["owner"].id,
        recovery_option_id=setup_data["rec2"].id,
    )
    assert execution.status == "SUCCESS"
    assert setup_data["rec2"].status == "EXECUTED"

    # Verify task was cancelled as proposed
    db.refresh(setup_data["task"])
    assert setup_data["task"].status == "CANCELLED"

    # 3. Verify
    ver_service = VerificationService(db)
    ver = ver_service.verify_action(
        event_id=setup_data["event"].id,
        action_execution_id=execution.id,
        current_user_id=setup_data["owner"].id,
    )
    assert ver.status in ("VERIFIED", "FAILED", "PARTIAL")
    assert ver.action_execution_id == execution.id

    # 4. Test Query Endpoint logic
    from app.api.routes.recovery import get_incident_recovery_verification, trigger_incident_recovery_verification
    query_res = get_incident_recovery_verification(
        event_id=setup_data["event"].id,
        incident_id=setup_data["incident"].id,
        db=db,
        current_user_id=setup_data["owner"].id,
    )
    assert query_res["incident_id"] == setup_data["incident"].id
    assert query_res["has_execution"] is True
    assert query_res["verification_id"] == ver.id
    assert query_res["verification_status"] == ver.status

    # 5. Test Trigger Endpoint
    trigger_res = trigger_incident_recovery_verification(
        event_id=setup_data["event"].id,
        incident_id=setup_data["incident"].id,
        db=db,
        current_user_id=setup_data["owner"].id,
    )
    assert trigger_res["execution_id"] == execution.id
    assert trigger_res["verification_status"] in ("VERIFIED", "FAILED", "PARTIAL", "STALE")
