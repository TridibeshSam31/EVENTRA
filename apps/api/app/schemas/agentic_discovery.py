"""Pydantic Schemas for Agentic Provider & Venue Discovery Pipeline."""
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field

from app.schemas.vendor import VendorResponse
from app.services.agentic_discovery_controller import FunnelTransparencyStats, TieredShortlistResult


class AgenticDiscoveryRequest(BaseModel):
    """Request payload for triggering agentic provider discovery."""
    category: str = Field(..., description="Provider category (e.g., CATERING, VENUE, DECOR)")
    location: str = Field(..., description="Target city or venue area (e.g. 'Delhi', 'Noida')")
    event_type: Optional[str] = Field("GENERIC", description="Event type (WEDDING, CORPORATE_CONFERENCE, COLLEGE_FEST)")
    guest_count: Optional[int] = Field(None, ge=1, description="Expected guest count")
    max_budget: Optional[float] = Field(None, ge=0.0, description="Max budget ceiling for this provider task")
    base_radius_km: float = Field(10.0, ge=1.0, le=100.0, description="Initial search radius in km")
    required_amenities: Optional[List[str]] = Field(default_factory=list, description="Required amenities/capabilities")
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    target_count: int = Field(6, ge=1, le=20, description="Target number of confirmed candidates")
    max_iterations: int = Field(3, ge=1, le=5, description="Max search iterations")
    simulate_outreach: bool = Field(True, description="Whether to simulate provider outreach availability responses")


class CandidateCardResponse(BaseModel):
    """Candidate representation formatted for UI presentation with evidence and field source tags."""
    id: str
    name: str
    category: str
    city: str
    address: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    website: Optional[str] = None
    maps_url: Optional[str] = None
    rating: Optional[float] = None
    review_count: Optional[int] = None
    base_cost: Optional[float] = None
    capacity: Optional[int] = None
    qualification: str = "qualified"
    availability: str = "confirmed"
    score: float = 0.0
    rank: int = 1
    confidence: float = 0.85
    reasons: List[str] = Field(default_factory=list)
    field_sources: Dict[str, str] = Field(default_factory=dict)
    distance_km: Optional[float] = None
    qualification_reason: Optional[str] = None


class AgenticDiscoveryResponse(BaseModel):
    """Complete API response carrying the tiered shortlist and funnel stats."""
    top_matches: List[CandidateCardResponse] = Field(default_factory=list)
    other_available_options: List[CandidateCardResponse] = Field(default_factory=list)
    backup_waitlist: List[CandidateCardResponse] = Field(default_factory=list)
    rejected_candidates: List[CandidateCardResponse] = Field(default_factory=list)
    funnel_stats: FunnelTransparencyStats
    target_count_met: bool
    diagnosis_message: Optional[str] = None
    search_queries_used: List[str] = Field(default_factory=list)


def map_ranked_candidate_to_card(rc: Any) -> CandidateCardResponse:
    """Helper to convert a RankedCandidate instance to CandidateCardResponse."""
    cand = rc.candidate
    qual_reason = None
    if rc.qualification == "rejected" and rc.reasons:
        qual_reason = rc.reasons[0]
    return CandidateCardResponse(
        id=cand.source_id or cand.name,
        name=cand.name,
        category=cand.category,
        city=cand.city,
        address=cand.address,
        latitude=cand.latitude,
        longitude=cand.longitude,
        phone=cand.phone,
        email=cand.email,
        website=cand.website,
        maps_url=cand.maps_url,
        rating=cand.rating,
        review_count=cand.review_count,
        base_cost=cand.base_cost,
        capacity=cand.capacity,
        qualification=rc.qualification,
        availability=rc.availability,
        score=rc.score,
        rank=rc.rank,
        confidence=rc.confidence,
        reasons=rc.reasons or [],
        field_sources=rc.field_sources or {},
        distance_km=rc.distance_km,
        qualification_reason=qual_reason,
    )
