"""Domain Registry for Event Specification and Provider Category Validation."""
from typing import Dict, List, Optional, Union
from app.domains.base import BaseEventDomain
from app.models.enums import EventType


class UnsupportedEventTypeException(ValueError):
    """Raised when an unsupported or unregistered event type is requested."""
    def __init__(self, event_type: str, supported: List[str]):
        super().__init__(
            f"Unsupported event type '{event_type}'. Supported domain types are: {', '.join(supported)}"
        )
        self.event_type = event_type
        self.supported = supported


class DomainRegistry:
    """Central registry mapping event types to domain implementations."""

    _domains: Dict[str, BaseEventDomain] = {}

    @classmethod
    def register(cls, domain: BaseEventDomain) -> None:
        """Register a domain implementation instance."""
        domain.validate_baseline()
        raw_key = domain.event_type
        key = (raw_key.value if hasattr(raw_key, "value") else str(raw_key)).upper()
        cls._domains[key] = domain

    ALIAS_MAP = {
        "EXHIBITION": "CONFERENCE",
        "EXPO": "CONFERENCE",
        "CORPORATE": "CONFERENCE",
        "SUMMIT": "CONFERENCE",
        "HACKATHON": "CONFERENCE",
        "MEETUP": "CONFERENCE",
        "FESTIVAL": "COLLEGE_FEST",
        "FEST": "COLLEGE_FEST",
        "CULTURAL": "COLLEGE_FEST",
        "CONCERT": "COLLEGE_FEST",
        "PARTY": "COLLEGE_FEST",
        "MARRIAGE": "WEDDING",
        "RECEPTION": "WEDDING",
        "GALA": "WEDDING",
        "OTHER": "CONFERENCE",
    }

    @classmethod
    def get(cls, event_type: Union[EventType, str]) -> BaseEventDomain:
        """Retrieve the domain handler for a given event type with alias normalization."""
        raw_key = event_type.value if hasattr(event_type, "value") else str(event_type)
        normalized = raw_key.strip().upper().replace("-", "_").replace(" ", "_")
        if normalized in cls._domains:
            return cls._domains[normalized]
        if normalized in cls.ALIAS_MAP and cls.ALIAS_MAP[normalized] in cls._domains:
            return cls._domains[cls.ALIAS_MAP[normalized]]
        supported = list(cls._domains.keys())
        raise UnsupportedEventTypeException(normalized, supported)

    @classmethod
    def list_supported_event_types(cls) -> List[str]:
        """Return list of supported event type keys."""
        return list(cls._domains.keys())

    @classmethod
    def clear(cls) -> None:
        """Clear registry."""
        cls._domains.clear()


def get_domain(event_type: Union[EventType, str]) -> BaseEventDomain:
    """Convenience function to resolve domain by event type."""
    return DomainRegistry.get(event_type)


# Backward compatibility helpers
def list_supported_domains() -> List[str]:
    return [k.lower() for k in DomainRegistry.list_supported_event_types()]


def get_domain_provider_categories(domain_name: str) -> List[str]:
    try:
        domain = get_domain(domain_name)
        return [c.lower() for c in domain.provider_categories()]
    except UnsupportedEventTypeException:
        return []


def is_provider_category_compatible(domain_name: str, category: str) -> bool:
    categories = get_domain_provider_categories(domain_name)
    return category.strip().lower() in categories
