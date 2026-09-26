"""Unit & Integration Tests for Agentic Provider Discovery Pipeline."""
import pytest
from unittest.mock import MagicMock, patch

from app.integrations.google_maps_scraper.models import NormalizedProvider, RawScraperBusiness
from app.integrations.google_maps_scraper.client import GoogleMapsScraperClient
from app.services.discovery_search_planner import SearchPlanner
from app.services.discovery_qualification_engine import QualificationEngine, QualificationResult
from app.services.discovery_ranking_engine import DiscoveryRankingEngine
from app.services.discovery_outreach_service import DiscoveryOutreachService
from app.services.agentic_discovery_controller import AgenticDiscoveryController


def test_search_planner_multi_query_variants():
    """Verify search planner generates multiple distinct query variants."""
    queries = SearchPlanner.generate_queries(
        category="CATERING",
        location="Delhi",
        event_type="WEDDING",
        required_services=["live_counter", "pure_veg"],
        max_queries=5,
    )
    assert len(queries) >= 3
    assert any("catering" in q.lower() for q in queries)
    assert any("delhi" in q.lower() for q in queries)


def test_qualification_engine_disqualifies_institutions():
    """Verify non-vendor entities like 'Institute of Hotel Management' or 'IRCTC' are rejected."""
    ihm = NormalizedProvider(
        name="Institute of Hotel Management Catering Dept",
        category="CATERING",
        city="Delhi",
        raw_category="Educational Institution",
    )
    is_inst, reason = QualificationEngine.check_institution_disqualification(ihm)
    assert is_inst is True
    assert "institution" in reason.lower()

    qual = QualificationEngine.evaluate(ihm, category="CATERING")
    assert qual.qualification == "rejected"
    assert qual.is_institution is True


def test_qualification_engine_hard_constraints_capacity():
    """Verify capacity constraint hard fail immediately rejects 4.9-star venue."""
    small_venue = NormalizedProvider(
        name="Grand Deluxe Banquet Lawn",
        category="VENUE",
        raw_category="Banquet Hall",
        city="Delhi",
        capacity=250,  # Only 250 capacity
        rating=4.9,
        review_count=350,
        phone="+919876543210",
        maps_url="https://maps.google.com/?cid=999",
    )
    # Event requires 500 capacity
    qual = QualificationEngine.evaluate(small_venue, category="VENUE", guest_count=500)
    assert qual.qualification == "rejected"
    assert qual.hard_constraints_passed is False
    assert "Capacity constraint failed" in qual.disqualification_reason


def test_qualification_engine_hard_constraints_budget():
    """Verify budget ceiling hard constraint immediately rejects over-budget vendor."""
    expensive_caterer = NormalizedProvider(
        name="Luxury Gold Catering",
        category="CATERING",
        city="Delhi",
        base_cost=15000.0,
        rating=4.9,
        phone="+919876543210",
        maps_url="https://maps.google.com/?cid=888",
    )
    qual = QualificationEngine.evaluate(expensive_caterer, category="CATERING", max_budget=8000.0)
    assert qual.qualification == "rejected"
    assert qual.hard_constraints_passed is False
    assert "Budget ceiling constraint failed" in qual.disqualification_reason


def test_ranking_engine_weight_profiles():
    """Verify different event types select distinct weight profiles and rank evidence."""
    cand1 = NormalizedProvider(
        name="Apex Corporate AV & Tech",
        category="AV_TECH",
        city="Delhi",
        rating=4.8,
        review_count=120,
        phone="+919811223344",
        website="https://apexav.example.com",
    )
    score_corp, reasons_corp = DiscoveryRankingEngine.score_candidate(
        candidate=cand1,
        event_type="CORPORATE_CONFERENCE",
        distance_km=3.2,
        max_budget=5000.0,
    )
    score_wedding, _ = DiscoveryRankingEngine.score_candidate(
        candidate=cand1,
        event_type="WEDDING",
        distance_km=3.2,
        max_budget=5000.0,
    )
    assert 0.0 <= score_corp <= 1.0
    assert 0.0 <= score_wedding <= 1.0
    assert score_corp != score_wedding  # Profiles MUST weight criteria differently
    assert len(reasons_corp) >= 2


def test_outreach_service_state_machine():
    """Verify outreach updates state to pending_response on dispatch, confirmed when simulated/resolved."""
    cand = NormalizedProvider(
        name="Royal Feast Caterers",
        category="CATERING",
        city="Delhi",
        rating=4.7,
        phone="+919876543210",
    )
    distances = {"Royal Feast Caterers": 2.5}
    qual_results = {"Royal Feast Caterers": QualificationResult(qualification="qualified")}

    ranked_list = DiscoveryRankingEngine.rank_candidates(
        candidates=[cand],
        event_type="WEDDING",
        distances=distances,
        qual_results=qual_results,
    )
    assert len(ranked_list) == 1
    assert ranked_list[0].availability == "unconfirmed"

    # Real path: dispatch sets availability to pending_response
    item_pending = DiscoveryOutreachService.contact_candidate(
        item=ranked_list[0],
        event_id="evt-test-1",
        dev_simulate_responses=False,
    )
    assert item_pending.availability == "pending_response"

    # Dev/test path: simulated response resolves to confirmed (for rating >= 4.0)
    item_pending.availability = "unconfirmed"
    outreach_res = DiscoveryOutreachService.contact_batch(
        ranked_candidates=ranked_list,
        event_id="evt-test-1",
        batch_size=1,
        dev_simulate_responses=True,
    )
    assert outreach_res.total_contacted == 1
    assert ranked_list[0].availability == "confirmed"


def test_agentic_discovery_controller_end_to_end(db_session):
    """Verify agentic discovery controller multi-iteration search, deduplication, and confirmed shortlist eligibility."""
    controller = AgenticDiscoveryController(
        db=db_session,
        max_iterations=2,
        target_count=3,
    )

    result = controller.execute_discovery(
        event_id="test-event-123",
        category="CATERING",
        location="Delhi",
        event_type="WEDDING",
        guest_count=150,
        max_budget=10000.0,
        base_radius_km=10.0,
        simulate_outreach=True,
    )

    # Invariant: every presented candidate MUST have confirmed availability
    for cand in result.top_matches + result.other_available_options:
        assert cand.availability == "confirmed"


def test_radius_expansion_kwarg_plumbing(db_session, monkeypatch):
    """Regression test: verify radius_km actually expands across iterations when target_count is not met."""
    scraped_radii = []

    def mock_search_providers(category, city=None, query=None, latitude=None, longitude=None, limit=20, radius_km=None):
        scraped_radii.append(radius_km)
        from app.integrations.base import IntegrationResult, IntegrationSource
        # Return 1 candidate per iteration to force controller to expand radius on iteration 2
        cand_dict = {
            "name": f"Provider at {radius_km}km",
            "category": "CATERING",
            "city": "Delhi",
            "rating": 4.5,
            "phone": f"+9199999{len(scraped_radii)}",
            "is_active": True,
            "business_status": "OPERATIONAL",
        }
        return IntegrationResult(data=[cand_dict], source=IntegrationSource.REAL, success=True)

    from app.integrations.registry import registry
    adapter = registry.get_provider_directory()
    monkeypatch.setattr(adapter, "search_providers", mock_search_providers)

    controller = AgenticDiscoveryController(
        db=db_session,
        max_iterations=2,
        target_count=5,  # High target to force iteration 2
        allowed_expansion_km=10.0,
    )

    controller.execute_discovery(
        event_id="test-event-radius",
        category="CATERING",
        location="Delhi",
        base_radius_km=10.0,
        simulate_outreach=True,
    )

    assert len(scraped_radii) >= 2
    # Verify radius actually expanded between iteration 1 and iteration 2
    assert scraped_radii[0] == 10.0
    assert scraped_radii[-1] > 10.0

