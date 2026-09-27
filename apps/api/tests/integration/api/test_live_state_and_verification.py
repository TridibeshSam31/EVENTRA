"""Integration tests for B5 (Live State Push / Change Feed) and B6 (Task Verification State)."""
import pytest
from datetime import datetime, timezone
from fastapi.testclient import TestClient

from app.models.event import Event
from app.models.task import Task
from app.models.enums import EventLifecycleState, TaskStatus


def utc_now():
    return datetime.now(timezone.utc).replace(tzinfo=None)


@pytest.fixture
def live_event_with_tasks(db_session):
    event = Event(
        name="Live Ops Test Festival",
        event_type="COLLEGE_FEST",
        lifecycle_state=EventLifecycleState.LIVE.value,
        total_budget=50000.0,
        start_datetime=utc_now(),
        end_datetime=utc_now(),
    )
    db_session.add(event)
    db_session.commit()
    db_session.refresh(event)

    task1 = Task(
        event_id=event.id,
        name="Stage Lighting Setup",
        status=TaskStatus.READY.value,
        verification_status="PENDING",
    )
    task2 = Task(
        event_id=event.id,
        name="Sound Check",
        status=TaskStatus.PENDING.value,
        verification_status="PENDING",
    )
    db_session.add_all([task1, task2])
    db_session.commit()
    db_session.refresh(task1)
    db_session.refresh(task2)

    return event, task1, task2


def test_live_changes_feed_versioning(test_client: TestClient, live_event_with_tasks):
    event, task1, task2 = live_event_with_tasks

    # Initial query without version
    res = test_client.get(f"/api/events/{event.id}/live-changes")
    assert res.status_code == 200
    data = res.json()
    assert data["has_changes"] is True
    assert "version" in data
    assert data["state"]["lifecycle_state"] == "LIVE"

    version = data["version"]

    # Repeat query with same version
    res_repeat = test_client.get(f"/api/events/{event.id}/live-changes?since_version={version}")
    assert res_repeat.status_code == 200
    repeat_data = res_repeat.json()
    assert repeat_data["has_changes"] is False
    assert repeat_data["state"] is None


def test_live_sse_stream_initial_connected_event(test_client: TestClient, live_event_with_tasks):
    event, task1, _ = live_event_with_tasks

    # Connect to live-stream with max_frames=1
    with test_client.stream("GET", f"/api/events/{event.id}/live-stream?max_frames=1") as response:
        assert response.status_code == 200
        assert "text/event-stream" in response.headers["content-type"]
        text_content = ""
        for chunk in response.iter_text():
            text_content += chunk
        assert "event: connected" in text_content
        assert event.id in text_content


def test_task_completion_sets_executed_not_verified(test_client: TestClient, live_event_with_tasks, db_session):
    event, task1, _ = live_event_with_tasks

    # First update status to IN_PROGRESS
    res1 = test_client.put(
        f"/api/events/{event.id}/tasks/{task1.id}/status",
        json={"status": TaskStatus.IN_PROGRESS.value},
    )
    assert res1.status_code == 200

    # Then update to COMPLETED
    res2 = test_client.put(
        f"/api/events/{event.id}/tasks/{task1.id}/status",
        json={"status": TaskStatus.COMPLETED.value},
    )
    assert res2.status_code == 200
    task_data = res2.json()

    # B6 Rule: 'EXECUTED' must NEVER automatically mean 'VERIFIED'
    assert task_data["status"] == "COMPLETED"
    assert task_data["verification_status"] == "EXECUTED"
    assert task_data["verified_at"] is None


def test_task_verification_lifecycle(test_client: TestClient, live_event_with_tasks):
    event, task1, _ = live_event_with_tasks

    # 1. Update verification to VERIFYING
    res1 = test_client.patch(
        f"/api/events/{event.id}/tasks/{task1.id}/verification",
        json={"verification_status": "VERIFYING", "verification_notes": "QA inspector evaluating sound levels"},
    )
    assert res1.status_code == 200
    data1 = res1.json()
    assert data1["verification_status"] == "VERIFYING"
    assert data1["verification_notes"] == "QA inspector evaluating sound levels"
    assert data1["verified_at"] is None

    # 2. Update verification to VERIFIED
    res2 = test_client.patch(
        f"/api/events/{event.id}/tasks/{task1.id}/verification",
        json={"verification_status": "VERIFIED", "verification_notes": "Sound decibels compliant with municipal limits"},
    )
    assert res2.status_code == 200
    data2 = res2.json()
    assert data2["verification_status"] == "VERIFIED"
    assert data2["verified_at"] is not None

    # 3. Invalid verification status returns 400
    res3 = test_client.patch(
        f"/api/events/{event.id}/tasks/{task1.id}/verification",
        json={"verification_status": "INVALID_STATE"},
    )
    assert res3.status_code == 400

    # 4. Non-existent task returns 404
    res4 = test_client.patch(
        f"/api/events/{event.id}/tasks/00000000-0000-0000-0000-000000000000/verification",
        json={"verification_status": "VERIFIED"},
    )
    assert res4.status_code == 404
