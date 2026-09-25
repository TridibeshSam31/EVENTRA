"""Domain Service: ProviderCommunicationService

Coordinates outbound and inbound communications with vendors/providers.
Isolates third-party channels (mock, WhatsApp, SMS) from core business logic.
"""
from typing import Any, Dict, List, Optional
from sqlalchemy.orm import Session

from app.integrations.base import IntegrationResult
from app.observability.audit import AuditRecorder


class ProviderCommunicationService:
    """Manages vendor communication threads and dispatches alerts."""

    def __init__(self, db: Optional[Session] = None):
        self.db = db
        from app.integrations.registry import registry
        self._provider = registry.get_communication_provider()
        self._audit = AuditRecorder(db) if db else None

    def send_message(
        self,
        event_id: str,
        provider_id: str,
        message: str,
        recipient_contact: Optional[str] = None,
        actor_id: Optional[str] = "system",
        actor_type: Optional[str] = "SYSTEM",
    ) -> IntegrationResult[Dict[str, Any]]:
        """Sends an operational dispatch message to a provider."""
        result = self._provider.send_message(
            event_id=event_id,
            provider_id=provider_id,
            message=message,
            recipient_contact=recipient_contact,
        )

        if self._audit:
            self._audit.record(
                event_id=event_id,
                actor_id=actor_id or "system",
                actor_type=actor_type or "SYSTEM",
                action="PROVIDER_MESSAGE_SENT",
                action_type="COMMUNICATION",
                target_type="PROVIDER",
                target_id=provider_id,
                after_state={
                    "provider_id": provider_id,
                    "recipient_contact": recipient_contact,
                    "success": result.success,
                    "channel": result.data.get("channel") if result.data else "UNKNOWN",
                },
            )

        return result

    def get_messages(
        self,
        event_id: str,
        provider_id: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """Retrieves message history for an event/provider."""
        return self._provider.get_messages(event_id=event_id, provider_id=provider_id)

    def receive_inbound(
        self,
        payload: Dict[str, Any],
        signature: Optional[str] = None,
    ) -> IntegrationResult[Dict[str, Any]]:
        """Normalizes and processes inbound webhook message from a provider."""
        result = self._provider.receive_inbound(payload=payload, signature=signature)

        if self._audit and result.success and result.data:
            event_id = result.data.get("event_id") or "SYSTEM"
            self._audit.record(
                event_id=event_id,
                actor_id="provider",
                actor_type="EXTERNAL",
                action="PROVIDER_MESSAGE_RECEIVED",
                action_type="COMMUNICATION",
                after_state={
                    "channel": result.data.get("channel"),
                    "provider_id": result.data.get("provider_id"),
                },
            )

        return result

    def make_call(
        self,
        event_id: str,
        provider_id: str,
        recipient_phone: str,
        task_id: Optional[str] = None,
        session_id: Optional[str] = None,
        custom_field: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
        actor_id: Optional[str] = "system",
        actor_type: Optional[str] = "SYSTEM",
    ) -> IntegrationResult[Dict[str, Any]]:
        """Initiates an outbound telephony call to a vendor/provider."""
        result = self._provider.make_call(
            event_id=event_id,
            provider_id=provider_id,
            recipient_phone=recipient_phone,
            task_id=task_id,
            session_id=session_id,
            custom_field=custom_field,
            metadata=metadata,
        )

        if self._audit:
            self._audit.record(
                event_id=event_id,
                actor_id=actor_id or "system",
                actor_type=actor_type or "SYSTEM",
                action="PROVIDER_CALL_INITIATED",
                action_type="COMMUNICATION",
                target_type="PROVIDER",
                target_id=provider_id,
                after_state={
                    "provider_id": provider_id,
                    "task_id": task_id,
                    "recipient_phone": recipient_phone,
                    "session_id": session_id,
                    "success": result.success,
                    "channel": result.data.get("channel") if result.data else "UNKNOWN",
                    "call_sid": result.data.get("call_sid") if result.data else None,
                },
            )

        return result
