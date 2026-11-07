from typing import Any, Dict, List, Optional, Union
import hmac
import hashlib
from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException, Query, Request, Response, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user_id, get_db_session
from app.core.config import settings
from app.integrations.registry import registry
from app.services.notification_service import NotificationService
from app.services.provider_communication_service import ProviderCommunicationService
from app.services.negotiation_service import NegotiationService
from app.observability.audit import AuditRecorder

router = APIRouter(tags=["Integrations"])


# --- Schemas ---

class DistanceRequest(BaseModel):
    origin: Union[str, List[float], Dict[str, float]]
    destination: Union[str, List[float], Dict[str, float]]


class GeocodeRequest(BaseModel):
    address: str = Field(..., min_length=1)


class SendNotificationRequest(BaseModel):
    notification_type: str = Field(..., description="e.g. INCIDENT_DETECTED, APPROVAL_REQUESTED")
    title: str = Field(..., min_length=1)
    message: str = Field(..., min_length=1)
    channel: Optional[str] = "IN_APP"
    recipient: Optional[str] = None
    payload: Optional[Dict[str, Any]] = None


class ProviderMessageRequest(BaseModel):
    message: str = Field(..., min_length=1)
    recipient_contact: Optional[str] = None


# --- Endpoints ---

@router.get("/integrations/status")
def get_integrations_status():
    """Returns the operational status of all external integration adapters without exposing credentials."""
    return registry.get_status()


@router.post("/integrations/maps/distance")
def get_map_distance(payload: DistanceRequest):
    """Calculates transit distance and ETA using the active maps adapter."""
    maps = registry.get_maps_provider()
    result = maps.get_distance(payload.origin, payload.destination)
    return result.to_dict()


@router.post("/integrations/maps/geocode")
def geocode_address(payload: GeocodeRequest):
    """Resolves coordinates for an address using the active maps adapter."""
    maps = registry.get_maps_provider()
    result = maps.geocode(payload.address)
    return result.to_dict()


@router.get("/integrations/whatsapp/webhook")
def verify_whatsapp_webhook(
    hub_mode: Optional[str] = Query(None, alias="hub.mode"),
    hub_challenge: Optional[str] = Query(None, alias="hub.challenge"),
    hub_verify_token: Optional[str] = Query(None, alias="hub.verify_token"),
):
    """Handles Meta WhatsApp webhook verification challenge."""
    comm = registry.get_communication_provider()
    from app.integrations.whatsapp.client import WhatsAppAdapter
    if isinstance(comm, WhatsAppAdapter) and hub_mode and hub_verify_token:
        if comm.verify_webhook_token(hub_mode, hub_verify_token):
            return Response(content=hub_challenge or "", media_type="text/plain")
    elif hub_mode == "subscribe":
        expected_token = settings.WHATSAPP_WEBHOOK_VERIFY_TOKEN or "eventra_verify_secret"
        if hub_verify_token == expected_token or not settings.WHATSAPP_WEBHOOK_VERIFY_TOKEN:
            return Response(content=hub_challenge or "", media_type="text/plain")
    return Response(content="Verification failed", status_code=status.HTTP_403_FORBIDDEN)


@router.post("/integrations/whatsapp/webhook")
def receive_whatsapp_webhook(payload: Dict[str, Any]):
    """Receives and normalizes inbound webhook message from WhatsApp."""
    comm = registry.get_communication_provider()
    result = comm.receive_inbound(payload)
    return {"status": "PROCESSED", "result": result.to_dict()}


@router.get("/integrations/openwa/status")
def get_openwa_status():
    """Returns OpenWA self-hosted gateway connectivity and session status."""
    comm = registry.get_communication_provider()
    from app.integrations.whatsapp.client import OpenWACommunicationAdapter
    if isinstance(comm, OpenWACommunicationAdapter):
        return {
            "enabled": settings.OPENWA_ENABLED,
            "session_id": settings.OPENWA_SESSION_ID,
            "base_url": settings.OPENWA_BASE_URL,
            "health": comm.check_health(),
            "session": comm.get_session_status(),
        }
    return {
        "enabled": False,
        "mode": "MOCK",
        "message": "OpenWA provider not active.",
    }


@router.post("/webhooks/openwa")
@router.post("/integrations/openwa/webhook")
async def receive_openwa_webhook(
    request: Request,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db_session),
    x_openwa_signature: Optional[str] = Header(None, alias="X-OpenWA-Signature"),
):
    """Receives OpenWA webhook events (e.g. message, session.status).
    
    1. Verifies HMAC signature if OPENWA_WEBHOOK_SECRET is configured.
    2. Parses incoming message.
    3. Resolves provider by phone number.
    4. Finds active VendorAssignment.
    5. Feeds response into NegotiationService for deterministic handling.
    """
    raw_body = await request.body()

    # 1. HMAC signature verification
    if settings.ENVIRONMENT != "development" and not settings.OPENWA_WEBHOOK_SECRET:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="OPENWA_WEBHOOK_SECRET is required in non-development environments.",
        )

    if settings.OPENWA_WEBHOOK_SECRET:
        # open-wa cannot sign webhook bodies, so a shared token in the webhook URL
        # (?token=<OPENWA_WEBHOOK_SECRET>) is accepted as an alternative to the HMAC header.
        url_token = request.query_params.get("token")
        if url_token is not None:
            if not hmac.compare_digest(url_token, settings.OPENWA_WEBHOOK_SECRET):
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invalid webhook token.")
        elif not x_openwa_signature:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Missing X-OpenWA-Signature header.",
            )
        else:
            expected_sig = hmac.new(
                settings.OPENWA_WEBHOOK_SECRET.encode("utf-8"),
                raw_body,
                hashlib.sha256,
            ).hexdigest()
            if not hmac.compare_digest(expected_sig.lower(), x_openwa_signature.lower()):
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Invalid webhook HMAC signature.",
                )

    try:
        import json
        payload = json.loads(raw_body.decode("utf-8")) if raw_body else {}
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Malformed JSON payload: {e}",
        )

    # Delivery receipts for messages we sent (open-wa onAck events)
    if isinstance(payload, dict) and payload.get("event") == "onAck":
        from app.services.vendor_outreach_service import VendorOutreachService
        ack_data = payload.get("data") or {}
        message_id = ack_data.get("id") if isinstance(ack_data.get("id"), str) else (ack_data.get("id") or {}).get("_serialized")
        try:
            ack = int(ack_data.get("ack")) if ack_data.get("ack") is not None else None
        except (TypeError, ValueError):
            ack = None
        attempt = VendorOutreachService(db).apply_whatsapp_ack(message_id, ack) if message_id else None
        return {"status": "ACK", "matched": attempt is not None}

    # Inbound normalization via communication adapter
    comm = registry.get_communication_provider()
    norm_result = comm.receive_inbound(payload)

    # Extract message details
    data = payload.get("data", payload)
    if isinstance(data, list) and len(data) > 0:
        data = data[0]

    sender = data.get("from") or data.get("chatId") or payload.get("from") or ""
    text = (
        data.get("body")
        or data.get("text")
        or data.get("message")
        or payload.get("body")
        or ""
    )

    if not sender or not text:
        return {
            "status": "ACK",
            "message": "Webhook received; no actionable text message found.",
            "parsed": norm_result.to_dict(),
        }

    # 2. Check for Organizer Approval Reply BEFORE vendor resolution
    message_id = data.get("id") or data.get("messageId") or payload.get("id")
    from app.integrations.whatsapp.webhook import process_organizer_approval_reply
    approval_result = process_organizer_approval_reply(
        db=db,
        sender=sender,
        text=text,
        message_id=message_id,
    )
    if approval_result is not None:
        return approval_result

    # 3. Provider resolution & negotiation flow (Vendor path unchanged)
    neg_service = NegotiationService(db)
    vendor = neg_service.resolve_provider_by_phone(sender)

    if not vendor:
        audit = AuditRecorder(db)
        audit.record(
            event_id="SYSTEM",
            actor_id=sender,
            actor_type="EXTERNAL",
            action="OPENWA_UNMAPPED_MESSAGE",
            action_type="COMMUNICATION",
            after_state={"sender": sender, "text": text[:200]},
        )
        return {
            "status": "UNMAPPED_PROVIDER",
            "message": f"Received message from '{sender}', but no registered provider matched.",
            "sender": sender,
        }

    # Webhook retries must not re-process the same vendor message (no repeat incidents or replies).
    from app.services.vendor_signal_service import VendorSignalService
    signal_service = VendorSignalService(db)
    provider_message_id = message_id if isinstance(message_id, str) else (message_id or {}).get("_serialized") if isinstance(message_id, dict) else None
    if not signal_service.claim_message(provider_message_id, {"sender": sender, "text": text}):
        return {"status": "DUPLICATE", "message": "This message was already processed.", "provider_message_id": provider_message_id}

    # 3. Find active assignment
    assignment = neg_service.find_active_assignment(vendor.id)
    event_id = assignment.event_id if assignment else "SYSTEM"

    # Persist inbound message and extract structured facts (Part A.2)
    from app.services.conversation_service import ConversationService
    conv_service = ConversationService(db)
    msg_record = conv_service.record_inbound_message(
        event_id=event_id,
        raw_text=text,
        vendor_id=vendor.id,
        channel="whatsapp",
        sender=sender,
        context={"assignment_id": assignment.id} if assignment else None,
    )

    if not assignment:
        audit = AuditRecorder(db)
        audit.record(
            event_id="SYSTEM",
            actor_id=vendor.id,
            actor_type="PROVIDER",
            action="OPENWA_MESSAGE_NO_ACTIVE_ASSIGNMENT",
            action_type="COMMUNICATION",
            target_type="VENDOR",
            target_id=vendor.id,
            after_state={"vendor_name": vendor.name, "text": text[:200]},
        )
        signal_service.complete_message(provider_message_id, {"status": "NO_ACTIVE_ASSIGNMENT"})
        return {
            "status": "NO_ACTIVE_ASSIGNMENT",
            "vendor_id": vendor.id,
            "vendor_name": vendor.name,
            "message": "Provider resolved, but no active engagement found.",
            "extracted_facts": msg_record.extracted_facts,
        }

    # Interpret the message into a validated operational signal; raises or correlates incidents.
    try:
        signal_result = signal_service.process(
            event_id=assignment.event_id,
            vendor=vendor,
            assignment=assignment,
            text=text,
            extracted_facts=msg_record.extracted_facts,
            provider_message_id=provider_message_id,
        )
    except Exception as sig_exc:
        db.rollback()
        logger.exception("Vendor signal processing failed: %s", sig_exc)
        signal_result = {"error": "Signal processing failed; the message is saved for manual review."}

    # A newly detected incident gets the same agent follow-up as a manually reported one
    # (impact review, recovery options, approval request). Correlated repeats do not re-trigger.
    new_incident = (signal_result.get("incident") or {}) if isinstance(signal_result, dict) else {}
    if new_incident.get("action") == "CREATED":
        from app.agent.triggers import trigger_agent_run
        background_tasks.add_task(
            trigger_agent_run,
            event_id=assignment.event_id,
            message=f"Incident detected from vendor WhatsApp ({vendor.name}): {text[:200]}",
            user_id="system",
        )

    # 4. Process provider response through authoritative domain service
    proc_result = neg_service.process_provider_response(
        assignment_id=assignment.id,
        response_text=text,
        is_simulation=False,
    )

    signal_service.complete_message(provider_message_id, {"status": "PROCESSED"})
    return {
        "status": "PROCESSED",
        "vendor_id": vendor.id,
        "vendor_name": vendor.name,
        "assignment_id": assignment.id,
        "extracted_facts": msg_record.extracted_facts,
        "negotiation_result": proc_result,
        "operational_signal": signal_result,
    }


# --- Event Notification Routes ---

@router.post("/events/{event_id}/notifications", status_code=status.HTTP_201_CREATED)
def send_event_notification(
    event_id: str,
    payload: SendNotificationRequest,
    db: Session = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user_id),
):
    """Dispatches an operational alert for an event."""
    service = NotificationService(db)
    result = service.send_notification(
        event_id=event_id,
        notification_type=payload.notification_type,
        title=payload.title,
        message=payload.message,
        channel=payload.channel,
        recipient=payload.recipient,
        payload=payload.payload,
    )
    return result.to_dict()


@router.get("/events/{event_id}/notifications")
def list_event_notifications(
    event_id: str,
    limit: int = Query(50, ge=1, le=100),
    db: Session = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user_id),
):
    """Retrieves notification history for an event."""
    service = NotificationService(db)
    items = service.list_notifications(event_id=event_id, limit=limit)
    return {"total": len(items), "items": items}


# --- Event Provider Messaging Routes ---

@router.post("/events/{event_id}/providers/{provider_id}/messages", status_code=status.HTTP_201_CREATED)
def send_provider_message(
    event_id: str,
    provider_id: str,
    payload: ProviderMessageRequest,
    db: Session = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user_id),
):
    """Dispatches an operational message to a vendor/provider."""
    service = ProviderCommunicationService(db)
    result = service.send_message(
        event_id=event_id,
        provider_id=provider_id,
        message=payload.message,
        recipient_contact=payload.recipient_contact,
    )
    return result.to_dict()


@router.get("/events/{event_id}/providers/{provider_id}/messages")
def get_provider_messages(
    event_id: str,
    provider_id: str,
    db: Session = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user_id),
):
    """Retrieves message history with a vendor/provider."""
    service = ProviderCommunicationService(db)
    items = service.get_messages(event_id=event_id, provider_id=provider_id)
    return {"total": len(items), "items": items}
