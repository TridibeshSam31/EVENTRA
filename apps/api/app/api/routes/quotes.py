"""Quote comparison (UX v3 §4): every vendor's current price for an event, side by side."""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.api.dependencies import get_db_session
from app.models.event import Event
from app.services.quotes_service import list_quotes

router = APIRouter(prefix="/events", tags=["quotes"])


@router.get("/{event_id}/quotes", status_code=status.HTTP_200_OK)
def get_event_quotes(
    event_id: str,
    category: Optional[str] = Query(None, description="Only this provider category, e.g. CATERING"),
    db: Session = Depends(get_db_session),
):
    """Current quotes from every engaged vendor, cheapest first, grouped per category.

    Only stored values are returned: a vendor that has not quoted has ``quoted_amount: null``.
    """
    if db.get(Event, event_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found")
    return list_quotes(db, event_id, category)
