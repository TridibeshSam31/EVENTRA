"""Tests for Phase 2: Canonical Event Workspace & Overview Recommendations

Verifies:
1. Operations status returns coherent agent state snapshot.
2. Operations status returns discovery category states.
3. Operations status returns recommendations.
4. Multiple recommendations are returned without collapsing to top-1.
5. Candidate remains RECOMMENDED until explicit organizer action.
6. Selection changes only after explicit organizer selection.
7. selected_by persists.
8. selected_at persists.
9. Selection survives refresh / re-fetch.
10. VendorAssignment is created only after explicit selection.
11. No VendorAssignment is created merely by reading Overview.
12. No communication is triggered by reading Overview.
13. Empty discovery remains truthful.
14. No fake fallback candidate appears.
15. Agent WAITING_FOR_USER_SELECTION remains represented truthfully.
"""
import pytest
from datetime import datetime, timezone
from app.models.event import Event
from app.models.venue import Venue
from app.models.vendor import Vendor
from app.models.vendor_assignment import VendorAssignment
from app.models.shortlist import EventShortlistEntry
from app.models.agent_run import AgentRun
from app.models.discovery_run import DiscoveryRun
from app.models.communication import Conversation


def test_overview_read_does_not_mutate_state(test_client, db_session):
    """Reading operations status must be idempotent and create NO assignments, selections, or communications."""
    event = Event(
        id="evt-read-test",
        name="Test Executive Summit",
        location="Mumbai",
        start_datetime=datetime(2026, 12, 1, 10, 0, tzinfo=timezone.utc).replace(tzinfo=None),
        total_budget=500000.0,
        lifecycle_state="ACTIVE",
    )
    db_session.add(event)
    db_session.commit()

    # Call operations status endpoint multiple times
    res1 = test_client.get("/api/events/evt-read-test/operations/status")
    assert res1.status_code == 200
    res2 = test_client.get("/api/events/evt-read-test/operations/status")
    assert res2.status_code == 200

    # Ensure no assignments were created
    assignments = db_session.query(VendorAssignment).filter(VendorAssignment.event_id == "evt-read-test").all()
    assert len(assignments) == 0

    # Ensure no shortlist entries were created
    shortlist = db_session.query(EventShortlistEntry).filter(EventShortlistEntry.event_id == "evt-read-test").all()
    assert len(shortlist) == 0

    # Ensure no communications were triggered
    comms = db_session.query(Conversation).filter(Conversation.event_id == "evt-read-test").all()
    assert len(comms) == 0


def test_operations_status_coherent_snapshot(test_client, db_session):
    """Verifies that get_operations_status returns agent state, discovery per category, and multiple recommendations."""
    event = Event(
        id="evt-snap-1",
        name="Annual Gala 2026",
        location="Bengaluru",
        start_datetime=datetime(2026, 11, 20, 18, 0, tzinfo=timezone.utc).replace(tzinfo=None),
        total_budget=1000000.0,
        lifecycle_state="LIVE",
    )
    db_session.add(event)

    # 1. AgentRun waiting for selection
    agent_run = AgentRun(
        run_id="run-snap-1",
        event_id="evt-snap-1",
        status="WAITING_FOR_USER_SELECTION",
        started_at=datetime.now(timezone.utc).replace(tzinfo=None),
    )
    db_session.add(agent_run)

    # 2. DiscoveryRuns for 2 categories
    dr_venue = DiscoveryRun(
        id="dr-venue-1",
        event_id="evt-snap-1",
        category="VENUE",
        status="TARGET_REACHED",
        discovered=5,
        relevant=4,
        matching=3,
        shortlisted=3,
        summary="Found 5 venues in Bengaluru",
    )
    dr_catering = DiscoveryRun(
        id="dr-cat-1",
        event_id="evt-snap-1",
        category="CATERING",
        status="TARGET_REACHED",
        discovered=4,
        relevant=3,
        matching=2,
        shortlisted=2,
        summary="Found 4 caterers in Bengaluru",
    )
    db_session.add_all([dr_venue, dr_catering])

    # 3. Multiple recommendations for VENUE and CATERING
    v1 = Venue(id="v-1", name="Grand Palace Hall", city="Bengaluru", address="MG Road", capacity=400, hourly_rate=8000.0, venue_type="BANQUET")
    v2 = Venue(id="v-2", name="Royal Orchid Ballroom", city="Bengaluru", address="Indiranagar", capacity=300, hourly_rate=6000.0, venue_type="BANQUET")
    c1 = Vendor(id="vnd-1", name="Feast Catering", category="CATERING", city="Bengaluru", rating=4.9, status="ACTIVE")
    c2 = Vendor(id="vnd-2", name="Spice Art Caterers", category="CATERING", city="Bengaluru", rating=4.7, status="ACTIVE")
    db_session.add_all([v1, v2, c1, c2])

    sl_v1 = EventShortlistEntry(
        id="sl-1",
        event_id="evt-snap-1",
        candidate_id="v-1",
        category="VENUE",
        provider_id="v-1",
        candidate_name="Grand Palace Hall",
        ranking=1,
        candidate_data={"score": 94.5},
        status="RECOMMENDED",
    )
    sl_v2 = EventShortlistEntry(
        id="sl-2",
        event_id="evt-snap-1",
        candidate_id="v-2",
        category="VENUE",
        provider_id="v-2",
        candidate_name="Royal Orchid Ballroom",
        ranking=2,
        candidate_data={"score": 88.0},
        status="RECOMMENDED",
    )
    sl_c1 = EventShortlistEntry(
        id="sl-3",
        event_id="evt-snap-1",
        candidate_id="vnd-1",
        category="CATERING",
        provider_id="vnd-1",
        candidate_name="Feast Catering",
        ranking=1,
        candidate_data={"score": 96.0},
        status="RECOMMENDED",
    )
    sl_c2 = EventShortlistEntry(
        id="sl-4",
        event_id="evt-snap-1",
        candidate_id="vnd-2",
        category="CATERING",
        provider_id="vnd-2",
        candidate_name="Spice Art Caterers",
        ranking=2,
        candidate_data={"score": 85.0},
        status="RECOMMENDED",
    )
    db_session.add_all([sl_v1, sl_v2, sl_c1, sl_c2])
    db_session.commit()

    # Query status endpoint
    response = test_client.get("/api/events/evt-snap-1/operations/status")
    assert response.status_code == 200
    data = response.json()

    # 1. Agent status
    agent_info = data.get("agent")
    assert agent_info is not None
    assert agent_info["status"] == "WAITING_FOR_USER_SELECTION"
    assert agent_info["is_waiting_for_selection"] is True

    # 2. Discovery runs
    discovery_info = data.get("discovery")
    assert discovery_info is not None
    assert len(discovery_info) == 2
    cats = {d["category"] for d in discovery_info}
    assert "VENUE" in cats
    assert "CATERING" in cats

    # 3. Recommendations
    recs = data.get("recommendations", [])
    assert len(recs) == 4
    venue_recs = [r for r in recs if r["category"] == "VENUE"]
    catering_recs = [r for r in recs if r["category"] == "CATERING"]
    assert len(venue_recs) == 2
    assert len(catering_recs) == 2

    # All should initially be RECOMMENDED, none SELECTED
    for r in recs:
        assert r["status"] == "RECOMMENDED"
        assert r.get("selected_by") is None
        assert r.get("selected_at") is None

    selections = data.get("selections", [])
    assert len(selections) == 0


def test_explicit_selection_persistence_and_assignment(test_client, db_session):
    """Selecting a candidate updates status to SELECTED, records selected_by/selected_at,
    creates VendorAssignment, sets event.venue_id if venue, and survives re-fetch."""
    event = Event(
        id="evt-select-1",
        name="Tech Conference 2026",
        location="Hyderabad",
        start_datetime=datetime(2026, 12, 15, 9, 0, tzinfo=timezone.utc).replace(tzinfo=None),
        total_budget=800000.0,
        lifecycle_state="LIVE",
    )
    venue = Venue(
        id="v-hyd-1",
        name="HITEC City Convention",
        city="Hyderabad",
        address="HITEC City",
        capacity=500,
        hourly_rate=10000.0,
        venue_type="BANQUET",
    )
    db_session.add_all([event, venue])

    shortlist_entry = EventShortlistEntry(
        id="sl-hyd-1",
        event_id="evt-select-1",
        candidate_id="v-hyd-1",
        category="VENUE",
        provider_id="v-hyd-1",
        candidate_name="HITEC City Convention",
        ranking=1,
        candidate_data={"score": 95.0},
        status="RECOMMENDED",
    )
    db_session.add(shortlist_entry)
    db_session.commit()

    # Before selection: 0 assignments, shortlist status is RECOMMENDED
    assignments_before = db_session.query(VendorAssignment).filter(VendorAssignment.event_id == "evt-select-1").all()
    assert len(assignments_before) == 0

    # Perform explicit selection via endpoint
    sel_res = test_client.post(
        "/api/events/evt-select-1/shortlist/v-hyd-1/select",
        json={"selected_by": "organizer_jane"},
    )
    assert sel_res.status_code == 200
    sel_data = sel_res.json()
    assert sel_data["status"] == "SELECTED"
    assert sel_data["selected_by"] == "organizer_jane"
    assert sel_data["selected_at"] is not None

    # Re-fetch operations status (simulating page refresh)
    refresh_res = test_client.get("/api/events/evt-select-1/operations/status")
    assert refresh_res.status_code == 200
    status_data = refresh_res.json()

    # The selected candidate should be in selections
    selections = status_data.get("selections", [])
    assert len(selections) == 1
    assert selections[0]["candidate_id"] == "v-hyd-1"
    assert selections[0]["status"] == "SELECTED"
    assert selections[0]["selected_by"] == "organizer_jane"
    assert selections[0]["selected_at"] is not None

    # VendorAssignment was created
    assignments = db_session.query(VendorAssignment).filter(VendorAssignment.event_id == "evt-select-1").all()
    assert len(assignments) == 1
    assert assignments[0].category.upper() == "VENUE"
    assert assignments[0].status == "ASSIGNED"

    # Event venue_id was populated
    refreshed_event = db_session.query(Event).filter(Event.id == "evt-select-1").first()
    assert refreshed_event.venue_id == "v-hyd-1"

    # Communication was NOT triggered
    comms = db_session.query(Conversation).filter(Conversation.event_id == "evt-select-1").all()
    assert len(comms) == 0


def test_empty_discovery_remains_truthful_without_fake_vendors(test_client, db_session):
    """When discovery yields zero candidates, Overview must return an empty list truthfully, never fake candidates."""
    event = Event(
        id="evt-empty-1",
        name="Remote Meetup",
        location="NowhereVille",
        start_datetime=datetime(2026, 10, 1, 10, 0, tzinfo=timezone.utc).replace(tzinfo=None),
        total_budget=50000.0,
        lifecycle_state="LIVE",
    )
    db_session.add(event)
    db_session.commit()

    res = test_client.get("/api/events/evt-empty-1/operations/status")
    assert res.status_code == 200
    data = res.json()

    assert data.get("recommendations") == []
    assert data.get("selections") == []
    assert data.get("assignments") == []
    # No fake DEMO_FALLBACK vendors
    for assignment in data.get("assignments", []):
        assert assignment.get("source") != "DEMO_FALLBACK"
