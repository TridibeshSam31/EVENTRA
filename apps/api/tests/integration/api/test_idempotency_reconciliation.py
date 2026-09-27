"""Integration tests for B11: Mutation Idempotency & Offline Batch Reconciliation."""
from datetime import datetime, timedelta, timezone
import pytest
from fastapi.testclient import TestClient

from app.models.event import Event
from app.models.user import User
from app.models.task import Task
from app.models.enums import EventLifecycleState, TaskStatus
from app.core.idempotency import IdempotencyService, compute_payload_hash


def utc_now():
    return datetime.now(timezone.utc).replace(tzinfo=None)


@pytest.fixture
def reconciliation_test_data(db_session):
    owner = User(name="Recon Owner", email="recon.owner@eventra.test")
    intruder = User(name="Intruder", email="intruder@eventra.test")
    db_session.add_all([owner, intruder])
    db_session.commit()
    db_session.refresh(owner)
    db_session.refresh(intruder)

    event = Event(
        owner_id=owner.id,
        name="Offline Ops Festival",
        event_type="COLLEGE_FEST",
        lifecycle_state=EventLifecycleState.LIVE.value,
        total_budget=20000.0,
        start_datetime=utc_now(),
        end_datetime=utc_now(),
    )
    db_session.add(event)
    db_session.commit()
    db_session.refresh(event)

    task1 = Task(
        event_id=event.id,
        name="Stage Setup",
        status=TaskStatus.READY.value,
        verification_status="PENDING",
    )
    task2 = Task(
        event_id=event.id,
        name="Audio Tuning",
        status=TaskStatus.PENDING.value,
        verification_status="PENDING",
    )
    db_session.add_all([task1, task2])
    db_session.commit()
    db_session.refresh(task1)
    db_session.refresh(task2)

    return event, owner, intruder, task1, task2


def test_batch_reconciliation_applied_and_already_applied(test_client: TestClient, reconciliation_test_data):
    event, owner, _, task1, task2 = reconciliation_test_data

    batch_payload = {
        "operations": [
            {
                "idempotency_key": "IDEMP-OP-001",
                "operation_type": "TASK_STATUS_UPDATE",
                "payload": {"task_id": task1.id, "status": TaskStatus.IN_PROGRESS.value},
            },
            {
                "idempotency_key": "IDEMP-OP-002",
                "operation_type": "TASK_VERIFICATION",
                "payload": {"task_id": task1.id, "verification_status": "VERIFYING", "notes": "Checking cables"},
            },
        ]
    }

    # 1. First execution: should be APPLIED
    res1 = test_client.post(
        f"/api/events/{event.id}/reconciliation/batch",
        json=batch_payload,
        headers={"x-user-id": owner.id},
    )
    assert res1.status_code == 200
    data1 = res1.json()
    assert data1["applied_count"] == 2
    assert data1["already_applied_count"] == 0
    assert data1["results"][0]["status"] == "APPLIED"
    assert data1["results"][1]["status"] == "APPLIED"

    # 2. Replay execution with identical keys and payload: should be ALREADY_APPLIED
    res2 = test_client.post(
        f"/api/events/{event.id}/reconciliation/batch",
        json=batch_payload,
        headers={"x-user-id": owner.id},
    )
    assert res2.status_code == 200
    data2 = res2.json()
    assert data2["applied_count"] == 0
    assert data2["already_applied_count"] == 2
    assert data2["results"][0]["status"] == "ALREADY_APPLIED"
    assert data2["results"][1]["status"] == "ALREADY_APPLIED"


def test_batch_reconciliation_payload_tampering_returns_conflict(test_client: TestClient, reconciliation_test_data):
    event, owner, _, task1, _ = reconciliation_test_data

    key = "IDEMP-CONFLICT-001"
    # First apply
    payload1 = {
        "operations": [
            {
                "idempotency_key": key,
                "operation_type": "TASK_STATUS_UPDATE",
                "payload": {"task_id": task1.id, "status": TaskStatus.IN_PROGRESS.value},
            }
        ]
    }
    res1 = test_client.post(
        f"/api/events/{event.id}/reconciliation/batch",
        json=payload1,
        headers={"x-user-id": owner.id},
    )
    assert res1.status_code == 200
    assert res1.json()["applied_count"] == 1

    # Second apply with same key but materially different payload
    payload2 = {
        "operations": [
            {
                "idempotency_key": key,
                "operation_type": "TASK_STATUS_UPDATE",
                "payload": {"task_id": task1.id, "status": TaskStatus.CANCELLED.value},
            }
        ]
    }
    res2 = test_client.post(
        f"/api/events/{event.id}/reconciliation/batch",
        json=payload2,
        headers={"x-user-id": owner.id},
    )
    assert res2.status_code == 200
    data2 = res2.json()
    assert data2["conflict_count"] == 1
    assert data2["results"][0]["status"] == "CONFLICT"


def test_batch_reconciliation_invalid_operation_rejected_atomically(test_client: TestClient, reconciliation_test_data):
    event, owner, _, task1, _ = reconciliation_test_data

    # Attempting to move READY directly to COMPLETED is invalid without IN_PROGRESS
    payload = {
        "operations": [
            {
                "idempotency_key": "IDEMP-INVALID-001",
                "operation_type": "TASK_STATUS_UPDATE",
                "payload": {"task_id": task1.id, "status": TaskStatus.COMPLETED.value},
            }
        ]
    }
    res = test_client.post(
        f"/api/events/{event.id}/reconciliation/batch",
        json=payload,
        headers={"x-user-id": owner.id},
    )
    assert res.status_code == 200
    data = res.json()
    assert data["failed_count"] == 1
    assert data["results"][0]["status"] == "REJECTED"


def test_batch_reconciliation_unauthorized_access_rejected(test_client: TestClient, reconciliation_test_data):
    event, _, intruder, task1, _ = reconciliation_test_data
    payload = {
        "operations": [
            {
                "idempotency_key": "IDEMP-AUTH-001",
                "operation_type": "TASK_STATUS_UPDATE",
                "payload": {"task_id": task1.id, "status": TaskStatus.IN_PROGRESS.value},
            }
        ]
    }
    res = test_client.post(
        f"/api/events/{event.id}/reconciliation/batch",
        json=payload,
        headers={"x-user-id": intruder.id},
    )
    assert res.status_code == 403


def test_idempotency_expiration(db_session, reconciliation_test_data):
    event, owner, _, task1, _ = reconciliation_test_data
    service = IdempotencyService(db_session)

    key = "IDEMP-EXPIRE-001"
    payload = {"some": "value"}

    # Start and complete with past expiration date
    service.check_or_start(key, "/test", "POST", payload, event_id=event.id, ttl_hours=1)
    service.complete(key, 200, {"ok": True})

    # Artificially set expiration to past
    from app.models.idempotency import IdempotencyRecord
    rec = db_session.query(IdempotencyRecord).filter(IdempotencyRecord.idempotency_key == key).first()
    rec.expires_at = utc_now() - timedelta(minutes=10)
    db_session.commit()

    # check_or_start should treat expired key as new
    already_done, _, _ = service.check_or_start(key, "/test", "POST", payload, event_id=event.id, ttl_hours=1)
    assert already_done is False
