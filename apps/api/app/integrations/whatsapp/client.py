"""OpenWA WhatsApp Gateway Adapter.

Isolates external WhatsApp communication behind ProviderCommunicationProvider using OpenWA.
Falls back safely to MockCommunicationProvider when unconfigured or offline.
Follows docs.open-wa.org REST API specifications.
"""
import time
import uuid
from typing import Any, Dict, List, Optional
import httpx

from app.core.config import settings
from app.integrations.base import ProviderCommunicationProvider, IntegrationResult, IntegrationSource
from app.integrations.communication.mock import MockCommunicationProvider


class OpenWACommunicationAdapter(ProviderCommunicationProvider):
    """OpenWA integration adapter supporting outbound messages, inbound webhooks, and session health."""

    def __init__(
        self,
        base_url: Optional[str] = None,
        api_key: Optional[str] = None,
        session_id: Optional[str] = None,
        webhook_secret: Optional[str] = None,
        timeout_seconds: Optional[int] = None,
        api_token: Optional[str] = None,
        phone_number_id: Optional[str] = None,
        verify_token: Optional[str] = None,
        **kwargs: Any,
    ):
        self.base_url = (base_url or settings.OPENWA_BASE_URL or "http://localhost:2785/api").rstrip("/")
        self.api_key = api_key or settings.OPENWA_API_KEY or api_token
        self.session_id = session_id or settings.OPENWA_SESSION_ID
        self.webhook_secret = webhook_secret or settings.OPENWA_WEBHOOK_SECRET
        self.timeout_seconds = timeout_seconds or settings.OPENWA_TIMEOUT_SECONDS
        self.verify_token = verify_token or settings.WHATSAPP_WEBHOOK_VERIFY_TOKEN
        self.phone_number_id = phone_number_id or settings.WHATSAPP_PHONE_NUMBER_ID
        self._fallback = MockCommunicationProvider()

    def _normalize_chat_id(self, recipient_contact: Optional[str]) -> str:
        """Converts recipient contact into OpenWA WhatsApp chatId format (e.g. 919876543210@c.us)."""
        if not recipient_contact:
            return ""
        contact = recipient_contact.strip()
        if "@c.us" in contact or "@g.us" in contact:
            return contact
        # Extract digits
        digits = "".join(c for c in contact if c.isdigit())
        if not digits:
            return contact
        return f"{digits}@c.us"

    def send_message(
        self,
        event_id: str,
        provider_id: str,
        message: str,
        recipient_contact: Optional[str] = None,
    ) -> IntegrationResult[Dict[str, Any]]:
        """Sends an outbound WhatsApp message via OpenWA REST endpoint:
        POST /api/sessions/{sessionId}/messages/send-text
        """
        # If OpenWA is disabled or session_id is not set, safely use fallback
        if not settings.OPENWA_ENABLED or not self.session_id:
            res = self._fallback.send_message(event_id, provider_id, message, recipient_contact)
            res.error = "OpenWA not enabled or session not configured; captured in fallback."
            return res

        start_time = time.time()
        chat_id = self._normalize_chat_id(recipient_contact)
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["api_key"] = self.api_key
            headers["key"] = self.api_key
            headers["X-API-Key"] = self.api_key

        # OpenWA standard endpoint: POST /sendText with args: {to, content}
        primary_url = f"{self.base_url}/sendText"
        primary_payload = {
            "args": {
                "to": chat_id,
                "content": message,
            }
        }

        try:
            with httpx.Client(timeout=self.timeout_seconds) as client:
                resp = client.post(primary_url, headers=headers, json=primary_payload)
                # Fallback to session-prefixed URL if standard endpoint returned 404
                if resp.status_code == 404:
                    alt_url = f"{self.base_url}/sessions/{self.session_id}/messages/send-text"
                    alt_payload = {"chatId": chat_id, "text": message}
                    resp = client.post(alt_url, headers=headers, json=alt_payload)

                latency = round((time.time() - start_time) * 1000, 2)
                if resp.status_code in (200, 201):
                    try:
                        data = resp.json()
                    except Exception:
                        data = resp.text

                    # Validate that OpenWA did not return an explicit failure boolean
                    if data is False or data == "false" or (isinstance(data, dict) and data.get("error")):
                        err_text = data.get("error") if isinstance(data, dict) else "OpenWA rejected dispatch (recipient unreachable or session not ready)."
                        res = self._fallback.send_message(event_id, provider_id, message, recipient_contact)
                        res.source = IntegrationSource.REAL
                        res.success = False
                        res.error = str(err_text)
                        return res

                    msg_id = None
                    if isinstance(data, dict):
                        msg_id = data.get("id") or data.get("messageId") or data.get("response") or str(uuid.uuid4())
                    elif isinstance(data, str) and len(data.strip()) > 4:
                        msg_id = data.strip().strip('"')
                    else:
                        msg_id = str(uuid.uuid4())

                    record = {
                        "id": str(msg_id),
                        "event_id": event_id,
                        "provider_id": provider_id,
                        "recipient_contact": recipient_contact,
                        "chat_id": chat_id,
                        "message": message,
                        "direction": "OUTBOUND",
                        "channel": "WHATSAPP",
                        "status": "SENT",
                        "timestamp": time.time(),
                        "is_simulation": False,
                    }
                    self._fallback._history.append(record)
                    return IntegrationResult(
                        data=record,
                        source=IntegrationSource.REAL,
                        success=True,
                        latency_ms=latency,
                    )
                else:
                    # Fall back safely to mock provider
                    res = self._fallback.send_message(event_id, provider_id, message, recipient_contact)
                    res.source = IntegrationSource.MOCK
                    res.error = f"OpenWA dispatch returned HTTP {resp.status_code}; captured in fallback mock."
                    return res
        except Exception as err:
            # Fall back safely to mock provider
            res = self._fallback.send_message(event_id, provider_id, message, recipient_contact)
            res.source = IntegrationSource.MOCK
            res.error = f"OpenWA offline ({err}); captured in fallback mock."
            return res

    def get_messages(
        self,
        event_id: str,
        provider_id: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """Retrieves in-memory message history for this session."""
        return self._fallback.get_messages(event_id, provider_id)

    def receive_inbound(
        self,
        payload: Dict[str, Any],
        signature: Optional[str] = None,
    ) -> IntegrationResult[Dict[str, Any]]:
        """Normalizes an inbound webhook payload.
        Supports both OpenWA format (direct / data dict) and Meta Cloud API format (entry -> changes -> value -> messages).
        """
        try:
            # 1. Check for Meta Cloud API format (entry -> changes -> value -> messages)
            if "entry" in payload:
                entry = payload.get("entry", [{}])[0]
                change = entry.get("changes", [{}])[0]
                val = change.get("value", {})
                msgs = val.get("messages", [])
                if msgs:
                    raw_msg = msgs[0]
                    sender = raw_msg.get("from", "")
                    text = raw_msg.get("text", {}).get("body", "")
                    msg_id = raw_msg.get("id", str(uuid.uuid4()))
                    normalized = {
                        "id": str(msg_id),
                        "sender": sender,
                        "message": text,
                        "direction": "INBOUND",
                        "channel": "WHATSAPP",
                        "timestamp": time.time(),
                        "is_simulation": False,
                    }
                    self._fallback._history.append(normalized)
                    return IntegrationResult(
                        data=normalized,
                        source=IntegrationSource.REAL,
                        success=True,
                        latency_ms=1.0,
                    )

            # 2. Check for OpenWA event format
            data = payload.get("data", payload)
            if isinstance(data, list) and len(data) > 0:
                data = data[0]

            msg_id = data.get("id") or payload.get("id") or str(uuid.uuid4())
            sender = data.get("from") or data.get("chatId") or payload.get("from") or ""
            text = (
                data.get("body")
                or data.get("text")
                or data.get("message")
                or payload.get("body")
                or ""
            )

            event_id = payload.get("event_id") or data.get("event_id") or "UNKNOWN"
            provider_id = payload.get("provider_id") or data.get("provider_id") or "UNKNOWN"

            normalized = {
                "id": str(msg_id),
                "event_id": event_id,
                "provider_id": provider_id,
                "sender": sender,
                "message": text,
                "direction": "INBOUND",
                "channel": "WHATSAPP",
                "timestamp": time.time(),
                "is_simulation": False,
            }
            self._fallback._history.append(normalized)
            return IntegrationResult(
                data=normalized,
                source=IntegrationSource.REAL,
                success=True,
                latency_ms=1.0,
            )
        except Exception as err:
            return self._fallback.receive_inbound(payload, signature)

    def check_health(self) -> Dict[str, Any]:
        """Performs a non-leaking health check against the OpenWA gateway."""
        if not settings.OPENWA_ENABLED:
            return {"configured": False, "enabled": False, "status": "DISABLED"}
        headers = {}
        if self.api_key:
            headers["api_key"] = self.api_key
            headers["X-API-Key"] = self.api_key
        try:
            with httpx.Client(timeout=3) as client:
                resp = client.get(self.base_url, headers=headers)
                return {
                    "configured": True,
                    "enabled": True,
                    "status": "HEALTHY" if resp.status_code in (200, 201) else f"HTTP_{resp.status_code}",
                    "base_url": self.base_url,
                }
        except Exception as err:
            return {
                "configured": True,
                "enabled": True,
                "status": "UNREACHABLE",
                "base_url": self.base_url,
                "error": str(err),
            }

    def get_session_status(self) -> Dict[str, Any]:
        """Queries session status from OpenWA for the configured session_id."""
        if not self.session_id:
            return {"session_id": None, "status": "NOT_CONFIGURED", "connected": False}
        headers = {}
        if self.api_key:
            headers["api_key"] = self.api_key
            headers["X-API-Key"] = self.api_key
        try:
            with httpx.Client(timeout=3) as client:
                # 1. Check if QR code is actively awaiting scan
                qr_resp = client.get(f"{self.base_url}/qr", headers=headers)
                if qr_resp.status_code == 200 and len(qr_resp.content) > 100:
                    return {
                        "session_id": self.session_id,
                        "status": "QR_READY",
                        "connected": False,
                        "qr_available": True,
                    }
                # 2. Check session endpoint if already paired
                resp = client.get(f"{self.base_url}/sessions/{self.session_id}", headers=headers)
                if resp.status_code == 200:
                    data = resp.json()
                    return {
                        "session_id": self.session_id,
                        "status": data.get("status") or "ACTIVE",
                        "connected": data.get("connected", True),
                    }
                return {"session_id": self.session_id, "status": f"HTTP_{resp.status_code}", "connected": False}
        except Exception as err:
            return {"session_id": self.session_id, "status": "UNREACHABLE", "connected": False, "error": str(err)}

    def verify_webhook_token(self, mode: str, token: str) -> bool:
        """Validates webhook challenge token for legacy Meta or custom integrations."""
        if not self.verify_token:
            return True
        return mode == "subscribe" and token == self.verify_token


# Backward-compatible alias
WhatsAppAdapter = OpenWACommunicationAdapter
