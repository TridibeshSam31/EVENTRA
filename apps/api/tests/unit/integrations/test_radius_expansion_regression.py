"""Regression Test: Radius Expansion Across Agentic Discovery Iterations.

Asserts that when a search iteration fails to meet the target provider count,
the discovery controller scales the search radius (e.g., x1.5) and passes
the expanded radius_meters to the underlying scraper client.
"""
import pytest
from unittest.mock import MagicMock, patch
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.db.base import Base
from app.services.agentic_discovery_controller import AgenticDiscoveryController
from app.integrations.google_maps_scraper.models import NormalizedProvider
from app.integrations.base import IntegrationResult, IntegrationSource


@pytest.fixture
def test_db():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    session = Session()
    yield session
    session.close()


def test_radius_expansion_regression(test_db):
    """Verifies that radius expands across iterations and passes expanded radius to directory provider."""
    controller = AgenticDiscoveryController(
        db=test_db,
        max_iterations=3,
        max_queries_per_iteration=1,
        target_count=5,
        allowed_expansion_km=15.0,
    )

    recorded_radii = []

    def mock_search_providers(*args, **kwargs):
        # Record the radius_km passed to search_providers
        radius_km = kwargs.get("radius_km")
        recorded_radii.append(radius_km)
        # Return empty list to trigger failure diagnosis and radius expansion
        return IntegrationResult(
            data=[],
            source=IntegrationSource.REAL,
            success=True,
            latency_ms=10.0,
        )

    with patch("app.integrations.registry.registry.get_provider_directory") as mock_get_dir:
        mock_dir = MagicMock()
        mock_dir.search_providers.side_effect = mock_search_providers
        mock_get_dir.return_value = mock_dir

        result = controller.execute_discovery(
            event_id=None,
            category="CATERING",
            location="Delhi",
            base_radius_km=10.0,
            simulate_outreach=False,
        )

        # 3 iterations should have been executed since target_count was not met
        assert len(recorded_radii) == 3
        # Iteration 1: 10.0 km
        assert recorded_radii[0] == 10.0
        # Iteration 2: 20.0 km (scaled dynamically based on qualified deficit)
        assert recorded_radii[1] == 20.0
        # Iteration 3: 25.0 km (capped at base 10.0 + allowed 15.0 = 25.0 km)
        assert recorded_radii[2] == 25.0
        # Total searched radius should reflect expansion
        assert result.funnel_stats.radius_searched_km == 25.0
