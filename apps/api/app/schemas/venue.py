"""Pydantic Schemas: Venue, Availability, and Suitability"""
from typing import Optional, List
from datetime import datetime
from pydantic import BaseModel, Field, ConfigDict


class VenueBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    address: Optional[str] = Field(None, max_length=500)
    city: str = Field(..., min_length=1, max_length=100)
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    capacity: int = Field(..., gt=0)
    venue_type: str = Field(..., min_length=1, max_length=100)
    contact_email: Optional[str] = Field(None, max_length=255)
    contact_phone: Optional[str] = Field(None, max_length=50)
    hourly_rate: Optional[float] = Field(None, ge=0.0)
    amenities: List[str] = Field(default_factory=list)
    status: str = Field(default="ACTIVE", max_length=50)


class VenueCreate(VenueBase):
    pass


class VenueUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    address: Optional[str] = Field(None, max_length=500)
    city: Optional[str] = Field(None, min_length=1, max_length=100)
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    capacity: Optional[int] = Field(None, gt=0)
    venue_type: Optional[str] = Field(None, min_length=1, max_length=100)
    contact_email: Optional[str] = Field(None, max_length=255)
    contact_phone: Optional[str] = Field(None, max_length=50)
    hourly_rate: Optional[float] = Field(None, ge=0.0)
    amenities: Optional[List[str]] = None
    status: Optional[str] = Field(None, max_length=50)


class VenueResponse(VenueBase):
    id: str
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class VenueAvailabilityBase(BaseModel):
    start_datetime: datetime
    end_datetime: datetime
    status: str = Field(default="AVAILABLE", max_length=50)
    notes: Optional[str] = Field(None, max_length=500)


class VenueAvailabilityCreate(VenueAvailabilityBase):
    pass


class VenueAvailabilityResponse(VenueAvailabilityBase):
    id: str
    venue_id: str
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class VenueAvailabilityCheck(BaseModel):
    start_datetime: datetime
    end_datetime: datetime


class VenueAvailabilityResult(BaseModel):
    venue_id: str
    is_available: bool
    start_datetime: datetime
    end_datetime: datetime
    conflicts: List[VenueAvailabilityResponse] = Field(default_factory=list)
    reason: Optional[str] = None


class VenueSuitabilityCheck(BaseModel):
    required_capacity: int = Field(..., gt=0)
    required_amenities: Optional[List[str]] = Field(default_factory=list)
    start_datetime: Optional[datetime] = None
    end_datetime: Optional[datetime] = None


class VenueSuitabilityResult(BaseModel):
    venue_id: str
    venue_name: str
    capacity: int
    required_capacity: int
    capacity_satisfied: bool
    required_amenities: List[str] = Field(default_factory=list)
    missing_amenities: List[str] = Field(default_factory=list)
    amenities_satisfied: bool
    availability_satisfied: Optional[bool] = None
    is_suitable: bool


class PaginatedVenuesResponse(BaseModel):
    total: int
    items: List[VenueResponse]
    limit: int
    offset: int


class VenueDiscoveryRequest(BaseModel):
    city: Optional[str] = Field("Seattle", description="Target city for live geospatial discovery")
    query: Optional[str] = Field(None, description="Custom search query (e.g. convention center, ballroom)")
    latitude: Optional[float] = Field(None, description="Optional center latitude")
    longitude: Optional[float] = Field(None, description="Optional center longitude")
    limit: int = Field(25, ge=1, le=50, description="Max venues to discover")
    save_to_db: bool = Field(True, description="Whether to persist discovered venues to the database")


class VenueDiscoveryResponse(BaseModel):
    total_discovered: int
    total_created: int
    city: str
    source: str
    items: List[VenueResponse]


class VenueRecommendationRequest(BaseModel):
    city: str = Field("Delhi", description="Target city or state")
    guest_count: Optional[int] = Field(None, description="Expected guest or attendee count")
    event_type: Optional[str] = Field(None, description="Type of event")
    budget: Optional[float] = Field(None, description="Total budget in currency")
    required_amenities: Optional[List[str]] = Field(default_factory=list, description="Requested amenities")
    description: Optional[str] = Field(None, description="Full natural language event requirement description")
    event_id: Optional[str] = Field(None, description="Optional related event ID")


class RankedVenueItem(BaseModel):
    id: str
    name: str
    address: Optional[str] = None
    city: str
    capacity: int
    venue_type: str
    hourly_rate: Optional[float] = None
    amenities: List[str] = Field(default_factory=list)
    suitability_score: int = Field(..., description="Fit percentage 0-100")
    is_best_match: bool = False
    badge: str = "Candidate Space"
    match_reasons: List[str] = Field(default_factory=list)
    pros: List[str] = Field(default_factory=list)
    cons: List[str] = Field(default_factory=list)
    capacity_status: str = "FIT"


class VenueRecommendationResponse(BaseModel):
    city: str
    total_scouted: int
    agent_summary: str
    best_venue: Optional[RankedVenueItem] = None
    ranked_venues: List[RankedVenueItem] = Field(default_factory=list)


