"""Mock Provider Communication Adapter.

Stores messages in-memory for testing, simulation, and offline demonstration.
"""
import time
import uuid
from typing import Any, Dict, List, Optional
from app.integrations.base import ProviderCommunicationProvider, IntegrationResult, IntegrationSource


class MockCommunicationProvider(ProviderCommunicationProvider):
    """Deterministic in-memory communication provider."""

    def __init__(self):
        self._history: List[Dict[str, Any]] = []

    def send_message(
        self,
        event_id: str,
        provider_id: str,
        message: str,
        recipient_contact: Optional[str] = None,
    ) -> IntegrationResult[Dict[str, Any]]:
        record = {
            "id": f"msg-{uuid.uuid4()}",
            "event_id": event_id,
            "provider_id": provider_id,
            "message": message,
            "direction": "OUTBOUND",
            "channel": "MOCK",
            "recipient_contact": recipient_contact or "mock-phone-number",
            "status": "SENT",
            "timestamp": time.time(),
        }
        self._history.append(record)
        return IntegrationResult(
            data=record,
            source=IntegrationSource.MOCK,
            success=True,
            latency_ms=1.5,
        )

    def get_messages(
        self,
        event_id: str,
        provider_id: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        results = [m for m in self._history if m.get("event_id") == event_id]
        if provider_id:
            results = [m for m in results if m.get("provider_id") == provider_id]
        return sorted(results, key=lambda x: x.get("timestamp", 0))


    def receive_inbound(
        self,
        payload: Dict[str, Any],
        signature: Optional[str] = None,
    ) -> IntegrationResult[Dict[str, Any]]:
        msg_id = payload.get("id") or f"inbound-{uuid.uuid4()}"
        event_id = payload.get("event_id", "default_event")
        provider_id = payload.get("provider_id", "unknown_provider")
        text = payload.get("text") or payload.get("message", "")

        record = {
            "id": msg_id,
            "event_id": event_id,
            "provider_id": provider_id,
            "message": text,
            "direction": "INBOUND",
            "channel": "MOCK",
            "status": "RECEIVED",
            "timestamp": time.time(),
            "raw_payload": payload,
        }
        self._history.append(record)
        return IntegrationResult(
            data=record,
            source=IntegrationSource.MOCK,
            success=True,
            latency_ms=1.0,
        )

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
        call_id = f"call-mock-{uuid.uuid4()}"
        sid = session_id or f"sess-{uuid.uuid4()}"
        record = {
            "call_sid": call_id,
            "session_id": sid,
            "event_id": event_id,
            "task_id": task_id,
            "provider_id": provider_id,
            "recipient_phone": recipient_phone,
            "status": "QUEUED",
            "direction": "OUTBOUND_CALL",
            "channel": "EXOTEL_VOICE_MOCK",
            "custom_field": custom_field,
            "metadata": metadata or {},
            "timestamp": time.time(),
        }
        self._history.append(record)
        return IntegrationResult(
            data=record,
            source=IntegrationSource.MOCK,
            success=True,
            latency_ms=2.0,
        )

    def clear(self):
        self._history.clear()
