"""Organizer alerts that are actually stored.

``ApprovalNotificationDispatcher.notify_organizers`` calls the in-app provider
without a database session, so its in-app notification is never persisted (only
web push goes out). UX v3 alerts (vendor no reply, negotiation round limit) use
this helper, which persists the in-app notification with the caller's session so
it shows up in ``GET /notifications/list``.
"""
import logging
from typing import Any, Dict, Optional

from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)


def alert_organizers(
    db: Session,
    event_id: str,
    title: str,
    message: str,
    payload: Optional[Dict[str, Any]] = None,
    notification_type: str = "OPERATIONAL_ALERT",
) -> None:
    """Store an in-app alert for the event's organizers. Never raises."""
    from app.integrations.notifications.providers import InAppNotificationProvider
    from app.integrations.registry import registry

    try:
        provider = registry.get_notification_provider()
        kwargs = dict(
            event_id=event_id,
            notification_type=notification_type,
            title=title,
            message=message,
            channel="IN_APP",
            payload=payload or {},
        )
        if isinstance(provider, InAppNotificationProvider):
            provider.send_notification(**kwargs, db=db)
        else:
            provider.send_notification(**kwargs)
    except Exception as exc:
        logger.warning("Could not store organizer alert: %s", exc)
