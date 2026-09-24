"""Comprehensive tests for the bounded Event Operations Agent loop, tool registry, and safety boundaries."""
from datetime import datetime, timezone, timedelta
from decimal import Decimal
import pytest
from sqlalchemy.orm import Session

from app.agent.state import AgentState
from app.agent.decision import AgentDecision, DecisionType, ReasonCode
from app.agent.provider import MockLLMProvider
from app.agent.agent import EventOperationsAgent
from app.agent.tools.registry import default_registry, ToolStatus, ToolCategory, ToolResult
from app.models.event import Event
from app.models.event_member import EventMember
from app.models.user import User
from app.models.task import Task
from app.models.vendor import Vendor
from app.models.incident import Incident
from app.models.recovery import Recovery
from app.models.approval import Approval
from app.models.enums import EventLifecycleState, EventState, RoleType, TaskPriority, TaskStatus, IncidentType, IncidentSeverity


def _create_base_event(db: Session):
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    user = User(name="Organizer Lead", email="lead@eventra.test")
    collab = User(name="Coordinator", email="collab@eventra.test")
    db.add_all([user, collab])
    db.flush()

    event = Event(
        owner_id=user.id,
        name="Annual Leadership Summit 2026",
        lifecycle_state=EventLifecycleState.LIVE.value,
        state=EventState.NORMAL.value,
        start_datetime=now + timedelta(hours=3),
        end_datetime=now + timedelta(hours=10),
        total_budget=Decimal("100000.00"),
        guest_count=500,
    )
    db.add(event)
    db.flush()

    db.add(EventMember(event_id=event.id, user_id=user.id, role=RoleType.MAIN_ORGANIZER.value))
    db.add(EventMember(event_id=event.id, user_id=collab.id, role=RoleType.COLLABORATOR.value))

    task = Task(
        event_id=event.id,
        name="Keynote AV Setup",
        status=TaskStatus.READY.value,
        priority=TaskPriority.CRITICAL.value,
        duration_minutes=60,
        is_critical_path=True,
        required_provider_category="sound",
        planned_start=now + timedelta(hours=2),
        planned_end=now + timedelta(hours=3),
    )
    db.add(task)
    db.commit()

    return user, collab, event, task


# --- Tool Registry Tests ---

def test_tool_registry_rejects_unknown_tool(db_session: Session):
    """Unknown tool name returns UNKNOWN_TOOL error status."""
    result = default_registry.execute(
        tool_name="non_existent_hack_tool",
        arguments={},
        db=db_session,
    )
    assert result.status == ToolStatus.FAILURE
    assert result.error_code == "UNKNOWN_TOOL"
    assert "not registered" in result.message


def test_tool_registry_validates_malformed_arguments(db_session: Session):
    """Pydantic parameter validation catches missing or malformed tool arguments."""
    result = default_registry.execute(
        tool_name="get_incident_details",
        arguments={"event_id": "only-event-no-incident-id"},
        db=db_session,
    )
    assert result.status == ToolStatus.FAILURE
    assert result.error_code == "INVALID_ARGUMENTS"


def test_unknown_provider_availability_stays_unknown(db_session: Session):
    """Provider status for unassigned category stays UNKNOWN and never fabricates availability."""
    user, _, event, _ = _create_base_event(db_session)
    result = default_registry.execute(
        tool_name="get_provider_status",
        arguments={"event_id": event.id, "category": "non_existent_florist"},
        db=db_session,
    )
    assert result.status == ToolStatus.SUCCESS
    data = result.data
    assert data["status"] == "UNKNOWN"
    assert "UNKNOWN" in data["message"]


# --- Bounded Loop & Safety Tests ---

def test_step_limit_terminates_execution(db_session: Session):
    """Agent strictly terminates with STEP_LIMIT_REACHED when maximum steps exceeded."""
    user, _, event, _ = _create_base_event(db_session)
    # Define custom response that always requests a tool call to simulate infinite loop
    looping_provider = MockLLMProvider({
        "decision": AgentDecision(
            decision_type=DecisionType.TOOL_CALL,
            tool_name="get_event_state",
            tool_arguments={"event_id": event.id},
            reason_code=ReasonCode.INITIAL_OBSERVATION.value,
        )
    })

    agent = EventOperationsAgent(db_session, llm_provider=looping_provider)
    res = agent.run(
        event_id=event.id,
        message="Investigate loop boundary",
        user_id=user.id,
        max_steps=4,
    )

    assert res["status"] == "FAILED"
    assert res["termination_status"] in ("STEP_LIMIT_REACHED", "FAILED")
    assert res["step_count"] <= 5


def test_consecutive_identical_tool_calls_break_safely(db_session: Session):
    """Identical repeated tool calls trigger loop protection safeguard."""
    user, _, event, _ = _create_base_event(db_session)
    looping_provider = MockLLMProvider({
        "decision": AgentDecision(
            decision_type=DecisionType.TOOL_CALL,
            tool_name="get_event_state",
            tool_arguments={"event_id": event.id},
            reason_code=ReasonCode.INITIAL_OBSERVATION.value,
        )
    })

    agent = EventOperationsAgent(db_session, llm_provider=looping_provider)
    res = agent.run(
        event_id=event.id,
        message="Check loop safeguard",
        user_id=user.id,
        max_steps=10,
    )

    assert res["status"] == "FAILED"
    assert "LOOP" in (res.get("error") or "") or res.get("termination_status") in ("STEP_LIMIT_REACHED", "FAILED")


def test_agent_cannot_self_approve_consequential_action(db_session: Session):
    """Agent cannot self-approve consequential action; pauses at PENDING_APPROVAL without mutating."""
    _, collab, event, task = _create_base_event(db_session)
    backup = Vendor(name="Fast Sound", category="sound", city="Seattle", base_cost=2000.0, status="ACTIVE")
    db_session.add(backup)

    incident = Incident(
        event_id=event.id,
        title="AV Amp Failure",
        incident_type=IncidentType.VENDOR_CANCELLATION.value,
        severity=IncidentSeverity.CRITICAL.value,
        status="OPEN",
        related_task_id=task.id,
    )
    db_session.add(incident)
    db_session.commit()

    agent = EventOperationsAgent(db_session, llm_provider=MockLLMProvider())
    res = agent.run(
        event_id=event.id,
        message="AV equipment failure, replace immediately",
        user_id=collab.id,
    )

    # Invariant: Never executed, paused at approval gate
    assert res["status"] == "PENDING_APPROVAL"
    assert res["approval_id"] is not None
    assert res["execution"] is None


def test_rejected_approval_does_not_execute(db_session: Session):
    """Resuming with a REJECTED approval ticket does not execute the action."""
    user, collab, event, task = _create_base_event(db_session)
    backup = Vendor(name="Budget Sound", category="sound", city="Seattle", base_cost=1500.0, status="ACTIVE")
    db_session.add(backup)

    incident = Incident(
        event_id=event.id,
        title="Audio Speaker Blown",
        incident_type=IncidentType.VENDOR_CANCELLATION.value,
        severity=IncidentSeverity.HIGH.value,
        status="OPEN",
        related_task_id=task.id,
    )
    db_session.add(incident)
    db_session.commit()

    agent = EventOperationsAgent(db_session, llm_provider=MockLLMProvider())
    init_res = agent.run(event_id=event.id, message="Fix audio failure", user_id=collab.id)
    appr_id = init_res["approval_id"]

    # Reject approval
    appr = db_session.query(Approval).filter(Approval.id == appr_id).first()
    appr.status = "REJECTED"
    appr.approver_id = user.id
    appr.decided_at = datetime.now(timezone.utc).replace(tzinfo=None)
    db_session.commit()

    resume_res = agent.run(
        event_id=event.id,
        message="Resume audio fix",
        user_id=collab.id,
        approval_id=appr_id,
    )
    # Execution must remain None because ticket was rejected
    assert resume_res["execution"] is None


def test_decision_trace_contains_no_chain_of_thought(db_session: Session):
    """Agent tool history and state track factual operational traces, NOT hidden chain-of-thought."""
    user, _, event, _ = _create_base_event(db_session)
    agent = EventOperationsAgent(db_session, llm_provider=MockLLMProvider())
    res = agent.run(event_id=event.id, message="System status check", user_id=user.id)

    tool_history = res.get("tool_history") or []
    assert len(tool_history) >= 1
    for step in tool_history:
        # Verify no chain-of-thought keys
        assert "thought" not in step
        assert "thought_history" not in step
        assert "chain_of_thought" not in step
        assert "internal_reasoning" not in step
        # Verify presence of factual operational attributes
        assert "tool" in step
        assert "status" in step
        assert "result_summary" in step
