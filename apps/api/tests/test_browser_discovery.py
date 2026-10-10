"""Unit and Integration Tests for Browser Agent Venue & Vendor Discovery (Phase 3)."""

import asyncio
import uuid
from unittest.mock import AsyncMock, MagicMock, patch
import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.db.base import Base
from app.models.event import Event
from app.models.vendor import Vendor
from app.schemas.browser_agent import AgentEventType, ExecutionStatus
from app.schemas.browser_discovery import (
    BrowserDiscoveryRequest,
    DiscoveredCandidate,
    EventSearchRequirements,
)
from app.services.browser_agent_service import BrowserAgentService, ExecutionRecord
from app.services.browser_discovery_service import (
    BrowserDiscoveryService,
    sanitize_untrusted_text,
)
from app.services.browser_runtime_service import BrowserRuntimeService
from app.services.deduplication import ProviderDeduplicator
from app.services.discovery_qualification_engine import QualificationEngine


@pytest.fixture
def in_memory_db():
    """Provides an isolated SQLite in-memory database for testing."""
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    SessionLocal = sessionmaker(bind=engine)
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def mock_runtime():
    """Mock for BrowserRuntimeService."""
    runtime = MagicMock(spec=BrowserRuntimeService)
    runtime.search_discovery = AsyncMock()
    runtime.inspect_url = AsyncMock()
    runtime.get_page_content = AsyncMock()
    return runtime


@pytest.fixture
def mock_agent_service():
    """Mock BrowserAgentService with an active test execution."""
    svc = BrowserAgentService()
    record = ExecutionRecord(
        execution_id="exec_test_phase3",
        user_id="test_user",
        event_id="wedding_demo",
    )
    record.session_id = "sess_test_phase3"
    record.status = ExecutionStatus.RUNNING
    record.viewer_url = "http://localhost:6080/vnc.html"
    svc._executions["exec_test_phase3"] = record
    return svc


# --- 1. Event Requirements Extraction ---


def test_load_event_requirements_from_demo_events():
    service = BrowserDiscoveryService()
    reqs = service.load_event_requirements("wedding_demo", category="CATERING")

    assert reqs.event_id == "wedding_demo"
    assert reqs.city == "San Francisco"
    assert reqs.category == "CATERING"
    assert reqs.guest_count == 150
    assert reqs.budget == 25000.0


def test_load_event_requirements_from_db(in_memory_db):
    event = Event(
        id="db_event_1",
        name="Annual Gala 2026",
        event_type="GALA",
        location="Chicago, IL",
        guest_count=200,
        total_budget=35000.0,
    )
    in_memory_db.add(event)
    in_memory_db.commit()

    service = BrowserDiscoveryService()
    reqs = service.load_event_requirements("db_event_1", db=in_memory_db, category="VENUE")

    assert reqs.event_id == "db_event_1"
    assert reqs.event_name == "Annual Gala 2026"
    assert reqs.city == "Chicago"
    assert reqs.category == "VENUE"
    assert reqs.guest_count == 200
    assert reqs.budget == 35000.0


def test_load_event_requirements_missing_location_raises_400(in_memory_db):
    event = Event(
        id="db_event_no_loc",
        name="Mystery Gathering",
        event_type="MEETING",
        location="",  # Empty location
    )
    in_memory_db.add(event)
    in_memory_db.commit()

    service = BrowserDiscoveryService()
    with pytest.raises(HTTPException) as exc_info:
        service.load_event_requirements("db_event_no_loc", db=in_memory_db)

    assert exc_info.value.status_code == 400
    assert "lacks a usable location" in exc_info.value.detail


def test_load_event_requirements_nonexistent_event_raises_404():
    service = BrowserDiscoveryService()
    with pytest.raises(HTTPException) as exc_info:
        service.load_event_requirements("nonexistent_event_999")

    assert exc_info.value.status_code == 404


# --- 2. Query Construction ---


def test_build_search_query_construction():
    service = BrowserDiscoveryService()
    reqs = EventSearchRequirements(
        event_id="e1",
        event_name="Wedding",
        event_type="WEDDING",
        category="CATERING",
        location="San Francisco, CA",
        city="San Francisco",
    )
    query = service.build_search_query(reqs)
    assert query == "Catering in San Francisco"

    venue_reqs = EventSearchRequirements(
        event_id="e2",
        event_name="Reception",
        event_type="WEDDING",
        category="VENUE",
        location="Seattle, WA",
        city="Seattle",
    )
    query_venue = service.build_search_query(venue_reqs)
    assert query_venue == "Venue venues in Seattle" or "Venues in Seattle" in query_venue


def test_build_search_query_custom_override():
    service = BrowserDiscoveryService()
    reqs = EventSearchRequirements(
        event_id="e1",
        event_name="Wedding",
        event_type="WEDDING",
        category="CATERING",
        location="San Francisco, CA",
        city="San Francisco",
    )
    custom = "Luxury organic caterers near Mission District"
    query = service.build_search_query(reqs, custom_query=custom)
    assert query == custom


# --- 3. Prompt Injection and Untrusted Content Sanitization ---


def test_sanitize_untrusted_text():
    dirty = "   SF &amp; Beyond Catering <script>alert(1)</script>\x00 \n  "
    cleaned = sanitize_untrusted_text(dirty)
    assert "\x00" not in cleaned
    assert "&amp;" not in cleaned
    assert "SF & Beyond Catering <script>alert(1)</script>" in cleaned
    assert not cleaned.startswith(" ")


# --- 4. Candidate Normalization, Provenance, and Qualification ---


def test_normalize_and_qualify_evidence_retention():
    service = BrowserDiscoveryService()
    reqs = EventSearchRequirements(
        event_id="wedding_demo",
        event_name="Demo Wedding",
        event_type="WEDDING",
        category="CATERING",
        location="San Francisco, CA",
        city="San Francisco",
        guest_count=100,
        budget=20000.0,
    )

    raw_items = [
        {
            "name": "Golden Gate Catering Co",
            "address": "123 Market St, San Francisco, CA",
            "phone": "+1 415-555-0199",
            "website": "https://goldengatecatering.example.com",
            "maps_url": "https://www.google.com/maps/place/Golden+Gate+Catering",
            "rating": 4.8,
            "review_count": 120,
            "latitude": 37.7749,
            "longitude": -122.4194,
            "raw_category": "Catering food service",
            "source": "BROWSER_AGENT",
        }
    ]

    results = service.normalize_and_qualify(raw_items, reqs)
    assert len(results) == 1
    norm_p, candidate = results[0]

    # Provenance checks
    assert candidate.name == "Golden Gate Catering Co"
    assert candidate.category == "CATERING"
    assert candidate.source == "BROWSER_AGENT"
    assert candidate.phone == "+1 415-555-0199"
    assert candidate.website == "https://goldengatecatering.example.com"
    assert candidate.rating == 4.8
    assert candidate.review_count == 120
    assert candidate.base_cost is None  # Not fabricated!
    assert candidate.capacity is None   # Not fabricated!
    assert candidate.field_sources["phone"] == "google_maps_place_details"
    assert candidate.field_sources["website"] == "google_maps_place_details"
    assert candidate.qualification_status == "qualified"
    assert len(candidate.evidence) >= 4


def test_institution_disqualification():
    service = BrowserDiscoveryService()
    reqs = EventSearchRequirements(
        event_id="wedding_demo",
        event_name="Demo Wedding",
        event_type="WEDDING",
        category="CATERING",
        location="Boston, MA",
        city="Boston",
    )

    raw_items = [
        {
            "name": "State University Catering Institute",
            "address": "100 College Ave, Boston, MA",
            "phone": "617-555-1234",
            "raw_category": "Degree College Training Center",
        }
    ]

    results = service.normalize_and_qualify(raw_items, reqs)
    assert len(results) == 1
    _, candidate = results[0]
    assert candidate.qualification_status == "rejected"
    assert any("institution" in r.lower() or "non-commercial" in r.lower() for r in candidate.qualification_reasons)


# --- 5. Deduplication and Persistence ---


def test_duplicate_prevention_on_persistence(in_memory_db):
    deduplicator = ProviderDeduplicator(in_memory_db)

    # 1. First insert
    from app.integrations.google_maps_scraper.models import NormalizedProvider
    p1 = NormalizedProvider(
        name="Mission Feast Catering",
        category="CATERING",
        city="San Francisco",
        phone="415-888-9999",
        website="https://missionfeast.com",
        maps_url="https://google.com/maps?cid=12345",
        source="BROWSER_AGENT",
    )
    v1, created1 = deduplicator.upsert_provider(p1, commit=True)
    assert created1 is True
    assert v1.id is not None

    # 2. Duplicate second insert matching domain and phone
    p2 = NormalizedProvider(
        name="Mission Feast Catering LLC",
        category="CATERING",
        city="San Francisco",
        phone="415-888-9999",
        website="https://www.missionfeast.com/about",
        maps_url="https://google.com/maps?cid=12345",
        rating=4.9,
        source="BROWSER_AGENT",
    )
    v2, created2 = deduplicator.upsert_provider(p2, commit=True)
    assert created2 is False
    assert v2.id == v1.id
    assert v2.rating == 4.9

    total_vendors = in_memory_db.query(Vendor).count()
    assert total_vendors == 1  # Deduplicated!


# --- 6. End-to-End Orchestrated Discovery Workflow with Live Events ---


@pytest.mark.asyncio
async def test_discover_workflow_execution(mock_agent_service, mock_runtime, in_memory_db):
    mock_runtime.search_discovery.return_value = {
        "status": "success",
        "current_url": "https://www.google.com/maps/search/catering+in+San+Francisco",
        "current_title": "Catering in San Francisco - Google Maps",
        "count": 2,
        "results": [
            {
                "name": "Bespoke Bites Catering",
                "address": "456 Castro St, San Francisco, CA",
                "phone": "+1 415-777-1234",
                "website": "https://bespokebites.com",
                "maps_url": "https://google.com/maps/place/Bespoke+Bites",
                "rating": 4.9,
                "review_count": 85,
                "raw_category": "Caterer",
                "source": "BROWSER_AGENT",
            },
            {
                "name": "City Hall Municipal Canteen",  # Disqualified entity
                "address": "1 Dr Carlton B Goodlett Pl, San Francisco, CA",
                "phone": "+1 415-554-4000",
                "raw_category": "Government Office",
                "source": "BROWSER_AGENT",
            },
        ],
    }

    discovery_service = BrowserDiscoveryService(
        agent_service=mock_agent_service,
        runtime_service=mock_runtime,
    )

    request = BrowserDiscoveryRequest(
        event_id="wedding_demo",
        category="CATERING",
        max_results=5,
        persist_results=True,
    )

    response = await discovery_service.discover(
        execution_id="exec_test_phase3",
        request=request,
        db=in_memory_db,
        user_id="test_user",
    )

    assert response.status == "completed"
    assert response.total_found == 2
    assert response.total_qualified == 1
    assert response.total_persisted == 1
    assert len(response.candidates) == 2

    # Check candidates
    cand1 = response.candidates[0]
    assert cand1.name == "Bespoke Bites Catering"
    assert cand1.is_persisted is True
    assert cand1.vendor_id is not None
    assert cand1.qualification_status == "qualified"

    cand2 = response.candidates[1]
    assert cand2.name == "City Hall Municipal Canteen"
    assert cand2.is_persisted is False
    assert cand2.qualification_status == "rejected"

    # Verify event sequence emitted
    record = mock_agent_service._executions["exec_test_phase3"]
    event_types = [e.event_type for e in record.event_history]
    assert AgentEventType.DISCOVERY_STARTED.value in event_types
    assert AgentEventType.DISCOVERY_REQUIREMENTS_LOADED.value in event_types
    assert AgentEventType.DISCOVERY_SEARCH_STARTED.value in event_types
    assert AgentEventType.DISCOVERY_PAGE_OPENED.value in event_types
    assert AgentEventType.DISCOVERY_CANDIDATE_FOUND.value in event_types
    assert AgentEventType.DISCOVERY_CANDIDATE_VALIDATED.value in event_types
    assert AgentEventType.DISCOVERY_CANDIDATE_REJECTED.value in event_types
    assert AgentEventType.DISCOVERY_PERSISTENCE_COMPLETED.value in event_types
    assert AgentEventType.DISCOVERY_COMPLETED.value in event_types


# --- 7. Cancellation Safety ---


@pytest.mark.asyncio
async def test_cancellation_during_discovery_prevents_persistence(mock_agent_service, mock_runtime, in_memory_db):
    record = mock_agent_service._executions["exec_test_phase3"]
    # Mark execution as cancelled
    record.status = ExecutionStatus.CANCELLED

    discovery_service = BrowserDiscoveryService(
        agent_service=mock_agent_service,
        runtime_service=mock_runtime,
    )

    request = BrowserDiscoveryRequest(
        event_id="wedding_demo",
        category="CATERING",
        persist_results=True,
    )

    # Calling discover on cancelled execution should cleanly reject or abort
    with pytest.raises(HTTPException) as exc_info:
        await discovery_service.discover(
            execution_id="exec_test_phase3",
            request=request,
            db=in_memory_db,
            user_id="test_user",
        )

    assert exc_info.value.status_code == 409
    assert in_memory_db.query(Vendor).count() == 0  # Zero records persisted!


# --- 8. Real Browser Container Live Discovery Integration Test ---


@pytest.mark.asyncio
async def test_live_container_maps_discovery_integration():
    """Live integration test against running container (port 9223).
    
    Skips cleanly if container is not running.
    """
    import httpx

    runtime_url = "http://localhost:9223"
    async with httpx.AsyncClient(timeout=3) as client:
        try:
            resp = await client.get(f"{runtime_url}/health")
            if resp.status_code != 200:
                pytest.skip("Browser runtime container not reachable at localhost:9223.")
        except Exception:
            pytest.skip("Browser runtime container not reachable at localhost:9223.")

    real_runtime = BrowserRuntimeService(base_url=runtime_url)
    session_id = f"test_live_disc_{uuid.uuid4().hex[:8]}"

    # Start live browser session
    started = await real_runtime.start_session(session_id=session_id, force=True)
    assert started.status == "running"

    try:
        # Perform real Google Maps search on virtual display :99
        search_res = await real_runtime.search_discovery(
            session_id=session_id,
            query="Catering in San Francisco",
            max_results=3,
            category="CATERING",
            inspect_details=True,
            timeout_ms=30000,
        )

        assert search_res.get("status") in ("success", "blocked")
        if search_res.get("status") == "success":
            results = search_res.get("results", [])
            assert len(results) > 0
            first = results[0]
            assert "name" in first and len(first["name"]) > 0
            assert "maps_url" in first
            assert first["source"] == "BROWSER_AGENT"
    finally:
        await real_runtime.stop_session(session_id=session_id)
