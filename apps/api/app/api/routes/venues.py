"""API Route: Venues (Venue Network Discovery and Suitability)"""
from typing import List, Optional
from datetime import datetime
from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.api.dependencies import get_db_session
from app.services.venue_service import VenueService
from app.schemas.venue import (
    VenueCreate,
    VenueResponse,
    VenueAvailabilityCreate,
    VenueAvailabilityResponse,
    VenueAvailabilityResult,
    VenueSuitabilityCheck,
    VenueSuitabilityResult,
    PaginatedVenuesResponse,
    VenueDiscoveryRequest,
    VenueDiscoveryResponse,
    VenueRecommendationRequest,
    VenueRecommendationResponse,
    RankedVenueItem,
)
from app.models.event import Event
from app.models.requirement import Requirement
from app.core.exceptions import AppException
from pydantic import BaseModel, Field

router = APIRouter(prefix="/venues", tags=["venues"])


class VenueSelectRequest(BaseModel):
    event_id: str = Field(..., description="Target Event ID")
    venue_id: str = Field(..., description="Chosen Venue ID")


@router.post("/recommend", response_model=VenueRecommendationResponse, status_code=status.HTTP_200_OK)
def recommend_venues(
    req: VenueRecommendationRequest,
    db: Session = Depends(get_db_session),
):
    """AI Agent venue navigation: Scouts live open geospatial radar and ranks the best venue for the event requirement."""
    service = VenueService(db)

    city = req.city
    guest_count = req.guest_count
    event_type = req.event_type
    budget = req.budget
    user_description = req.description

    # Inherit from event if provided
    if req.event_id:
        event = db.query(Event).filter(Event.id == req.event_id).first()
        if event:
            if not city or city == "Delhi":
                city = event.location or city
            if not guest_count:
                guest_count = event.guest_count
            if not event_type:
                event_type = event.event_type
            if not budget:
                budget = float(event.total_budget or 0)
            if not user_description:
                user_description = event.description

    res = service.recommend_best_venues(
        city=city or "Delhi",
        guest_count=guest_count,
        event_type=event_type,
        budget=budget,
        required_amenities=req.required_amenities,
        user_description=user_description,
    )

    return VenueRecommendationResponse(
        city=res["city"],
        total_scouted=res["total_scouted"],
        agent_summary=res["agent_summary"],
        best_venue=RankedVenueItem(**res["best_venue"]) if res["best_venue"] else None,
        ranked_venues=[RankedVenueItem(**item) for item in res["ranked_venues"]],
    )


@router.post("/select", status_code=status.HTTP_200_OK)
def select_event_venue(
    req: VenueSelectRequest,
    db: Session = Depends(get_db_session),
):
    """Locks the selected venue to the event specification and updates operational requirements."""
    service = VenueService(db)
    venue = service.get_venue(req.venue_id)
    if not venue:
        raise AppException(
            message=f"Venue '{req.venue_id}' not found",
            status_code=status.HTTP_404_NOT_FOUND,
            code="VENUE_NOT_FOUND",
        )

    event = db.query(Event).filter(Event.id == req.event_id).first()
    if not event:
        raise AppException(
            message=f"Event '{req.event_id}' not found",
            status_code=status.HTTP_404_NOT_FOUND,
            code="EVENT_NOT_FOUND",
        )

    event.location = f"{venue.name}, {venue.city}"

    req_record = db.query(Requirement).filter(
        Requirement.event_id == event.id,
        Requirement.type == "VENUE",
    ).first()
    venue_details = {
        "venue_id": venue.id,
        "venue_name": venue.name,
        "address": venue.address,
        "city": venue.city,
        "capacity": venue.capacity,
        "hourly_rate": venue.hourly_rate,
        "amenities": venue.amenities,
    }
    if req_record:
        req_record.value = venue_details
        req_record.description = f"Locked venue: {venue.name} in {venue.city}"
    else:
        req_record = Requirement(
            event_id=event.id,
            name=f"Venue: {venue.name}",
            type="VENUE",
            required=True,
            description=f"Locked venue: {venue.name} in {venue.city}",
            value=venue_details,
        )
        db.add(req_record)

    db.commit()
    db.refresh(event)

    return {
        "success": True,
        "message": f"Venue '{venue.name}' successfully locked for event '{event.name}'",
        "event_id": event.id,
        "venue": venue_details,
    }


@router.post("/discover", response_model=VenueDiscoveryResponse, status_code=status.HTTP_200_OK)
def discover_venues(
    discovery_in: VenueDiscoveryRequest,
    db: Session = Depends(get_db_session),
):
    """Discovers real physical venues dynamically from the live open geospatial network (zero API keys)."""
    service = VenueService(db)
    venues, created, city, source = service.discover_live_venues(
        city=discovery_in.city or "Seattle",
        query=discovery_in.query,
        latitude=discovery_in.latitude,
        longitude=discovery_in.longitude,
        limit=discovery_in.limit,
        save_to_db=discovery_in.save_to_db,
    )
    return VenueDiscoveryResponse(
        total_discovered=len(venues),
        total_created=created,
        city=city,
        source=source,
        items=[VenueResponse.model_validate(v) for v in venues],
    )


@router.get("", response_model=PaginatedVenuesResponse)

def search_venues(
    city: Optional[str] = Query(None, description="Filter by city (case-insensitive)"),
    min_capacity: Optional[int] = Query(None, ge=1, description="Minimum guest capacity"),
    max_capacity: Optional[int] = Query(None, ge=1, description="Maximum guest capacity"),
    venue_type: Optional[str] = Query(None, description="Venue type/category"),
    status: Optional[str] = Query("ACTIVE", description="Venue operational status"),
    max_hourly_rate: Optional[float] = Query(None, ge=0.0, description="Maximum rental rate"),
    amenities: Optional[List[str]] = Query(None, description="Required amenities list"),
    available_from: Optional[datetime] = Query(None, description="Start of availability window"),
    available_to: Optional[datetime] = Query(None, description="End of availability window"),
    limit: int = Query(50, ge=1, le=100, description="Items per page"),
    offset: int = Query(0, ge=0, description="Page offset"),
    db: Session = Depends(get_db_session),
):
    """Deterministically searches and filters venue options."""
    service = VenueService(db)
    try:
        items, total = service.search_venues(
            city=city,
            min_capacity=min_capacity,
            max_capacity=max_capacity,
            venue_type=venue_type,
            status=status,
            max_hourly_rate=max_hourly_rate,
            required_amenities=amenities,
            available_from=available_from,
            available_to=available_to,
            limit=limit,
            offset=offset,
        )
    except ValueError as exc:
        raise AppException(message=str(exc), status_code=status.HTTP_400_BAD_REQUEST, code="INVALID_PARAMETERS")

    return PaginatedVenuesResponse(
        total=total,
        items=[VenueResponse.model_validate(v) for v in items],
        limit=limit,
        offset=offset,
    )


@router.post("", response_model=VenueResponse, status_code=status.HTTP_201_CREATED)
def create_venue(
    venue_in: VenueCreate,
    db: Session = Depends(get_db_session),
):
    """Registers a new venue in the venue network."""
    service = VenueService(db)
    venue = service.create_venue(venue_in)
    return VenueResponse.model_validate(venue)


@router.get("/{venue_id}", response_model=VenueResponse)
def get_venue(
    venue_id: str,
    db: Session = Depends(get_db_session),
):
    """Retrieves single venue record by ID."""
    service = VenueService(db)
    venue = service.get_venue(venue_id)
    if not venue:
        raise AppException(
            message=f"Venue '{venue_id}' not found",
            status_code=status.HTTP_404_NOT_FOUND,
            code="VENUE_NOT_FOUND",
        )
    return VenueResponse.model_validate(venue)


@router.post("/{venue_id}/availability", response_model=VenueAvailabilityResponse, status_code=status.HTTP_201_CREATED)
def add_venue_availability(
    venue_id: str,
    avail_in: VenueAvailabilityCreate,
    db: Session = Depends(get_db_session),
):
    """Adds an operational availability window (AVAILABLE, BOOKED, BLOCKED, MAINTENANCE)."""
    service = VenueService(db)
    try:
        slot = service.add_venue_availability(venue_id, avail_in)
    except ValueError as exc:
        err_msg = str(exc)
        if "not found" in err_msg:
            raise AppException(message=err_msg, status_code=status.HTTP_404_NOT_FOUND, code="VENUE_NOT_FOUND")
        raise AppException(message=err_msg, status_code=status.HTTP_400_BAD_REQUEST, code="INVALID_TIMEFRAME")
    return VenueAvailabilityResponse.model_validate(slot)


@router.get("/{venue_id}/availability", response_model=VenueAvailabilityResult)
def check_venue_availability(
    venue_id: str,
    start_datetime: datetime = Query(..., description="Start of requested window"),
    end_datetime: datetime = Query(..., description="End of requested window"),
    db: Session = Depends(get_db_session),
):
    """Checks whether a venue is available during a specified time window."""
    service = VenueService(db)
    try:
        return service.check_venue_availability(
            venue_id=venue_id,
            start_datetime=start_datetime,
            end_datetime=end_datetime,
        )
    except ValueError as exc:
        err_msg = str(exc)
        if "not found" in err_msg:
            raise AppException(message=err_msg, status_code=status.HTTP_404_NOT_FOUND, code="VENUE_NOT_FOUND")
        raise AppException(message=err_msg, status_code=status.HTTP_400_BAD_REQUEST, code="INVALID_TIMEFRAME")


@router.post("/{venue_id}/suitability", response_model=VenueSuitabilityResult)
def check_venue_suitability(
    venue_id: str,
    check_in: VenueSuitabilityCheck,
    db: Session = Depends(get_db_session),
):
    """Factual deterministic suitability evaluation of a venue against operational requirements."""
    service = VenueService(db)
    try:
        return service.check_venue_suitability(venue_id, check_in)
    except ValueError as exc:
        err_msg = str(exc)
        if "not found" in err_msg:
            raise AppException(message=err_msg, status_code=status.HTTP_404_NOT_FOUND, code="VENUE_NOT_FOUND")
        raise AppException(message=err_msg, status_code=status.HTTP_400_BAD_REQUEST, code="INVALID_REQUIREMENTS")
