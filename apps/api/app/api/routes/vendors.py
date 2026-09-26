"""API Route: Vendors (Provider Network Discovery, Availability, and Assignment)"""
from typing import Any, List, Optional
from datetime import datetime
from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from app.api.dependencies import get_db_session
from app.services.vendor_service import VendorService
from app.schemas.vendor import (
    VendorCreate,
    VendorResponse,
    ProviderAvailabilityCreate,
    ProviderAvailabilityResponse,
    ProviderAvailabilityResult,
    VendorAssignmentCreate,
    VendorAssignmentResponse,
    CategoryValidationResult,
    PaginatedVendorsResponse,
    ProviderDiscoveryRequest,
    ProviderDiscoveryResponse,
    ProviderEngagementRequest,
    SimulateProviderRequest,
)
from app.core.exceptions import AppException

router = APIRouter(prefix="/vendors", tags=["vendors"])


@router.post("/discover", response_model=ProviderDiscoveryResponse, status_code=status.HTTP_200_OK)
def discover_providers(
    discovery_in: ProviderDiscoveryRequest,
    db: Session = Depends(get_db_session),
):
    """Discovers providers from Google Maps, normalizes, classifies into EVENTRA taxonomy,

    deduplicates, and stores them in the Provider Network.
    """
    service = VendorService(db)
    vendors, created, updated, source, queries = service.discover_providers(discovery_in)
    return ProviderDiscoveryResponse(
        total_discovered=len(vendors),
        total_created=created,
        total_updated=updated,
        source=source,
        query_used=queries,
        items=[VendorResponse.model_validate(v) for v in vendors],
    )


@router.post("/agentic-discovery", status_code=status.HTTP_200_OK)
def run_agentic_provider_discovery(
    request_in: Any,
    db: Session = Depends(get_db_session),
):
    """Executes multi-iteration agentic provider discovery pipeline with qualification,

    ranking, outreach availability confirmation, and tiered shortlist output.
    """
    from app.schemas.agentic_discovery import (
        AgenticDiscoveryRequest,
        AgenticDiscoveryResponse,
        map_ranked_candidate_to_card,
    )
    from app.services.agentic_discovery_controller import AgenticDiscoveryController

    req = AgenticDiscoveryRequest.model_validate(request_in)
    controller = AgenticDiscoveryController(
        db=db,
        max_iterations=req.max_iterations,
        target_count=req.target_count,
    )
    result = controller.execute_discovery(
        event_id=None,
        category=req.category,
        location=req.location,
        event_type=req.event_type or "GENERIC",
        guest_count=req.guest_count,
        max_budget=req.max_budget,
        base_radius_km=req.base_radius_km,
        required_amenities=req.required_amenities,
        latitude=req.latitude,
        longitude=req.longitude,
        simulate_outreach=req.simulate_outreach,
    )

    return AgenticDiscoveryResponse(
        top_matches=[map_ranked_candidate_to_card(c) for c in result.top_matches],
        other_available_options=[map_ranked_candidate_to_card(c) for c in result.other_available_options],
        backup_waitlist=[map_ranked_candidate_to_card(c) for c in result.backup_waitlist],
        funnel_stats=result.funnel_stats,
        target_count_met=result.target_count_met,
        diagnosis_message=result.diagnosis_message,
        search_queries_used=result.search_queries_used,
    )


@router.get("", response_model=PaginatedVendorsResponse)
def search_vendors(
    category: Optional[str] = Query(None, description="Provider category (e.g. catering, sound, lighting)"),
    city: Optional[str] = Query(None, description="Filter by city (case-insensitive)"),
    status: Optional[str] = Query("ACTIVE", description="Operational status"),
    max_base_cost: Optional[float] = Query(None, ge=0.0, description="Maximum base cost"),
    available_from: Optional[datetime] = Query(None, description="Start of availability window"),
    available_to: Optional[datetime] = Query(None, description="End of availability window"),
    limit: int = Query(50, ge=1, le=100, description="Items per page"),
    offset: int = Query(0, ge=0, description="Page offset"),
    db: Session = Depends(get_db_session),
):
    """Deterministically searches and filters providers."""
    service = VendorService(db)
    try:
        items, total = service.search_vendors(
            category=category,
            city=city,
            status=status,
            max_base_cost=max_base_cost,
            available_from=available_from,
            available_to=available_to,
            limit=limit,
            offset=offset,
        )
    except ValueError as exc:
        raise AppException(message=str(exc), status_code=status.HTTP_400_BAD_REQUEST, code="INVALID_PARAMETERS")

    return PaginatedVendorsResponse(
        total=total,
        items=[VendorResponse.model_validate(v) for v in items],
        limit=limit,
        offset=offset,
    )


@router.post("", response_model=VendorResponse, status_code=status.HTTP_201_CREATED)
def create_vendor(
    vendor_in: VendorCreate,
    db: Session = Depends(get_db_session),
):
    """Registers a new provider in the provider network."""
    service = VendorService(db)
    vendor = service.create_vendor(vendor_in)
    return VendorResponse.model_validate(vendor)


@router.get("/categories/validate", response_model=CategoryValidationResult)
def validate_category(
    domain: str = Query(..., description="Event domain (e.g., wedding, college_fest, conference)"),
    category: str = Query(..., description="Provider category to validate"),
    db: Session = Depends(get_db_session),
):
    """Deterministically checks if a provider category is valid and required for an event domain."""
    service = VendorService(db)
    try:
        return service.validate_category_for_domain(domain, category)
    except ValueError as exc:
        raise AppException(message=str(exc), status_code=status.HTTP_400_BAD_REQUEST, code="UNKNOWN_DOMAIN")


@router.get("/assignments/event/{event_id}", response_model=List[VendorAssignmentResponse])
def get_assignments_for_event(
    event_id: str,
    db: Session = Depends(get_db_session),
):
    """Lists all provider assignments for an event with stable ordering."""
    service = VendorService(db)
    assignments = service.get_assignments_for_event(event_id)
    return [VendorAssignmentResponse.model_validate(a) for a in assignments]


@router.post("/assignments", response_model=VendorAssignmentResponse, status_code=status.HTTP_201_CREATED)
def create_assignment(
    assignment_in: VendorAssignmentCreate,
    db: Session = Depends(get_db_session),
):
    """Records an operational provider assignment for an event."""
    service = VendorService(db)
    try:
        assignment = service.create_assignment(assignment_in)
        return VendorAssignmentResponse.model_validate(assignment)
    except ValueError as exc:
        raise AppException(message=str(exc), status_code=status.HTTP_404_NOT_FOUND, code="RESOURCE_NOT_FOUND")


@router.get("/{vendor_id}", response_model=VendorResponse)
def get_vendor(
    vendor_id: str,
    db: Session = Depends(get_db_session),
):
    """Retrieves single provider record by ID."""
    service = VendorService(db)
    vendor = service.get_vendor(vendor_id)
    if not vendor:
        raise AppException(
            message=f"Provider '{vendor_id}' not found",
            status_code=status.HTTP_404_NOT_FOUND,
            code="PROVIDER_NOT_FOUND",
        )
    return VendorResponse.model_validate(vendor)


@router.post("/{vendor_id}/availability", response_model=ProviderAvailabilityResponse, status_code=status.HTTP_201_CREATED)
def add_provider_availability(
    vendor_id: str,
    avail_in: ProviderAvailabilityCreate,
    db: Session = Depends(get_db_session),
):
    """Records provider availability or blackout window (AVAILABLE, BOOKED, BLOCKED)."""
    service = VendorService(db)
    try:
        slot = service.add_provider_availability(vendor_id, avail_in)
        return ProviderAvailabilityResponse.model_validate(slot)
    except ValueError as exc:
        err_msg = str(exc)
        if "not found" in err_msg:
            raise AppException(message=err_msg, status_code=status.HTTP_404_NOT_FOUND, code="PROVIDER_NOT_FOUND")
        raise AppException(message=err_msg, status_code=status.HTTP_400_BAD_REQUEST, code="INVALID_TIMEFRAME")


@router.get("/{vendor_id}/availability", response_model=ProviderAvailabilityResult)
def check_provider_availability(
    vendor_id: str,
    start_datetime: datetime = Query(..., description="Start of requested window"),
    end_datetime: datetime = Query(..., description="End of requested window"),
    db: Session = Depends(get_db_session),
):
    """Evaluates provider availability for a requested time window."""
    service = VendorService(db)
    try:
        return service.check_provider_availability(
            vendor_id=vendor_id,
            start_datetime=start_datetime,
            end_datetime=end_datetime,
        )
    except ValueError as exc:
        err_msg = str(exc)
        if "not found" in err_msg:
            raise AppException(message=err_msg, status_code=status.HTTP_404_NOT_FOUND, code="PROVIDER_NOT_FOUND")
        raise AppException(message=err_msg, status_code=status.HTTP_400_BAD_REQUEST, code="INVALID_TIMEFRAME")


# ==========================================================
# PROVIDER NEGOTIATION & ENGAGEMENT ROUTES
# ==========================================================

@router.post("/assignments/{assignment_id}/engage", status_code=status.HTTP_200_OK)
def initiate_provider_engagement(
    assignment_id: str,
    payload: ProviderEngagementRequest,
    db: Session = Depends(get_db_session),
):
    """Initiates provider contact for an assignment. Generates engagement message and sends it."""
    from app.services.negotiation_service import NegotiationService
    neg = NegotiationService(db)
    assignment = neg._get_assignment(assignment_id)
    try:
        result = neg.initiate_engagement(
            event_id=assignment.event_id,
            assignment_id=assignment_id,
            target_amount=payload.target_amount,
            max_approved_amount=payload.max_approved_amount,
            currency=payload.currency,
            required_coverage_start=payload.required_coverage_start,
            required_coverage_end=payload.required_coverage_end,
        )
        return result
    except Exception as exc:
        raise AppException(message=str(exc), status_code=status.HTTP_400_BAD_REQUEST, code="ENGAGEMENT_FAILED")


@router.post("/assignments/{assignment_id}/simulate", status_code=status.HTTP_200_OK)
def simulate_provider_response(
    assignment_id: str,
    payload: SimulateProviderRequest,
    db: Session = Depends(get_db_session),
):
    """DEMO SIMULATION — Simulates a provider response scenario.

    Scenarios: ACCEPT, COUNTER, DECLINE, NO_RESPONSE.
    Simulated communication is clearly labeled and goes through the real EVENTRA state pipeline.
    """
    from app.services.negotiation_service import NegotiationService
    neg = NegotiationService(db)
    try:
        result = neg.simulate_response(
            assignment_id=assignment_id,
            scenario=payload.scenario,
            quoted_amount=payload.quoted_amount,
            coverage_start=payload.counter_coverage_start,
            coverage_end=payload.counter_coverage_end,
            advance_required=payload.advance_required,
            provider_count=payload.provider_count,
            custom_message=payload.message,
        )
        return result
    except Exception as exc:
        raise AppException(message=str(exc), status_code=status.HTTP_400_BAD_REQUEST, code="SIMULATION_FAILED")


@router.post("/assignments/{assignment_id}/negotiate", status_code=status.HTTP_200_OK)
def negotiate_with_provider(
    assignment_id: str,
    db: Session = Depends(get_db_session),
):
    """Sends a counter-offer to the provider. Agent negotiates toward target, never exceeds ceiling."""
    from app.services.negotiation_service import NegotiationService
    neg = NegotiationService(db)
    try:
        result = neg.negotiate(assignment_id=assignment_id)
        return result
    except Exception as exc:
        raise AppException(message=str(exc), status_code=status.HTTP_400_BAD_REQUEST, code="NEGOTIATION_FAILED")


@router.post("/assignments/{assignment_id}/request-approval", status_code=status.HTTP_200_OK)
def request_engagement_approval(
    assignment_id: str,
    db: Session = Depends(get_db_session),
):
    """Creates an approval request for a provider engagement. Human approval is ALWAYS required."""
    from app.services.negotiation_service import NegotiationService
    neg = NegotiationService(db)
    assignment = neg._get_assignment(assignment_id)
    try:
        result = neg.request_approval(
            event_id=assignment.event_id,
            assignment_id=assignment_id,
        )
        return result
    except Exception as exc:
        raise AppException(message=str(exc), status_code=status.HTTP_400_BAD_REQUEST, code="APPROVAL_REQUEST_FAILED")


@router.post("/assignments/{assignment_id}/confirm", status_code=status.HTTP_200_OK)
def confirm_provider_engagement(
    assignment_id: str,
    db: Session = Depends(get_db_session),
):
    """Confirms provider engagement AFTER human approval. Updates assignment to CONFIRMED."""
    from app.services.negotiation_service import NegotiationService
    neg = NegotiationService(db)
    try:
        result = neg.confirm_engagement(assignment_id=assignment_id)
        return result
    except Exception as exc:
        raise AppException(message=str(exc), status_code=status.HTTP_400_BAD_REQUEST, code="CONFIRMATION_FAILED")


@router.get("/assignments/{assignment_id}/conversation")
def get_negotiation_conversation(
    assignment_id: str,
    db: Session = Depends(get_db_session),
):
    """Retrieves the full negotiation conversation thread and state for an assignment."""
    from app.services.negotiation_service import NegotiationService
    neg = NegotiationService(db)
    try:
        data = neg.get_conversation(assignment_id=assignment_id)
        assignment = data["assignment"]
        vendor = data.get("vendor")
        return {
            "assignment": VendorAssignmentResponse.model_validate(assignment),
            "vendor": VendorResponse.model_validate(vendor) if vendor else None,
            "messages": data["messages"],
            "budget_validation": data.get("budget_validation"),
            "requirement_validation": data.get("requirement_validation"),
        }
    except Exception as exc:
        raise AppException(message=str(exc), status_code=status.HTTP_404_NOT_FOUND, code="CONVERSATION_NOT_FOUND")

