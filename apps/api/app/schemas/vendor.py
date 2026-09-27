"""Pydantic Schemas: Vendor (Provider), Availability, Assignment, and Category Validation"""
from typing import Optional, List, Any, Dict
from datetime import datetime
from pydantic import BaseModel, Field, ConfigDict


class VendorBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    category: str = Field(..., min_length=1, max_length=100)
    city: str = Field(..., min_length=1, max_length=100)
    address: Optional[str] = Field(None, max_length=500)
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    contact_name: Optional[str] = Field(None, max_length=255)
    contact_email: Optional[str] = Field(None, max_length=255)
    contact_phone: Optional[str] = Field(None, max_length=50)
    website: Optional[str] = Field(None, max_length=500)
    maps_url: Optional[str] = Field(None, max_length=500)
    base_cost: Optional[float] = Field(None, ge=0.0)
    rating: Optional[float] = None
    review_count: Optional[int] = None
    service_description: Optional[str] = None
    status: str = Field(default="ACTIVE", max_length=50)
    source: str = Field(default="INTERNAL", max_length=50)
    source_id: Optional[str] = Field(None, max_length=255)
    raw_category: Optional[str] = Field(None, max_length=255)
    capabilities: Optional[List[str]] = Field(default_factory=list)
    classification_confidence: Optional[float] = None


class VendorCreate(VendorBase):
    pass


class VendorUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    category: Optional[str] = Field(None, min_length=1, max_length=100)
    city: Optional[str] = Field(None, min_length=1, max_length=100)
    address: Optional[str] = Field(None, max_length=500)
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    contact_name: Optional[str] = Field(None, max_length=255)
    contact_email: Optional[str] = Field(None, max_length=255)
    contact_phone: Optional[str] = Field(None, max_length=50)
    website: Optional[str] = Field(None, max_length=500)
    maps_url: Optional[str] = Field(None, max_length=500)
    base_cost: Optional[float] = Field(None, ge=0.0)
    rating: Optional[float] = None
    review_count: Optional[int] = None
    service_description: Optional[str] = None
    status: Optional[str] = Field(None, max_length=50)
    capabilities: Optional[List[str]] = None


class VendorResponse(VendorBase):
    id: str
    created_at: datetime
    updated_at: datetime
    distance_km: Optional[float] = None
    is_assigned: Optional[bool] = None
    qualification: Optional[str] = "qualified"
    qualification_reason: Optional[str] = None
    score: Optional[float] = None
    reasons: Optional[List[str]] = None

    model_config = ConfigDict(from_attributes=True)


class ProviderDiscoveryRequest(BaseModel):
    """Payload to discover providers from Google Maps."""
    category: Optional[str] = Field(None, description="EVENTRA category (e.g. CATERING, DECOR, DJ_MUSIC)")
    query: Optional[str] = Field(None, description="Custom search keywords or natural query")
    location: Optional[str] = Field(None, description="City or specific location string")
    latitude: Optional[float] = Field(None, description="Optional geocoded latitude")
    longitude: Optional[float] = Field(None, description="Optional geocoded longitude")
    radius_km: Optional[float] = Field(None, description="Search radius in kilometers")
    anchor_mode: Optional[str] = Field(None, description="Location anchor mode: 'NEAR_EVENT', 'NEAR_ME', 'REGION'")
    limit: int = Field(default=25, ge=1, le=100, description="Max providers to discover")
    use_real_scraper: bool = Field(default=True, description="Attempt real scraping if scraper service alive")


class ProviderDiscoveryResponse(BaseModel):
    """Result of provider discovery operation."""
    event_id: Optional[str] = None
    total_discovered: int
    total_created: int
    total_updated: int
    source: str
    query_used: List[str]
    anchor_coordinates: Optional[List[float]] = None
    anchor_label: Optional[str] = None
    anchor_mode: Optional[str] = None
    items: List[VendorResponse]


class ProviderAvailabilityBase(BaseModel):
    start_datetime: datetime
    end_datetime: datetime
    status: str = Field(default="AVAILABLE", max_length=50)
    notes: Optional[str] = Field(None, max_length=500)


class ProviderAvailabilityCreate(ProviderAvailabilityBase):
    pass


class ProviderAvailabilityResponse(ProviderAvailabilityBase):
    id: str
    vendor_id: str
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ProviderAvailabilityCheck(BaseModel):
    start_datetime: datetime
    end_datetime: datetime


class ProviderAvailabilityResult(BaseModel):
    vendor_id: str
    is_available: bool
    start_datetime: datetime
    end_datetime: datetime
    conflicts: List[ProviderAvailabilityResponse] = Field(default_factory=list)
    reason: Optional[str] = None


class VendorAssignmentBase(BaseModel):
    event_id: str = Field(..., min_length=1, max_length=36)
    vendor_id: str = Field(..., min_length=1, max_length=36)
    category: str = Field(..., min_length=1, max_length=100)
    status: str = Field(default="REQUESTED", max_length=50)
    agreed_cost: Optional[float] = Field(None, ge=0.0)
    notes: Optional[str] = None


class VendorAssignmentCreate(VendorAssignmentBase):
    target_amount: Optional[float] = Field(None, ge=0.0, description="Budget target agent negotiates toward")
    max_approved_amount: Optional[float] = Field(None, ge=0.0, description="Hard ceiling agent cannot exceed")
    currency: Optional[str] = Field(default="INR", max_length=10)


class VendorAssignmentUpdate(BaseModel):
    category: Optional[str] = Field(None, min_length=1, max_length=100)
    status: Optional[str] = Field(None, max_length=50)
    agreed_cost: Optional[float] = Field(None, ge=0.0)
    notes: Optional[str] = None
    target_amount: Optional[float] = Field(None, ge=0.0)
    max_approved_amount: Optional[float] = Field(None, ge=0.0)


class VendorAssignmentResponse(VendorAssignmentBase):
    id: str
    created_at: datetime
    updated_at: datetime
    # Negotiation fields
    negotiation_status: Optional[str] = None
    target_amount: Optional[float] = None
    max_approved_amount: Optional[float] = None
    quoted_amount: Optional[float] = None
    currency: Optional[str] = None
    provider_available: Optional[bool] = None
    coverage_start: Optional[str] = None
    coverage_end: Optional[str] = None
    advance_required: Optional[bool] = None
    provider_response_summary: Optional[Dict[str, Any]] = None
    negotiation_round: Optional[str] = None
    approval_id: Optional[str] = None
    is_simulation: Optional[bool] = None
    # Vendor details (populated for UI)
    vendor: Optional[VendorResponse] = None

    model_config = ConfigDict(from_attributes=True)


class CategoryValidationResult(BaseModel):
    domain: str
    category: str
    is_valid: bool
    allowed_categories: List[str]


class PaginatedVendorsResponse(BaseModel):
    total: int
    items: List[VendorResponse]
    limit: int
    offset: int


# --- Negotiation Schemas ---

class ProviderEngagementRequest(BaseModel):
    """Initiates provider engagement / contact for an assignment."""
    target_amount: Optional[float] = Field(None, ge=0.0, description="Budget target for negotiation")
    max_approved_amount: Optional[float] = Field(None, ge=0.0, description="Hard ceiling amount")
    currency: str = Field(default="INR")
    required_coverage_start: Optional[str] = Field(None, description="Required coverage start time e.g. '10:00'")
    required_coverage_end: Optional[str] = Field(None, description="Required coverage end time e.g. '20:00'")


class SimulateProviderRequest(BaseModel):
    """Demo simulation request — simulates provider response."""
    scenario: str = Field(..., description="ACCEPT, COUNTER, DECLINE, NO_RESPONSE")
    quoted_amount: Optional[float] = Field(None, description="Provider's quoted amount for ACCEPT/COUNTER scenarios")
    counter_coverage_start: Optional[str] = Field(None, description="Provider's counter-offered coverage start")
    counter_coverage_end: Optional[str] = Field(None, description="Provider's counter-offered coverage end")
    advance_required: Optional[bool] = Field(None, description="Provider requires advance payment")
    provider_count: Optional[int] = Field(None, description="Number of providers offered")
    message: Optional[str] = Field(None, description="Custom provider response message")


class NegotiationConversationResponse(BaseModel):
    """Full negotiation state and conversation thread."""
    assignment: VendorAssignmentResponse
    messages: List[Dict[str, Any]] = Field(default_factory=list)
    budget_validation: Optional[Dict[str, Any]] = None
    requirement_validation: Optional[Dict[str, Any]] = None
