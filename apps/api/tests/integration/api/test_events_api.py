"""Integration Tests: Events REST API (Phase 1 Foundational Endpoints)"""
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session
from app.models.user import User
from app.models.enums import RoleType, EventType


def test_create_and_get_event_via_api(test_client: TestClient, db_session: Session):
    """Test creating an event via API and retrieving it."""
    # Create owner user in database
    owner = User(name="Alice Johnson", email="alice.j@example.com")
    db_session.add(owner)
    db_session.commit()

    # Create event via API
    payload = {
        "owner_id": owner.id,
        "name": "Global AI Summit 2026",
        "description": "Annual gathering of AI research leaders",
        "event_type": EventType.CONFERENCE.value,
        "location": "Convention Center Hall B",
        "guest_count": 800,
        "total_budget": 50000.00,
        "currency": "USD",
    }
    create_resp = test_client.post("/api/events", json=payload)
    assert create_resp.status_code == 201
    event_data = create_resp.json()
    event_id = event_data["id"]
    assert event_data["name"] == "Global AI Summit 2026"
    assert event_data["owner_id"] == owner.id
    assert event_data["guest_count"] == 800
    assert event_data["state"] == "NORMAL"

    # Get event via API
    get_resp = test_client.get(f"/api/events/{event_id}")
    assert get_resp.status_code == 200
    fetched_data = get_resp.json()
    assert fetched_data["id"] == event_id
    assert fetched_data["name"] == "Global AI Summit 2026"


def test_event_membership_endpoints(test_client: TestClient, db_session: Session):
    """Test adding collaborators and listing members through API."""
    owner = User(name="Owner Bob", email="bob.o@example.com")
    collaborator = User(name="Collab Carol", email="carol.c@example.com")
    db_session.add_all([owner, collaborator])
    db_session.commit()

    # Create event
    create_resp = test_client.post("/api/events", json={
        "owner_id": owner.id,
        "name": "University Hackathon",
        "event_type": EventType.COLLEGE_FEST.value,
        "guest_count": 250,
    })
    assert create_resp.status_code == 201
    event_id = create_resp.json()["id"]

    # Initial members should include the owner as MAIN_ORGANIZER
    list_resp = test_client.get(f"/api/events/{event_id}/members")
    assert list_resp.status_code == 200
    initial_members = list_resp.json()
    assert len(initial_members) == 1
    assert initial_members[0]["user_id"] == owner.id
    assert initial_members[0]["role"] == RoleType.MAIN_ORGANIZER.value

    # Add collaborator
    add_resp = test_client.post(f"/api/events/{event_id}/members", json={
        "user_id": collaborator.id,
        "role": RoleType.COLLABORATOR.value,
    })
    assert add_resp.status_code == 201
    member_data = add_resp.json()
    assert member_data["user_id"] == collaborator.id
    assert member_data["role"] == RoleType.COLLABORATOR.value

    # List members should now have 2 members
    list_resp2 = test_client.get(f"/api/events/{event_id}/members")
    assert list_resp2.status_code == 200
    members2 = list_resp2.json()
    assert len(members2) == 2
    user_ids = [m["user_id"] for m in members2]
    assert owner.id in user_ids
    assert collaborator.id in user_ids

    # Adding duplicate member should return 409 Conflict
    dup_resp = test_client.post(f"/api/events/{event_id}/members", json={
        "user_id": collaborator.id,
        "role": RoleType.VIEWER.value,
    })
    assert dup_resp.status_code == 409


def test_create_event_with_nonexistent_owner(test_client: TestClient):
    """Verify creating event auto-creates owner if not already present."""
    payload = {
        "owner_id": "non-existent-user-id",
        "name": "Ghost Event",
    }
    resp = test_client.post("/api/events", json=payload)
    assert resp.status_code == 201
    data = resp.json()
    assert data["owner_id"] == "non-existent-user-id"
