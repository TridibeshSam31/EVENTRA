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


class OpenWAError(Exception):
    """A sanitized OpenWA failure with a stable code for the UI and tests."""

    def __init__(self, code: str, reason: str):
        super().__init__(reason)
        self.code = code
        self.reason = reason


def _strict_failure(code: str, reason: str) -> IntegrationResult[Dict[str, Any]]:
    return IntegrationResult(
        data={"error_code": code, "channel": "WHATSAPP"},
        source=IntegrationSource.REAL,
        success=False,
        error=reason,
    )


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
        self._cached_health: Optional[Dict[str, Any]] = None
        self._last_health_check: float = 0.0

    @property
    def is_configured(self) -> bool:
        """Checks whether OpenWA is enabled and a session is configured."""
        return bool(settings.OPENWA_ENABLED and self.session_id)

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

        if getattr(self, "_is_unreachable", False) and (time.time() - getattr(self, "_last_unreachable_time", 0) < 60):
            res = self._fallback.send_message(event_id, provider_id, message, recipient_contact)
            res.source = IntegrationSource.MOCK
            res.error = "OpenWA daemon not reachable; captured in fallback."
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
            with httpx.Client(timeout=httpx.Timeout(self.timeout_seconds, connect=1.5)) as client:
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

                    # Validate that OpenWA did not return an explicit failure or error message
                    has_error = (
                        data is False
                        or data == "false"
                        or (isinstance(data, dict) and bool(data.get("error")))
                        or (isinstance(data, str) and ("ERROR:" in data or "Error:" in data or "error" in data.lower()[:20]))
                    )
                    if has_error:
                        err_text = data.get("error") if isinstance(data, dict) else str(data)
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
        except (httpx.ConnectError, httpx.ConnectTimeout) as conn_err:
            self._is_unreachable = True
            self._last_unreachable_time = time.time()
            res = self._fallback.send_message(event_id, provider_id, message, recipient_contact)
            res.source = IntegrationSource.MOCK
            res.error = f"OpenWA offline ({conn_err}); captured in fallback mock."
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
        
        now = time.time()
        if self._cached_health is not None and (now - self._last_health_check) < 10.0:
            return self._cached_health

        headers = {"Content-Type": "application/json", "Connection": "close"}
        if self.api_key:
            headers["api_key"] = self.api_key
            headers["X-API-Key"] = self.api_key
        try:
            with httpx.Client(timeout=2.0) as client:
                resp = client.post(f"{self.base_url}/getHostNumber", headers=headers, json={})
                if resp.status_code == 200 and resp.json().get("success"):
                    host_num = resp.json().get("response", "")
                    health_res = {
                        "configured": True,
                        "enabled": True,
                        "status": "HEALTHY",
                        "base_url": self.base_url,
                        "account_suffix": host_num[-4:] if host_num else None,
                    }
                else:
                    health_res = {
                        "configured": True,
                        "enabled": True,
                        "status": "HEALTHY" if resp.status_code in (200, 302) else f"HTTP_{resp.status_code}",
                        "base_url": self.base_url,
                    }
        except Exception as err:
            health_res = {
                "configured": True,
                "enabled": True,
                "status": "UNREACHABLE",
                "base_url": self.base_url,
                "error": str(err),
            }

        self._cached_health = health_res
        self._last_health_check = now
        return health_res

    def get_session_status(self) -> Dict[str, Any]:
        """Queries session status from OpenWA for the configured session_id."""
        if not self.session_id:
            return {"session_id": None, "status": "NOT_CONFIGURED", "connected": False}
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["api_key"] = self.api_key
            headers["X-API-Key"] = self.api_key
        try:
            with httpx.Client(timeout=5) as client:
                # 1. Check if host number is active
                resp = client.post(f"{self.base_url}/getHostNumber", headers=headers, json={})
                if resp.status_code == 200:
                    data = resp.json()
                    if data.get("success") and data.get("response"):
                        host_num = data.get("response", "")
                        return {
                            "session_id": self.session_id,
                            "status": "ACTIVE",
                            "connected": True,
                            "account_suffix": host_num[-4:] if host_num else None,
                        }

                # 2. Check if QR code is actively awaiting scan
                qr_resp = client.get(f"{self.base_url}/qr", headers=headers)
                if qr_resp.status_code == 200 and len(qr_resp.content) > 100:
                    return {
                        "session_id": self.session_id,
                        "status": "QR_READY",
                        "connected": False,
                        "qr_available": True,
                    }
                return {"session_id": self.session_id, "status": f"HTTP_{resp.status_code}", "connected": False}
        except Exception as err:
            return {"session_id": self.session_id, "status": "UNREACHABLE", "connected": False, "error": str(err)}

    # -----------------------------------------------------------------------
    # Strict operations for approved vendor outreach. Unlike send_message these
    # never fall back to the mock provider: a failure is reported as a failure.
    # -----------------------------------------------------------------------

    def _easy_api_call(self, method: str, args: Dict[str, Any], timeout: Optional[float] = None) -> Any:
        """Calls an open-wa EASY API method (POST /<method> with {args}) and returns its `response`.

        Raises OpenWAError with a sanitized reason on transport errors, HTTP errors or
        an explicit `success: false`.
        """
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["api_key"] = self.api_key
        try:
            with httpx.Client(timeout=httpx.Timeout(timeout or self.timeout_seconds, connect=3.0)) as client:
                resp = client.post(f"{self.base_url}/{method}", headers=headers, json={"args": args})
        except (httpx.ConnectError, httpx.ConnectTimeout):
            raise OpenWAError("OPENWA_UNREACHABLE", "The OpenWA gateway is not reachable. Is the openwa container running?")
        except httpx.TimeoutException:
            raise OpenWAError("OPENWA_TIMEOUT", f"OpenWA did not respond to {method} within the timeout.")
        if resp.status_code in (401, 403):
            raise OpenWAError("OPENWA_AUTH", "OpenWA rejected the API key (check OPENWA_API_KEY).")
        if resp.status_code >= 400:
            raise OpenWAError("OPENWA_HTTP_ERROR", f"OpenWA {method} returned HTTP {resp.status_code}.")
        try:
            body = resp.json()
        except Exception:
            raise OpenWAError("OPENWA_BAD_RESPONSE", f"OpenWA {method} returned a non-JSON response.")
        if isinstance(body, dict) and "success" in body:
            if not body.get("success"):
                raise OpenWAError("OPENWA_REJECTED", f"OpenWA {method} failed: {str(body.get('response') or body.get('error'))[:200]}")
            return body.get("response")
        return body

    def get_connection_state(self) -> str:
        """Returns the WhatsApp session state reported by OpenWA (e.g. CONNECTED, OPENING, UNPAIRED)."""
        return str(self._easy_api_call("getConnectionState", {}, timeout=5) or "UNKNOWN").upper()

    def check_number(self, chat_id: str) -> Dict[str, Any]:
        """Asks WhatsApp whether the number has an account that can receive messages."""
        result = self._easy_api_call("checkNumberStatus", {"contactId": chat_id}, timeout=15)
        return result if isinstance(result, dict) else {}

    def send_text_strict(self, to_e164: str, message: str) -> IntegrationResult[Dict[str, Any]]:
        """Sends a WhatsApp text after verifying the session and recipient.

        Returns success only when OpenWA hands back a message id, which is the only
        evidence it gives that WhatsApp accepted the message (ack=SENT comes later).
        """
        start_time = time.time()
        if not self.is_configured:
            return _strict_failure(
                "OPENWA_NOT_CONFIGURED",
                "WhatsApp is not enabled. Set OPENWA_ENABLED=true and OPENWA_SESSION_ID in .env and restart the API.",
            )
        chat_id = self._normalize_chat_id(to_e164)
        try:
            state = self.get_connection_state()
            if state != "CONNECTED":
                return _strict_failure(
                    "OPENWA_SESSION_DISCONNECTED",
                    f"The WhatsApp session is not connected (state: {state}). Re-link the device by scanning the OpenWA QR code.",
                )
            number = self.check_number(chat_id)
            if number and (number.get("numberExists") is False or number.get("canReceiveMessage") is False):
                return _strict_failure("WHATSAPP_INVALID_NUMBER", "This number is not registered on WhatsApp.")
            response = self._easy_api_call("sendText", {"to": chat_id, "content": message})
        except OpenWAError as err:
            return _strict_failure(err.code, err.reason)

        message_id = response if isinstance(response, str) and response not in ("", "false") else None
        if isinstance(response, dict):
            message_id = response.get("id") or response.get("_serialized")
        if not message_id:
            return _strict_failure("OPENWA_NOT_ACCEPTED", "OpenWA did not return a message id; the message was not sent.")
        return IntegrationResult(
            data={"message_id": str(message_id), "chat_id": chat_id, "channel": "WHATSAPP"},
            source=IntegrationSource.REAL,
            success=True,
            latency_ms=round((time.time() - start_time) * 1000, 2),
        )

    def get_message_ack(self, message_id: str) -> Optional[int]:
        """Returns the WhatsApp ack level of a sent message (-1 error, 0 pending, 1 sent, 2 delivered, 3 read, 4 played)."""
        message = self._easy_api_call("getMessageById", {"messageId": message_id}, timeout=8)
        if isinstance(message, dict) and message.get("ack") is not None:
            try:
                return int(message["ack"])
            except (TypeError, ValueError):
                return None
        return None

    def get_replies_after(self, message_id: str) -> List[Dict[str, Any]]:
        """Returns the contact's text messages in the chat of `message_id`, sent at or after it.

        The chat is looked up from the sent message itself, because WhatsApp may file it
        under a @lid id instead of the phone-number id.
        """
        sent = self._easy_api_call("getMessageById", {"messageId": message_id}, timeout=10)
        if not isinstance(sent, dict):
            return []
        chat_id = sent.get("chatId")
        if isinstance(chat_id, dict):
            chat_id = chat_id.get("_serialized")
        if not chat_id:
            return []
        sent_at = sent.get("t") or 0
        messages = self._easy_api_call(
            "getAllMessagesInChat", {"chatId": chat_id, "includeMe": True, "includeNotifications": False}, timeout=20
        )
        replies = []
        for m in messages if isinstance(messages, list) else []:
            if not isinstance(m, dict) or m.get("fromMe") or not m.get("body"):
                continue
            if m.get("type") not in ("chat", None) or (m.get("t") or 0) < sent_at:
                continue
            mid = m.get("id")
            if isinstance(mid, dict):
                mid = mid.get("_serialized")
            replies.append({"id": str(mid), "text": str(m["body"])[:2000], "t": m.get("t")})
        return replies

    def verify_webhook_token(self, mode: str, token: str) -> bool:
        """Validates webhook challenge token for legacy Meta or custom integrations."""
        if not self.verify_token:
            return True
        return mode == "subscribe" and token == self.verify_token


# Backward-compatible alias
WhatsAppAdapter = OpenWACommunicationAdapter
