"""Base integration interfaces and result schemas for EVENTRA.

External integrations act strictly as adapters:
- They NEVER calculate authoritative operational figures (budget, schedule, dependencies, risk, recovery feasibility, permissions).
- They isolate third-party APIs from core business logic.
- They clearly tag data sources as REAL, MOCK, or UNAVAILABLE.
"""
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, Generic, List, Optional, TypeVar


class IntegrationSource(str, Enum):
    REAL = "REAL"
    MOCK = "MOCK"
    UNAVAILABLE = "UNAVAILABLE"


T = TypeVar("T")


@dataclass
class IntegrationResult(Generic[T]):
    """Standardized wrapper for external integration outputs."""
    data: Optional[T]
    source: IntegrationSource
    success: bool = True
    latency_ms: float = 0.0
    error: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return {
            "data": self.data,
            "source": self.source.value if isinstance(self.source, IntegrationSource) else str(self.source),
            "success": self.success,
            "latency_ms": self.latency_ms,
            "error": self.error,
        }


class MapProvider(ABC):
    """Abstract interface for geospatial and routing providers."""

    @abstractmethod
    def geocode(self, address: str) -> IntegrationResult[Dict[str, Any]]:
        """Resolves address to coordinates (lat, lng, formatted_address)."""
        pass

    @abstractmethod
    def get_distance(self, origin: Any, destination: Any) -> IntegrationResult[Dict[str, Any]]:
        """Calculates transit distance (km) and estimated travel duration (minutes)."""
        pass

    @abstractmethod
    def get_route(self, origin: Any, destination: Any) -> IntegrationResult[Dict[str, Any]]:
        """Retrieves route summary including distance, duration, and turn points."""
        pass


class NotificationProvider(ABC):
    """Abstract interface for external notification delivery."""

    @abstractmethod
    def send_notification(
        self,
        event_id: str,
        notification_type: str,
        title: str,
        message: str,
        channel: str = "IN_APP",
        recipient: Optional[str] = None,
        payload: Optional[Dict[str, Any]] = None,
    ) -> IntegrationResult[Dict[str, Any]]:
        """Dispatches operational notification to configured channel."""
        pass


class ProviderCommunicationProvider(ABC):
    """Abstract interface for bidirectional provider/vendor communication."""

    @abstractmethod
    def send_message(
        self,
        event_id: str,
        provider_id: str,
        message: str,
        recipient_contact: Optional[str] = None,
    ) -> IntegrationResult[Dict[str, Any]]:
        """Dispatches operational message to provider."""
        pass

    @abstractmethod
    def get_messages(
        self,
        event_id: str,
        provider_id: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """Retrieves communication history with provider."""
        pass

    @abstractmethod
    def receive_inbound(
        self,
        payload: Dict[str, Any],
        signature: Optional[str] = None,
    ) -> IntegrationResult[Dict[str, Any]]:
        """Parses and normalizes incoming message from provider webhook."""
        pass

    def make_call(
        self,
        event_id: str,
        provider_id: str,
        recipient_phone: str,
        task_id: Optional[str] = None,
        session_id: Optional[str] = None,
        custom_field: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> IntegrationResult[Dict[str, Any]]:
        """Initiates an outbound telephony call to a provider/vendor."""
        raise NotImplementedError("Telephony voice calls not supported by this provider.")


class VenueDirectoryProvider(ABC):
    """Abstract interface for external venue discovery directories."""

    @abstractmethod
    def search_venues(
        self,
        query: str,
        city: Optional[str] = None,
        min_capacity: Optional[int] = None,
    ) -> IntegrationResult[List[Dict[str, Any]]]:
        """Queries external venue directories and returns normalized results."""
        pass


class ProviderDirectoryProvider(ABC):
    """Abstract interface for external vendor/provider directories."""

    @abstractmethod
    def search_providers(
        self,
        category: str,
        city: Optional[str] = None,
    ) -> IntegrationResult[List[Dict[str, Any]]]:
        """Queries external vendor networks and returns normalized results."""
        pass
