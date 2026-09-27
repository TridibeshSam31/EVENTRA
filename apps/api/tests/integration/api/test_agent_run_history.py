"""Integration tests for B10: Standalone Persistent Agent Run History."""
from datetime import datetime, timezone
import pytest
from fastapi.testclient import TestClient

from app.models.event import Event
from app.models.user import User
from app.models.agent_run import AgentRun
from app.models.enums import EventLifecycleState


def utc_now():
    return datetime.now(timezone.utc).replace(tzinfo=None)


@pytest.fixture
def agent_test_data(db_session):
    owner = User(name="Agent Operator", email="agent.op@eventra.test")
    intruder = User(name="Intruder", email="intruder@eventra.test")
    db_session.add_all([owner, intruder])
    db_session.commit()
    db_session.refresh(owner)
    db_session.refresh(intruder)

    event1 = Event(
        owner_id=owner.id,
        name="Agent Run Gala 1",
        event_type="COLLEGE_FEST",
        lifecycle_state=EventLifecycleState.LIVE.value,
        total_budget=5000.0,
        start_datetime=utc_now(),
        end_datetime=utc_now(),
    )
    event2 = Event(
        owner_id=owner.id,
        name="Agent Run Gala 2",
        event_type="CONFERENCE",
        lifecycle_state=EventLifecycleState.LIVE.value,
        total_budget=8000.0,
        start_datetime=utc_now(),
        end_datetime=utc_now(),
    )
    db_session.add_all([event1, event2])
    db_session.commit()
    db_session.refresh(event1)
    db_session.refresh(event2)

    return event1, event2, owner, intruder


def test_agent_run_execution_persists_and_queries(test_client: TestClient, agent_test_data):
    event1, _, owner, intruder = agent_test_data

    # 1. Execute agent run via API
    run_res = test_client.post(
        f"/api/events/{event1.id}/agent/runs",
        json={"message": "What is the status of the festival?"},
        headers={"x-user-id": owner.id},
    )
    assert run_res.status_code == 200
    run_data = run_res.json()
    assert "run_id" in run_data
    run_id = run_data["run_id"]

    # 2. Query list of agent runs
    list_res = test_client.get(
        f"/api/events/{event1.id}/agent/runs",
        headers={"x-user-id": owner.id},
    )
    assert list_res.status_code == 200
    list_data = list_res.json()
    assert list_data["total"] >= 1
    found_run = next((r for r in list_data["items"] if r["run_id"] == run_id), None)
    assert found_run is not None
    assert found_run["trigger_message"] == "What is the status of the festival?"
    assert found_run["status"] is not None

    # 3. Query specific agent run by run_id
    detail_res = test_client.get(
        f"/api/events/{event1.id}/agent/runs/{run_id}",
        headers={"x-user-id": owner.id},
    )
    assert detail_res.status_code == 200
    detail_data = detail_res.json()
    assert detail_data["run_id"] == run_id
    assert detail_data["event_id"] == event1.id


def test_agent_run_event_isolation(test_client: TestClient, agent_test_data, db_session):
    event1, event2, owner, _ = agent_test_data

    # Create a persistent run for event1
    run1 = AgentRun(
        run_id="RUN-ISOLATION-001",
        event_id=event1.id,
        user_id=owner.id,
        trigger_message="Event 1 command",
        status="COMPLETED",
        started_at=utc_now(),
        completed_at=utc_now(),
    )
    db_session.add(run1)
    db_session.commit()

    # Querying event2 for event1's run must return 404
    cross_res = test_client.get(
        f"/api/events/{event2.id}/agent/runs/RUN-ISOLATION-001",
        headers={"x-user-id": owner.id},
    )
    assert cross_res.status_code == 404


def test_agent_run_unauthorized_access_rejected(test_client: TestClient, agent_test_data):
    event1, _, _, intruder = agent_test_data

    res = test_client.get(
        f"/api/events/{event1.id}/agent/runs",
        headers={"x-user-id": intruder.id},
    )
    assert res.status_code == 403


def test_agent_run_secret_redaction(test_client: TestClient, agent_test_data, db_session):
    event1, _, owner, _ = agent_test_data

    # Insert a run with sensitive dictionary
    run_with_secret = AgentRun(
        run_id="RUN-SECRET-002",
        event_id=event1.id,
        user_id=owner.id,
        trigger_message="Trigger with secrets",
        status="COMPLETED",
        started_at=utc_now(),
        tool_history=[
            {"tool": "vendor_dispatch", "args": {"auth_token": "[REDACTED]", "vendor_id": "V1"}},
        ],
    )
    db_session.add(run_with_secret)
    db_session.commit()

    res = test_client.get(
        f"/api/events/{event1.id}/agent/runs/RUN-SECRET-002",
        headers={"x-user-id": owner.id},
    )
    assert res.status_code == 200
    data = res.json()
    assert data["tool_history"][0]["args"]["auth_token"] == "[REDACTED]"
