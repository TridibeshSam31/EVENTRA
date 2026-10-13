"""Progress events for directive (LangGraph) runs and post-selection communication."""
from datetime import datetime, timedelta, timezone
from decimal import Decimal

from sqlalchemy.orm import Session

from app.agent.agent import EventOperationsAgent
from app.agent.provider import MockLLMProvider
from app.models.agent_run import AgentRun
from app.models.agent_run_event import AgentRunEvent
from app.models.enums import (
    EventLifecycleState,
    EventState,
    IncidentSeverity,
    IncidentType,
    RoleType,
    TaskPriority,
    TaskStatus,
)
from app.models.event import Event
from app.models.event_member import EventMember
from app.models.incident import Incident
from app.models.shortlist import EventShortlistEntry
from app.models.task import Task
from app.models.user import User
from app.models.vendor import Vendor
from app.services.provider_communication_service import ProviderCommunicationService


def _now():
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _events(db: Session, run_id: str):
    return (
        db.query(AgentRunEvent)
        .filter(AgentRunEvent.run_id == run_id)
        .order_by(AgentRunEvent.sequence.asc())
        .all()
    )


def _event_with_open_incident(db: Session):
    owner = User(name="Owner", email="owner.progress@eventra.test")
    collab = User(name="Collaborator", email="collab.progress@eventra.test")
    db.add_all([owner, collab])
    db.flush()
    event = Event(
        owner_id=owner.id,
        name="Progress Gala",
        lifecycle_state=EventLifecycleState.LIVE.value,
        state=EventState.AT_RISK.value,
        start_datetime=_now() + timedelta(hours=2),
        end_datetime=_now() + timedelta(hours=10),
        total_budget=Decimal("50000.00"),
    )
    db.add(event)
    db.flush()
    db.add_all([
        EventMember(event_id=event.id, user_id=owner.id, role=RoleType.MAIN_ORGANIZER.value),
        EventMember(event_id=event.id, user_id=collab.id, role=RoleType.COLLABORATOR.value),
    ])
    task = Task(
        event_id=event.id,
        name="Catering Setup",
        status=TaskStatus.READY.value,
        priority=TaskPriority.CRITICAL.value,
        duration_minutes=60,
        required_provider_category="catering",
        planned_start=_now() + timedelta(hours=2),
        planned_end=_now() + timedelta(hours=3),
    )
    db.add(task)
    db.flush()
    db.add_all([
        Vendor(name="Gourmet Catering Co", category="catering", city="Seattle", base_cost=3000.0),
        Vendor(name="Star Caterers", category="catering", city="Seattle", base_cost=3100.0, status="ACTIVE"),
        Incident(
            event_id=event.id,
            title="Catering Cancellation",
            incident_type=IncidentType.VENDOR_NO_SHOW.value,
            severity=IncidentSeverity.CRITICAL.value,
            status="OPEN",
            related_task_id=task.id,
        ),
    ])
    db.commit()
    return event, owner, collab


def test_directive_run_records_tool_steps_and_approval_required_not_success(db_session: Session):
    event, _, collab = _event_with_open_incident(db_session)

    result = EventOperationsAgent(db_session, llm_provider=MockLLMProvider()).run(
        event_id=event.id, message="Catering cancelled, what should we do?", user_id=collab.id,
    )
    assert result["status"] == "PENDING_APPROVAL"

    # The run row is created once, at start, then updated (not duplicated).
    runs = db_session.query(AgentRun).filter(AgentRun.run_id == result["run_id"]).all()
    assert len(runs) == 1 and runs[0].status == "PENDING_APPROVAL"

    events = _events(db_session, result["run_id"])
    types = [e.type for e in events]
    assert [e.sequence for e in events] == list(range(1, len(events) + 1))
    assert types[0] == "agent.run_started"
    assert types[-1] == "approval.required"
    assert "agent.run_completed" not in types
    assert events[-1].data["approval_id"] == result["approval_id"]

    started = [e.data["tool"] for e in events if e.type == "agent.tool_started"]
    completed = [e.data["tool"] for e in events if e.type == "agent.tool_completed"]
    assert started and started == completed
    assert started == [h["tool"] for h in result["tool_history"] if h["tool"] != "request_action_approval"]


def test_directive_run_that_raises_is_recorded_as_failed(db_session: Session, monkeypatch):
    event, owner, _ = _event_with_open_incident(db_session)
    agent = EventOperationsAgent(db_session, llm_provider=MockLLMProvider())

    def boom(*args, **kwargs):
        raise RuntimeError("graph crashed")

    monkeypatch.setattr(agent.graph, "invoke", boom)
    try:
        agent.run(event_id=event.id, message="status?", user_id=owner.id)
    except RuntimeError:
        pass
    run = db_session.query(AgentRun).filter(AgentRun.event_id == event.id).one()
    assert run.status == "FAILED"
    assert [e.type for e in _events(db_session, run.run_id)] == ["agent.run_started", "agent.run_failed"]


def _selected_entry(db: Session, event: Event, run_id, phone=None):
    entry = EventShortlistEntry(
        event_id=event.id,
        candidate_id="cand-1",
        category="CATERING",
        candidate_name="Spice Caterers",
        status="SELECTED",
        ranking=1,
        selection_source="AGENT_RECOMMENDATION",
        candidate_data={"name": "Spice Caterers", "phone": phone, "agent_run_id": run_id},
    )
    db.add(entry)
    db.commit()
    return entry


def test_approved_outreach_is_recorded_on_originating_run_without_fabrication(db_session: Session):
    event, owner, _ = _event_with_open_incident(db_session)
    db_session.add(AgentRun(run_id="RUN-COMM0001", event_id=event.id, status="WAITING_FOR_USER_SELECTION", started_at=_now()))
    db_session.commit()
    _selected_entry(db_session, event, "RUN-COMM0001", phone="+919800000000")

    result = ProviderCommunicationService(db_session).execute_approved_communication(
        event_id=event.id, candidate_id="cand-1", approval_id="apr-comm-1", approver_id=owner.id,
    )

    events = _events(db_session, "RUN-COMM0001")
    assert events[0].type == "communication.started"
    assert events[0].data["candidate_name"] == "Spice Caterers"
    updates = [(e.data["channel"], e.data["status"]) for e in events if e.type == "communication.status_changed"]
    # Test environment has no voice/WhatsApp provider configured: report that, never a send.
    assert updates == [("CALL", "UNAVAILABLE"), ("WHATSAPP", "UNAVAILABLE"), ("OVERALL", result["overall_status"])]
    assert result["overall_status"] == "UNAVAILABLE"


def test_outreach_without_phone_is_reported_as_not_attempted(db_session: Session):
    event, owner, _ = _event_with_open_incident(db_session)
    db_session.add(AgentRun(run_id="RUN-COMM0002", event_id=event.id, status="WAITING_FOR_USER_SELECTION", started_at=_now()))
    db_session.commit()
    _selected_entry(db_session, event, "RUN-COMM0002", phone=None)

    ProviderCommunicationService(db_session).execute_approved_communication(
        event_id=event.id, candidate_id="cand-1", approval_id="apr-comm-2", approver_id=owner.id,
    )
    updates = [(e.data["channel"], e.data["status"]) for e in _events(db_session, "RUN-COMM0002") if e.type == "communication.status_changed"]
    assert ("ALL", "NOT_ATTEMPTED") in updates
    assert all(status not in ("SENT", "CALL_PLACED") for _, status in updates)


def test_outreach_for_manually_shortlisted_candidate_records_no_run_events(db_session: Session):
    event, owner, _ = _event_with_open_incident(db_session)
    _selected_entry(db_session, event, None, phone=None)

    ProviderCommunicationService(db_session).execute_approved_communication(
        event_id=event.id, candidate_id="cand-1", approval_id="apr-comm-3", approver_id=owner.id,
    )
    assert db_session.query(AgentRunEvent).count() == 0
