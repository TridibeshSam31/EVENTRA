"""Exotel Telephony Communication Adapter.

Implements outbound PSTN telephony calling and provider communication
following Exotel v1 REST API specifications.
Falls back safely to MockCommunicationProvider when unconfigured or offline.
Isolates telephony transport details so AgentStream/WebSocket can be cleanly layered on top.
"""
import base64
import json
import logging
import time
import uuid
import xml.etree.ElementTree as ET
from typing import Any, Dict, List, Optional
import httpx

from app.core.config import settings
from app.integrations.base import ProviderCommunicationProvider, IntegrationResult, IntegrationSource
from app.integrations.communication.mock import MockCommunicationProvider

logger = logging.getLogger(__name__)


def _normalize_phone_number(phone: Optional[str]) -> str:
    """Normalizes phone numbers to standard E.164-compatible digit string without spaces/dashes."""
    if not phone:
        return ""
    digits = "".join(c for c in phone if c.isdigit() or c == "+")
    # If starting with +, strip + for standard Indian Exotel format (e.g. 919876543210 or 09876543210)
    if digits.startswith("+"):
        digits = digits[1:]
    return digits


_DEFAULT = object()


class ExotelVoiceAdapter(ProviderCommunicationProvider):
    """Exotel telephony communication adapter for outbound calls and status verification."""

    def __init__(
        self,
        api_key: Any = _DEFAULT,
        api_token: Any = _DEFAULT,
        account_sid: Any = _DEFAULT,
        subdomain: Any = _DEFAULT,
        caller_id: Any = _DEFAULT,
        app_id: Any = _DEFAULT,
        stream_url: Any = _DEFAULT,
        callback_url: Any = _DEFAULT,
        timeout_seconds: Any = _DEFAULT,
        **kwargs: Any,
    ):
        self.api_key = settings.EXOTEL_API_KEY if api_key is _DEFAULT else api_key
        self.api_token = settings.EXOTEL_API_TOKEN if api_token is _DEFAULT else api_token
        self.account_sid = settings.EXOTEL_ACCOUNT_SID if account_sid is _DEFAULT else account_sid
        self.subdomain = (
            (settings.EXOTEL_SUBDOMAIN or "api.exotel.com")
            if subdomain is _DEFAULT
            else (subdomain or "api.exotel.com")
        ).strip()
        self.caller_id = settings.EXOTEL_CALLER_ID if caller_id is _DEFAULT else caller_id
        self.app_id = settings.EXOTEL_APP_ID if app_id is _DEFAULT else app_id
        self.stream_url = settings.EXOTEL_STREAM_URL if stream_url is _DEFAULT else stream_url
        self.callback_url = settings.EXOTEL_CALLBACK_URL if callback_url is _DEFAULT else callback_url
        self.timeout_seconds = (
            settings.EXOTEL_TIMEOUT_SECONDS if timeout_seconds is _DEFAULT else timeout_seconds
        )
        self._fallback = MockCommunicationProvider()

    @property
    def is_configured(self) -> bool:
        """Checks whether mandatory credentials are provided."""
        return bool(self.api_key and self.api_token and self.account_sid and self.caller_id)

    @property
    def base_url(self) -> str:
        """Constructs canonical Exotel v1 API base URL."""
        sub = self.subdomain.replace("https://", "").replace("http://", "").rstrip("/")
        sid = self.account_sid or "ACCOUNT_SID"
        return f"https://{sub}/v1/Accounts/{sid}"

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
        """Initiates an outbound telephony call via Exotel API.

        Endpoint: POST /v1/Accounts/{AccountSid}/Calls/connect.json
        (or .xml with fallback parsing).
        Form fields:
          - From: Recipient number (first leg)
          - To: Caller ID (virtual number) or second leg / AppId flow
          - CallerId: Virtual number / ExoPhone
          - Url: Flow URL or http://my.exotel.com/.../exoml/start_voice/{app_id}
          - StatusCallback: Webhook for call events
          - CustomField: Metadata JSON/string tracking session_id, event_id, task_id
        """
        sid = session_id or str(uuid.uuid4())
        normalized_recipient = _normalize_phone_number(recipient_phone)

        if not normalized_recipient:
            return IntegrationResult(
                data={
                    "call_sid": None,
                    "session_id": sid,
                    "event_id": event_id,
                    "task_id": task_id,
                    "provider_id": provider_id,
                    "recipient_phone": recipient_phone,
                    "status": "FAILED",
                    "channel": "EXOTEL_VOICE",
                    "error": "Recipient phone number is required and cannot be empty.",
                },
                source=IntegrationSource.REAL if (settings.EXOTEL_ENABLED and self.is_configured) else IntegrationSource.MOCK,
                success=False,
                error="Recipient phone number is required.",
            )

        # Fallback if Exotel is not enabled or not fully configured
        if not settings.EXOTEL_ENABLED or not self.is_configured:
            logger.info("Exotel not enabled or unconfigured; routing outbound call to fallback mock.")
            res = self._fallback.make_call(
                event_id=event_id,
                provider_id=provider_id,
                recipient_phone=normalized_recipient,
                task_id=task_id,
                session_id=sid,
                custom_field=custom_field,
                metadata=metadata,
            )
            res.error = "Exotel not enabled or credentials not configured; recorded in mock fallback."
            return res

        start_time = time.time()
        url = f"{self.base_url}/Calls/connect"
        auth = (self.api_key, self.api_token)

        # CustomField packs EVENTRA contextual tracking
        custom_payload = {
            "session_id": sid,
            "event_id": event_id,
            "task_id": task_id,
            "provider_id": provider_id,
            **(metadata or {}),
        }
        custom_str = custom_field or json.dumps(custom_payload)

        # STRICT REQUIREMENT: Fail loudly if EXOTEL_STREAM_URL is not configured
        if not self.stream_url:
            err_msg = "EXOTEL_STREAM_URL not set — outbound calls cannot bridge audio"
            logger.error(err_msg)
            return IntegrationResult(
                data={
                    "call_sid": None,
                    "session_id": sid,
                    "event_id": event_id,
                    "task_id": task_id,
                    "provider_id": provider_id,
                    "recipient_phone": normalized_recipient,
                    "status": "FAILED",
                    "channel": "EXOTEL_VOICE",
                    "error": err_msg,
                },
                source=IntegrationSource.REAL,
                success=False,
                error=err_msg,
            )

        # Build form payload according to direct Exotel Connect Voice AI specification
        form_data: Dict[str, str] = {
            "From": normalized_recipient,
            "CallerId": self.caller_id,
            "StreamUrl": self.stream_url,
            "StreamType": "bidirectional",
            "CustomField": custom_str,
        }

        if self.callback_url:
            form_data["StatusCallback"] = self.callback_url

        try:
            with httpx.Client(timeout=self.timeout_seconds) as client:
                response = client.post(
                    url,
                    auth=auth,
                    data=form_data,
                    headers={"Accept": "application/json"},
                )
                latency = round((time.time() - start_time) * 1000, 2)

                # Parse JSON or XML response
                resp_data = self._parse_exotel_response(response)

                if response.status_code in (200, 201):
                    call_obj = resp_data.get("Call") if isinstance(resp_data, dict) else {}
                    if not isinstance(call_obj, dict):
                        call_obj = resp_data if isinstance(resp_data, dict) else {}

                    call_sid = call_obj.get("Sid") or call_obj.get("sid") or f"exotel-{uuid.uuid4()}"
                    call_status = call_obj.get("Status") or call_obj.get("status") or "QUEUED"

                    record = {
                        "call_sid": str(call_sid),
                        "session_id": sid,
                        "event_id": event_id,
                        "task_id": task_id,
                        "provider_id": provider_id,
                        "recipient_phone": normalized_recipient,
                        "status": str(call_status).upper(),
                        "direction": "OUTBOUND_CALL",
                        "channel": "EXOTEL_VOICE",
                        "custom_field": custom_str,
                        "raw_response": resp_data,
                        "timestamp": time.time(),
                    }
                    self._fallback._history.append(record)
                    return IntegrationResult(
                        data=record,
                        source=IntegrationSource.REAL,
                        success=True,
                        latency_ms=latency,
                    )
                else:
                    error_msg = f"Exotel API returned HTTP {response.status_code}: {resp_data}"
                    logger.warning("Exotel call initiation failed: %s", error_msg)
                    return IntegrationResult(
                        data={
                            "call_sid": None,
                            "session_id": sid,
                            "event_id": event_id,
                            "task_id": task_id,
                            "provider_id": provider_id,
                            "recipient_phone": normalized_recipient,
                            "status": "FAILED",
                            "channel": "EXOTEL_VOICE",
                            "error": error_msg,
                            "raw_response": resp_data,
                        },
                        source=IntegrationSource.REAL,
                        success=False,
                        latency_ms=latency,
                        error=error_msg,
                    )
        except Exception as err:
            latency = round((time.time() - start_time) * 1000, 2)
            error_msg = f"Exotel call request failed with network error: {err}"
            logger.error("Exotel HTTP exception: %s", error_msg)
            return IntegrationResult(
                data={
                    "call_sid": None,
                    "session_id": sid,
                    "event_id": event_id,
                    "task_id": task_id,
                    "provider_id": provider_id,
                    "recipient_phone": normalized_recipient,
                    "status": "FAILED",
                    "channel": "EXOTEL_VOICE",
                    "error": error_msg,
                },
                source=IntegrationSource.REAL,
                success=False,
                latency_ms=latency,
                error=error_msg,
            )

    def _parse_exotel_response(self, response: httpx.Response) -> Dict[str, Any]:
        """Safely parses Exotel response whether returned as JSON or XML."""
        content_type = response.headers.get("content-type", "").lower()
        text = response.text.strip()
        if not text:
            return {}

        if "json" in content_type or text.startswith("{"):
            try:
                return response.json()
            except Exception:
                pass

        # Try XML parse if response is XML
        if "xml" in content_type or text.startswith("<"):
            try:
                root = ET.fromstring(text)
                return self._xml_to_dict(root)
            except Exception as xml_err:
                return {"raw_text": text, "xml_error": str(xml_err)}

        return {"raw_text": text}

    def _xml_to_dict(self, element: ET.Element) -> Dict[str, Any]:
        """Recursively parses XML element tree into Python dictionary."""
        result: Dict[str, Any] = {}
        for child in element:
            if len(child) > 0:
                child_data = self._xml_to_dict(child)
            else:
                child_data = child.text.strip() if child.text else ""
            if child.tag in result:
                if not isinstance(result[child.tag], list):
                    result[child.tag] = [result[child.tag]]
                result[child.tag].append(child_data)
            else:
                result[child.tag] = child_data
        return result

    def send_message(
        self,
        event_id: str,
        provider_id: str,
        message: str,
        recipient_contact: Optional[str] = None,
    ) -> IntegrationResult[Dict[str, Any]]:
        """Sends an SMS message via Exotel SMS API if needed, or falls back safely to mock."""
        if not settings.EXOTEL_ENABLED or not self.is_configured:
            res = self._fallback.send_message(event_id, provider_id, message, recipient_contact)
            res.error = "Exotel not enabled or configured; SMS recorded in mock fallback."
            return res

        normalized_phone = _normalize_phone_number(recipient_contact)
        start_time = time.time()
        url = f"{self.base_url}/Sms/send.json"
        auth = (self.api_key, self.api_token)
        payload = {
            "From": self.caller_id,
            "To": normalized_phone,
            "Body": message,
        }

        try:
            with httpx.Client(timeout=self.timeout_seconds) as client:
                resp = client.post(url, auth=auth, data=payload)
                latency = round((time.time() - start_time) * 1000, 2)
                resp_data = self._parse_exotel_response(resp)
                if resp.status_code in (200, 201):
                    msg_obj = resp_data.get("SMSMessage") or resp_data
                    sid = msg_obj.get("Sid") if isinstance(msg_obj, dict) else str(uuid.uuid4())
                    record = {
                        "id": str(sid),
                        "event_id": event_id,
                        "provider_id": provider_id,
                        "recipient_contact": normalized_phone,
                        "message": message,
                        "direction": "OUTBOUND",
                        "channel": "EXOTEL_SMS",
                        "status": "SENT",
                        "timestamp": time.time(),
                    }
                    self._fallback._history.append(record)
                    return IntegrationResult(
                        data=record,
                        source=IntegrationSource.REAL,
                        success=True,
                        latency_ms=latency,
                    )
                else:
                    res = self._fallback.send_message(event_id, provider_id, message, recipient_contact)
                    res.source = IntegrationSource.REAL
                    res.success = False
                    res.error = f"Exotel SMS API error HTTP {resp.status_code}: {resp_data}"
                    return res
        except Exception as err:
            res = self._fallback.send_message(event_id, provider_id, message, recipient_contact)
            res.source = IntegrationSource.REAL
            res.success = False
            res.error = f"Exotel SMS network error: {err}"
            return res

    def get_messages(
        self,
        event_id: str,
        provider_id: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """Retrieves in-memory message and call history."""
        return self._fallback.get_messages(event_id, provider_id)

    def receive_inbound(
        self,
        payload: Dict[str, Any],
        signature: Optional[str] = None,
    ) -> IntegrationResult[Dict[str, Any]]:
        """Normalizes an inbound webhook payload from Exotel call status or passthru callback."""
        try:
            call_sid = payload.get("CallSid") or payload.get("CallSid") or payload.get("sid") or str(uuid.uuid4())
            from_phone = payload.get("From") or payload.get("from") or ""
            to_phone = payload.get("To") or payload.get("to") or ""
            call_status = payload.get("Status") or payload.get("CallStatus") or payload.get("status") or "IN_PROGRESS"
            custom_field = payload.get("CustomField") or ""

            # Attempt to extract session_id and event_id from CustomField if JSON
            event_id = "UNKNOWN"
            provider_id = "UNKNOWN"
            task_id = None
            session_id = None
            if custom_field:
                try:
                    cf_data = json.loads(custom_field) if isinstance(custom_field, str) else custom_field
                    if isinstance(cf_data, dict):
                        event_id = cf_data.get("event_id") or event_id
                        provider_id = cf_data.get("provider_id") or provider_id
                        task_id = cf_data.get("task_id")
                        session_id = cf_data.get("session_id")
                except Exception:
                    pass

            normalized = {
                "id": str(call_sid),
                "call_sid": str(call_sid),
                "session_id": session_id,
                "event_id": event_id,
                "provider_id": provider_id,
                "task_id": task_id,
                "from": from_phone,
                "to": to_phone,
                "status": str(call_status).upper(),
                "direction": "INBOUND_STATUS",
                "channel": "EXOTEL_VOICE",
                "custom_field": custom_field,
                "raw_payload": payload,
                "timestamp": time.time(),
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
        """Performs non-leaking health inspection of Exotel configuration and connectivity."""
        if not settings.EXOTEL_ENABLED:
            return {"configured": False, "enabled": False, "status": "DISABLED"}
        if not self.is_configured:
            return {
                "configured": False,
                "enabled": True,
                "status": "INCOMPLETE_CREDENTIALS",
                "missing": [
                    k for k, v in [
                        ("EXOTEL_API_KEY", self.api_key),
                        ("EXOTEL_API_TOKEN", self.api_token),
                        ("EXOTEL_ACCOUNT_SID", self.account_sid),
                        ("EXOTEL_CALLER_ID", self.caller_id),
                    ] if not v
                ],
            }

        url = f"{self.base_url}.json"
        auth = (self.api_key, self.api_token)
        try:
            with httpx.Client(timeout=self.timeout_seconds) as client:
                resp = client.get(url, auth=auth)
                return {
                    "configured": True,
                    "enabled": True,
                    "status": "HEALTHY" if resp.status_code in (200, 201) else f"HTTP_{resp.status_code}",
                    "subdomain": self.subdomain,
                    "caller_id": self.caller_id,
                }
        except Exception as err:
            return {
                "configured": True,
                "enabled": True,
                "status": "UNREACHABLE",
                "subdomain": self.subdomain,
                "error": str(err),
            }
