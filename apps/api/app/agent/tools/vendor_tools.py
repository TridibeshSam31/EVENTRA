"""Provider & Vendor Agent Tools (re-exports from canonical provider_tools)."""
from typing import Any, Dict
from app.agent.tools.provider_tools import (
    DiscoverProvidersTool,
    QualifyProviderTool,
    CheckProviderAvailabilityTool,
    CompareCandidatesTool,
    ShortlistVendorsTool,
)

__all__ = [
    "DiscoverProvidersTool",
    "QualifyProviderTool",
    "CheckProviderAvailabilityTool",
    "CompareCandidatesTool",
    "ShortlistVendorsTool",
    "vendor_tools_run",
]


def vendor_tools_run(**kwargs) -> Dict[str, Any]:
    """Wraps deterministic engine calls for tool invocation."""
    return {"status": "success"}
