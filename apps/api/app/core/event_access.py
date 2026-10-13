"""Shared event-scoped access check for agent run endpoints.

Mirrors the existing agent-history policy: the event owner and event members
may access runs; the built-in operator/system identities used by the current
header-based identity stub are allowed through unchanged.
"""
from sqlalchemy.orm import Session

from app.core.exceptions import ForbiddenException, NotFoundException
from app.models.event import Event
from app.models.event_member import EventMember

SYSTEM_IDENTITIES = ("anonymous_operator", "system", "SYSTEM")


def verify_event_access(db: Session, event_id: str, user_id: str) -> Event:
    """Returns the event if `user_id` may access it, raising otherwise."""
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise NotFoundException(f"Event '{event_id}' not found.")

    if user_id in SYSTEM_IDENTITIES:
        return event

    if event.owner_id == user_id:
        return event

    member = (
        db.query(EventMember)
        .filter(EventMember.event_id == event_id, EventMember.user_id == user_id)
        .first()
    )
    if not member:
        raise ForbiddenException(f"User '{user_id}' is not authorized to access agent runs for event '{event_id}'.")
    return event
