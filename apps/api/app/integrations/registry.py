"""Integration Registry: Central factory and health inspection for external adapters."""
from typing import Any, Dict, Optional
from app.core.config import settings
from app.integrations.base import (
    MapProvider,
    NotificationProvider,
    ProviderCommunicationProvider,
    VenueDirectoryProvider,
    ProviderDirectoryProvider,
)
from app.integrations.maps.mock import MockMapsProvider
from app.integrations.maps.http_maps import HTTPMapsProvider
from app.integrations.notifications.providers import (
    InAppNotificationProvider,
    WebhookNotificationProvider,
    MockNotificationProvider,
)
from app.integrations.communication.mock import MockCommunicationProvider
from app.integrations.communication.exotel import ExotelVoiceAdapter
from app.integrations.whatsapp.client import OpenWACommunicationAdapter, WhatsAppAdapter
from app.integrations.venues.discovery import ExternalVenueAdapter
from app.integrations.providers.directory import ExternalProviderAdapter
from app.integrations.google_maps_scraper.adapter import GoogleMapsScraperAdapter
from app.integrations.llm.base import LLMProvider, get_configured_llm_provider


class IntegrationRegistry:
    """Central registry and factory for all Phase 12 real-world integration adapters."""

    def __init__(self):
        self._maps_provider: Optional[MapProvider] = None
        self._notification_provider: Optional[NotificationProvider] = None
        self._communication_provider: Optional[ProviderCommunicationProvider] = None
        self._venue_provider: Optional[VenueDirectoryProvider] = None
        self._provider_directory: Optional[ProviderDirectoryProvider] = None
        self._google_maps_scraper: Optional[GoogleMapsScraperAdapter] = None
        self._llm_provider: Optional[LLMProvider] = None

    def get_maps_provider(self) -> MapProvider:
        if not self._maps_provider:
            provider_type = (settings.MAP_PROVIDER or "mock").lower()
            if provider_type != "mock" and settings.MAPS_API_KEY:
                self._maps_provider = HTTPMapsProvider(
                    api_key=settings.MAPS_API_KEY,
                    timeout_seconds=settings.MAPS_TIMEOUT_SECONDS,
                )
            else:
                self._maps_provider = MockMapsProvider()
        return self._maps_provider

    def get_notification_provider(self) -> NotificationProvider:
        if not self._notification_provider:
            provider_type = (settings.NOTIFICATION_PROVIDER or "in_app").lower()
            if provider_type == "webhook" and settings.NOTIFICATION_WEBHOOK_URL:
                self._notification_provider = WebhookNotificationProvider(
                    webhook_url=settings.NOTIFICATION_WEBHOOK_URL,
                )
            elif provider_type == "mock":
                self._notification_provider = MockNotificationProvider()
            else:
                self._notification_provider = InAppNotificationProvider()
        return self._notification_provider

    def get_communication_provider(self) -> ProviderCommunicationProvider:
        if not self._communication_provider:
            comm_type = (settings.COMMUNICATION_PROVIDER or "mock").lower()
            if comm_type in ("openwa", "whatsapp") or settings.OPENWA_ENABLED:
                self._communication_provider = OpenWACommunicationAdapter(
                    base_url=settings.OPENWA_BASE_URL,
                    api_key=settings.OPENWA_API_KEY,
                    session_id=settings.OPENWA_SESSION_ID,
                    webhook_secret=settings.OPENWA_WEBHOOK_SECRET,
                    timeout_seconds=settings.OPENWA_TIMEOUT_SECONDS,
                )
            elif comm_type == "exotel" or settings.EXOTEL_ENABLED:
                self._communication_provider = ExotelVoiceAdapter(
                    api_key=settings.EXOTEL_API_KEY,
                    api_token=settings.EXOTEL_API_TOKEN,
                    account_sid=settings.EXOTEL_ACCOUNT_SID,
                    subdomain=settings.EXOTEL_SUBDOMAIN,
                    caller_id=settings.EXOTEL_CALLER_ID,
                    app_id=settings.EXOTEL_APP_ID,
                    stream_url=settings.EXOTEL_STREAM_URL,
                    callback_url=settings.EXOTEL_CALLBACK_URL,
                    timeout_seconds=settings.EXOTEL_TIMEOUT_SECONDS,
                )
            else:
                self._communication_provider = MockCommunicationProvider()
        return self._communication_provider

    def get_venue_provider(self) -> VenueDirectoryProvider:
        if not self._venue_provider:
            self._venue_provider = ExternalVenueAdapter()
        return self._venue_provider

    def get_provider_directory(self) -> ProviderDirectoryProvider:
        if not self._provider_directory:
            self._provider_directory = ExternalProviderAdapter()
        return self._provider_directory

    def get_google_maps_scraper(self) -> GoogleMapsScraperAdapter:
        if not self._google_maps_scraper:
            self._google_maps_scraper = GoogleMapsScraperAdapter()
        return self._google_maps_scraper

    def get_llm_provider(self) -> LLMProvider:
        if not self._llm_provider:
            self._llm_provider = get_configured_llm_provider()
        return self._llm_provider

    def get_status(self) -> Dict[str, Any]:
        """Provides operational status of external integrations without leaking secrets."""
        maps_prov = self.get_maps_provider()
        notif_prov = self.get_notification_provider()
        comm_prov = self.get_communication_provider()
        scraper_prov = self.get_google_maps_scraper()

        comm_is_real = (
            (isinstance(comm_prov, OpenWACommunicationAdapter) and settings.OPENWA_ENABLED and bool(settings.OPENWA_SESSION_ID))
            or (isinstance(comm_prov, ExotelVoiceAdapter) and settings.EXOTEL_ENABLED and comm_prov.is_configured)
        )
        exotel_configured = bool(
            settings.EXOTEL_API_KEY
            and settings.EXOTEL_API_TOKEN
            and settings.EXOTEL_ACCOUNT_SID
            and settings.EXOTEL_CALLER_ID
        )
        comm_status: Dict[str, Any] = {
            "provider": settings.COMMUNICATION_PROVIDER,
            "mode": "REAL" if comm_is_real else "MOCK",
            "openwa_enabled": settings.OPENWA_ENABLED,
            "whatsapp_enabled": settings.WHATSAPP_ENABLED or settings.OPENWA_ENABLED,
            "exotel_enabled": settings.EXOTEL_ENABLED,
            "exotel_configured": exotel_configured,
            "is_configured": bool(settings.OPENWA_SESSION_ID) or exotel_configured,
            "session_id": settings.OPENWA_SESSION_ID if settings.OPENWA_ENABLED else None,
            "base_url": settings.OPENWA_BASE_URL if settings.OPENWA_ENABLED else None,
        }
        if isinstance(comm_prov, OpenWACommunicationAdapter) and settings.OPENWA_ENABLED:
            comm_status["gateway_health"] = comm_prov.check_health()
        elif isinstance(comm_prov, ExotelVoiceAdapter) and settings.EXOTEL_ENABLED:
            comm_status["exotel_health"] = comm_prov.check_health()

        return {
            "maps": {
                "provider": settings.MAP_PROVIDER,
                "mode": "REAL" if not isinstance(maps_prov, MockMapsProvider) and settings.MAPS_API_KEY else "MOCK",
                "is_configured": bool(settings.MAPS_API_KEY),
                "timeout_seconds": settings.MAPS_TIMEOUT_SECONDS,
            },
            "google_maps_scraper": {
                "url": settings.GOOGLE_MAPS_SCRAPER_URL,
                "is_available": scraper_prov.client.is_available(),
                "fallback_to_mock": settings.GOOGLE_MAPS_SCRAPER_FALLBACK_TO_MOCK,
                "timeout_seconds": settings.GOOGLE_MAPS_SCRAPER_TIMEOUT,
            },
            "notifications": {
                "provider": settings.NOTIFICATION_PROVIDER,
                "mode": "REAL" if settings.NOTIFICATION_PROVIDER in ("in_app", "webhook") else "MOCK",
                "is_configured": bool(settings.NOTIFICATION_WEBHOOK_URL or settings.NOTIFICATION_PROVIDER == "in_app"),
            },
            "communication": comm_status,
            "llm": {
                "provider": settings.LLM_PROVIDER,
                "model": settings.LLM_MODEL,
                "mode": "REAL" if settings.LLM_PROVIDER != "mock" and settings.LLM_API_KEY else "MOCK",
                "is_configured": bool(settings.LLM_API_KEY),
                "timeout_seconds": settings.LLM_TIMEOUT_SECONDS,
            },
        }


# Global registry singleton
registry = IntegrationRegistry()
