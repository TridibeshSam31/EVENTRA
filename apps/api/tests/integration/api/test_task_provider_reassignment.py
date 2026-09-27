"""Integration tests for B4: Task -> Provider Reassignment."""
import pytest
from datetime import datetime, timezone
from decimal import Decimal
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.db.base import Base
from app.models.event import Event
from app.models.user import User
from app.models.task import Task
from app.models.vendor import Vendor
from app.models.vendor_assignment import VendorAssignment
from app.models.audit import AuditRecord
from app.models.approval import Approval
from app.models.enums import TaskStatus
from app.services.vendor_task_binding_service import VendorTaskBindingService
from app.core.exceptions import NotFoundException, BadRequestException, ForbiddenException


@pytest.fixture
def db():
    engine = create_engine("sqlite:///:memory:", echo=False)
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    session = Session()
    yield session
    session.close()


@pytest.fixture
def reassignment_fixture(db):
    user = User(id="user-reassign-owner", email="reassign_owner@eventra.com", name="Owner")
    stranger = User(id="user-reassign-stranger", email="stranger@eventra.com", name="Stranger")
    db.add_all([user, stranger])

    event = Event(
        id="evt-reassign-1",
        name="Annual Conclave",
        owner_id=user.id,
        state="NORMAL",
        lifecycle_state="LIVE",
    )
    db.add(event)
    db.flush()

    # Vendor 1: Catering
    v1 = Vendor(
        id="vnd-cat-1",
        name="Royal Feast Caterers",
        category="catering",
        city="Delhi",
    )
    # Vendor 2: Catering replacement
    v2 = Vendor(
        id="vnd-cat-2",
        name="Gourmet Delights",
        category="catering",
        city="Delhi",
    )
    # Vendor 3: Wrong category (AV)
    v3 = Vendor(
        id="vnd-av-3",
        name="Stage Lighting Pros",
        category="av",
        city="Delhi",
    )
    db.add_all([v1, v2, v3])
    db.flush()

    # Task requiring catering
    task = Task(
        id="tsk-buffet-setup",
        event_id=event.id,
        name="Lunch Buffet Station Prep",
        required_provider_category="catering",
        provider_id=v1.id,
        status=TaskStatus.ASSIGNED.value,
        duration_minutes=90,
    )
    db.add(task)

    va1 = VendorAssignment(
        event_id=event.id,
        vendor_id=v1.id,
        category="catering",
        status="CONFIRMED",
        agreed_cost=Decimal("15000.00"),
    )
    db.add(va1)
    db.commit()

    return {
        "event": event,
        "task": task,
        "v1": v1,
        "v2": v2,
        "v3": v3,
        "owner": user,
        "stranger": stranger,
    }


def test_valid_task_provider_reassignment(db, reassignment_fixture):
    """Reassigning to an eligible provider of the matching category succeeds atomically."""
    service = VendorTaskBindingService(db)
    res = service.reassign_task_provider(
        event_id=reassignment_fixture["event"].id,
        task_id=reassignment_fixture["task"].id,
        provider_id=reassignment_fixture["v2"].id,
        agreed_cost=18000.0,
        notes="Replacing caterer due to updated guest preferences",
        current_user_id=reassignment_fixture["owner"].id,
    )

    assert res["status"] == "REASSIGNED"
    assert res["previous_provider_id"] == reassignment_fixture["v1"].id
    assert res["new_provider_id"] == reassignment_fixture["v2"].id
    assert res["agreed_cost"] == 18000.0
    assert res["audit_id"] is not None

    # Check database state
    db.refresh(reassignment_fixture["task"])
    assert reassignment_fixture["task"].provider_id == reassignment_fixture["v2"].id
    assert reassignment_fixture["task"].status == TaskStatus.ASSIGNED.value

    # Verify audit trail was generated
    audit = db.query(AuditRecord).filter(AuditRecord.id == res["audit_id"]).first()
    assert audit is not None
    assert audit.action == "REASSIGN_PROVIDER"
    assert audit.before_state["provider_id"] == reassignment_fixture["v1"].id
    assert audit.after_state["provider_id"] == reassignment_fixture["v2"].id


def test_reassignment_idempotency(db, reassignment_fixture):
    """Repeated reassignment to the already assigned vendor is idempotent with no duplicate mutations."""
    service = VendorTaskBindingService(db)
    res = service.reassign_task_provider(
        event_id=reassignment_fixture["event"].id,
        task_id=reassignment_fixture["task"].id,
        provider_id=reassignment_fixture["v1"].id,
        current_user_id=reassignment_fixture["owner"].id,
    )

    assert res["status"] == "ALREADY_ASSIGNED"
    assert res["new_provider_id"] == reassignment_fixture["v1"].id
    assert res["audit_id"] is None


def test_reassignment_category_mismatch_rejected(db, reassignment_fixture):
    """Reassigning to a vendor of incompatible category (AV vendor to catering task) is rejected."""
    service = VendorTaskBindingService(db)
    with pytest.raises(BadRequestException) as exc:
        service.reassign_task_provider(
            event_id=reassignment_fixture["event"].id,
            task_id=reassignment_fixture["task"].id,
            provider_id=reassignment_fixture["v3"].id,
            current_user_id=reassignment_fixture["owner"].id,
        )
    assert "CATEGORY_MISMATCH" in str(exc.value)


def test_reassignment_invalid_provider_rejected(db, reassignment_fixture):
    """Reassigning to non-existent provider returns NotFoundException."""
    service = VendorTaskBindingService(db)
    with pytest.raises(NotFoundException) as exc:
        service.reassign_task_provider(
            event_id=reassignment_fixture["event"].id,
            task_id=reassignment_fixture["task"].id,
            provider_id="non-existent-vendor-id",
            current_user_id=reassignment_fixture["owner"].id,
        )
    assert "not found" in str(exc.value).lower()


def test_reassignment_unauthorized_user_rejected(db, reassignment_fixture):
    """Unauthorized non-member cannot execute task provider reassignment."""
    service = VendorTaskBindingService(db)
    with pytest.raises(ForbiddenException) as exc:
        service.reassign_task_provider(
            event_id=reassignment_fixture["event"].id,
            task_id=reassignment_fixture["task"].id,
            provider_id=reassignment_fixture["v2"].id,
            current_user_id=reassignment_fixture["stranger"].id,
        )
    assert "not a member" in str(exc.value) or "unauthorized" in str(exc.value).lower()


def test_reassignment_approval_gate_enforcement(db, reassignment_fixture):
    """If an approval gate is pending for this task, reassignment without override is blocked."""
    approval = Approval(
        id="appr-reassign-gate",
        event_id=reassignment_fixture["event"].id,
        requester_id=reassignment_fixture["owner"].id,
        action_type="REASSIGN_VENDOR",
        target_type="TASK",
        target_id=reassignment_fixture["task"].id,
        impact_level="HIGH",
        status="PENDING",
        state_snapshot="snap",
    )
    db.add(approval)
    db.commit()

    service = VendorTaskBindingService(db)
    with pytest.raises(ForbiddenException) as exc:
        service.reassign_task_provider(
            event_id=reassignment_fixture["event"].id,
            task_id=reassignment_fixture["task"].id,
            provider_id=reassignment_fixture["v2"].id,
            current_user_id=reassignment_fixture["owner"].id,
            force_override=False,
        )
    assert "REASSIGNMENT_APPROVAL_REQUIRED" in str(exc.value)
