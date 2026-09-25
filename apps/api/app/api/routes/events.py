"""API Route: Events (Phase 1 Foundational Endpoints + Phase 2 Specification Preview)"""
from datetime import datetime
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.api.dependencies import get_db_session, get_current_user_id
from app.services.event_service import EventService
from app.services.collaboration_service import CollaborationService
from app.services.vendor_service import VendorService
from app.schemas.vendor_outcome import (
    VendorOutcomeCreate,
    VendorOutcomeResponse,
)
from app.schemas.vendor_outcome_validation import (
    VendorOutcomeValidationResponse,
)
from app.services.specification_service import (
    SpecificationService,
    SpecificationValidationError,
)
from app.schemas.event import EventCreate, EventResponse
from app.schemas.event_member import EventMemberCreate, EventMemberUpdate, EventMemberResponse
from app.schemas.vendor import (
    ProviderDiscoveryRequest,
    ProviderDiscoveryResponse,
    VendorResponse,
)
from app.services.venue_service import VenueService
from app.schemas.venue import (
    VenueDiscoveryRequest,
    VenueDiscoveryResponse,
    VenueResponse,
)
from app.schemas.specification import (
    EventSpecification,
    EventSpecificationPreviewRequest,
)
from app.core.exceptions import NotFoundException, BadRequestException

router = APIRouter(prefix="/events", tags=["events"])

# Seed / Demo in-memory lookup for deterministic previewing
DEMO_EVENTS: Dict[str, Dict[str, Any]] = {
    "wedding_demo": {
        "id": "wedding_demo",
        "title": "Demo Wedding",
        "description": "Deterministic baseline demo wedding",
        "event_type": "WEDDING",
        "start_time": datetime(2026, 10, 10, 10, 0, 0),
        "end_time": datetime(2026, 10, 10, 22, 0, 0),
        "guest_count": 150,
        "total_budget": 25000.0,
        "currency": "USD",
        "location": {"name": "Grand Horizon Hall", "city": "San Francisco"},
    },
    "college_fest_demo": {
        "id": "college_fest_demo",
        "title": "Demo College Fest",
        "description": "Deterministic baseline demo college fest",
        "event_type": "COLLEGE_FEST",
        "start_time": datetime(2026, 11, 15, 9, 0, 0),
        "end_time": datetime(2026, 11, 15, 23, 0, 0),
        "guest_count": 800,
        "total_budget": 50000.0,
        "currency": "USD",
        "location": {"name": "North Campus Quad", "city": "Boston"},
    },
    "conference_demo": {
        "id": "conference_demo",
        "title": "Demo Tech Conference",
        "description": "Deterministic baseline demo tech conference",
        "event_type": "CONFERENCE",
        "start_time": datetime(2026, 12, 1, 8, 0, 0),
        "end_time": datetime(2026, 12, 1, 18, 0, 0),
        "guest_count": 300,
        "total_budget": 40000.0,
        "currency": "USD",
        "location": {"name": "Civic Convention Hall", "city": "Seattle"},
    },
}


# --- Phase 2: Specification Endpoints ---
@router.post("/specification/preview", response_model=EventSpecification)
def preview_event_specification(
    payload: EventSpecificationPreviewRequest,
) -> EventSpecification:
    """Build and preview an EventSpecification deterministically without persistence."""
    service = SpecificationService()
    try:
        spec = service.build_specification(
            event=payload.model_dump(),
            custom_requirements=payload.custom_requirements,
            constraints=payload.constraints,
            objectives=payload.objectives,
            custom_configuration=payload.custom_configuration,
        )
        return spec
    except SpecificationValidationError as err:
        raise BadRequestException(str(err))


@router.get("/{event_id}/specification", response_model=EventSpecification)
def get_event_specification(
    event_id: str,
    db: Session = Depends(get_db_session),
) -> EventSpecification:
    """Retrieve the deterministic EventSpecification for an existing or demo event."""
    spec_service = SpecificationService(db)

    # 1. Check database first
    event_service = EventService(db)
    db_event = event_service.get_event(event_id)
    if db_event:
        try:
            return spec_service.build_specification(event=db_event)
        except SpecificationValidationError as err:
            raise BadRequestException(str(err))

    # 2. Check demo events store
    demo_event = DEMO_EVENTS.get(event_id)
    if demo_event:
        try:
            return spec_service.build_specification(event=demo_event)
        except SpecificationValidationError as err:
            raise BadRequestException(str(err))

    raise NotFoundException(f"Event with id '{event_id}' not found.")


# --- Phase 1: Foundational Event Endpoints ---
@router.get("", response_model=List[EventResponse])
def list_events(
    db: Session = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user_id),
):
    """Lists all events from database."""
    from app.models.event import Event
    events = db.query(Event).order_by(Event.created_at.desc()).all()
    return events


@router.post("", response_model=EventResponse, status_code=status.HTTP_201_CREATED)
def create_event(
    payload: EventCreate,
    db: Session = Depends(get_db_session),
):
    """Creates a new event with authoritative user ownership."""
    service = EventService(db)
    event = service.create_event(payload)
    return event


@router.get("/{event_id}", response_model=EventResponse)
def get_event(
    event_id: str,
    db: Session = Depends(get_db_session),
):
    """Retrieves an event by its unique ID."""
    service = EventService(db)
    event = service.get_event(event_id)
    if not event:
        raise NotFoundException(f"Event with id '{event_id}' not found.")
    return event


@router.post("/{event_id}/members", response_model=EventMemberResponse, status_code=status.HTTP_201_CREATED)
def add_event_member(
    event_id: str,
    payload: EventMemberCreate,
    db: Session = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user_id),
):
    """Adds a collaborator or member to the event with role authorization."""
    service = CollaborationService(db)
    member = service.add_member(event_id, payload, current_user_id=current_user_id)
    return member


@router.get("/{event_id}/members", response_model=List[EventMemberResponse])
def list_event_members(
    event_id: str,
    db: Session = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user_id),
):
    """Lists all members/collaborators for an event."""
    service = CollaborationService(db)
    return service.list_members(event_id, current_user_id=current_user_id)


@router.patch("/{event_id}/members/{member_id}", response_model=EventMemberResponse)
def update_event_member(
    event_id: str,
    member_id: str,
    payload: EventMemberUpdate,
    db: Session = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user_id),
):
    """Updates an event member's role (Organizers only)."""
    service = CollaborationService(db)
    return service.update_member_role(event_id, member_id, payload, current_user_id=current_user_id)


@router.delete("/{event_id}/members/{member_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_event_member(
    event_id: str,
    member_id: str,
    db: Session = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user_id),
):
    """Removes a member from the event (Organizers only)."""
    service = CollaborationService(db)
    service.remove_member(event_id, member_id, current_user_id=current_user_id)
    return None


@router.post("/{event_id}/providers/discover", response_model=ProviderDiscoveryResponse, status_code=status.HTTP_200_OK)
def discover_providers_for_event(
    event_id: str,
    discovery_in: ProviderDiscoveryRequest,
    db: Session = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user_id),
):
    """Context-aware provider discovery for an event using event location, venue, and requirement."""
    service = VendorService(db)
    try:
        vendors, created, updated, source, queries, anchor_coords, anchor_label, anchor_mode = service.discover_providers_for_event(
            event_id=event_id,
            request=discovery_in,
        )
    except ValueError as exc:
        raise NotFoundException(str(exc))

    return ProviderDiscoveryResponse(
        event_id=event_id,
        total_discovered=len(vendors),
        total_created=created,
        total_updated=updated,
        source=source,
        query_used=queries,
        anchor_coordinates=[anchor_coords[0], anchor_coords[1]] if anchor_coords else None,
        anchor_label=anchor_label,
        anchor_mode=anchor_mode,
        items=[VendorResponse.model_validate(v) for v in vendors],
    )


@router.post("/{event_id}/venues/discover", response_model=VenueDiscoveryResponse, status_code=status.HTTP_200_OK)
def discover_venues_for_event(
    event_id: str,
    discovery_in: VenueDiscoveryRequest,
    db: Session = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user_id),
):
    """Context-aware live real venue discovery for an event."""
    event_service = EventService(db)
    event = event_service.get_event(event_id)
    target_city = discovery_in.city
    if not target_city and event and event.location and isinstance(event.location, dict):
        target_city = event.location.get("city")
    if not target_city:
        target_city = "Seattle"

    service = VenueService(db)
    venues, created, city, source = service.discover_live_venues(
        city=target_city,
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


# --- Phase 6: Vendor Outcome Endpoints (Task 6) ---

@router.post("/{event_id}/vendor-outcomes", response_model=VendorOutcomeResponse, status_code=status.HTTP_201_CREATED)
def record_vendor_outcome(
    event_id: str,
    payload: VendorOutcomeCreate,
    db: Session = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user_id),
):
    """Records the organizer-reported outcome of an external vendor interaction.

    CRITICAL ARCHITECTURAL BOUNDARY:
    The outcome is strictly recorded with source='ORGANIZER_REPORTED' and verification_status='UNVERIFIED'.
    Task 6 never mutates task provider assignments or booking confirmations.
    """
    from app.services.vendor_outcome_service import VendorOutcomeService
    from app.models.vendor import Vendor
    from app.models.task import Task

    service = VendorOutcomeService(db)
    outcome = service.record_outcome(event_id, payload, submitted_by=current_user_id)

    vendor = db.query(Vendor).filter(Vendor.id == outcome.provider_id).first()
    task = db.query(Task).filter(Task.id == outcome.task_id).first() if outcome.task_id else None

    resp = VendorOutcomeResponse.model_validate(outcome)
    resp.provider_name = vendor.name if vendor else None
    resp.task_name = task.name if task else None
    return resp


@router.get("/{event_id}/vendor-outcomes", response_model=List[VendorOutcomeResponse], status_code=status.HTTP_200_OK)
def list_vendor_outcomes(
    event_id: str,
    provider_id: Optional[str] = Query(None, description="Optional vendor ID filter"),
    task_id: Optional[str] = Query(None, description="Optional task ID filter"),
    db: Session = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user_id),
):
    """Lists historical organizer-reported vendor outcomes for an event in reverse chronological order."""
    from app.services.vendor_outcome_service import VendorOutcomeService
    from app.models.vendor import Vendor
    from app.models.task import Task

    service = VendorOutcomeService(db)
    outcomes = service.get_outcomes_for_event(event_id, provider_id=provider_id, task_id=task_id)

    results: List[VendorOutcomeResponse] = []
    for o in outcomes:
        vendor = db.query(Vendor).filter(Vendor.id == o.provider_id).first()
        task = db.query(Task).filter(Task.id == o.task_id).first() if o.task_id else None
        item = VendorOutcomeResponse.model_validate(o)
        item.provider_name = vendor.name if vendor else None
        item.task_name = task.name if task else None
        results.append(item)
    return results


# --- Phase 7: Vendor Outcome Parsing & Validation Endpoints (Task 7) ---

@router.post(
    "/{event_id}/vendor-outcomes/{outcome_id}/validate",
    response_model=VendorOutcomeValidationResponse,
    status_code=status.HTTP_200_OK,
)
def validate_vendor_outcome_endpoint(
    event_id: str,
    outcome_id: str,
    db: Session = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user_id),
):
    """Parses and deterministically validates an organizer-reported vendor outcome against system state.

    CRITICAL ARCHITECTURAL BOUNDARY:
    Evaluates claims deterministically into PASS, FAIL, UNKNOWN, or CONFLICT.
    Does NOT assign or bind the vendor to the task, does NOT mutate task status or provider_id,
    and does NOT recalculate the event plan or DAG.
    """
    from app.services.vendor_outcome_validation_service import VendorOutcomeValidationService
    from app.models.vendor import Vendor

    service = VendorOutcomeValidationService(db)
    validation = service.validate_outcome(outcome_id=outcome_id, event_id=event_id)
    return VendorOutcomeValidationResponse.model_validate(validation)


@router.get(
    "/{event_id}/vendor-outcomes/{outcome_id}/validation",
    response_model=VendorOutcomeValidationResponse,
    status_code=status.HTTP_200_OK,
)
def get_vendor_outcome_validation_endpoint(
    event_id: str,
    outcome_id: str,
    db: Session = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user_id),
):
    """Retrieves the latest deterministic validation result for a vendor outcome."""
    from app.services.vendor_outcome_validation_service import VendorOutcomeValidationService

    service = VendorOutcomeValidationService(db)
    validation = service.get_validation(outcome_id=outcome_id)
    if not validation:
        raise NotFoundException(f"No validation found for vendor outcome '{outcome_id}'.")
    return VendorOutcomeValidationResponse.model_validate(validation)



