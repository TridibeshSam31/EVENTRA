"""Google Maps Scraper Adapter for EVENTRA Provider Discovery.

Implements ProviderDirectoryProvider interface while keeping EVENTRA logic
completely decoupled from the underlying scraper engine.
"""
import time
import logging
from typing import Any, Dict, List, Optional

from app.core.config import settings
from app.integrations.base import (
    ProviderDirectoryProvider,
    IntegrationResult,
    IntegrationSource,
)
from app.integrations.google_maps_scraper.client import GoogleMapsScraperClient
from app.integrations.google_maps_scraper.mapper import ProviderNormalizer
from app.integrations.google_maps_scraper.queries import build_discovery_query
from app.integrations.google_maps_scraper.models import (
    RawScraperBusiness,
    NormalizedProvider,
)

logger = logging.getLogger(__name__)


class GoogleMapsScraperAdapter(ProviderDirectoryProvider):
    """Adapter for open-source Google Maps Scraper Kit (gosom/google-maps-scraper)."""

    def __init__(
        self,
        client: Optional[GoogleMapsScraperClient] = None,
        fallback_to_mock: Optional[bool] = None,
    ):
        self.client = client or GoogleMapsScraperClient()
        self.fallback_to_mock = (
            fallback_to_mock
            if fallback_to_mock is not None
            else settings.GOOGLE_MAPS_SCRAPER_FALLBACK_TO_MOCK
        )

    def search_providers(
        self,
        category: str,
        city: Optional[str] = None,
        query: Optional[str] = None,
        latitude: Optional[float] = None,
        longitude: Optional[float] = None,
        limit: int = 20,
        radius_km: Optional[float] = None,
    ) -> IntegrationResult[List[Dict[str, Any]]]:
        """Queries Google Maps through scraper API, normalizes, and returns provider dictionaries."""
        start_time = time.time()
        city_target = city or "Seattle"

        from app.services.geospatial_service import geospatial_discovery
        city_target = geospatial_discovery.clean_city_name(city_target)
        if latitude is None or longitude is None:
            lat, lon = geospatial_discovery.resolve_city_center(city_target)
        else:
            lat, lon = latitude, longitude

        keywords = build_discovery_query(
            category=category,
            custom_query=query,
            location=city_target,
        )

        # Convert radius_km to meters for the scraper API (default: 10km)
        radius_meters: Optional[int] = int(radius_km * 1000) if radius_km and radius_km > 0 else None

        is_alive = self.client.is_available()

        if is_alive:
            try:
                raw_results = self.client.scrape(
                    keywords=keywords[:2],
                    lat=lat,
                    lon=lon,
                    depth=min(settings.GOOGLE_MAPS_SCRAPER_MAX_DEPTH, 5),
                    radius_meters=radius_meters,
                )
                if raw_results:
                    normalized: List[NormalizedProvider] = [
                        ProviderNormalizer.normalize(r, default_city=city_target)
                        for r in raw_results[:limit]
                    ]
                    latency = round((time.time() - start_time) * 1000, 2)
                    return IntegrationResult(
                        data=[p.model_dump(mode="json") for p in normalized],
                        source=IntegrationSource.REAL,
                        success=True,
                        latency_ms=latency,
                    )
            except Exception as exc:
                logger.warning(f"Google Maps scraper run failed: {exc}")

        # Live Geospatial Network Fallback if scraper container is not active
        try:
            from app.services.geospatial_service import geospatial_discovery
            live_providers = geospatial_discovery.discover_real_providers(
                category=category,
                city=city_target,
                latitude=lat,
                longitude=lon,
                query=query,
                limit=limit,
            )
            if live_providers:
                latency = round((time.time() - start_time) * 1000, 2)
                return IntegrationResult(
                    data=live_providers,
                    source=IntegrationSource.REAL,
                    success=True,
                    latency_ms=latency,
                )
        except Exception as live_exc:
            logger.warning(f"Live provider discovery failed: {live_exc}")

        # Fallback to simulated fixture if scraper container and live network are not available
        if self.fallback_to_mock:
            simulated = self._get_simulated_fixtures(category, city_target, lat, lon)
            latency = round((time.time() - start_time) * 1000, 2)
            return IntegrationResult(
                data=simulated[:limit],
                source=IntegrationSource.MOCK,
                success=True,
                latency_ms=latency,
                error="Google Maps Scraper container and live network unavailable. Fallback simulated fixtures used.",
            )

        return IntegrationResult(
            data=[],
            source=IntegrationSource.UNAVAILABLE,
            success=False,
            latency_ms=round((time.time() - start_time) * 1000, 2),
            error="Google Maps Scraper service is unavailable and fallback is disabled.",
        )

    def _get_simulated_fixtures(
        self,
        category: str,
        city: str,
        lat: float,
        lon: float,
    ) -> List[Dict[str, Any]]:
        """Controlled test fixture for fallback/demo resilience (clearly marked SIMULATED)."""
        cat_clean = category.strip().upper()
        cat_lower = cat_clean.lower()
        cat_title = cat_clean.replace("_", " ").title()

        fixtures = [
            NormalizedProvider(
                source="GOOGLE_MAPS",
                source_id=f"gmap_sim_001_{cat_lower}",
                name=f"Royal {cat_title} & Hospitality Services",
                category=cat_clean,
                raw_category=f"{cat_title} Company",
                address=f"Sector 62, Commercial Hub, {city}",
                city=city,
                latitude=lat + 0.005,
                longitude=lon + 0.003,
                phone="+919876543210",
                email=f"info@royal{cat_lower}.example.com",
                website=f"https://royal{cat_lower}.example.com",
                rating=4.8,
                review_count=142,
                maps_url=f"https://maps.google.com/?cid=1001_{cat_lower}",
                description=f"Leading {cat_title} specialist delivering premium services for luxury weddings, corporate summits, and social events.",
                base_cost=3500.0,
                capabilities=[f"full_service_{cat_lower}", "on_site_management", "verified_staff"],
                classification_confidence=0.96,
                classification_reason="Exact match on Google Maps business title and services description.",
                raw_data={"fixture_type": "SIMULATED / TEST FIXTURE"},
            ),
            NormalizedProvider(
                source="GOOGLE_MAPS",
                source_id=f"gmap_sim_002_{cat_lower}",
                name=f"Apex {cat_title} Solutions",
                category=cat_clean,
                raw_category=f"Professional {cat_title} Supplier",
                address=f"Expressway Towers, Block B, {city}",
                city=city,
                latitude=lat - 0.004,
                longitude=lon + 0.006,
                phone="+919811223344",
                email=f"contact@apex{cat_lower}.example.com",
                website=f"https://apex{cat_lower}.example.com",
                rating=4.6,
                review_count=89,
                maps_url=f"https://maps.google.com/?cid=1002_{cat_lower}",
                description=f"Reliable {cat_title} operations offering expedited turnaround, backup equipment, and dedicated coordinators.",
                base_cost=4200.0,
                capabilities=[f"premium_{cat_lower}", "emergency_backup"],
                classification_confidence=0.92,
                classification_reason="High semantic similarity with provider taxonomy.",
                raw_data={"fixture_type": "SIMULATED / TEST FIXTURE"},
            ),
            NormalizedProvider(
                source="GOOGLE_MAPS",
                source_id=f"gmap_sim_003_{cat_lower}",
                name=f"Elite Grand {cat_title} Creations",
                category=cat_clean,
                raw_category=f"Event {cat_title}",
                address=f"Central Plaza, Main Road, {city}",
                city=city,
                latitude=lat + 0.002,
                longitude=lon - 0.007,
                phone="+919955443322",
                email=f"hello@elitegrand{cat_lower}.example.com",
                website=f"https://elitegrand{cat_lower}.example.com",
                rating=4.9,
                review_count=210,
                maps_url=f"https://maps.google.com/?cid=1003_{cat_lower}",
                description=f"Award-winning {cat_title} firm trusted by Fortune 500 summits and celebrity galas.",
                base_cost=5500.0,
                capabilities=[f"bespoke_{cat_lower}", "large_scale_events"],
                classification_confidence=0.98,
                classification_reason="Explicit category match and high rating credentials.",
                raw_data={"fixture_type": "SIMULATED / TEST FIXTURE"},
            ),
        ]
        return [f.model_dump(mode="json") for f in fixtures]
