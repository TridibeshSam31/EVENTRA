"""Domain Service: ProviderCommunicationService

Coordinates outbound and inbound communications with vendors/providers.
Isolates third-party channels (mock, WhatsApp, SMS) from core business logic.
"""
import logging
from typing import Any, Dict, List, Optional
from sqlalchemy.orm import Session

from app.integrations.base import IntegrationResult, IntegrationSource
from app.observability.audit import AuditRecorder

logger = logging.getLogger(__name__)


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

        channel_val = "whatsapp"
        if result.data and isinstance(result.data, dict):
            channel_val = (result.data.get("channel") or "whatsapp").lower()

        # Persist conversation thread and message to database
        if self.db:
            try:
                from app.services.conversation_service import ConversationService
                conv_service = ConversationService(self.db)
                conv_service.record_outbound_message(
                    event_id=event_id,
                    vendor_id=provider_id,
                    raw_text=message,
                    channel=channel_val,
                    recipient=recipient_contact,
                    sender="EVENTRA Autonomous Agent" if (actor_type or "").upper() == "AGENT" else "EVENTRA Operations",
                    status="sent" if result.success else "failed",
                )
            except Exception as conv_err:
                self.db.rollback()
                logger.warning(f"Could not record outbound message in ConversationService: {conv_err}")

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
                    "channel": channel_val,
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

        if self.db and result.success and result.data:
            try:
                from app.services.conversation_service import ConversationService
                conv_service = ConversationService(self.db)
                ev_id = result.data.get("event_id") or "UNKNOWN"
                prov_id = result.data.get("provider_id")
                raw_txt = result.data.get("message") or ""
                sender_num = result.data.get("sender") or ""
                chan = (result.data.get("channel") or "whatsapp").lower()
                conv_service.record_inbound_message(
                    event_id=ev_id,
                    vendor_id=prov_id if prov_id != "UNKNOWN" else None,
                    raw_text=raw_txt,
                    channel=chan,
                    sender=sender_num,
                )
            except Exception as in_err:
                logger.warning(f"Could not record inbound message in ConversationService: {in_err}")

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
        try:
            result = self._provider.make_call(
                event_id=event_id,
                provider_id=provider_id,
                recipient_phone=recipient_phone,
                task_id=task_id,
                session_id=session_id,
                custom_field=custom_field,
                metadata=metadata,
            )
        except NotImplementedError:
            from app.core.config import settings
            if settings.TWILIO_ENABLED or (settings.COMMUNICATION_PROVIDER or "").lower() == "twilio":
                from app.integrations.communication.twilio import TwilioVoiceAdapter
                twilio_adapter = TwilioVoiceAdapter()
                result = twilio_adapter.make_call(
                    event_id=event_id,
                    provider_id=provider_id,
                    recipient_phone=recipient_phone,
                    task_id=task_id,
                    session_id=session_id,
                    custom_field=custom_field,
                    metadata=metadata,
                )
            elif settings.EXOTEL_ENABLED:
                from app.integrations.communication.exotel import ExotelVoiceAdapter
                exotel_adapter = ExotelVoiceAdapter()
                result = exotel_adapter.make_call(
                    event_id=event_id,
                    provider_id=provider_id,
                    recipient_phone=recipient_phone,
                    task_id=task_id,
                    session_id=session_id,
                    custom_field=custom_field,
                    metadata=metadata,
                )
            else:
                from app.integrations.communication.mock import MockCommunicationProvider
                mock_adapter = MockCommunicationProvider()
                result = mock_adapter.make_call(
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
                    "channel": str(result.data.get("channel")) if (result.data and result.data.get("channel")) else "UNKNOWN",
                    "call_sid": str(result.data.get("call_sid")) if (result.data and result.data.get("call_sid") is not None) else None,
                },
            )

        return result

    def hangup_call(
        self,
        call_sid: str,
        reason: Optional[str] = "MANUAL_TAKEOVER",
        actor_id: Optional[str] = None,
        event_id: Optional[str] = None,
    ) -> IntegrationResult[Dict[str, Any]]:
        """Terminates an in-progress telephony call to a provider/vendor."""
        # 1. Audit termination attempt
        if self._audit and event_id:
            self._audit.record(
                event_id=event_id,
                actor_id=actor_id or "system",
                actor_type="ORGANIZER" if actor_id else "SYSTEM",
                action="PROVIDER_CALL_TERMINATE_ATTEMPT",
                action_type="COMMUNICATION",
                target_type="CALL",
                target_id=call_sid,
                after_state={"call_sid": call_sid, "reason": reason},
            )

        provider = self._provider
        try:
            if hasattr(provider, "hangup_call"):
                result = provider.hangup_call(call_sid, reason=reason)
            else:
                result = IntegrationResult(
                    data={"call_sid": call_sid, "status": "FAILED", "reason": reason},
                    source=IntegrationSource.REAL,
                    success=False,
                    error=f"Provider {provider.__class__.__name__} does not support hangup_call",
                )
        except NotImplementedError:
            result = IntegrationResult(
                data={"call_sid": call_sid, "status": "FAILED", "reason": reason},
                source=IntegrationSource.REAL,
                success=False,
                error=f"Provider {provider.__class__.__name__} does not support hangup_call",
            )
        except Exception as e:
            result = IntegrationResult(
                data={"call_sid": call_sid, "status": "FAILED", "reason": reason},
                source=IntegrationSource.REAL,
                success=False,
                error=f"Error terminating call on {provider.__class__.__name__}: {str(e)}",
            )

        # 2. Audit termination outcome
        if self._audit and event_id:
            self._audit.record(
                event_id=event_id,
                actor_id=actor_id or "system",
                actor_type="ORGANIZER" if actor_id else "SYSTEM",
                action="PROVIDER_CALL_TERMINATED" if result.success else "PROVIDER_CALL_TERMINATION_FAILED",
                action_type="COMMUNICATION",
                target_type="CALL",
                target_id=call_sid,
                after_state={
                    "call_sid": call_sid,
                    "reason": reason,
                    "success": result.success,
                    "status": (result.data or {}).get("status", "COMPLETED" if result.success else "FAILED"),
                    "error": result.error,
                },
            )
        return result

    def execute_approved_communication(
        self,
        event_id: str,
        candidate_id: str,
        approval_id: str,
        approver_id: Optional[str] = "organizer",
    ) -> Dict[str, Any]:
        """Executes real call and WhatsApp outreach strictly AFTER explicit approval.

        Guarantees:
        - Candidate must exist, belong to event, and be in SELECTED status.
        - Idempotency via idempotency_records (double click / repeated requests safely return existing result).
        - Independent Call and WhatsApp operations tracked separately.
        - Truthful failure / unavailable state (no fake success, no fabricated numbers, no silent fallback).
        - Persisted to database candidate_data and emitted via live_broker.
        """
        from datetime import datetime, timezone, timedelta
        from app.models.event import Event
        from app.models.shortlist import EventShortlistEntry
        from app.models.approval import Approval
        from app.models.idempotency import IdempotencyRecord
        from app.models.vendor import Vendor
        from app.services.live_broker import live_broker
        from app.core.exceptions import NotFoundException, BadRequestException
        from app.core.config import settings

        if not self.db:
            raise ValueError("ProviderCommunicationService requires a database session for approved execution.")

        event = self.db.query(Event).filter(Event.id == event_id).first()
        if not event:
            raise NotFoundException(f"Event with id '{event_id}' not found.")

        entry = (
            self.db.query(EventShortlistEntry)
            .filter(
                EventShortlistEntry.event_id == event_id,
                (EventShortlistEntry.candidate_id == candidate_id) | (EventShortlistEntry.id == candidate_id),
            )
            .first()
        )
        if not entry:
            raise NotFoundException(f"Candidate '{candidate_id}' not found in event '{event_id}' shortlist.")

        if entry.status != "SELECTED":
            raise BadRequestException(
                f"Candidate '{candidate_id}' is in status '{entry.status}'. Communication approval requires candidate to be SELECTED."
            )

        # 1. Idempotency Check & Lock
        idem_key = f"comm_approval:{event_id}:{entry.candidate_id}:{approval_id}"
        now_dt = datetime.now(timezone.utc).replace(tzinfo=None)
        existing_rec = (
            self.db.query(IdempotencyRecord)
            .filter(IdempotencyRecord.idempotency_key == idem_key)
            .first()
        )
        if existing_rec:
            if existing_rec.status == "COMPLETED" and existing_rec.response_body:
                logger.info(f"Duplicate communication approval request ignored for {idem_key}")
                return existing_rec.response_body
            elif existing_rec.status == "PROCESSING":
                logger.info(f"Communication approval already processing for {idem_key}")
                c_data = entry.candidate_data or {}
                return c_data.get("communication", {
                    "approval_id": approval_id,
                    "approval_status": "APPROVED",
                    "overall_status": "PROCESSING",
                })

        # Register idempotency processing
        idem_rec = IdempotencyRecord(
            idempotency_key=idem_key,
            event_id=event_id,
            endpoint=f"/events/{event_id}/shortlist/{candidate_id}/approve-communication",
            method="POST",
            request_hash="comm_approved_hash",
            status="PROCESSING",
            created_at=now_dt,
            expires_at=now_dt + timedelta(hours=24),
        )
        self.db.add(idem_rec)
        self.db.commit()

        # 2. Update Approval record status to APPROVED
        approval = (
            self.db.query(Approval)
            .filter(Approval.id == approval_id, Approval.event_id == event_id)
            .first()
        )
        if approval:
            approval.status = "APPROVED"
            if approver_id:
                from app.services.identity_service import ensure_user_exists
                approver = ensure_user_exists(self.db, approver_id)
                approval.approver_id = approver.id
            approval.decided_at = now_dt
            self.db.commit()

        # 3. Resolve Contact Phone Number
        c_data = dict(entry.candidate_data or {})
        phone = c_data.get("phone") or c_data.get("contact_phone")
        if not phone and entry.provider_id:
            vendor = self.db.query(Vendor).filter(Vendor.id == entry.provider_id).first()
            if vendor and vendor.contact_phone:
                phone = vendor.contact_phone
            else:
                try:
                    from app.models.venue import Venue
                    venue = self.db.query(Venue).filter(Venue.id == entry.provider_id).first()
                    if venue and venue.contact_phone:
                        phone = venue.contact_phone
                except Exception:
                    pass

        phone = str(phone).strip() if phone else None

        # Emit communication.started
        live_broker.publish_sync(
            event_id,
            {
                "type": "communication.started",
                "event_id": event_id,
                "candidate_id": entry.candidate_id,
                "candidate_name": entry.candidate_name,
                "category": entry.category,
                "approval_id": approval_id,
                "phone": phone,
                "message": f"Approved outreach initiated for {entry.candidate_name}",
            },
        )

        call_status = "NOT_ATTEMPTED"
        call_error = None
        whatsapp_status = "NOT_ATTEMPTED"
        whatsapp_error = None

        if not phone:
            call_status = "NOT_ATTEMPTED"
            call_error = "No contact phone number available"
            whatsapp_status = "NOT_ATTEMPTED"
            whatsapp_error = "No contact phone number available"
            overall_status = "UNAVAILABLE"
            logger.info(f"Communication for {entry.candidate_name} not attempted: phone number missing.")
        else:
            # --- OPERATION 1: VOICE CALL ---
            voice_configured = False
            voice_adapter = None
            if settings.TWILIO_ENABLED or (settings.COMMUNICATION_PROVIDER or "").lower() == "twilio":
                from app.integrations.communication.twilio import TwilioVoiceAdapter
                voice_adapter = TwilioVoiceAdapter()
                voice_configured = voice_adapter.is_configured
            elif settings.EXOTEL_ENABLED or (settings.COMMUNICATION_PROVIDER or "").lower() == "exotel":
                from app.integrations.communication.exotel import ExotelVoiceAdapter
                voice_adapter = ExotelVoiceAdapter()
                voice_configured = voice_adapter.is_configured

            if not voice_configured:
                call_status = "UNAVAILABLE"
                call_error = "Voice provider is not configured"
                logger.info(f"Voice call unavailable for {entry.candidate_name}: provider not configured")
                live_broker.publish_sync(
                    event_id,
                    {
                        "type": "call.failed",
                        "event_id": event_id,
                        "candidate_id": entry.candidate_id,
                        "status": "UNAVAILABLE",
                        "reason": "Voice provider is not configured",
                    },
                )
            else:
                live_broker.publish_sync(
                    event_id,
                    {
                        "type": "call.started",
                        "event_id": event_id,
                        "candidate_id": entry.candidate_id,
                        "candidate_name": entry.candidate_name,
                        "phone": phone,
                    },
                )
                try:
                    call_res = self.make_call(
                        event_id=event_id,
                        provider_id=entry.provider_id or entry.candidate_id,
                        recipient_phone=phone,
                        actor_id=approver_id,
                        actor_type="ORGANIZER",
                    )
                    if call_res.success:
                        call_status = "COMPLETED"
                        live_broker.publish_sync(
                            event_id,
                            {
                                "type": "call.completed",
                                "event_id": event_id,
                                "candidate_id": entry.candidate_id,
                                "status": "COMPLETED",
                                "call_details": call_res.data,
                            },
                        )
                    else:
                        call_status = "FAILED"
                        call_error = call_res.error or "Voice call attempt failed"
                        live_broker.publish_sync(
                            event_id,
                            {
                                "type": "call.failed",
                                "event_id": event_id,
                                "candidate_id": entry.candidate_id,
                                "status": "FAILED",
                                "reason": call_error,
                            },
                        )
                except Exception as exc:
                    logger.error(f"Voice call dispatch exception for {entry.candidate_name}: {exc}")
                    call_status = "FAILED"
                    call_error = str(exc)
                    live_broker.publish_sync(
                        event_id,
                        {
                            "type": "call.failed",
                            "event_id": event_id,
                            "candidate_id": entry.candidate_id,
                            "status": "FAILED",
                            "reason": call_error,
                        },
                    )

            # --- OPERATION 2: WHATSAPP MESSAGE ---
            from app.integrations.whatsapp.client import OpenWACommunicationAdapter
            wa_adapter = OpenWACommunicationAdapter()
            whatsapp_configured = wa_adapter.is_configured

            if not whatsapp_configured:
                whatsapp_status = "UNAVAILABLE"
                whatsapp_error = "WhatsApp provider is not configured"
                logger.info(f"WhatsApp unavailable for {entry.candidate_name}: provider not configured")
                live_broker.publish_sync(
                    event_id,
                    {
                        "type": "message.failed",
                        "event_id": event_id,
                        "candidate_id": entry.candidate_id,
                        "status": "UNAVAILABLE",
                        "reason": "WhatsApp provider is not configured",
                    },
                )
            else:
                live_broker.publish_sync(
                    event_id,
                    {
                        "type": "message.started",
                        "event_id": event_id,
                        "candidate_id": entry.candidate_id,
                        "candidate_name": entry.candidate_name,
                        "phone": phone,
                    },
                )
                try:
                    msg_text = (
                        f"Hello {entry.candidate_name}, this is an inquiry regarding {entry.category} "
                        f"for event '{event.name}'. Please confirm your availability and service details."
                    )
                    wa_res = self.send_message(
                        event_id=event_id,
                        provider_id=entry.provider_id or entry.candidate_id,
                        message=msg_text,
                        recipient_contact=phone,
                        actor_id=approver_id,
                        actor_type="ORGANIZER",
                    )
                    if wa_res.success:
                        whatsapp_status = "SENT"
                        live_broker.publish_sync(
                            event_id,
                            {
                                "type": "message.sent",
                                "event_id": event_id,
                                "candidate_id": entry.candidate_id,
                                "status": "SENT",
                            },
                        )
                    else:
                        whatsapp_status = "FAILED"
                        whatsapp_error = wa_res.error or "WhatsApp dispatch failed"
                        live_broker.publish_sync(
                            event_id,
                            {
                                "type": "message.failed",
                                "event_id": event_id,
                                "candidate_id": entry.candidate_id,
                                "status": "FAILED",
                                "reason": whatsapp_error,
                            },
                        )
                except Exception as exc:
                    logger.error(f"WhatsApp dispatch exception for {entry.candidate_name}: {exc}")
                    whatsapp_status = "FAILED"
                    whatsapp_error = str(exc)
                    live_broker.publish_sync(
                        event_id,
                        {
                            "type": "message.failed",
                            "event_id": event_id,
                            "candidate_id": entry.candidate_id,
                            "status": "FAILED",
                            "reason": whatsapp_error,
                        },
                    )

            # Compute overall truthful status
            if call_status in ("COMPLETED", "SUCCESS") and whatsapp_status in ("SENT", "DELIVERED"):
                overall_status = "COMPLETED"
            elif (call_status in ("COMPLETED", "SUCCESS")) or (whatsapp_status in ("SENT", "DELIVERED")):
                overall_status = "PARTIAL"
            elif call_status == "UNAVAILABLE" and whatsapp_status == "UNAVAILABLE":
                overall_status = "UNAVAILABLE"
            else:
                overall_status = "FAILED"

        # 4. Persist Truthful Communication Results
        comm_data = {
            "approval_id": approval_id,
            "approval_status": "APPROVED",
            "call_status": call_status,
            "whatsapp_status": whatsapp_status,
            "overall_status": overall_status,
            "call_error": call_error,
            "whatsapp_error": whatsapp_error,
            "phone": phone,
            "updated_at": datetime.now(timezone.utc).replace(tzinfo=None).isoformat(),
        }
        c_data["communication"] = comm_data
        entry.candidate_data = c_data

        if approval:
            approval.decision_notes = f"Call: {call_status}, WhatsApp: {whatsapp_status}"

        # Update IdempotencyRecord to COMPLETED
        idem_rec.status = "COMPLETED"
        idem_rec.response_code = 200
        idem_rec.response_body = comm_data

        self.db.commit()
        self.db.refresh(entry)

        # 5. Broadcast Final Realtime Events
        end_event_type = "communication.completed" if overall_status in ("COMPLETED", "PARTIAL") else "communication.failed"
        live_broker.publish_sync(
            event_id,
            {
                "type": end_event_type,
                "event_id": event_id,
                "candidate_id": entry.candidate_id,
                "candidate_name": entry.candidate_name,
                "call_status": call_status,
                "whatsapp_status": whatsapp_status,
                "overall_status": overall_status,
                "call_error": call_error,
                "whatsapp_error": whatsapp_error,
            },
        )
        live_broker.publish_sync(
            event_id,
            {
                "type": "shortlist.updated",
                "event_id": event_id,
                "action": "communication_updated",
                "candidate_id": entry.candidate_id,
                "candidate_name": entry.candidate_name,
                "category": entry.category,
                "status": entry.status,
                "communication": comm_data,
            },
        )

        return comm_data

