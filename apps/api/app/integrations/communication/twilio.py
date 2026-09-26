"""Twilio Telephony Communication Adapter.

Implements outbound PSTN telephony calling with Twilio Voice and bidirectional
Media Streams WebSocket bridging for real-time AI negotiation.
Follows official Twilio Programmable Voice REST API and TwiML Media Streams specifications.
Falls back safely to MockCommunicationProvider when unconfigured.
"""
import base64
import json
import logging
import time
import uuid
from typing import Any, Dict, List, Optional
import httpx

from app.core.config import settings
from app.integrations.base import ProviderCommunicationProvider, IntegrationResult, IntegrationSource
from app.integrations.communication.mock import MockCommunicationProvider

logger = logging.getLogger(__name__)

_DEFAULT = object()


def _normalize_e164_phone(phone: Optional[str]) -> str:
    """Normalizes phone numbers to standard E.164 format (+[country_code][digits])."""
    if not phone:
        return ""
    cleaned = "".join(c for c in phone.strip() if c.isdigit() or c == "+")
    if not cleaned.startswith("+"):
        # Default to +91 (India) if 10-digit standard Indian mobile, else prepend +
        if len(cleaned) == 10:
            cleaned = "+91" + cleaned
        else:
            cleaned = "+" + cleaned
    return cleaned


class TwilioVoiceAdapter(ProviderCommunicationProvider):
    """Twilio telephony communication adapter supporting outbound PSTN calls and Media Streams."""

    def __init__(
        self,
        account_sid: Any = _DEFAULT,
        auth_token: Any = _DEFAULT,
        caller_number: Any = _DEFAULT,
        stream_url: Any = _DEFAULT,
        callback_url: Any = _DEFAULT,
        timeout_seconds: Any = _DEFAULT,
        **kwargs: Any,
    ):
        self.account_sid = (
            settings.TWILIO_ACCOUNT_SID if account_sid is _DEFAULT else account_sid
        )
        self.auth_token = (
            settings.TWILIO_AUTH_TOKEN if auth_token is _DEFAULT else auth_token
        )
        self.caller_number = (
            settings.TWILIO_CALLER_NUMBER if caller_number is _DEFAULT else caller_number
        )
        self.stream_url = (
            settings.TWILIO_STREAM_URL if stream_url is _DEFAULT else stream_url
        )
        self.callback_url = (
            settings.TWILIO_CALLBACK_URL if callback_url is _DEFAULT else callback_url
        )
        self.timeout_seconds = (
            settings.TWILIO_TIMEOUT_SECONDS if timeout_seconds is _DEFAULT else timeout_seconds
        )
        self._fallback = MockCommunicationProvider()

    @property
    def is_configured(self) -> bool:
        """Checks whether mandatory credentials are provided."""
        return bool(self.account_sid and self.auth_token and self.caller_number)

    def make_call(
        self,
        event_id: str,
        provider_id: str,
        recipient_phone: str,
        task_id: Optional[str] = None,
        session_id: Optional[str] = None,
        custom_field: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> IntegrationResult[Dict[str, Any]]:
        """Initiates an outbound telephony call via Twilio REST API with TwiML Media Stream."""
        start_time = time.time()
        session_id = session_id or str(uuid.uuid4())
        norm_phone = _normalize_e164_phone(recipient_phone)

        # Fallback if not configured
        if not self.is_configured:
            logger.warning(
                "TwilioVoiceAdapter: Missing mandatory credentials. Falling back to MockCommunicationProvider."
            )
            res = self._fallback.send_message(
                event_id, provider_id, f"CALL:{recipient_phone}", recipient_phone
            )
            res.error = "Twilio credentials not configured (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_CALLER_NUMBER); fallback used."
            return res

        # Validate Stream URL — fail loudly if missing or placeholder (non-negotiable safety invariant)
        stream_url = (self.stream_url or "").strip()
        if not stream_url:
            raise ValueError(
                "CRITICAL CONFIGURATION ERROR: TWILIO_STREAM_URL is not set. "
                "Outbound voice calls cannot establish bidirectional media streaming without a public WSS endpoint. "
                "Run `scripts/dev_tunnel.ps1` and set TWILIO_STREAM_URL=wss://<tunnel-domain>/voice/twilio/stream in your .env."
            )
        if "api.eventra.ai" in stream_url or "example.com" in stream_url:
            raise ValueError(
                f"CRITICAL CONFIGURATION ERROR: TWILIO_STREAM_URL contains unresolvable domain '{stream_url}'. "
                "Must be a live public WSS URL pointing to this EVENTRA instance."
            )

        task_id_str = task_id or ""
        # Build TwiML with <Connect><Stream> and custom parameters
        twiml = (
            f'<?xml version="1.0" encoding="UTF-8"?>'
            f'<Response>'
            f'  <Connect>'
            f'    <Stream url="{stream_url}">'
            f'      <Parameter name="session_id" value="{session_id}" />'
            f'      <Parameter name="event_id" value="{event_id}" />'
            f'      <Parameter name="task_id" value="{task_id_str}" />'
            f'      <Parameter name="provider_id" value="{provider_id}" />'
            f'    </Stream>'
            f'  </Connect>'
            f'</Response>'
        )

        # 1. Try using official Twilio SDK if available
        try:
            from twilio.rest import Client
            client = Client(self.account_sid, self.auth_token)
            call_kwargs: Dict[str, Any] = {
                "to": norm_phone,
                "from_": self.caller_number,
                "twiml": twiml,
            }
            if self.callback_url:
                call_kwargs["status_callback"] = self.callback_url
                call_kwargs["status_callback_event"] = ["initiated", "ringing", "answered", "completed"]

            call = client.calls.create(**call_kwargs)
            latency = round((time.time() - start_time) * 1000, 2)
            call_data = {
                "call_sid": getattr(call, "sid", None) or str(uuid.uuid4()),
                "session_id": session_id,
                "event_id": event_id,
                "provider_id": provider_id,
                "recipient_phone": norm_phone,
                "caller_id": self.caller_number,
                "stream_url": stream_url,
                "status": getattr(call, "status", "queued") or "queued",
                "direction": "outbound-api",
                "timestamp": time.time(),
            }
            return IntegrationResult(
                data=call_data,
                source=IntegrationSource.REAL,
                success=True,
                latency_ms=latency,
            )
        except Exception as twilio_sdk_err:
            logger.warning(
                "Twilio SDK call creation encountered error: %s. Attempting direct HTTP fallback.",
                twilio_sdk_err,
            )

        # 2. Direct HTTP Basic Auth fallback to Twilio API
        api_url = f"https://api.twilio.com/2010-04-01/Accounts/{self.account_sid}/Calls.json"
        form_data = {
            "To": norm_phone,
            "From": self.caller_number,
            "Twiml": twiml,
        }
        if self.callback_url:
            form_data["StatusCallback"] = self.callback_url

        try:
            with httpx.Client(timeout=self.timeout_seconds) as http_client:
                resp = http_client.post(
                    api_url,
                    data=form_data,
                    auth=(self.account_sid, self.auth_token),
                )
                latency = round((time.time() - start_time) * 1000, 2)
                if resp.status_code in (200, 201):
                    resp_json = resp.json()
                    call_data = {
                        "call_sid": resp_json.get("sid", str(uuid.uuid4())),
                        "session_id": session_id,
                        "event_id": event_id,
                        "provider_id": provider_id,
                        "recipient_phone": norm_phone,
                        "caller_id": self.caller_number,
                        "stream_url": stream_url,
                        "status": resp_json.get("status", "queued"),
                        "direction": "outbound-api",
                        "timestamp": time.time(),
                    }
                    return IntegrationResult(
                        data=call_data,
                        source=IntegrationSource.REAL,
                        success=True,
                        latency_ms=latency,
                    )
                else:
                    err_msg = f"Twilio API call initiation returned HTTP {resp.status_code}: {resp.text}"
                    logger.error(err_msg)
                    res = self._fallback.send_message(
                        event_id, provider_id, f"CALL:{recipient_phone}", recipient_phone
                    )
                    res.source = IntegrationSource.MOCK
                    res.error = err_msg
                    return res
        except Exception as http_err:
            err_msg = f"Twilio API request failed: {http_err}"
            logger.error(err_msg)
            res = self._fallback.send_message(
                event_id, provider_id, f"CALL:{recipient_phone}", recipient_phone
            )
            res.source = IntegrationSource.MOCK
            res.error = err_msg
            return res

    def send_message(
        self,
        event_id: str,
        provider_id: str,
        message: str,
        recipient_contact: Optional[str] = None,
    ) -> IntegrationResult[Dict[str, Any]]:
        """Sends an SMS message via Twilio REST API if needed, otherwise captures in history."""
        if not self.is_configured:
            return self._fallback.send_message(event_id, provider_id, message, recipient_contact)

        norm_phone = _normalize_e164_phone(recipient_contact)
        start_time = time.time()
        try:
            from twilio.rest import Client
            client = Client(self.account_sid, self.auth_token)
            msg = client.messages.create(
                to=norm_phone,
                from_=self.caller_number,
                body=message,
            )
            latency = round((time.time() - start_time) * 1000, 2)
            record = {
                "id": getattr(msg, "sid", str(uuid.uuid4())),
                "event_id": event_id,
                "provider_id": provider_id,
                "recipient_contact": norm_phone,
                "message": message,
                "direction": "OUTBOUND",
                "channel": "SMS",
                "status": getattr(msg, "status", "sent"),
                "timestamp": time.time(),
                "is_simulation": False,
            }
            return IntegrationResult(
                data=record,
                source=IntegrationSource.REAL,
                success=True,
                latency_ms=latency,
            )
        except Exception as err:
            logger.warning("Twilio SMS send failed (%s), capturing in fallback.", err)
            res = self._fallback.send_message(event_id, provider_id, message, recipient_contact)
            res.error = f"Twilio SMS failed ({err}); captured in fallback."
            return res

    def get_messages(
        self,
        event_id: str,
        provider_id: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """Retrieves in-memory message history."""
        return self._fallback.get_messages(event_id, provider_id)

    def receive_inbound(
        self,
        payload: Dict[str, Any],
        signature: Optional[str] = None,
    ) -> IntegrationResult[Dict[str, Any]]:
        """Normalizes an inbound Twilio webhook payload (Call or SMS)."""
        call_sid = payload.get("CallSid") or payload.get("MessageSid") or str(uuid.uuid4())
        from_number = payload.get("From", "")
        body = payload.get("Body") or payload.get("SpeechResult") or ""
        normalized = {
            "id": call_sid,
            "sender": from_number,
            "message": body,
            "direction": "INBOUND",
            "channel": "TWILIO_VOICE" if "CallSid" in payload else "TWILIO_SMS",
            "timestamp": time.time(),
            "raw_payload": payload,
        }
        return IntegrationResult(
            data=normalized,
            source=IntegrationSource.REAL,
            success=True,
            latency_ms=1.0,
        )

    def check_health(self) -> Dict[str, Any]:
        """Performs a non-leaking health verification of Twilio configuration."""
        if not self.is_configured:
            return {"configured": False, "enabled": False, "status": "NOT_CONFIGURED"}
        return {
            "configured": True,
            "enabled": True,
            "status": "CONFIGURED",
            "account_sid_suffix": f"...{self.account_sid[-4:]}" if len(self.account_sid or "") >= 4 else None,
            "caller_number": self.caller_number,
            "stream_url_configured": bool(self.stream_url),
        }
