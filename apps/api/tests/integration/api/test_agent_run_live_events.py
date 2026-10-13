"""Integration tests: durable agent run progress events for the Agent button flow.

Exercises the real start-operations route, the real AutonomousOperationsService
pipeline and the persisted run event log. Only external network discovery
(the scraper-backed AgenticDiscoveryController) is replaced, with a fake that
reports milestones through the same progress callback the real controller uses.
"""
import json
from datetime import datetime, timezone
from typing import List

import pytest
from fastapi.testclient import TestClient

import app.db.session as db_session_module
from app.integrations.google_maps_scraper.models import NormalizedProvider
from app.models.agent_run import AgentRun
from app.models.agent_run_event import AgentRunEvent
from app.models.enums import EventLifecycleState
from app.models.event import Event
from app.models.shortlist import EventShortlistEntry
from app.models.user import User
from app.models.vendor import Vendor
from app.models.venue import Venue
from app.services.agent_run_events import AgentRunEventRecorder, fail_orphaned_runs
from app.services.agentic_discovery_controller import (
    AgenticDiscoveryController,
    FunnelTransparencyStats,
    TieredShortlistResult,
)
from app.services.autonomous_operations_service import AutonomousOperationsService
from app.services.discovery_ranking_engine import RankedCandidate


def utc_now():
    return datetime.now(timezone.utc).replace(tzinfo=None)


@pytest.fixture
def ops_data(db_session):
    owner = User(name="Ops Owner", email="ops.owner@eventra.test")
    intruder = User(name="Ops Intruder", email="ops.intruder@eventra.test")
    db_session.add_all([owner, intruder])
    db_session.commit()

    event = Event(
        owner_id=owner.id,
        name="Live Agent Summit",
        event_type="CONFERENCE",
        lifecycle_state=EventLifecycleState.LIVE.value,
        total_budget=500000.0,
        guest_count=100,
        location="Delhi",
        start_datetime=utc_now(),
        end_datetime=utc_now(),
    )
    other_event = Event(
        owner_id=intruder.id,
        name="Someone Else's Event",
        event_type="CONFERENCE",
        lifecycle_state=EventLifecycleState.LIVE.value,
        total_budget=1000.0,
        start_datetime=utc_now(),
        end_datetime=utc_now(),
    )
    db_session.add_all([event, other_event])
    db_session.commit()
    return event, other_event, owner, intruder


class _SharedSession:
    """Test DB session handed to the worker; the worker's close() must not detach test objects."""

    def __init__(self, session):
        self._session = session

    def close(self):
        pass

    def __getattr__(self, name):
        return getattr(self._session, name)


@pytest.fixture
def worker_uses_test_db(db_session, monkeypatch):
    """The background worker opens its own SessionLocal; point it at the test DB."""
    monkeypatch.setattr(db_session_module, "SessionLocal", lambda: _SharedSession(db_session))


@pytest.fixture
def two_categories(monkeypatch):
    monkeypatch.setattr(
        AutonomousOperationsService,
        "_resolve_categories_to_source",
        staticmethod(lambda requirements, tasks: ["VENUE", "CATERING"]),
    )


def _ranked(name: str, qualification: str, score: float, rating=None) -> RankedCandidate:
    return RankedCandidate(
        candidate=NormalizedProvider(
            name=name, category="CATERING", city="Delhi", source="GOOGLE_MAPS", source_id=f"gm-{name}", rating=rating,
        ),
        qualification=qualification,
        score=score,
        reasons=[f"{qualification} on available evidence"],
    )


def _fake_discovery(result: TieredShortlistResult):
    def execute_discovery(self, **kwargs):
        callback = kwargs.get("progress_callback")
        if callback:
            callback("query_generated", "Generating discovery queries: caterers in Delhi", {"queries": ["caterers in Delhi"]}, 1)
            callback("batch_scraped", "3 candidates discovered from directory/scraper", {"scraped_count": 3}, 1)
        return result
    return execute_discovery


def _types(events: List[dict]) -> List[str]:
    return [e["type"] for e in events]


def _snapshot(client: TestClient, event_id: str, user_id: str):
    res = client.get(f"/api/events/{event_id}/agent/runs/current", headers={"x-user-id": user_id})
    assert res.status_code == 200, res.text
    return res.json()


def test_agent_button_run_streams_real_venue_and_provider_progress(
    test_client, db_session, ops_data, worker_uses_test_db, two_categories, monkeypatch
):
    event, _, owner, _ = ops_data
    db_session.add_all([
        Venue(name="Grand Hall", city="Delhi", capacity=150, venue_type="BANQUET", hourly_rate=8000.0),
        Venue(name="Tiny Room", city="Delhi", capacity=90, venue_type="MEETING_ROOM"),
    ])
    db_session.commit()
    monkeypatch.setattr(
        AgenticDiscoveryController,
        "execute_discovery",
        _fake_discovery(TieredShortlistResult(
            top_matches=[_ranked("Spice Caterers", "qualified", 0.91, rating=4.2)],
            other_available_options=[_ranked("Unverified Kitchen", "uncertain", 0.62)],
            rejected_candidates=[_ranked("Closed Cafe", "rejected", 0.1)],
            funnel_stats=FunnelTransparencyStats(discovered=3, unique=3),
        )),
    )

    res = test_client.post(f"/api/events/{event.id}/start-operations", headers={"x-user-id": owner.id})
    assert res.status_code == 200, res.text
    run_id = res.json()["run_id"]
    assert res.json()["status"] == "STARTED"

    snap = _snapshot(test_client, event.id, owner.id)
    assert snap["run"]["run_id"] == run_id
    # Waiting on the organizer is not a completed success.
    assert snap["run"]["status"] == "WAITING_FOR_USER_SELECTION"
    events = snap["events"]
    types = _types(events)

    assert [e["sequence"] for e in events] == list(range(1, len(events) + 1))
    assert snap["last_sequence"] == len(events)
    assert types[0] == "agent.run_started"
    assert types[-1] == "selection.required"
    assert "agent.run_completed" not in types

    # Venue discovery happens before provider discovery, with real tool boundaries.
    venue_start = types.index("venue.discovery_started")
    venue_results = types.index("venue.results_updated")
    provider_start = types.index("provider.discovery_started")
    assert venue_start < venue_results < provider_start
    assert types[venue_start + 1:venue_start + 3] == ["agent.tool_started", "agent.tool_completed"]

    venue_payload = events[venue_results]["data"]
    assert venue_payload["status"] == "COMPLETED"
    names = [c["name"] for c in venue_payload["candidates"]]
    assert "Grand Hall" in names
    assert all(c["source"] for c in venue_payload["candidates"])
    assert all(c["shortlist_entry_id"] for c in venue_payload["candidates"])

    progress = [e for e in events if e["type"] == "provider.discovery_progress"]
    assert [p["data"]["milestone"] for p in progress] == ["query_generated", "batch_scraped"]

    provider_payload = next(e for e in events if e["type"] == "provider.results_updated")["data"]
    assert provider_payload["category"] == "CATERING"
    assert provider_payload["counts"]["qualified"] == 1
    assert provider_payload["counts"]["pending_verification"] == 1
    assert provider_payload["counts"]["rejected"] == 1
    by_name = {c["name"]: c for c in provider_payload["candidates"]}
    assert by_name["Spice Caterers"]["qualification"] == "qualified"
    assert by_name["Unverified Kitchen"]["qualification"] == "pending_verification"

    # Persisted business state is authoritative and linked back to the run.
    entries = db_session.query(EventShortlistEntry).filter(EventShortlistEntry.event_id == event.id).all()
    assert entries and all(e.candidate_data.get("agent_run_id") == run_id for e in entries)
    # Ratings are never invented for providers that did not report one.
    assert db_session.query(Vendor).filter(Vendor.name == "Unverified Kitchen").one().rating is None
    assert db_session.query(Vendor).filter(Vendor.name == "Spice Caterers").one().rating == 4.2


def test_start_operations_is_idempotent_while_run_executes(test_client, db_session, ops_data, monkeypatch):
    event, _, owner, _ = ops_data
    calls = []
    monkeypatch.setattr(
        AutonomousOperationsService, "run_background_operations",
        classmethod(lambda cls, **kwargs: calls.append(kwargs)),
    )

    first = test_client.post(f"/api/events/{event.id}/start-operations", headers={"x-user-id": owner.id})
    second = test_client.post(f"/api/events/{event.id}/start-operations", headers={"x-user-id": owner.id})

    assert first.json()["status"] == "STARTED"
    assert second.json()["status"] == "ALREADY_RUNNING"
    assert second.json()["run_id"] == first.json()["run_id"]
    assert len(calls) == 1
    assert db_session.query(AgentRun).filter(AgentRun.event_id == event.id).count() == 1


def test_empty_discovery_reports_empty_states(
    test_client, db_session, ops_data, worker_uses_test_db, two_categories, monkeypatch
):
    event, _, owner, _ = ops_data
    monkeypatch.setattr(
        AgenticDiscoveryController, "execute_discovery", _fake_discovery(TieredShortlistResult()),
    )
    monkeypatch.setattr(
        AutonomousOperationsService, "__init__",
        _wrap_init_with_empty_cache(AutonomousOperationsService.__init__),
    )

    run_id = test_client.post(f"/api/events/{event.id}/start-operations", headers={"x-user-id": owner.id}).json()["run_id"]
    events = _snapshot(test_client, event.id, owner.id)["events"]

    venue = next(e for e in events if e["type"] == "venue.results_updated")["data"]
    provider = next(e for e in events if e["type"] == "provider.results_updated")["data"]
    assert venue["status"] == "EMPTY" and venue["candidates"] == []
    assert provider["status"] == "EMPTY" and provider["candidates"] == []
    final = events[-1]
    assert final["type"] == "selection.required"
    assert {c["status"] for c in final["data"]["categories"]} == {"NO_CANDIDATES_FOUND"}
    assert final["run_id"] == run_id


def _wrap_init_with_empty_cache(original_init):
    def init(self, db):
        original_init(self, db)
        self._vendor_service.get_cached_candidates = lambda **kwargs: []
    return init


def test_discovery_failure_marks_run_failed_not_waiting(
    test_client, db_session, ops_data, worker_uses_test_db, two_categories, monkeypatch
):
    event, _, owner, _ = ops_data

    def boom(self, **kwargs):
        raise RuntimeError("scraper unavailable")

    monkeypatch.setattr(AgenticDiscoveryController, "execute_discovery", boom)

    test_client.post(f"/api/events/{event.id}/start-operations", headers={"x-user-id": owner.id})
    snap = _snapshot(test_client, event.id, owner.id)

    assert snap["run"]["status"] == "FAILED"
    types = _types(snap["events"])
    assert types[-1] == "agent.run_failed"
    assert types.count("agent.run_failed") == 1
    assert "selection.required" not in types
    failed_tool = [e for e in snap["events"] if e["type"] == "agent.tool_completed" and e["data"]["status"] == "FAILED"]
    assert failed_tool and failed_tool[0]["data"]["tool"] == "agentic_provider_discovery"
    assert "scraper unavailable" in snap["events"][-1]["data"]["error"]


def test_cancel_stops_run_at_next_boundary(test_client, db_session, ops_data, worker_uses_test_db, two_categories, monkeypatch):
    event, _, owner, _ = ops_data
    monkeypatch.setattr(
        AutonomousOperationsService, "run_background_operations", classmethod(lambda cls, **kwargs: None),
    )
    run_id = test_client.post(f"/api/events/{event.id}/start-operations", headers={"x-user-id": owner.id}).json()["run_id"]

    cancel = test_client.post(f"/api/events/{event.id}/agent/runs/{run_id}/cancel", headers={"x-user-id": owner.id})
    assert cancel.status_code == 200
    assert cancel.json()["status"] == "CANCELLING"

    # The worker now picks the run up and must stop before doing any discovery.
    monkeypatch.undo()
    monkeypatch.setattr(db_session_module, "SessionLocal", lambda: _SharedSession(db_session))
    AutonomousOperationsService.run_background_operations(event_id=event.id, run_id=run_id, user_id=owner.id)

    snap = _snapshot(test_client, event.id, owner.id)
    assert snap["run"]["status"] == "CANCELLED"
    types = _types(snap["events"])
    assert types == ["agent.run_started", "agent.cancel_requested", "agent.run_cancelled"]

    again = test_client.post(f"/api/events/{event.id}/agent/runs/{run_id}/cancel", headers={"x-user-id": owner.id})
    assert again.status_code == 409


def _record_sample_run(db_session, event, user_id, n_progress=3, terminal="agent.run_failed"):
    run = AgentRun(run_id="RUN-REPLAY1", event_id=event.id, user_id=user_id, status="FAILED", started_at=utc_now())
    db_session.add(run)
    db_session.commit()
    recorder = AgentRunEventRecorder(db_session)
    recorder.record(run.run_id, event.id, "agent.run_started", {"status": "RUNNING"})
    for i in range(n_progress):
        recorder.record(run.run_id, event.id, "agent.phase_changed", {"phase": f"P{i}"})
    recorder.record(run.run_id, event.id, terminal, {"status": "FAILED", "error": "x"})
    return run


def _parse_sse(body: str):
    frames = []
    for block in body.strip().split("\n\n"):
        fields = {}
        for line in block.split("\n"):
            if line.startswith(":") or ":" not in line:
                continue
            key, value = line.split(":", 1)
            fields[key] = value.strip()
        if fields:
            frames.append(fields)
    return frames


def test_replay_from_cursor_via_json_and_sse(test_client, db_session, ops_data):
    event, _, owner, _ = ops_data
    run = _record_sample_run(db_session, event, owner.id)

    page = test_client.get(
        f"/api/events/{event.id}/agent/runs/{run.run_id}/events?after=2", headers={"x-user-id": owner.id},
    ).json()
    assert [i["sequence"] for i in page["items"]] == [3, 4, 5]
    assert page["last_sequence"] == 5

    # Reconnect with Last-Event-ID: only missed events are replayed, then the
    # stream closes because the run is terminal.
    res = test_client.get(
        f"/api/events/{event.id}/agent/runs/{run.run_id}/stream",
        headers={"x-user-id": owner.id, "Last-Event-ID": f"{run.run_id}:3"},
    )
    assert res.status_code == 200
    assert res.headers["content-type"].startswith("text/event-stream")
    frames = _parse_sse(res.text)
    assert frames[0]["event"] == "connected"
    run_frames = frames[1:]
    assert [f["id"] for f in run_frames] == [f"{run.run_id}:4", f"{run.run_id}:5"]
    assert run_frames[-1]["event"] == "agent.run_failed"
    assert json.loads(run_frames[-1]["data"])["sequence"] == 5


def test_run_endpoints_enforce_event_access_and_isolation(test_client, db_session, ops_data):
    event, other_event, owner, intruder = ops_data
    run = _record_sample_run(db_session, event, owner.id)
    base = f"/api/events/{event.id}/agent/runs"
    intruder_headers = {"x-user-id": intruder.id}

    assert test_client.get(f"{base}/current", headers=intruder_headers).status_code == 403
    assert test_client.get(f"{base}/{run.run_id}/events", headers=intruder_headers).status_code == 403
    assert test_client.get(f"{base}/{run.run_id}/stream", headers=intruder_headers).status_code == 403
    assert test_client.post(f"{base}/{run.run_id}/cancel", headers=intruder_headers).status_code == 403
    assert test_client.post(f"/api/events/{event.id}/start-operations", headers=intruder_headers).status_code == 403

    # A run is never reachable through another event's URL, even for that event's owner.
    cross = test_client.get(
        f"/api/events/{other_event.id}/agent/runs/{run.run_id}/events", headers=intruder_headers,
    )
    assert cross.status_code == 404
    assert _snapshot(test_client, other_event.id, intruder.id)["run"] is None


def test_orphaned_executing_runs_are_failed_on_startup(db_session, ops_data):
    event, _, owner, _ = ops_data
    db_session.add_all([
        AgentRun(run_id="RUN-ORPHAN1", event_id=event.id, user_id=owner.id, status="DISCOVERING", started_at=utc_now()),
        AgentRun(run_id="RUN-ORPHAN2", event_id=event.id, user_id=owner.id, status="CANCELLING", started_at=utc_now()),
        AgentRun(run_id="RUN-DONE1", event_id=event.id, user_id=owner.id, status="WAITING_FOR_USER_SELECTION", started_at=utc_now()),
    ])
    db_session.commit()

    assert fail_orphaned_runs(db_session) == 2

    statuses = {r.run_id: r.status for r in db_session.query(AgentRun).all()}
    assert statuses == {"RUN-ORPHAN1": "FAILED", "RUN-ORPHAN2": "CANCELLED", "RUN-DONE1": "WAITING_FOR_USER_SELECTION"}
    terminal = {e.run_id: e.type for e in db_session.query(AgentRunEvent).all()}
    assert terminal == {"RUN-ORPHAN1": "agent.run_failed", "RUN-ORPHAN2": "agent.run_cancelled"}
