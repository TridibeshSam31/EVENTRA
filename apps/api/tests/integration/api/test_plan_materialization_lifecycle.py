"""Integration tests for B3: Event -> Plan Materialization Lifecycle."""
import pytest
from datetime import datetime, timezone, timedelta
from decimal import Decimal
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.db.base import Base
from app.models.event import Event
from app.models.user import User
from app.models.task import Task
from app.models.budget import BudgetItem
from app.models.enums import EventLifecycleState
from app.services.planning_service import PlanningService
from app.api.routes.schedule import compute_schedule
from app.core.exceptions import BadRequestException


@pytest.fixture
def db():
    engine = create_engine("sqlite:///:memory:", echo=False)
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    session = Session()
    yield session
    session.close()


@pytest.fixture
def event_data(db):
    user = User(id="user-planner", email="planner@eventra.com", name="Planner User")
    db.add(user)
    
    event = Event(
        id="evt-materialize-1",
        name="Annual Tech Conference 2026",
        event_type="CONFERENCE",
        owner_id=user.id,
        state="NORMAL",
        lifecycle_state=EventLifecycleState.DRAFT.value,
        guest_count=250,
        total_budget=Decimal("50000.00"),
        start_datetime=datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(days=30),
        end_datetime=datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(days=30, hours=5),
    )
    db.add(event)
    db.commit()
    return {"event": event, "user": user}


def test_unmaterialized_event_reports_truthful_pending_status(db, event_data):
    """A newly created event with no tasks must report is_materialized=False and PENDING_PLAN."""
    service = PlanningService(db)
    plan = service.get_plan(event_data["event"].id)
    
    assert plan.is_materialized is False
    assert plan.planning_status == "PENDING_PLAN"
    assert len(plan.tasks) == 0
    assert plan.summary.total_tasks == 0
    assert plan.summary.is_materialized is False
    assert plan.summary.planning_status == "PENDING_PLAN"


def test_schedule_compute_fails_gracefully_with_typed_error_before_materialization(db, event_data):
    """Calling schedule compute before plan materialization must raise a clear, typed exception."""
    with pytest.raises(BadRequestException) as exc:
        compute_schedule(event_id=event_data["event"].id, db=db)
    assert "PLAN_NOT_MATERIALIZED" in str(exc.value)


def test_full_specification_to_materialized_plan_pipeline(db, event_data):
    """Full lifecycle: Specification -> Generate Plan -> Materialized -> Schedule -> Budget."""
    event_id = event_data["event"].id
    from app.models.requirement import Requirement
    
    # 1. Provide Event Requirements
    r1 = Requirement(
        event_id=event_id,
        name="Catering Banquet",
        type="CATERING",
        required=True,
    )
    r2 = Requirement(
        event_id=event_id,
        name="Keynote AV & Lighting",
        type="AV",
        required=True,
    )
    db.add_all([r1, r2])
    db.commit()

    # 2. Materialize Plan
    planning_service = PlanningService(db)
    plan = planning_service.generate_plan(event_id)

    assert plan.is_materialized is True
    assert plan.planning_status == "MATERIALIZED"
    assert len(plan.tasks) > 0
    assert len(plan.dependencies) >= 0
    assert len(plan.budget_items) > 0

    # Lifecycle state must have transitioned to PLANNED
    db.refresh(event_data["event"])
    assert event_data["event"].lifecycle_state == EventLifecycleState.PLANNED.value

    # 3. Schedule can now compute deterministically
    sched_res = compute_schedule(event_id=event_id, db=db)
    assert sched_res is not None
    assert len(sched_res.entries) == len(plan.tasks)
    for t_sched in sched_res.entries:
        assert t_sched.planned_start is not None
        assert t_sched.planned_end is not None

    # 4. Budget items correctly reflect materialized plan
    budget_items = db.query(BudgetItem).filter(BudgetItem.event_id == event_id).all()
    assert len(budget_items) == len(plan.budget_items)
    total_budget = sum(float(b.estimated_amount) for b in budget_items)
    assert total_budget > 0
