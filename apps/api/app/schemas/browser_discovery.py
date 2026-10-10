"""Pydantic schemas for Browser Agent Venue & Vendor Discovery (Phase 3)."""
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field


class EventSearchRequirements(BaseModel):
    """Typed search requirements extracted strictly from authorized EVENTRA event data."""
    event_id: str
    event_name: str
    event_type: str
    category: str
    location: str
    city: str
    guest_count: Optional[int] = None
    budget: Optional[float] = None
    currency: str = "USD"
    start_date: Optional[str] = None
    constraints: List[str] = Field(default_factory=list)
    raw_query: Optional[str] = None


class BrowserDiscoveryRequest(BaseModel):
    """Request payload to initiate real browser-based discovery for an event."""
    event_id: str = Field(..., description="Target EVENTRA event identifier")
    category: str = Field("CATERING", description="Target vendor/venue category (e.g. CATERING, VENUE, PHOTOGRAPHY)")
    max_results: int = Field(5, ge=1, le=15, description="Maximum number of candidates to inspect and extract")
    custom_query: Optional[str] = Field(None, description="Optional custom query string overriding default template")
    persist_results: bool = Field(True, description="Whether to persist qualified candidates to the Vendor database")
    use_fallback_if_blocked: bool = Field(True, description="Whether to activate approved scraper fallback if Google blocks live browser")


class DiscoveredCandidate(BaseModel):
    """Evidence-backed business candidate discovered during live browser research."""
    id: str = Field(..., description="Candidate unique temporary identifier")
    name: str = Field(..., description="Observed business name")
    category: str = Field(..., description="EVENTRA taxonomy category")
    raw_category: Optional[str] = Field(None, description="Category string directly observed on page")
    address: Optional[str] = Field(None, description="Observed street address")
    city: str = Field("Unknown", description="Resolved city")
    latitude: Optional[float] = Field(None, description="Geographic latitude if observed")
    longitude: Optional[float] = Field(None, description="Geographic longitude if observed")
    phone: Optional[str] = Field(None, description="Observed public phone number")
    email: Optional[str] = Field(None, description="Observed public contact email")
    website: Optional[str] = Field(None, description="Observed official website URL")
    maps_url: Optional[str] = Field(None, description="Google Maps listing URL")
    rating: Optional[float] = Field(None, description="Observed rating (1.0 - 5.0)")
    review_count: Optional[int] = Field(None, description="Observed public review count")
    base_cost: Optional[float] = Field(None, description="Verified pricing if explicitly stated on page")
    capacity: Optional[int] = Field(None, description="Verified venue capacity if explicitly stated on page")
    source: str = Field("BROWSER_AGENT", description="Data provenance source (BROWSER_AGENT, GOOGLE_MAPS_SCRAPER, etc.)")
    source_id: Optional[str] = Field(None, description="Unique place CID or coordinate hash")
    field_sources: Dict[str, str] = Field(default_factory=dict, description="Field-level evidence provenance")
    evidence: List[str] = Field(default_factory=list, description="List of observed evidence statements")
    qualification_status: str = Field("qualified", description="Qualification verdict: qualified, uncertain, or rejected")
    qualification_reasons: List[str] = Field(default_factory=list, description="Explainable qualification notes")
    is_persisted: bool = Field(False, description="Whether record was successfully saved to Vendor DB")
    vendor_id: Optional[str] = Field(None, description="Database Vendor ID if persisted")
    is_new_vendor: Optional[bool] = Field(None, description="True if new vendor created; False if deduplicated/enriched")


class BrowserDiscoveryResponse(BaseModel):
    """Response returned upon completion of browser discovery workflow."""
    execution_id: str
    event_id: str
    query: str
    category: str
    status: str
    total_found: int
    total_qualified: int
    total_persisted: int
    candidates: List[DiscoveredCandidate] = Field(default_factory=list)
    warnings: List[str] = Field(default_factory=list)
    provenance: Dict[str, Any] = Field(default_factory=dict)
