"""API Routes: Event Candidate Shortlist (Persistent Event-Scoped Shortlist).

Provides endpoints to add, list, and remove shortlist entries for an event.
Survives refresh, navigation, and page reloads, and synchronizes across the workspace via live_broker.
"""
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
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
    # Venue and discovery-candidate ids are not vendor ids; only real vendors get an assignment.
    from app.models.vendor import Vendor
    if not existing_asg and entry.provider_id and db.get(Vendor, entry.provider_id):
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
    Strictly gated: verifies an identified organizer, candidate selection, then dispatches
    a real WhatsApp message and a real AI phone call as independent operations.
    """
    event, entry = _load_selected_entry(db, event_id, candidate_id)
    _require_outreach_authority(db, event, current_user_id)

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

    from app.models.shortlist import utc_now
    from app.services.identity_service import ensure_user_exists
    approver = ensure_user_exists(db, current_user_id)
    if approval.status != "APPROVED":
        approval.status = "APPROVED"
        approval.approver_id = approver.id
        approval.decided_at = utc_now()
    c_data = dict(entry.candidate_data or {})
    comm = dict(c_data.get("communication") or {})
    comm.update({"approval_id": approval.id, "approval_status": "APPROVED"})
    c_data["communication"] = comm
    entry.candidate_data = c_data
    db.commit()

    from app.services.vendor_outreach_service import VendorOutreachService
    VendorOutreachService(db).start_outreach(event, entry, actor_id=approver.id, approval_id=approval.id)

    db.refresh(entry)
    return ShortlistEntryResponse.model_validate(entry)


@router.get(
    "/{event_id}/shortlist/{candidate_id}/communication",
    status_code=status.HTTP_200_OK,
)
def get_candidate_communication(
    event_id: str,
    candidate_id: str,
    refresh: bool = Query(False, description="Pull the latest WhatsApp ack from OpenWA and call state from Twilio"),
    db: Session = Depends(get_db_session),
):
    """Returns the persisted per-channel communication status for a selected candidate."""
    from app.services.vendor_outreach_service import VendorOutreachService

    _, entry = _load_selected_entry(db, event_id, candidate_id, require_selected=False)
    service = VendorOutreachService(db)
    if refresh:
        service.refresh_whatsapp_acks(entry)
        service.refresh_whatsapp_replies(entry)
        service.refresh_call_status(entry)
        service.refresh_call_analysis(entry)
    return service.summary(entry)


@router.post(
    "/{event_id}/shortlist/{candidate_id}/communication/{channel}/retry",
    response_model=ShortlistEntryResponse,
    status_code=status.HTTP_200_OK,
)
def retry_candidate_communication(
    event_id: str,
    candidate_id: str,
    channel: str,
    db: Session = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user_id),
) -> ShortlistEntryResponse:
    """Retries one failed channel. The other channel is never re-sent."""
    from app.services.vendor_outreach_service import CHANNELS, VendorOutreachService

    channel_key = channel.upper()
    if channel_key not in CHANNELS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Channel must be 'whatsapp' or 'call'.")
    event, entry = _load_selected_entry(db, event_id, candidate_id)
    _require_outreach_authority(db, event, current_user_id)

    comm = (entry.candidate_data or {}).get("communication") or {}
    if comm.get("approval_status") != "APPROVED":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Communication with this candidate has not been approved yet.",
        )
    service = VendorOutreachService(db)
    current = service.summary(entry)["whatsapp" if channel_key == "WHATSAPP" else "call"]
    redial = channel_key == "CALL" and current["status"] == "COMPLETED"
    if current["status"] != "NOT_ATTEMPTED" and not current["retryable"] and not redial:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"This {channel.lower()} is '{current['status']}' and cannot be retried.",
        )
    service.start_outreach(
        event, entry, actor_id=current_user_id, approval_id=comm.get("approval_id"), channels=[channel_key], redial=redial
    )
    db.refresh(entry)
    return ShortlistEntryResponse.model_validate(entry)


class WhatsAppFollowupRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=1000)


def _approved_outreach(db: Session, event_id: str, candidate_id: str, user_id: str):
    event, entry = _load_selected_entry(db, event_id, candidate_id)
    _require_outreach_authority(db, event, user_id)
    comm = (entry.candidate_data or {}).get("communication") or {}
    if comm.get("approval_status") != "APPROVED":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Communication with this candidate has not been approved yet.")
    return event, entry


@router.get("/{event_id}/shortlist/{candidate_id}/communication/whatsapp/draft", status_code=status.HTTP_200_OK)
def draft_whatsapp_followup(
    event_id: str,
    candidate_id: str,
    db: Session = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user_id),
):
    """Drafts the next WhatsApp message for the organizer to review. Nothing is sent."""
    from app.services.vendor_outreach_service import VendorOutreachService

    _, entry = _approved_outreach(db, event_id, candidate_id, current_user_id)
    return VendorOutreachService(db).draft_whatsapp_followup(entry)


@router.post("/{event_id}/shortlist/{candidate_id}/communication/whatsapp/send", status_code=status.HTTP_200_OK)
def send_whatsapp_followup(
    event_id: str,
    candidate_id: str,
    payload: WhatsAppFollowupRequest,
    db: Session = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user_id),
):
    """Sends the organizer-reviewed follow-up text to the vendor on WhatsApp (one explicit click = one message)."""
    from app.services.vendor_outreach_service import VendorOutreachService

    event, entry = _approved_outreach(db, event_id, candidate_id, current_user_id)
    text = payload.text.strip()
    if not text:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Message is empty.")
    try:
        return VendorOutreachService(db).send_whatsapp_followup(event, entry, text, current_user_id)
    except ValueError as err:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(err))
    except RuntimeError as err:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(err))


def _load_selected_entry(db: Session, event_id: str, candidate_id: str, require_selected: bool = True):
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Event '{event_id}' not found.")
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
    if require_selected and entry.status != "SELECTED":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Candidate '{candidate_id}' is in status '{entry.status}'. Communication approval requires candidate to be SELECTED first.",
        )
    return event, entry


def _require_outreach_authority(db: Session, event: Event, user_id: str) -> None:
    from app.services.vendor_outreach_service import OutreachAuthorizationError, require_real_organizer

    try:
        require_real_organizer(db, event, user_id)
    except OutreachAuthorizationError as err:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(err))


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

