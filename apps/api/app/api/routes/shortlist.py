"""API Routes: Event Candidate Shortlist (Persistent Event-Scoped Shortlist).

Provides endpoints to add, list, and remove shortlist entries for an event.
Survives refresh, navigation, and page reloads, and synchronizes across the workspace via live_broker.
"""
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user_id, get_db_session
from app.models.event import Event
from app.models.shortlist import EventShortlistEntry
from app.schemas.shortlist import (
    ShortlistEntryCreate,
    ShortlistCandidateSelect,
    ShortlistEntryResponse,
    ShortlistListResponse,
)
from app.services.live_broker import live_broker

router = APIRouter(prefix="/events", tags=["Event Shortlist"])


@router.get(
    "/{event_id}/shortlist",
    response_model=ShortlistListResponse,
    status_code=status.HTTP_200_OK,
)
def get_event_shortlist(
    event_id: str,
    category: Optional[str] = Query(None, description="Optional category filter"),
    status: Optional[str] = Query(None, description="Optional status filter (e.g. RECOMMENDED, SHORTLISTED)"),
    selection_source: Optional[str] = Query(None, description="Optional source filter (e.g. AGENT_RECOMMENDATION, ORGANIZER_SELECTION)"),
    db: Session = Depends(get_db_session),
) -> ShortlistListResponse:
    """Retrieves all persisted shortlist entries for an event."""
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Event '{event_id}' not found.",
        )

    query = db.query(EventShortlistEntry).filter(EventShortlistEntry.event_id == event_id)
    if category:
        query = query.filter(EventShortlistEntry.category.ilike(f"%{category}%"))
    if status:
        query = query.filter(EventShortlistEntry.status == status)
    if selection_source:
        query = query.filter(EventShortlistEntry.selection_source == selection_source)
    entries = query.order_by(EventShortlistEntry.created_at.asc()).all()

    items = [ShortlistEntryResponse.model_validate(e) for e in entries]
    return ShortlistListResponse(items=items, total=len(items))


@router.post(
    "/{event_id}/shortlist",
    response_model=ShortlistEntryResponse,
    status_code=status.HTTP_201_CREATED,
)
def add_event_shortlist_entry(
    event_id: str,
    payload: ShortlistEntryCreate,
    db: Session = Depends(get_db_session),
) -> ShortlistEntryResponse:
    """Persists a candidate to the event's shortlist (idempotent for candidate_id)."""
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Event '{event_id}' not found.",
        )

    # Check if already shortlisted
    existing = (
        db.query(EventShortlistEntry)
        .filter(
            EventShortlistEntry.event_id == event_id,
            EventShortlistEntry.candidate_id == payload.candidate_id,
        )
        .first()
    )

    if existing:
        if payload.status:
            existing.status = payload.status
        if payload.selection_source:
            existing.selection_source = payload.selection_source
        if payload.selected_by is not None:
            existing.selected_by = payload.selected_by
        if payload.selected_at is not None:
            existing.selected_at = payload.selected_at
        if payload.notes:
            existing.notes = payload.notes
        if payload.candidate_data:
            existing.candidate_data = payload.candidate_data
        db.commit()
        db.refresh(existing)
        entry = existing
    else:
        entry = EventShortlistEntry(
            event_id=event_id,
            candidate_id=payload.candidate_id,
            provider_id=payload.provider_id,
            category=payload.category,
            candidate_name=payload.candidate_name,
            status=payload.status or "SHORTLISTED",
            ranking=payload.ranking,
            selection_source=payload.selection_source or "ORGANIZER_SELECTION",
            selected_by=payload.selected_by,
            selected_at=payload.selected_at,
            notes=payload.notes,
            candidate_data=payload.candidate_data or {},
        )
        db.add(entry)
        db.commit()
        db.refresh(entry)

    # Broadcast shortlist mutation across workspace
    live_broker.publish_sync(
        event_id,
        {
            "type": "shortlist.updated",
            "event_id": event_id,
            "action": "added",
            "candidate_id": entry.candidate_id,
            "candidate_name": entry.candidate_name,
            "category": entry.category,
            "status": entry.status,
        },
    )

    return ShortlistEntryResponse.model_validate(entry)


@router.delete(
    "/{event_id}/shortlist/{candidate_id}",
    status_code=status.HTTP_200_OK,
)
def remove_event_shortlist_entry(
    event_id: str,
    candidate_id: str,
    db: Session = Depends(get_db_session),
):
    """Removes a candidate from the event shortlist."""
    entry = (
        db.query(EventShortlistEntry)
        .filter(
            EventShortlistEntry.event_id == event_id,
            EventShortlistEntry.candidate_id == candidate_id,
        )
        .first()
    )

    if not entry:
        # Also try matching by provider_id or id
        entry = (
            db.query(EventShortlistEntry)
            .filter(
                EventShortlistEntry.event_id == event_id,
                (EventShortlistEntry.id == candidate_id) | (EventShortlistEntry.provider_id == candidate_id),
            )
            .first()
        )

    if not entry:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Candidate '{candidate_id}' not found in event '{event_id}' shortlist.",
        )

    db.delete(entry)
    db.commit()

    live_broker.publish_sync(
        event_id,
        {
            "type": "shortlist.updated",
            "event_id": event_id,
            "action": "removed",
            "candidate_id": candidate_id,
        },
    )

    return {"success": True, "message": f"Candidate '{candidate_id}' removed from shortlist."}


@router.post(
    "/{event_id}/shortlist/{candidate_id}/select",
    response_model=ShortlistEntryResponse,
    status_code=status.HTTP_200_OK,
)
def select_event_shortlist_candidate(
    event_id: str,
    candidate_id: str,
    payload: Optional[ShortlistCandidateSelect] = None,
    db: Session = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user_id),
) -> ShortlistEntryResponse:
    """Organizer action to select a candidate from the shortlist.
    Marks status as SELECTED, selection_source as ORGANIZER_SELECTION,
    and creates the corresponding VendorAssignment for the selected candidate.
    """
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Event '{event_id}' not found.",
        )

    entry = (
        db.query(EventShortlistEntry)
        .filter(
            EventShortlistEntry.event_id == event_id,
            (EventShortlistEntry.candidate_id == candidate_id) | (EventShortlistEntry.id == candidate_id),
        )
        .first()
    )
    if not entry:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Candidate '{candidate_id}' not found in event '{event_id}' shortlist.",
        )

    from app.models.shortlist import utc_now
    from app.services.identity_service import resolve_requester_identity, ensure_user_exists

    candidate_actor = (payload.selected_by if payload and payload.selected_by else None) or current_user_id
    requester_id = resolve_requester_identity(db, event_id=event_id, candidate_user_id=candidate_actor)
    selected_by_user = (payload.selected_by if payload and payload.selected_by else None) or requester_id
    ensure_user_exists(db, selected_by_user)

    entry.status = "SELECTED"
    entry.selection_source = "ORGANIZER_SELECTION"
    entry.selected_by = selected_by_user
    entry.selected_at = entry.selected_at or utc_now()

    from app.models.vendor_assignment import VendorAssignment
    existing_asg = (
        db.query(VendorAssignment)
        .filter(
            VendorAssignment.event_id == event_id,
            VendorAssignment.vendor_id == entry.provider_id,
        )
        .first()
    )
    if not existing_asg and entry.provider_id:
        asg = VendorAssignment(
            event_id=event_id,
            vendor_id=entry.provider_id,
            category=entry.category.lower(),
            status="ASSIGNED",
        )
        db.add(asg)

    if entry.category and entry.category.upper() == "VENUE" and entry.provider_id:
        event.venue_id = entry.provider_id

    # Initialize pending communication approval via central ApprovalService boundary
    from app.services.approval_service import ApprovalService
    approval_svc = ApprovalService(db)
    approval, is_new_approval = approval_svc.create_communication_outreach_approval(
        event_id=event_id,
        candidate_id=entry.candidate_id,
        requester_id=entry.selected_by or requester_id,
        candidate_name=entry.candidate_name,
        category=entry.category,
        provider_id=entry.provider_id,
    )

    c_data = dict(entry.candidate_data or {})
    comm_data = dict(c_data.get("communication") or {})
    comm_data["approval_id"] = approval.id
    comm_data["approval_status"] = approval.status
    comm_data["call_status"] = comm_data.get("call_status") or "NOT_ATTEMPTED"
    comm_data["whatsapp_status"] = comm_data.get("whatsapp_status") or "NOT_ATTEMPTED"
    comm_data["overall_status"] = "PENDING_APPROVAL" if approval.status == "PENDING" else approval.status
    comm_data["updated_at"] = utc_now().isoformat()
    c_data["communication"] = comm_data
    entry.candidate_data = c_data

    db.commit()
    db.refresh(entry)

    live_broker.publish_sync(
        event_id,
        {
            "type": "shortlist.selected",
            "event_id": event_id,
            "candidate_id": entry.candidate_id,
            "candidate_name": entry.candidate_name,
            "category": entry.category,
            "status": "SELECTED",
            "selection_source": "ORGANIZER_SELECTION",
            "selected_by": entry.selected_by,
            "selected_at": entry.selected_at.isoformat() if entry.selected_at else None,
        },
    )
    if is_new_approval:
        live_broker.publish_sync(
            event_id,
            {
                "type": "approval.created",
                "event_id": event_id,
                "approval_id": approval.id,
                "action_type": "COMMUNICATION_OUTREACH",
                "target_id": entry.candidate_id,
                "target_name": entry.candidate_name,
                "status": "PENDING",
                "impact_level": "MAJOR",
            },
        )

    return ShortlistEntryResponse.model_validate(entry)


@router.post(
    "/{event_id}/shortlist/{candidate_id}/approve-communication",
    response_model=ShortlistEntryResponse,
    status_code=status.HTTP_200_OK,
)
def approve_candidate_communication(
    event_id: str,
    candidate_id: str,
    db: Session = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user_id),
) -> ShortlistEntryResponse:
    """Organizer explicitly approves communication with the selected candidate.
    Strictly gated: verifies event ownership, candidate selection, and dispatches real Call + WhatsApp.
    """
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Event '{event_id}' not found.",
        )

    # Security: Verify organizer/manager role and authorization
    from app.services.authorization_service import AuthorizationService
    from app.engines.auth.policy import ApprovalPolicy
    from app.core.exceptions import ForbiddenException
    try:
        auth_service = AuthorizationService(db)
        user_role = auth_service.get_user_role(event, current_user_id)
        if not ApprovalPolicy.is_eligible_approver(user_role, "MAJOR"):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Role '{user_role}' is not authorized to approve communication.",
            )
    except ForbiddenException as fe:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(fe))

    entry = (
        db.query(EventShortlistEntry)
        .filter(
            EventShortlistEntry.event_id == event_id,
            (EventShortlistEntry.candidate_id == candidate_id) | (EventShortlistEntry.id == candidate_id),
        )
        .first()
    )
    if not entry:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Candidate '{candidate_id}' not found in event '{event_id}' shortlist.",
        )

    if entry.status != "SELECTED":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Candidate '{candidate_id}' is in status '{entry.status}'. Communication approval requires candidate to be SELECTED first.",
        )

    # Find or create Approval record via central ApprovalService boundary
    from app.services.approval_service import ApprovalService
    approval_svc = ApprovalService(db)
    approval, _ = approval_svc.create_communication_outreach_approval(
        event_id=event_id,
        candidate_id=entry.candidate_id,
        requester_id=entry.selected_by or current_user_id,
        candidate_name=entry.candidate_name,
        category=entry.category,
        provider_id=entry.provider_id,
    )

    from app.services.identity_service import ensure_user_exists
    approver = ensure_user_exists(db, current_user_id)

    # Execute approved communication via ProviderCommunicationService
    from app.services.provider_communication_service import ProviderCommunicationService
    comm_service = ProviderCommunicationService(db)
    comm_service.execute_approved_communication(
        event_id=event_id,
        candidate_id=entry.candidate_id,
        approval_id=approval.id,
        approver_id=approver.id,
    )

    db.refresh(entry)
    return ShortlistEntryResponse.model_validate(entry)


@router.post(
    "/{event_id}/shortlist/{candidate_id}/dismiss-communication",
    response_model=ShortlistEntryResponse,
    status_code=status.HTTP_200_OK,
)
def dismiss_candidate_communication(
    event_id: str,
    candidate_id: str,
    db: Session = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user_id),
) -> ShortlistEntryResponse:
    """Organizer chooses 'Not now' / dismisses communication with the selected candidate.
    Marks approval as REJECTED and communication as DISMISSED without contacting anyone.
    """
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Event '{event_id}' not found.",
        )

    # Security: Verify organizer/manager role and authorization
    from app.services.authorization_service import AuthorizationService
    from app.core.exceptions import ForbiddenException
    try:
        auth_service = AuthorizationService(db)
        auth_service.get_user_role(event, current_user_id)
    except ForbiddenException as fe:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(fe))

    entry = (
        db.query(EventShortlistEntry)
        .filter(
            EventShortlistEntry.event_id == event_id,
            (EventShortlistEntry.candidate_id == candidate_id) | (EventShortlistEntry.id == candidate_id),
        )
        .first()
    )
    if not entry:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Candidate '{candidate_id}' not found in event '{event_id}' shortlist.",
        )

    from app.models.approval import Approval
    from app.models.shortlist import utc_now
    approval = (
        db.query(Approval)
        .filter(
            Approval.event_id == event_id,
            Approval.action_type == "COMMUNICATION_OUTREACH",
            Approval.target_id == entry.candidate_id,
        )
        .first()
    )
    if approval:
        from app.services.identity_service import ensure_user_exists
        approver = ensure_user_exists(db, current_user_id)
        approval.status = "REJECTED"
        approval.approver_id = approver.id
        approval.rejection_reason = "Organizer dismissed communication outreach ('Not now')"
        approval.decided_at = utc_now()

    c_data = dict(entry.candidate_data or {})
    comm_data = dict(c_data.get("communication") or {})
    comm_data["approval_id"] = approval.id if approval else None
    comm_data["approval_status"] = "REJECTED"
    comm_data["call_status"] = "NOT_ATTEMPTED"
    comm_data["whatsapp_status"] = "NOT_ATTEMPTED"
    comm_data["overall_status"] = "DISMISSED"
    comm_data["updated_at"] = utc_now().isoformat()
    c_data["communication"] = comm_data
    entry.candidate_data = c_data

    db.commit()
    db.refresh(entry)

    if approval:
        live_broker.publish_sync(
            event_id,
            {
                "type": "approval.updated",
                "event_id": event_id,
                "approval_id": approval.id,
                "action_type": "COMMUNICATION_OUTREACH",
                "target_id": entry.candidate_id,
                "status": "REJECTED",
                "reason": "Dismissed by organizer",
            },
        )

    live_broker.publish_sync(
        event_id,
        {
            "type": "shortlist.updated",
            "event_id": event_id,
            "action": "communication_dismissed",
            "candidate_id": entry.candidate_id,
            "candidate_name": entry.candidate_name,
            "category": entry.category,
            "status": entry.status,
            "communication": comm_data,
        },
    )

    return ShortlistEntryResponse.model_validate(entry)

