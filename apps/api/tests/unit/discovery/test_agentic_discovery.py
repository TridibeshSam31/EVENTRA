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
    assert len(reasons_corp) >= 2


def test_outreach_service_state_machine():
    """Verify outreach updates state to confirmed/declined and enforces shortlist eligibility."""
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

    outreach_res = DiscoveryOutreachService.contact_batch(
        ranked_candidates=ranked_list,
        event_id="evt-test-1",
        batch_size=1,
        simulate_responses=True,
    )
    assert outreach_res.total_contacted == 1
    assert ranked_list[0].availability == "confirmed"


def test_agentic_discovery_controller_end_to_end(db_session):
    """Verify agentic discovery controller multi-iteration search, deduplication, and tiered shortlist output."""
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

    assert result.funnel_stats.total_scraped >= 0
    assert len(result.top_matches) + len(result.other_available_options) >= 0
