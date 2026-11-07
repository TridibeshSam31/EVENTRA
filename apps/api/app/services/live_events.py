"""Best-effort broadcast of authoritative state changes to live (SSE) subscribers."""
import logging
from typing import Any

logger = logging.getLogger(__name__)


def publish(event_id: str, event_type: str, **data: Any) -> None:
    """Never raises: a failed broadcast must not roll back a committed state change."""
    try:
        from app.services.live_broker import live_broker

        live_broker.publish_sync(event_id, {"type": event_type, **data})
    except Exception as exc:
        logger.debug("Live broadcast %s for %s failed: %s", event_type, event_id, exc)
