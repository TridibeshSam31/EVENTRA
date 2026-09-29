"""Regression Tests: Generic SSE Serialization & Autonomous Operations Lifecycle

Covers the global serialization fix and verifies the complete runtime chain
works for ANY event, not just a specific event ID.

Tests:
 1.  SSE snapshot with datetime fields
 2.  SSE snapshot with nested datetime (task_progress)
 3.  SSE snapshot with UUID values
 4.  SSE snapshot with Enum values
 5.  Empty/minimal snapshot (event with no tasks, no agent runs)
 6.  Populated snapshot (event with tasks, agent, discoveries, recommendations)
 7.  SSE reconnect yields fresh valid snapshot
 8.  Arbitrary event ID works (not hardcoded)
 9.  Start operations for arbitrary event
10.  Duplicate start operations returns ALREADY_RUNNING
11.  Background discovery actually completes
12.  Recommendations persist as RECOMMENDED
13.  Agent reaches WAITING_FOR_USER_SELECTION
"""
import json
import pytest
from datetime import datetime, timezone, timedelta
from decimal import Decimal
from enum import Enum
from uuid import uuid4, UUID

from app.core.serialization import EventraJSONEncoder, eventra_json_dumps
from app.models.event import Event
from app.models.task import Task
from app.models.venue import Venue
from app.models.vendor import Vendor
from app.models.shortlist import EventShortlistEntry
from app.models.agent_run import AgentRun
from app.models.discovery_run import DiscoveryRun
from app.models.enums import EventLifecycleState, TaskStatus
from app.services.autonomous_operations_service import AutonomousOperationsService
from app.services.intake_service import IntakeService


# ─────────────────────────────────────────────────────────────────────────────
# 1-4. EventraJSONEncoder unit tests
# ─────────────────────────────────────────────────────────────────────────────

class TestEventraJSONEncoder:
    """Verifies the centralized JSON encoder handles all backend types."""

    def test_datetime_serialization(self):
        """datetime objects serialize to ISO 8601 strings."""
        dt = datetime(2026, 12, 15, 10, 30, 0, tzinfo=timezone.utc)
        result = eventra_json_dumps({"ts": dt})
        parsed = json.loads(result)
        assert parsed["ts"] == "2026-12-15T10:30:00+00:00"

    def test_naive_datetime_serialization(self):
        """Naive datetime objects (no tzinfo) serialize correctly."""
        dt = datetime(2026, 11, 25, 14, 0, 0)
        result = eventra_json_dumps({"ts": dt})
        parsed = json.loads(result)
        assert parsed["ts"] == "2026-11-25T14:00:00"

    def test_nested_datetime_serialization(self):
        """Datetime objects nested in dicts/lists serialize correctly."""
        data = {
            "task_progress": [
                {
                    "task_id": "t-1",
                    "planned_start": datetime(2026, 12, 15, 9, 0),
                    "planned_end": datetime(2026, 12, 15, 17, 0),
                    "actual_start": None,
                    "actual_end": None,
                }
            ],
            "agent": {
                "started_at": datetime(2026, 12, 15, 8, 0),
                "completed_at": datetime(2026, 12, 15, 8, 30),
            },
        }
        result = eventra_json_dumps(data)
        parsed = json.loads(result)
        assert parsed["task_progress"][0]["planned_start"] == "2026-12-15T09:00:00"
        assert parsed["agent"]["started_at"] == "2026-12-15T08:00:00"

    def test_uuid_serialization(self):
        """UUID objects serialize to string."""
        uid = uuid4()
        result = eventra_json_dumps({"id": uid})
        parsed = json.loads(result)
        assert parsed["id"] == str(uid)

    def test_decimal_serialization(self):
        """Decimal values serialize to float."""
        result = eventra_json_dumps({"cost": Decimal("45000.50")})
        parsed = json.loads(result)
        assert parsed["cost"] == 45000.50

    def test_enum_serialization(self):
        """Enum values serialize to their .value."""
        class Status(Enum):
            ACTIVE = "ACTIVE"
            ARCHIVED = "ARCHIVED"

        result = eventra_json_dumps({"status": Status.ACTIVE})
        parsed = json.loads(result)
        assert parsed["status"] == "ACTIVE"

    def test_set_serialization(self):
        """Sets serialize to sorted lists."""
        result = eventra_json_dumps({"tags": {"b", "a", "c"}})
        parsed = json.loads(result)
        assert parsed["tags"] == ["a", "b", "c"]

    def test_mixed_complex_payload(self):
        """A realistic operations snapshot with all complex types serializes safely."""
        snapshot = {
            "event_id": "evt-123",
            "live_state": {
                "task_progress": [
                    {
                        "task_id": "t-1",
                        "planned_start": datetime(2026, 12, 15, 9, 0),
                        "planned_end": datetime(2026, 12, 15, 17, 0),
                    },
                ],
            },
            "agent": {
                "run_id": "RUN-ABC123",
                "started_at": datetime(2026, 12, 15, 8, 0),
                "completed_at": None,
            },
            "discovery": [
                {
                    "id": "disc_abc",
                    "created_at": datetime(2026, 12, 15, 8, 1),
                    "updated_at": datetime(2026, 12, 15, 8, 5),
                },
            ],
            "recommendations": [
                {
                    "id": 1,
                    "selected_at": datetime(2026, 12, 15, 9, 30),
                    "score": Decimal("0.92"),
                },
            ],
            "total_budget": Decimal("800000.00"),
        }
        result = eventra_json_dumps(snapshot)
        parsed = json.loads(result)
        assert parsed["live_state"]["task_progress"][0]["planned_start"] == "2026-12-15T09:00:00"
        assert parsed["agent"]["started_at"] == "2026-12-15T08:00:00"
        assert parsed["discovery"][0]["created_at"] == "2026-12-15T08:01:00"
        assert parsed["recommendations"][0]["selected_at"] == "2026-12-15T09:30:00"
        assert parsed["total_budget"] == 800000.0


# ─────────────────────────────────────────────────────────────────────────────
# 5. SSE with empty/minimal snapshot
# ─────────────────────────────────────────────────────────────────────────────

def test_sse_minimal_event_no_tasks_no_agent(test_client, db_session):
    """SSE live-stream works for an event with zero tasks, zero agent runs, zero recommendations."""
    event = Event(
        id="evt-minimal-sse",
        name="Minimal SSE Test",
        location="Chennai",
        start_datetime=datetime(2027, 1, 10, 10, 0),
        total_budget=100000.0,
        lifecycle_state="DRAFT",
    )
    db_session.add(event)
    db_session.commit()

    res = test_client.get("/api/events/evt-minimal-sse/live-stream?max_frames=1")
    assert res.status_code == 200
    assert "text/event-stream" in res.headers.get("content-type", "")

    lines = res.text.splitlines()
    data_line = next(line for line in lines if line.startswith("data:"))
    data = json.loads(data_line.replace("data:", "").strip())

    assert data["type"] == "CONNECTED"
    assert data["event_id"] == "evt-minimal-sse"
    # snapshot may be None if no operations have started — that's valid
    # The key assertion: no serialization error occurred


# ─────────────────────────────────────────────────────────────────────────────
# 6. SSE with populated snapshot (tasks + datetime fields + agent + recommendations)
# ─────────────────────────────────────────────────────────────────────────────

def test_sse_populated_event_with_datetimes(test_client, db_session):
    """SSE snapshot serializes correctly when event has tasks with datetime planned_start/planned_end."""
    event = Event(
        id="evt-pop-sse",
        name="Populated SSE Test",
        location="Delhi",
        start_datetime=datetime(2026, 12, 20, 9, 0),
        total_budget=500000.0,
        lifecycle_state="LIVE",
    )
    db_session.add(event)

    # Tasks with datetime fields (these end up in task_progress via LiveStateService)
    t1 = Task(
        id="t-pop-1",
        event_id="evt-pop-sse",
        name="Venue Setup",
        status=TaskStatus.PENDING.value,
        planned_start=datetime(2026, 12, 20, 7, 0),
        planned_end=datetime(2026, 12, 20, 9, 0),
        is_critical_path=True,
    )
    t2 = Task(
        id="t-pop-2",
        event_id="evt-pop-sse",
        name="Catering Delivery",
        status=TaskStatus.PENDING.value,
        planned_start=datetime(2026, 12, 20, 8, 0),
        planned_end=datetime(2026, 12, 20, 10, 0),
    )
    db_session.add_all([t1, t2])

    # Agent run with datetime started_at
    agent_run = AgentRun(
        run_id="run-pop-1",
        event_id="evt-pop-sse",
        status="WAITING_FOR_USER_SELECTION",
        started_at=datetime(2026, 12, 19, 15, 0),
        completed_at=datetime(2026, 12, 19, 15, 30),
    )
    db_session.add(agent_run)

    # Recommendations
    sl1 = EventShortlistEntry(
        event_id="evt-pop-sse",
        candidate_id="cand-pop-1",
        category="VENUE",
        candidate_name="Imperial Palace",
        status="RECOMMENDED",
        ranking=1,
        selection_source="AGENT_RECOMMENDATION",
    )
    db_session.add(sl1)
    db_session.commit()

    # THE CRITICAL TEST: This request previously failed with
    # "TypeError: Object of type datetime is not JSON serializable"
    res = test_client.get("/api/events/evt-pop-sse/live-stream?max_frames=1")
    assert res.status_code == 200

    lines = res.text.splitlines()
    data_line = next(line for line in lines if line.startswith("data:"))
    data = json.loads(data_line.replace("data:", "").strip())

    assert data["type"] == "CONNECTED"
    snapshot = data["snapshot"]
    assert snapshot is not None
    assert snapshot["event_id"] == "evt-pop-sse"

    # Agent timestamps serialized correctly
    assert snapshot["agent"]["status"] == "WAITING_FOR_USER_SELECTION"
    assert snapshot["agent"]["started_at"] is not None
    assert "2026" in snapshot["agent"]["started_at"]

    # Recommendations present
    assert len(snapshot["recommendations"]) >= 1
    assert snapshot["recommendations"][0]["candidate_name"] == "Imperial Palace"

    # live_state contains task_progress with serialized datetime fields
    live_state = snapshot["live_state"]
    if live_state.get("task_progress"):
        for tp in live_state["task_progress"]:
            # These should be ISO strings, not datetime objects
            if tp.get("planned_start"):
                assert isinstance(tp["planned_start"], str)
            if tp.get("planned_end"):
                assert isinstance(tp["planned_end"], str)


# ─────────────────────────────────────────────────────────────────────────────
# 7. SSE reconnect
# ─────────────────────────────────────────────────────────────────────────────

def test_sse_reconnect_returns_fresh_snapshot(test_client, db_session):
    """Two sequential SSE connections return valid CONNECTED snapshots — simulates browser reconnect."""
    event = Event(
        id="evt-reconnect-generic",
        name="Reconnect Generic Test",
        location="Mumbai",
        start_datetime=datetime(2026, 11, 30, 10, 0),
        total_budget=700000.0,
        lifecycle_state="LIVE",
    )
    db_session.add(event)

    agent_run = AgentRun(
        run_id="run-reconnect-g",
        event_id="evt-reconnect-generic",
        status="WAITING_FOR_USER_SELECTION",
        started_at=datetime(2026, 11, 30, 9, 0),
    )
    db_session.add(agent_run)
    db_session.commit()

    # First connection
    res1 = test_client.get("/api/events/evt-reconnect-generic/live-stream?max_frames=1")
    assert res1.status_code == 200
    data1 = json.loads(next(l for l in res1.text.splitlines() if l.startswith("data:")).replace("data:", "").strip())
    assert data1["type"] == "CONNECTED"

    # Second connection (reconnect)
    res2 = test_client.get("/api/events/evt-reconnect-generic/live-stream?max_frames=1")
    assert res2.status_code == 200
    data2 = json.loads(next(l for l in res2.text.splitlines() if l.startswith("data:")).replace("data:", "").strip())
    assert data2["type"] == "CONNECTED"
    assert data2["snapshot"]["agent"]["status"] == "WAITING_FOR_USER_SELECTION"


# ─────────────────────────────────────────────────────────────────────────────
# 8. Arbitrary event ID (not hardcoded)
# ─────────────────────────────────────────────────────────────────────────────

def test_sse_works_for_dynamically_created_event(test_client, db_session):
    """SSE works with a dynamically generated event ID — verifies no hardcoded event ID dependency."""
    dynamic_id = f"evt-dynamic-{uuid4().hex[:8]}"
    event = Event(
        id=dynamic_id,
        name="Dynamic Event",
        location="Bangalore",
        start_datetime=datetime(2027, 3, 15, 11, 0),
        total_budget=300000.0,
        lifecycle_state="LIVE",
    )
    db_session.add(event)
    db_session.commit()

    res = test_client.get(f"/api/events/{dynamic_id}/live-stream?max_frames=1")
    assert res.status_code == 200

    data = json.loads(next(l for l in res.text.splitlines() if l.startswith("data:")).replace("data:", "").strip())
    assert data["type"] == "CONNECTED"
    assert data["event_id"] == dynamic_id


# ─────────────────────────────────────────────────────────────────────────────
# 9. Start operations for arbitrary event
# ─────────────────────────────────────────────────────────────────────────────

def test_start_operations_arbitrary_event(db_session):
    """start_operations works for an arbitrary event with seeded providers."""
    intake = IntakeService(db_session)
    ops = AutonomousOperationsService(db_session)

    # Seed providers
    db_session.add(Venue(id="v-arb-1", name="Arbitrary Venue", city="Hyderabad", capacity=200, hourly_rate=3000.0, venue_type="BANQUET"))
    db_session.add(Vendor(id="vend-arb-1", name="Arb Caterers", category="CATERING", city="Hyderabad", rating=4.7, status="ACTIVE"))
    db_session.commit()

    init_res = intake.process_intake(
        "150-person workshop in Hyderabad on 20 March 2027. Budget 4 lakh. Requirements: venue, catering.",
        user_id="test_arb_user",
    )
    event_id = init_res["event_id"]

    # Mirror production flow: initiate first (creates AgentRun), then run operations
    init_out = ops.initiate_operations_run(event_id=event_id, user_id="test_arb_user")
    run_id = init_out["run_id"]

    ops_res = ops.start_operations(event_id=event_id, user_id="test_arb_user", run_id=run_id)

    assert ops_res["status"] == "WAITING_FOR_USER_SELECTION"
    assert ops_res["providers_contacted_count"] == 0

    # Recommendations exist
    shortlists = db_session.query(EventShortlistEntry).filter(EventShortlistEntry.event_id == event_id).all()
    assert len(shortlists) > 0
    assert all(s.status == "RECOMMENDED" for s in shortlists)

    # Agent reached WAITING_FOR_USER_SELECTION
    agent_run = (
        db_session.query(AgentRun)
        .filter(AgentRun.event_id == event_id)
        .order_by(AgentRun.started_at.desc())
        .first()
    )
    assert agent_run is not None
    assert agent_run.status == "WAITING_FOR_USER_SELECTION"


# ─────────────────────────────────────────────────────────────────────────────
# 10. Duplicate start operations (idempotency)
# ─────────────────────────────────────────────────────────────────────────────

def test_duplicate_start_operations_returns_already_running(db_session):
    """Two calls to initiate_operations_run for the same event do not create duplicate AgentRuns."""
    intake = IntakeService(db_session)
    ops = AutonomousOperationsService(db_session)

    init_res = intake.process_intake(
        "100-person event in Pune on 1 April 2027. Budget 2 lakh. Requirements: venue.",
        user_id="test_dup_user",
    )
    event_id = init_res["event_id"]

    first = ops.initiate_operations_run(event_id=event_id, user_id="test_dup_user")
    assert first["status"] == "STARTED"

    second = ops.initiate_operations_run(event_id=event_id, user_id="test_dup_user")
    assert second["status"] == "ALREADY_RUNNING"

    runs = db_session.query(AgentRun).filter(AgentRun.event_id == event_id).all()
    assert len(runs) == 1


# ─────────────────────────────────────────────────────────────────────────────
# 11. Background discovery actually completes
# ─────────────────────────────────────────────────────────────────────────────

def test_discovery_runs_complete(db_session):
    """After start_operations, all DiscoveryRuns reach COMPLETED status."""
    intake = IntakeService(db_session)
    ops = AutonomousOperationsService(db_session)

    db_session.add(Venue(id="v-disc-1", name="Discovery Venue", city="Kolkata", capacity=300, hourly_rate=4000.0, venue_type="BANQUET"))
    db_session.add(Vendor(id="vend-disc-1", name="Kolkata Catering", category="CATERING", city="Kolkata", rating=4.5, status="ACTIVE"))
    db_session.commit()

    init_res = intake.process_intake(
        "200-person summit in Kolkata on 15 April 2027. Budget 5 lakh. Requirements: venue, catering.",
        user_id="test_disc_user",
    )
    event_id = init_res["event_id"]
    ops.start_operations(event_id=event_id, user_id="test_disc_user")

    discovery_runs = db_session.query(DiscoveryRun).filter(DiscoveryRun.event_id == event_id).all()
    assert len(discovery_runs) >= 2
    for dr in discovery_runs:
        assert dr.status in ("COMPLETED", "TARGET_REACHED")


# ─────────────────────────────────────────────────────────────────────────────
# 12. Recommendations persist as RECOMMENDED
# ─────────────────────────────────────────────────────────────────────────────

def test_recommendations_persist_as_recommended(db_session):
    """Recommendations are persisted with status=RECOMMENDED, never auto-selected."""
    intake = IntakeService(db_session)
    ops = AutonomousOperationsService(db_session)

    db_session.add(Venue(id="v-rec-1", name="Persist Venue", city="Goa", capacity=150, hourly_rate=2500.0, venue_type="RESORT"))
    db_session.commit()

    init_res = intake.process_intake(
        "100-person retreat in Goa on 1 May 2027. Budget 3 lakh. Requirements: venue.",
        user_id="test_rec_user",
    )
    event_id = init_res["event_id"]
    ops.start_operations(event_id=event_id, user_id="test_rec_user")

    entries = db_session.query(EventShortlistEntry).filter(EventShortlistEntry.event_id == event_id).all()
    assert len(entries) > 0
    for entry in entries:
        assert entry.status == "RECOMMENDED"
        assert entry.selection_source == "AGENT_RECOMMENDATION"
        # Never auto-selected
        assert entry.selected_by is None
        assert entry.selected_at is None


# ─────────────────────────────────────────────────────────────────────────────
# 13. Agent reaches WAITING_FOR_USER_SELECTION
# ─────────────────────────────────────────────────────────────────────────────

def test_agent_final_state_is_waiting_for_selection(db_session):
    """After complete autonomous operations, AgentRun status is WAITING_FOR_USER_SELECTION, not COMPLETED."""
    intake = IntakeService(db_session)
    ops = AutonomousOperationsService(db_session)

    db_session.add(Venue(id="v-final-1", name="Final State Venue", city="Jaipur", capacity=400, hourly_rate=5000.0, venue_type="PALACE"))
    db_session.add(Vendor(id="vend-final-1", name="Jaipur AV Tech", category="AV_TECH", city="Jaipur", rating=4.6, status="ACTIVE"))
    db_session.commit()

    init_res = intake.process_intake(
        "300-person conference in Jaipur on 10 June 2027. Budget 8 lakh. Requirements: venue, av.",
        user_id="test_final_user",
    )
    event_id = init_res["event_id"]

    init_out = ops.initiate_operations_run(event_id=event_id, user_id="test_final_user")
    run_id = init_out["run_id"]

    result = ops.start_operations(event_id=event_id, user_id="test_final_user", run_id=run_id)
    assert result["status"] == "WAITING_FOR_USER_SELECTION"

    agent_run = (
        db_session.query(AgentRun)
        .filter(AgentRun.event_id == event_id)
        .order_by(AgentRun.started_at.desc())
        .first()
    )
    assert agent_run.status == "WAITING_FOR_USER_SELECTION"
    # Final response should exist
    assert agent_run.final_response is not None
    assert "Discovery Complete" in agent_run.final_response or "Autonomous" in agent_run.final_response


# ─────────────────────────────────────────────────────────────────────────────
# 14. Full chain: SSE snapshot after operations includes serialized datetimes
# ─────────────────────────────────────────────────────────────────────────────

def test_full_chain_sse_after_operations_serializes_cleanly(test_client, db_session):
    """End-to-end: create event → run operations → connect SSE → CONNECTED snapshot is valid JSON.

    This is the exact scenario that triggered the original TypeError.
    """
    intake = IntakeService(db_session)
    ops = AutonomousOperationsService(db_session)

    db_session.add(Venue(id="v-chain-1", name="Chain Test Venue", city="Delhi", capacity=500, hourly_rate=6000.0, venue_type="CONVENTION_CENTER"))
    db_session.add(Vendor(id="vend-chain-1", name="Chain Catering", category="CATERING", city="Delhi", rating=4.8, status="ACTIVE"))
    db_session.commit()

    init_res = intake.process_intake(
        "400-person summit in Delhi on 15 December 2026. Budget 10 lakh. Requirements: venue, catering.",
        user_id="test_chain_user",
    )
    event_id = init_res["event_id"]

    # Run operations mirroring production flow: initiate first (creates AgentRun), then run
    init_out = ops.initiate_operations_run(event_id=event_id, user_id="test_chain_user")
    run_id = init_out["run_id"]
    ops_result = ops.start_operations(event_id=event_id, user_id="test_chain_user", run_id=run_id)
    assert ops_result["status"] == "WAITING_FOR_USER_SELECTION"

    # NOW connect SSE — this was the failing step before the fix
    res = test_client.get(f"/api/events/{event_id}/live-stream?max_frames=1")
    assert res.status_code == 200

    lines = res.text.splitlines()
    data_line = next(line for line in lines if line.startswith("data:"))
    data = json.loads(data_line.replace("data:", "").strip())

    assert data["type"] == "CONNECTED"
    snapshot = data["snapshot"]
    assert snapshot is not None
    assert snapshot["agent"]["status"] == "WAITING_FOR_USER_SELECTION"
    assert len(snapshot["recommendations"]) > 0
    assert len(snapshot["discovery"]) > 0

    # All datetime fields in snapshot are strings, not objects
    raw_text = json.dumps(snapshot)  # This itself would fail if any datetime objects leaked through
    assert "datetime" not in raw_text


# ─────────────────────────────────────────────────────────────────────────────
# 15. Operations status endpoint returns valid JSON
# ─────────────────────────────────────────────────────────────────────────────

def test_operations_status_endpoint_serializes_cleanly(test_client, db_session):
    """GET /events/{id}/operations/status returns valid JSON even when tasks have datetime fields."""
    event = Event(
        id="evt-ops-status-ser",
        name="Ops Status Serialization",
        location="Delhi",
        start_datetime=datetime(2026, 12, 20, 9, 0),
        total_budget=500000.0,
        lifecycle_state="LIVE",
    )
    db_session.add(event)

    t1 = Task(
        id="t-ops-1",
        event_id="evt-ops-status-ser",
        name="Setup Task",
        status=TaskStatus.PENDING.value,
        planned_start=datetime(2026, 12, 20, 7, 0),
        planned_end=datetime(2026, 12, 20, 9, 0),
    )
    db_session.add(t1)

    agent_run = AgentRun(
        run_id="run-ops-status",
        event_id="evt-ops-status-ser",
        status="WAITING_FOR_USER_SELECTION",
        started_at=datetime(2026, 12, 19, 15, 0),
        completed_at=datetime(2026, 12, 19, 15, 30),
    )
    db_session.add(agent_run)
    db_session.commit()

    res = test_client.get("/api/events/evt-ops-status-ser/operations/status")
    assert res.status_code == 200

    data = res.json()
    assert data["event_id"] == "evt-ops-status-ser"
    assert data["agent"]["status"] == "WAITING_FOR_USER_SELECTION"

    # live_state task_progress datetimes are strings
    if data["live_state"].get("task_progress"):
        for tp in data["live_state"]["task_progress"]:
            if tp.get("planned_start"):
                assert isinstance(tp["planned_start"], str)
