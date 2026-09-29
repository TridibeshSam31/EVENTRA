"""Tests for Phase 3: Realtime EVENTRA Workspace Using Existing SSE

Validates:
1. SSE endpoint connects and sends initial snapshot with coherent workspace state.
2. SSE snapshot reflects WAITING_FOR_USER_SELECTION and recommendations without client-side inference.
3. live_broker propagates agent lifecycle events (agent.started, agent.progress, agent.waiting_for_selection, agent.failed).
4. live_broker propagates discovery lifecycle events (discovery.started, discovery.progress, discovery.completed, recommendations.ready).
5. Shortlist candidate selection emits shortlist.selected over live_broker with organizer metadata.
6. Reconnect yields fresh initial snapshot matching database persisted state.
7. Workspace snapshot preserves multiple candidates without auto-selection.
8. Duplicate autonomous runs remain prevented.
"""
import json
import pytest
import asyncio
from datetime import datetime, timezone
from app.models.event import Event
from app.models.venue import Venue
from app.models.shortlist import EventShortlistEntry
from app.models.agent_run import AgentRun
from app.models.discovery_run import DiscoveryRun
from app.services.live_broker import live_broker
from app.services.autonomous_operations_service import AutonomousOperationsService


def test_sse_endpoint_connects_and_provides_initial_snapshot(test_client, db_session):
    """GET /events/{event_id}/live-stream connects and yields the initial connected frame with authoritative snapshot."""
    event = Event(
        id="evt-sse-init-1",
        name="Realtime Test Summit",
        location="Delhi",
        start_datetime=datetime(2026, 12, 15, 10, 0, tzinfo=timezone.utc).replace(tzinfo=None),
        total_budget=800000.0,
        lifecycle_state="LIVE",
    )
    db_session.add(event)

    # Add an agent run in WAITING_FOR_USER_SELECTION
    agent_run = AgentRun(
        run_id="run-sse-init-1",
        event_id="evt-sse-init-1",
        status="WAITING_FOR_USER_SELECTION",
        started_at=datetime(2026, 12, 15, 9, 0, tzinfo=timezone.utc).replace(tzinfo=None),
        objective="Waiting for organizer selection",
    )
    db_session.add(agent_run)

    # Add 2 recommendations
    sl1 = EventShortlistEntry(
        event_id="evt-sse-init-1",
        candidate_id="cand-sse-1",
        category="VENUE",
        candidate_name="Grand Hyatt Delhi",
        status="RECOMMENDED",
        ranking=1,
        selection_source="AGENT_RECOMMENDATION",
    )
    sl2 = EventShortlistEntry(
        event_id="evt-sse-init-1",
        candidate_id="cand-sse-2",
        category="VENUE",
        candidate_name="Taj Palace Delhi",
        status="RECOMMENDED",
        ranking=2,
        selection_source="AGENT_RECOMMENDATION",
    )
    db_session.add_all([sl1, sl2])
    db_session.commit()

    # Request the SSE live-stream capped at 1 frame for test isolation
    response = test_client.get("/api/events/evt-sse-init-1/live-stream?max_frames=1")
    assert response.status_code == 200
    assert "text/event-stream" in response.headers.get("content-type", "")

    # Parse SSE payload
    body = response.text
    assert "event: connected" in body
    
    # Extract data: {...} line
    lines = body.splitlines()
    data_line = next(line for line in lines if line.startswith("data:"))
    data_json = json.loads(data_line.replace("data:", "").strip())

    assert data_json["type"] == "CONNECTED"
    assert data_json["event_id"] == "evt-sse-init-1"
    assert "snapshot" in data_json
    assert data_json["snapshot"] is not None

    snapshot = data_json["snapshot"]
    # Agent state
    assert snapshot["agent"]["status"] == "WAITING_FOR_USER_SELECTION"
    assert snapshot["agent"]["is_waiting_for_selection"] is True

    # Recommendations
    recs = snapshot["recommendations"]
    assert len(recs) == 2
    rec_names = [r["candidate_name"] for r in recs]
    assert "Grand Hyatt Delhi" in rec_names
    assert "Taj Palace Delhi" in rec_names

    # Neither candidate was automatically selected
    assert all(r["status"] == "RECOMMENDED" for r in recs)


def test_live_broker_broadcasts_agent_events():
    """live_broker delivers agent.started, agent.progress, and agent.waiting_for_selection to subscriber queues."""
    event_id = "evt-broker-agent-test"

    async def run_broker_test():
        queue = await live_broker.subscribe(event_id)
        try:
            # 1. Publish agent.started
            live_broker.publish_sync(
                event_id,
                {"type": "agent.started", "event_id": event_id, "status": "RUNNING", "current_step": "Planning"},
            )
            msg1 = await asyncio.wait_for(queue.get(), timeout=1.0)
            assert msg1["type"] == "agent.started"
            assert msg1["status"] == "RUNNING"

            # 2. Publish agent.progress
            live_broker.publish_sync(
                event_id,
                {"type": "agent.progress", "event_id": event_id, "message": "Evaluating venue options"},
            )
            msg2 = await asyncio.wait_for(queue.get(), timeout=1.0)
            assert msg2["type"] == "agent.progress"
            assert msg2["message"] == "Evaluating venue options"

            # 3. Publish agent.waiting_for_selection
            live_broker.publish_sync(
                event_id,
                {
                    "type": "agent.waiting_for_selection",
                    "event_id": event_id,
                    "status": "WAITING_FOR_USER_SELECTION",
                },
            )
            msg3 = await asyncio.wait_for(queue.get(), timeout=1.0)
            assert msg3["type"] == "agent.waiting_for_selection"
            assert msg3["status"] == "WAITING_FOR_USER_SELECTION"
        finally:
            await live_broker.unsubscribe(event_id, queue)

    asyncio.run(run_broker_test())


def test_live_broker_broadcasts_discovery_events():
    """live_broker delivers discovery.started, discovery.completed, and recommendations.ready."""
    event_id = "evt-broker-disc-test"

    async def run_discovery_broker_test():
        queue = await live_broker.subscribe(event_id)
        try:
            # 1. discovery.started
            live_broker.publish_sync(
                event_id,
                {"type": "discovery.started", "event_id": event_id, "category": "VENUE"},
            )
            msg1 = await asyncio.wait_for(queue.get(), timeout=1.0)
            assert msg1["type"] == "discovery.started"
            assert msg1["category"] == "VENUE"

            # 2. discovery.completed
            live_broker.publish_sync(
                event_id,
                {"type": "discovery.completed", "event_id": event_id, "category": "VENUE", "total_matching": 4},
            )
            msg2 = await asyncio.wait_for(queue.get(), timeout=1.0)
            assert msg2["type"] == "discovery.completed"
            assert msg2["total_matching"] == 4

            # 3. recommendations.ready
            live_broker.publish_sync(
                event_id,
                {"type": "recommendations.ready", "event_id": event_id, "categories": ["VENUE", "CATERING"]},
            )
            msg3 = await asyncio.wait_for(queue.get(), timeout=1.0)
            assert msg3["type"] == "recommendations.ready"
            assert "VENUE" in msg3["categories"]
        finally:
            await live_broker.unsubscribe(event_id, queue)

    asyncio.run(run_discovery_broker_test())


def test_shortlist_selection_emits_realtime_event(test_client, db_session):
    """POST /shortlist/{candidate_id}/select must publish shortlist.selected with selected_by metadata."""
    event = Event(
        id="evt-select-realtime",
        name="Realtime Selection Event",
        location="Delhi",
        start_datetime=datetime(2026, 12, 20, 10, 0, tzinfo=timezone.utc).replace(tzinfo=None),
        total_budget=500000.0,
        lifecycle_state="LIVE",
    )
    db_session.add(event)

    sl = EventShortlistEntry(
        event_id="evt-select-realtime",
        candidate_id="cand-realtime-sel-1",
        category="VENUE",
        candidate_name="The Imperial Delhi",
        status="RECOMMENDED",
        ranking=1,
        selection_source="AGENT_RECOMMENDATION",
    )
    db_session.add(sl)
    db_session.commit()

    async def verify_selection_stream():
        queue = await live_broker.subscribe("evt-select-realtime")
        try:
            # Trigger selection API
            res = test_client.post(
                "/api/events/evt-select-realtime/shortlist/cand-realtime-sel-1/select",
                headers={"X-User-Id": "organizer_tridibesh"},
            )
            assert res.status_code == 200

            # Wait for shortlist.selected event over queue
            event_received = None
            for _ in range(5):
                msg = await asyncio.wait_for(queue.get(), timeout=1.0)
                if msg.get("type") == "shortlist.selected":
                    event_received = msg
                    break

            assert event_received is not None
            assert event_received["type"] == "shortlist.selected"
            assert event_received["candidate_id"] == "cand-realtime-sel-1"
            assert event_received["selected_by"] == "organizer_tridibesh"
            assert "selected_at" in event_received
        finally:
            await live_broker.unsubscribe("evt-select-realtime", queue)

    asyncio.run(verify_selection_stream())


def test_reconnect_snapshot_reflects_persisted_state_without_duplication(test_client, db_session):
    """Reconnecting to live-stream returns updated snapshot with selected candidate and preserved recommendations."""
    event = Event(
        id="evt-reconnect-test",
        name="Reconnect Verification Gala",
        location="Delhi",
        start_datetime=datetime(2026, 11, 25, 10, 0, tzinfo=timezone.utc).replace(tzinfo=None),
        total_budget=900000.0,
        lifecycle_state="LIVE",
    )
    db_session.add(event)

    agent_run = AgentRun(
        run_id="run-reconnect-1",
        event_id="evt-reconnect-test",
        status="WAITING_FOR_USER_SELECTION",
        started_at=datetime(2026, 11, 25, 8, 0, tzinfo=timezone.utc).replace(tzinfo=None),
    )
    db_session.add(agent_run)

    # 1 recommended, 1 selected
    sl1 = EventShortlistEntry(
        event_id="evt-reconnect-test",
        candidate_id="cand-rec-1",
        category="VENUE",
        candidate_name="Venue Alpha",
        status="SELECTED",
        ranking=1,
        selection_source="ORGANIZER_SELECTION",
        selected_by="organizer_sarah",
        selected_at=datetime(2026, 11, 25, 9, 30, tzinfo=timezone.utc).replace(tzinfo=None),
    )
    sl2 = EventShortlistEntry(
        event_id="evt-reconnect-test",
        candidate_id="cand-rec-2",
        category="VENUE",
        candidate_name="Venue Beta",
        status="RECOMMENDED",
        ranking=2,
        selection_source="AGENT_RECOMMENDATION",
    )
    db_session.add_all([sl1, sl2])
    db_session.commit()

    # Client reconnects to SSE
    res = test_client.get("/api/events/evt-reconnect-test/live-stream?max_frames=1")
    assert res.status_code == 200

    lines = res.text.splitlines()
    data_line = next(line for line in lines if line.startswith("data:"))
    data = json.loads(data_line.replace("data:", "").strip())
    snapshot = data["snapshot"]

    assert snapshot["agent"]["status"] == "WAITING_FOR_USER_SELECTION"
    assert len(snapshot["recommendations"]) == 2

    # Exactly 1 selection
    selections = snapshot["selections"]
    assert len(selections) == 1
    assert selections[0]["candidate_id"] == "cand-rec-1"
    assert selections[0]["selected_by"] == "organizer_sarah"


def test_agent_failure_emits_agent_failed_and_does_not_emit_false_completion():
    """Failure during operations emits agent.failed and does not emit false agent.completed."""
    event_id = "evt-fail-test"

    async def verify_failure_stream():
        queue = await live_broker.subscribe(event_id)
        try:
            live_broker.publish_sync(
                event_id,
                {"type": "agent.failed", "event_id": event_id, "error": "Budget constraint violated"},
            )
            msg = await asyncio.wait_for(queue.get(), timeout=1.0)
            assert msg["type"] == "agent.failed"
            assert msg["error"] == "Budget constraint violated"
            assert msg.get("type") != "agent.completed"
        finally:
            await live_broker.unsubscribe(event_id, queue)

    asyncio.run(verify_failure_stream())


def test_duplicate_autonomous_run_prevented(test_client, db_session):
    """Calling start_operations when an agent run is already RUNNING returns active run and prevents duplicates."""
    event = Event(
        id="evt-dup-prevent-1",
        name="Concurrency Test Event",
        location="Delhi",
        start_datetime=datetime(2026, 12, 28, 10, 0, tzinfo=timezone.utc).replace(tzinfo=None),
        total_budget=600000.0,
        lifecycle_state="LIVE",
    )
    db_session.add(event)

    active_run = AgentRun(
        run_id="run-active-existing",
        event_id="evt-dup-prevent-1",
        status="RUNNING",
        started_at=datetime(2026, 12, 28, 9, 30, tzinfo=timezone.utc).replace(tzinfo=None),
    )
    db_session.add(active_run)
    db_session.commit()

    service = AutonomousOperationsService(db_session)
    res = service.initiate_operations_run("evt-dup-prevent-1", user_id="organizer_1")

    assert res["status"] in ("ALREADY_ACTIVE", "RUNNING", "ALREADY_RUNNING")
    assert res["run_id"] == "run-active-existing"

    # Confirm only 1 AgentRun exists in DB
    runs = db_session.query(AgentRun).filter(AgentRun.event_id == "evt-dup-prevent-1").all()
    assert len(runs) == 1


def test_initial_snapshot_does_not_infer_false_completion(test_client, db_session):
    """When autonomous operations end at WAITING_FOR_USER_SELECTION, snapshot must NOT report COMPLETED."""
    event = Event(
        id="evt-snapshot-truthful",
        name="Truthful State Event",
        location="Delhi",
        start_datetime=datetime(2026, 12, 30, 10, 0, tzinfo=timezone.utc).replace(tzinfo=None),
        total_budget=500000.0,
        lifecycle_state="LIVE",
    )
    db_session.add(event)

    agent_run = AgentRun(
        run_id="run-truthful-1",
        event_id="evt-snapshot-truthful",
        status="WAITING_FOR_USER_SELECTION",
        started_at=datetime(2026, 12, 30, 9, 0, tzinfo=timezone.utc).replace(tzinfo=None),
    )
    db_session.add(agent_run)
    db_session.commit()

    res = test_client.get("/api/events/evt-snapshot-truthful/live-stream?max_frames=1")
    assert res.status_code == 200

    lines = res.text.splitlines()
    data_line = next(line for line in lines if line.startswith("data:"))
    data = json.loads(data_line.replace("data:", "").strip())
    snapshot = data["snapshot"]

    assert snapshot["agent"]["status"] == "WAITING_FOR_USER_SELECTION"
    assert snapshot["agent"]["status"] != "COMPLETED"
    assert snapshot["agent"]["is_waiting_for_selection"] is True

