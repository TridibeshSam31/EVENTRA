"""Tests: government/institution filtering and ranking/recommendation in browser discovery."""
import pytest

from app.core.institution_filter import find_institution_marker
from app.integrations.google_maps_scraper.mapper import ProviderNormalizer
from app.integrations.google_maps_scraper.models import NormalizedProvider
from app.services.browser_discovery_service import BrowserDiscoveryService
from app.services.discovery_qualification_engine import QualificationEngine
from app.schemas.browser_discovery import EventSearchRequirements


@pytest.mark.parametrize(
    "name",
    [
        "Bharat Mandapam",
        "ITPO Exhibition Hall 5",
        "Pragati Maidan Convention Centre",
        "Delhi Development Authority Community Hall",
        "SAIL Guest House",
        "IHM Pusa Catering",
        "Government Girls College Auditorium",
        "Ministry of Tourism Conference Hall",
    ],
)
def test_government_and_institution_names_are_flagged(name):
    assert find_institution_marker(name) is not None


@pytest.mark.parametrize(
    "name",
    [
        "Grill House",          # contains "ril"
        "Brilliant Banquets",   # contains "ril"
        "Unity Caterers",       # contains "nit"
        "Bhel Puri House",      # ordinary word, not the PSU
        "Sail Boat Cafe",
        "The Leela Palace",
        "Taj Palace",
        "Event Corporation Pvt Ltd",
    ],
)
def test_legitimate_businesses_are_not_flagged(name):
    assert find_institution_marker(name) is None


def test_government_website_domain_is_flagged():
    assert find_institution_marker("Community Hall", "https://hall.nic.in/booking") is not None
    assert find_institution_marker("Community Hall", "https://someplace.edu.in") is not None
    assert find_institution_marker("Community Hall", "https://communityhall.com") is None


def test_extra_denylist_env(monkeypatch):
    monkeypatch.setenv("DISCOVERY_EXTRA_DENYLIST", "dharamshala, my local trust")
    assert find_institution_marker("Shri Ram Dharamshala Hall") is not None
    monkeypatch.delenv("DISCOVERY_EXTRA_DENYLIST")
    assert find_institution_marker("Shri Ram Dharamshala Hall") is None


def test_mapper_and_qualification_engine_agree():
    assert ProviderNormalizer.is_non_commercial_entity("Bharat Mandapam", "Convention center", "VENUE")
    assert not ProviderNormalizer.is_non_commercial_entity("Grill House", "Restaurant", "CATERING")

    venue = NormalizedProvider(
        name="Bharat Mandapam",
        raw_category="Convention center",
        phone="011-12345678",
        city="Delhi",
    )
    qual = QualificationEngine.evaluate(candidate=venue, category="VENUE")
    assert qual.qualification == "rejected"
    assert qual.is_institution is True


def _reqs():
    return EventSearchRequirements(
        event_id="demo",
        event_name="Demo",
        event_type="WEDDING",
        category="VENUE",
        location="Delhi",
        city="Delhi",
    )


def test_ranking_orders_recommends_and_pushes_rejected_last():
    service = BrowserDiscoveryService()
    raw_items = [
        {"name": "Bharat Mandapam", "phone": "011-1111111", "rating": 4.9, "review_count": 5000,
         "maps_url": "https://maps/bm", "raw_category": "Convention center"},
        {"name": "No Phone Banquet", "rating": 4.8, "review_count": 400,
         "website": "https://nophone.example.com", "maps_url": "https://maps/np", "raw_category": "Banquet hall"},
        {"name": "Royal Banquet", "phone": "011-2222222", "rating": 4.4, "review_count": 120,
         "website": "https://royal.example.com", "maps_url": "https://maps/rb", "raw_category": "Banquet hall"},
    ]
    items = service.normalize_and_qualify(raw_items, _reqs())
    ordered = service.rank_and_order(items, _reqs())
    cands = [c for _, c in ordered]

    # Rejected government venue is last, never ranked, never recommended.
    assert cands[-1].name == "Bharat Mandapam"
    assert cands[-1].qualification_status == "rejected"
    assert cands[-1].score is None and cands[-1].rank is None and cands[-1].recommended is False

    # Exactly one recommendation, and it must be contactable by phone.
    recommended = [c for c in cands if c.recommended]
    assert len(recommended) == 1
    assert recommended[0].name == "Royal Banquet"
    assert recommended[0].phone

    # Ranked candidates carry ascending ranks.
    ranked = [c for c in cands if c.rank is not None]
    assert [c.rank for c in ranked] == list(range(1, len(ranked) + 1))
