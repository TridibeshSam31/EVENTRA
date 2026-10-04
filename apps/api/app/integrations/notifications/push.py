"""Integration Adapter: Web Push (pywebpush with Mock mode)."""
import json
import logging
from typing import Any, Dict, Optional
from app.core.config import settings
from app.integrations.base import IntegrationResult, IntegrationSource

logger = logging.getLogger(__name__)


class PushAdapter:
    """Delivers browser push notifications via Web Push protocol (pywebpush) with mock fallback."""

    def __init__(
        self,
        vapid_private_key: Optional[str] = None,
        vapid_claim_email: Optional[str] = None,
    ):
        self.vapid_private_key = vapid_private_key or settings.VAPID_PRIVATE_KEY
        self.vapid_claim_email = vapid_claim_email or settings.VAPID_CLAIM_EMAIL or "admin@eventra.local"

    @property
    def is_configured(self) -> bool:
        """Returns True if real VAPID private key is available."""
        return bool(self.vapid_private_key and settings.COMMUNICATION_PROVIDER != "mock")

    def send_push(
        self,
        subscription_info: Dict[str, Any],
        payload: Dict[str, Any],
    ) -> IntegrationResult[Dict[str, Any]]:
        """Sends a push notification to a client's subscription endpoint.
        
        subscription_info structure:
        {
            "endpoint": "https://...",
            "keys": {
                "p256dh": "...",
                "auth": "..."
            }
        }
        """
        payload_json = json.dumps(payload, default=str)

        # Fallback to mock if not configured or in mock mode
        if not self.is_configured:
            logger.info(
                "[MOCK PUSH] Sent web push to endpoint=%s with payload=%s",
                subscription_info.get("endpoint", "")[:40],
                payload.get("title", ""),
            )
            return IntegrationResult(
                success=True,
                source=IntegrationSource.MOCK,
                data={
                    "status": "MOCK_DELIVERED",
                    "endpoint": subscription_info.get("endpoint"),
                    "payload": payload,
                },
            )

        try:
            from pywebpush import webpush, WebPushException

            vapid_claims = {
                "sub": f"mailto:{self.vapid_claim_email}",
            }
            response = webpush(
                subscription_info=subscription_info,
                data=payload_json,
                vapid_private_key=self.vapid_private_key,
                vapid_claims=vapid_claims,
                timeout=10,
            )
            status_code = getattr(response, "status_code", 201)
            return IntegrationResult(
                success=True,
                source=IntegrationSource.REAL,
                data={
                    "status_code": status_code,
                    "endpoint": subscription_info.get("endpoint"),
                },
            )
        except Exception as exc:
            from pywebpush import WebPushException
            is_unsubscribed = False
            status_code = getattr(getattr(exc, "response", None), "status_code", None)
            if isinstance(exc, WebPushException) and status_code in (404, 410):
                is_unsubscribed = True

            logger.warning(
                "Web push delivery failed to endpoint=%s (status=%s, unsubscribed=%s): %s",
                subscription_info.get("endpoint", "")[:40],
                status_code,
                is_unsubscribed,
                exc,
            )
            return IntegrationResult(
                success=False,
                source=IntegrationSource.REAL,
                error=str(exc),
                data={
                    "status_code": status_code,
                    "is_unsubscribed": is_unsubscribed,
                    "endpoint": subscription_info.get("endpoint"),
                },
            )
