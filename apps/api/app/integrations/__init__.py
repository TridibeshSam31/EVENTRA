"""Integrations Package for EVENTRA (Real-World Integration Layer)."""
from app.integrations.base import (
    IntegrationResult,
    IntegrationSource,
    MapProvider,
    NotificationProvider,
    ProviderCommunicationProvider,
    VenueDirectoryProvider,
    ProviderDirectoryProvider,
)
def __getattr__(name: str):
    if name in ("IntegrationRegistry", "registry"):
        from app.integrations import registry as reg_module
        return getattr(reg_module, name)
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


__all__ = [
    "IntegrationResult",
    "IntegrationSource",
    "MapProvider",
    "NotificationProvider",
    "ProviderCommunicationProvider",
    "VenueDirectoryProvider",
    "ProviderDirectoryProvider",
    "IntegrationRegistry",
    "registry",
]
