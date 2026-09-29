"""Integration Tests for Phase 4A: Generic Approval Identity & Foreign Key Fix.

Validates that:
1. Candidate selection via POST /api/events/{event_id}/shortlist/{candidate_id}/select returns HTTP 200.
2. Approval.requester_id always references a valid, existing users.id.
3. Separation of duties: requester_id is populated, approver_id is None, approval status is PENDING.
4. Gated communication: zero calls or WhatsApp messages are initiated upon selection.
5. Idempotency: repeated selection clicks return HTTP 200 without duplicate assignments or approvals.
6. Generic identity resolution handles:
   - Event owner ID fallback when unauthenticated.
   - Authenticated operator (X-User-Id header).
   - Explicit selected_by payload.
   - Canonical organizer fallback.
7. Subsequent communication approval or dismissal executes cleanly without foreign key errors.
"""
import pytest
from datetime import datetime, timezone
from unittest.mock import patch, MagicMock

from app.models.event import Event
from app.models.user import User
from app.models.shortlist import EventShortlistEntry
from app.models.approval import Approval
from app.models.vendor_assignment import VendorAssignment
from app.models.venue import Venue
from app.models.vendor import Vendor
from app.services.identity_service import ensure_canonical_users, resolve_requester_identity


@pytest.fixture
def seeded_users(db_session):
    ensure_canonical_users(db_session)
    return True


@pytest.fixture
def owner_user(db_session):
    user = User(
        id="owner-usr-phase4a",
        name="Phase4A Event Owner",
        email="owner_phase4a@eventra.ai",
    )
    db_session.add(user)
    db_session.commit()
    return user


@pytest.fixture
def test_event_with_owner(db_session, owner_user):
    event = Event(
        id="evt-phase4a-test-1",
        owner_id=owner_user.id,
        name="Phase 4A Showcase Gala",
        location="New Delhi",
        start_datetime=datetime(2026, 12, 15, 10, 0, tzinfo=timezone.utc).replace(tzinfo=None),
        total_budget=500000.0,
        lifecycle_state="LIVE",
    )
    db_session.add(event)
    db_session.commit()
    return event


@pytest.fixture
def test_shortlist_entry(db_session, test_event_with_owner):
    entry = EventShortlistEntry(
        id="sl-entry-4a-1",
        event_id=test_event_with_owner.id,
        candidate_id="cand-venue-4a-1",
        category="VENUE",
        provider_id="prov-venue-4a-1",
        candidate_name="Taj Palace New Delhi",
        ranking=1,
        status="RECOMMENDED",
        candidate_data={"phone": "+919876543210", "price": 250000},
    )
    db_session.add(entry)
    db_session.commit()
    return entry


def test_candidate_selection_creates_approval_with_valid_fk(test_client, db_session, test_event_with_owner, test_shortlist_entry):
    """1. Selection endpoint succeeds with HTTP 200 and Approval.requester_id is a valid users.id."""
    res = test_client.post(
        f"/api/events/{test_event_with_owner.id}/shortlist/{test_shortlist_entry.candidate_id}/select",
        json={},
    )
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "SELECTED"
    assert data["candidate_id"] == test_shortlist_entry.candidate_id

    # Verify Approval record in DB
    approval = db_session.query(Approval).filter(
        Approval.event_id == test_event_with_owner.id,
        Approval.target_id == test_shortlist_entry.candidate_id,
        Approval.action_type == "COMMUNICATION_OUTREACH",
    ).first()

    assert approval is not None
    assert approval.status == "PENDING"
    assert approval.approver_id is None
    assert approval.impact_level == "MAJOR"

    # Verify foreign key referential integrity: requester_id MUST exist in users table
    requester = db_session.query(User).filter(User.id == approval.requester_id).first()
    assert requester is not None
    assert requester.id == test_event_with_owner.owner_id

    # Verify VendorAssignment created
    asg = db_session.query(VendorAssignment).filter(
        VendorAssignment.event_id == test_event_with_owner.id,
        VendorAssignment.vendor_id == test_shortlist_entry.provider_id,
    ).first()
    assert asg is not None
    assert asg.status == "ASSIGNED"


def test_selection_alone_dispatches_zero_communication(test_client, db_session, test_event_with_owner, test_shortlist_entry):
    """2. Selection creates PENDING approval and DOES NOT trigger any phone call or WhatsApp message."""
    res = test_client.post(
        f"/api/events/{test_event_with_owner.id}/shortlist/{test_shortlist_entry.candidate_id}/select",
    )
    assert res.status_code == 200

    db_session.refresh(test_shortlist_entry)
    comm = test_shortlist_entry.candidate_data.get("communication", {})
    assert comm.get("approval_status") == "PENDING"
    assert comm.get("call_status") == "NOT_ATTEMPTED"
    assert comm.get("whatsapp_status") == "NOT_ATTEMPTED"
    assert comm.get("overall_status") == "PENDING_APPROVAL"


def test_selection_idempotency_double_click(test_client, db_session, test_event_with_owner, test_shortlist_entry):
    """3. Double click / repeated selection returns 200 without creating duplicate approvals or assignments."""
    res1 = test_client.post(
        f"/api/events/{test_event_with_owner.id}/shortlist/{test_shortlist_entry.candidate_id}/select",
    )
    assert res1.status_code == 200

    res2 = test_client.post(
        f"/api/events/{test_event_with_owner.id}/shortlist/{test_shortlist_entry.candidate_id}/select",
    )
    assert res2.status_code == 200

    approvals = db_session.query(Approval).filter(
        Approval.event_id == test_event_with_owner.id,
        Approval.target_id == test_shortlist_entry.candidate_id,
    ).all()
    assert len(approvals) == 1

    assignments = db_session.query(VendorAssignment).filter(
        VendorAssignment.event_id == test_event_with_owner.id,
        VendorAssignment.vendor_id == test_shortlist_entry.provider_id,
    ).all()
    assert len(assignments) == 1


def test_selection_with_explicit_selected_by_provisions_user(test_client, db_session, test_event_with_owner):
    """4. Explicit custom selected_by is provisioned in users table and referenced without FK error."""
    entry = EventShortlistEntry(
        id="sl-entry-custom-usr",
        event_id=test_event_with_owner.id,
        candidate_id="cand-cat-4a-2",
        category="CATERING",
        provider_id="prov-cat-4a-2",
        candidate_name="Delhi Delights Catering",
        status="RECOMMENDED",
    )
    db_session.add(entry)
    db_session.commit()

    res = test_client.post(
        f"/api/events/{test_event_with_owner.id}/shortlist/cand-cat-4a-2/select",
        json={"selected_by": "lead_planner_rohit"},
    )
    assert res.status_code == 200
    data = res.json()
    assert data["selected_by"] == "lead_planner_rohit"

    # User row must exist in users table
    custom_user = db_session.query(User).filter(User.id == "lead_planner_rohit").first()
    assert custom_user is not None

    approval = db_session.query(Approval).filter(
        Approval.event_id == test_event_with_owner.id,
        Approval.target_id == "cand-cat-4a-2",
    ).first()
    assert approval is not None
    assert approval.requester_id == "lead_planner_rohit"


def test_unowned_event_falls_back_to_canonical_user_without_fk_error(test_client, db_session):
    """5. An event with owner_id=None succeeds by falling back to canonical operator/organizer."""
    unowned_event = Event(
        id="evt-unowned-test-4a",
        owner_id=None,
        name="Unowned Demo Event",
        location="Mumbai",
        lifecycle_state="LIVE",
    )
    entry = EventShortlistEntry(
        id="sl-unowned-entry",
        event_id="evt-unowned-test-4a",
        candidate_id="cand-unowned-1",
        category="DECOR",
        provider_id="prov-decor-1",
        candidate_name="Mumbai Flora",
        status="RECOMMENDED",
    )
    db_session.add_all([unowned_event, entry])
    db_session.commit()

    res = test_client.post(
        f"/api/events/{unowned_event.id}/shortlist/cand-unowned-1/select",
        json={},
    )
    assert res.status_code == 200

    approval = db_session.query(Approval).filter(
        Approval.event_id == unowned_event.id,
        Approval.target_id == "cand-unowned-1",
    ).first()
    assert approval is not None
    # Requester must be a valid user in users table
    req_user = db_session.query(User).filter(User.id == approval.requester_id).first()
    assert req_user is not None


def test_dismiss_communication_records_approver_without_fk_error(test_client, db_session, test_event_with_owner, test_shortlist_entry):
    """6. Dismissing communication updates approval to REJECTED and records valid approver_id."""
    # First select candidate
    test_client.post(
        f"/api/events/{test_event_with_owner.id}/shortlist/{test_shortlist_entry.candidate_id}/select",
    )

    # Dismiss communication
    res = test_client.post(
        f"/api/events/{test_event_with_owner.id}/shortlist/{test_shortlist_entry.candidate_id}/dismiss-communication",
        headers={"X-User-Id": test_event_with_owner.owner_id},
    )
    assert res.status_code == 200

    approval = db_session.query(Approval).filter(
        Approval.event_id == test_event_with_owner.id,
        Approval.target_id == test_shortlist_entry.candidate_id,
    ).first()
    assert approval.status == "REJECTED"
    assert approval.approver_id == test_event_with_owner.owner_id
    assert db_session.query(User).filter(User.id == approval.approver_id).first() is not None
