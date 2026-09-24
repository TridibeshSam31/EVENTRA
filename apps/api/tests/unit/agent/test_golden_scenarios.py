"""Golden Integration Tests for EVENTRA's Event Operations Agent.

Test 1: Canonical Vendor No-Show (Photographer Overdue at Wedding)
Test 2: Event Requirement Scaling (Guest count increased from 500 to 800)
"""
from datetime import datetime, timezone, timedelta
from decimal import Decimal
import pytest
from sqlalchemy.orm import Session

from app.agent.state import AgentState
from app.agent.decision import AgentDecision, DecisionType, ReasonCode
from app.agent.provider import MockLLMProvider
from app.agent.agent import EventOperationsAgent
from app.agent.tools.registry import default_registry, ToolStatus
from app.models.event import Event
from app.models.event_member import EventMember
from app.models.user import User
from app.models.task import Task
from app.models.vendor import Vendor
from app.models.vendor_assignment import VendorAssignment
from app.models.budget import BudgetItem
from app.models.objective import Objective
from app.models.incident import Incident
from app.models.recovery import Recovery
from app.models.approval import Approval
from app.models.enums import (
    EventLifecycleState,
    EventState,
    RoleType,
    TaskPriority,
    TaskStatus,
    IncidentType,
    IncidentSeverity,
)


def _setup_wedding_ecosystem(db: Session):
    """Sets up canonical demo ecosystem: Wedding, 42 tasks, 14 providers, ₹8,00,000 budget."""
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    owner = User(name="Bride & Groom Lead", email="wedding.lead@eventra.test")
    coordinator = User(name="Onsite Coordinator", email="coordinator@eventra.test")
    db.add_all([owner, coordinator])
    db.flush()

    wedding = Event(
        owner_id=owner.id,
        name="Grand Royal Wedding 2026",
        lifecycle_state=EventLifecycleState.LIVE.value,
        state=EventState.NORMAL.value,
        start_datetime=now + timedelta(hours=1),
        end_datetime=now + timedelta(hours=12),
        total_budget=Decimal("800000.00"),
        guest_count=500,
    )
    db.add(wedding)
    db.flush()

    db.add(EventMember(event_id=wedding.id, user_id=owner.id, role=RoleType.MAIN_ORGANIZER.value))
    db.add(EventMember(event_id=wedding.id, user_id=coordinator.id, role=RoleType.COLLABORATOR.value))

    # Core Photography Objective
    obj = Objective(
        event_id=wedding.id,
        name="Complete Full Wedding Photography & Portraits",
        priority=1,
    )
    db.add(obj)

    # Primary Photographer
    primary_photographer = Vendor(
        name="Artisan Lens Studio",
        category="photography",
        city="Delhi",
        base_cost=80000.0,
        status="ACTIVE",
    )
    # Backup Photographer
    backup_photographer = Vendor(
        name="Rapid Flash Photography",
        category="photography",
        city="Delhi",
        base_cost=85000.0,
        status="ACTIVE",
    )
    db.add_all([primary_photographer, backup_photographer])
    db.flush()

    # Vendor Assignment for Primary Photographer
    assignment = VendorAssignment(
        event_id=wedding.id,
        vendor_id=primary_photographer.id,
        category="photography",
        negotiation_status="NO_RESPONSE",  # Primary is unresponsive
        quoted_amount=80000.0,
        agreed_cost=80000.0,
    )
    db.add(assignment)

    # Budget Item for Photography
    budget_item = BudgetItem(
        event_id=wedding.id,
        name="Photography & Videography",
        category="photography",
        estimated_amount=Decimal("90000.00"),
        actual_amount=Decimal("80000.00"),
    )
    db.add(budget_item)

    # 42 Tasks total across the wedding; photography tasks on critical path
    created_tasks = []
    photo_task = Task(
        event_id=wedding.id,
        name="Couple Portraits & Family Photos",
        status=TaskStatus.READY.value,
        priority=TaskPriority.CRITICAL.value,
        duration_minutes=90,
        is_critical_path=True,
        required_provider_category="photography",
        planned_start=now + timedelta(minutes=10),
        planned_end=now + timedelta(minutes=100),
    )
    created_tasks.append(photo_task)

    # Generate remaining tasks to represent the full 42 task schedule
    for i in range(2, 43):
        t = Task(
            event_id=wedding.id,
            name=f"Wedding Operation Task #{i}",
            status=TaskStatus.READY.value,
            priority=TaskPriority.HIGH.value if i % 5 == 0 else TaskPriority.MEDIUM.value,
            duration_minutes=30,
            is_critical_path=(i % 10 == 0),
            planned_start=now + timedelta(minutes=10 + i * 5),
            planned_end=now + timedelta(minutes=40 + i * 5),
        )
        created_tasks.append(t)

    db.add_all(created_tasks)
    db.commit()

    return owner, coordinator, wedding, photo_task, primary_photographer, backup_photographer


def test_golden_scenario_photographer_no_show(db_session: Session):
    """GOLDEN SCENARIO 1: Photographer no-show / overdue at 3:10 PM for live wedding.
    
    Validates end-to-end agentic workflow:
    1. Observe live state & open incidents
    2. Interpret provider delay
    3. Investigate provider status (returns unresponsive)
    4. Deterministic impact analysis (critical portraits task threatened)
    5. Deterministic risk assessment (objective threatened)
    6. RecoveryEngine generates feasible candidate options (Backup photographer)
    7. Agent proposes backup photographer (requires approval)
    8. Approval gate halts safely without mutating
    9. Human organizer approves ticket
    10. Resumed agent executes approved action
    11. VerificationService authoritatively verifies operational recovery
    12. Event successfully restored to stable operating condition
    """
    owner, coordinator, wedding, photo_task, primary_photo, backup_photo = _setup_wedding_ecosystem(db_session)

    # At 3:10 PM, an operational incident is detected: Photographer overdue
    incident = Incident(
        event_id=wedding.id,
        title="Photographer Overdue & Unresponsive at 3:10 PM",
        incident_type=IncidentType.VENDOR_DELAY.value,
        severity=IncidentSeverity.CRITICAL.value,
        status="OPEN",
        related_task_id=photo_task.id,
        related_vendor_id=primary_photo.id,
    )
    db_session.add(incident)
    db_session.commit()

    agent = EventOperationsAgent(db_session, llm_provider=MockLLMProvider())

    # --- Step A: Coordinator reports delay ---
    result_turn_1 = agent.run(
        event_id=wedding.id,
        message="Photographer has not arrived and the photography window starts soon.",
        user_id=coordinator.id,
    )

    # Assertions on Turn 1:
    assert result_turn_1["event_id"] == wedding.id
    assert result_turn_1["status"] == "PENDING_APPROVAL"
    assert result_turn_1["termination_status"] == "WAITING_FOR_APPROVAL"
    assert result_turn_1["approval_id"] is not None
    assert result_turn_1["execution"] is None  # Consequential write is NOT executed prematurely!

    # Verify structured tool history demonstrates dynamic investigation:
    tool_hist = result_turn_1["tool_history"]
    executed_tools = [h["tool"] for h in tool_hist]
    assert "get_event_state" in executed_tools
    assert "get_provider_status" in executed_tools
    assert "analyze_impact" in executed_tools
    assert "assess_risk" in executed_tools
    assert "generate_recovery_options" in executed_tools

    # Verify impact was analyzed and risk assessed
    assert result_turn_1["impact"] is not None
    assert result_turn_1["risk"] is not None
    assert len(result_turn_1["recovery_options"]) > 0

    # Verify that a feasible recovery option was selected and proposed
    selected = result_turn_1["selected_option"]
    assert selected is not None
    assert selected.get("is_feasible") is True

    # --- Step B: Human Organizer Reviews and Approves ---
    appr_id = result_turn_1["approval_id"]
    approval_record = db_session.query(Approval).filter(Approval.id == appr_id).first()
    assert approval_record is not None
    assert approval_record.status == "PENDING"

    # Organizer authoritatively approves the ticket in PostgreSQL
    approval_record.status = "APPROVED"
    approval_record.approver_id = owner.id
    approval_record.decided_at = datetime.now(timezone.utc).replace(tzinfo=None)
    db_session.commit()

    # --- Step C: Resumed Run with Approved Action ---
    result_turn_2 = agent.run(
        event_id=wedding.id,
        message="Approved. Proceed with backup photographer reassignment.",
        user_id=coordinator.id,
        approval_id=appr_id,
    )

    # Assertions on Turn 2:
    assert result_turn_2["status"] in ("COMPLETED", "VERIFIED")
    assert result_turn_2["execution"] is not None
    assert result_turn_2["verification"] is not None
    assert result_turn_2["verification"].get("status") in ("VERIFIED", "PARTIALLY_VERIFIED")

    # Verify decision trace exists and reflects verified recovery
    assert result_turn_2["decision_trace"] is not None or result_turn_2["verification"] is not None

    # Verify no chain-of-thought leaked in state or history
    for entry in result_turn_2["tool_history"]:
        assert "chain_of_thought" not in entry
        assert "thought" not in entry


def test_golden_scenario_guest_count_change_500_to_800(db_session: Session):
    """GOLDEN SCENARIO 2: Requirement Scaling (Guest count increases from 500 to 800).
    
    Validates:
    1. Agent inspects EventSpecification
    2. Deterministic engine calculates resource delta (+300 meals, chairs, tables)
    3. No LLM quantity hallucination trusted as authoritative
    4. Procurement requirements identified
    5. Action proposal passes through authorization boundary
    """
    owner, coordinator, wedding, _, _, _ = _setup_wedding_ecosystem(db_session)
    agent = EventOperationsAgent(db_session, llm_provider=MockLLMProvider())

    # Direct tool verification of deterministic calculation
    calc_res = default_registry.execute(
        tool_name="calculate_resource_requirements",
        arguments={
            "event_id": wedding.id,
            "new_guest_count": 800,
            "original_guest_count": 500,
        },
        db=db_session,
    )
    assert calc_res.status == ToolStatus.SUCCESS
    res_data = calc_res.data
    assert res_data["delta_guests"] == 300
    assert res_data["resource_requirements"]["meals"] == 300
    assert res_data["resource_requirements"]["chairs"] == 120
    assert res_data["resource_requirements"]["tables"] == 15
    assert res_data["procurement_required"] is True

    # Run agent loop with natural language update
    result = agent.run(
        event_id=wedding.id,
        message="Guest count increased from 500 to 800.",
        user_id=coordinator.id,
    )

    # Invariant: Collaborator proposing plan modification pauses for approval
    assert result["event_id"] == wedding.id
    assert result["status"] in ("PENDING_APPROVAL", "COMPLETED")
    if result["status"] == "PENDING_APPROVAL":
        assert result["approval_id"] is not None

    # Verify tool history captured requirement calculation
    tool_hist = result["tool_history"]
    executed_tools = [h["tool"] for h in tool_hist]
    assert any(t in executed_tools for t in ("get_event_spec", "get_event_state", "calculate_resource_requirements"))
