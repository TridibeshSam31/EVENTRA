"""Integration tests for B7 (Authoritative Audit Export) and B8 (Audit Cursor Pagination)."""
import json
import pytest
from datetime import datetime, timedelta, timezone
from fastapi.testclient import TestClient

from app.models.event import Event
from app.models.event_member import EventMember
from app.models.user import User
from app.models.audit import AuditRecord
from app.models.enums import EventLifecycleState


def utc_now():
    return datetime.now(timezone.utc).replace(tzinfo=None)


@pytest.fixture
def audit_test_data(db_session):
    owner = User(name="Audit Owner", email="audit.owner@eventra.test")
    unauthorized_user = User(name="Intruder", email="intruder@eventra.test")
    db_session.add_all([owner, unauthorized_user])
    db_session.commit()
    db_session.refresh(owner)
    db_session.refresh(unauthorized_user)

    event = Event(
        owner_id=owner.id,
        name="Audit Hardening Gala",
        event_type="COLLEGE_FEST",
        lifecycle_state=EventLifecycleState.LIVE.value,
        total_budget=10000.0,
        start_datetime=utc_now(),
        end_datetime=utc_now(),
    )
    db_session.add(event)
    db_session.commit()
    db_session.refresh(event)

    # Insert 15 audit records with distinct timestamps
    now = utc_now()
    records = []
    for i in range(15):
        rec = AuditRecord(
            event_id=event.id,
            actor_id=owner.id,
            actor_type="USER",
            action=f"ACTION_{i}",
            action_type="TASK_MUTATION" if i % 2 == 0 else "VENDOR_ENGAGEMENT",
            target_type="TASK",
            target_id=f"TASK_{i}",
            before_state={"api_token": "secret_123", "count": i},
            after_state={"password": "raw_pass_456", "count": i + 1},
            created_at=now - timedelta(minutes=15 - i),
        )
        records.append(rec)
    db_session.add_all(records)
    db_session.commit()

    return event, owner, unauthorized_user


def test_audit_cursor_pagination_multi_page(test_client: TestClient, audit_test_data):
    event, owner, _ = audit_test_data

    # Page 1: limit 5
    res1 = test_client.get(
        f"/api/events/{event.id}/audit?limit=5",
        headers={"x-user-id": owner.id},
    )
    assert res1.status_code == 200
    data1 = res1.json()
    assert data1["total"] == 15
    assert len(data1["items"]) == 5
    assert data1["next_cursor"] is not None

    cursor1 = data1["next_cursor"]
    page1_ids = [item["id"] for item in data1["items"]]

    # Page 2: with cursor1, limit 5
    res2 = test_client.get(
        f"/api/events/{event.id}/audit?limit=5&cursor={cursor1}",
        headers={"x-user-id": owner.id},
    )
    assert res2.status_code == 200
    data2 = res2.json()
    assert len(data2["items"]) == 5
    assert data2["next_cursor"] is not None

    cursor2 = data2["next_cursor"]
    page2_ids = [item["id"] for item in data2["items"]]

    # Ensure zero overlap between Page 1 and Page 2
    assert set(page1_ids).isdisjoint(set(page2_ids))

    # Page 3: with cursor2, limit 10
    res3 = test_client.get(
        f"/api/events/{event.id}/audit?limit=10&cursor={cursor2}",
        headers={"x-user-id": owner.id},
    )
    assert res3.status_code == 200
    data3 = res3.json()
    assert len(data3["items"]) == 5
    assert data3["next_cursor"] is None  # Final page


def test_audit_invalid_cursor_returns_400(test_client: TestClient, audit_test_data):
    event, owner, _ = audit_test_data
    res = test_client.get(
        f"/api/events/{event.id}/audit?cursor=invalid_base64_garbage",
        headers={"x-user-id": owner.id},
    )
    assert res.status_code == 400


def test_audit_export_json_redacts_secrets(test_client: TestClient, audit_test_data):
    event, owner, _ = audit_test_data
    res = test_client.get(
        f"/api/events/{event.id}/audit/export?format=json",
        headers={"x-user-id": owner.id},
    )
    assert res.status_code == 200
    assert "application/json" in res.headers["content-type"]
    assert "attachment;" in res.headers["content-disposition"]

    data = res.json()
    assert len(data) == 15
    for item in data:
        # Secrets should be redacted
        if item.get("before_state"):
            assert item["before_state"].get("api_token") == "[REDACTED]"
        if item.get("after_state"):
            assert item["after_state"].get("password") == "[REDACTED]"


def test_audit_export_csv_format(test_client: TestClient, audit_test_data):
    event, owner, _ = audit_test_data
    res = test_client.get(
        f"/api/events/{event.id}/audit/export?format=csv",
        headers={"x-user-id": owner.id},
    )
    assert res.status_code == 200
    assert "text/csv" in res.headers["content-type"]
    lines = res.text.strip().split("\n")
    # Header + 15 records = 16 lines
    assert len(lines) == 16
    assert lines[0].startswith("id,event_id,created_at,actor_id")


def test_audit_unauthorized_access_rejected(test_client: TestClient, audit_test_data):
    event, _, intruder = audit_test_data
    res1 = test_client.get(
        f"/api/events/{event.id}/audit",
        headers={"x-user-id": intruder.id},
    )
    assert res1.status_code == 403

    res2 = test_client.get(
        f"/api/events/{event.id}/audit/export",
        headers={"x-user-id": intruder.id},
    )
    assert res2.status_code == 403
