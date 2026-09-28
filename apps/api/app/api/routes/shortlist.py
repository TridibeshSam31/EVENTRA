"""API Routes: Event Candidate Shortlist (Persistent Event-Scoped Shortlist).

Provides endpoints to add, list, and remove shortlist entries for an event.
Survives refresh, navigation, and page reloads, and synchronizes across the workspace via live_broker.
"""
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.api.dependencies import get_db_session
from app.models.event import Event
from app.models.shortlist import EventShortlistEntry
from app.schemas.shortlist import (
    ShortlistEntryCreate,
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
