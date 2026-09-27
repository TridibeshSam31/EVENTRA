from typing import Any, Dict, List, Optional, Union
import hmac
import hashlib
from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, Response, status
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
    if settings.OPENWA_WEBHOOK_SECRET:
        if not x_openwa_signature:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Missing X-OpenWA-Signature header.",
            )
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

    # 2. Provider resolution & negotiation flow
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
        return {
            "status": "NO_ACTIVE_ASSIGNMENT",
            "vendor_id": vendor.id,
            "vendor_name": vendor.name,
            "message": "Provider resolved, but no active engagement found.",
            "extracted_facts": msg_record.extracted_facts,
        }

    # Auto-trigger Incident on Provider Cancellation (Part B.10)
    if msg_record.extracted_facts.get("available") is False:
        try:
            from app.schemas.incident import IncidentCreate
            from app.models.enums import IncidentType, IncidentSeverity
            from app.services.incident_service import IncidentService
            inc_service = IncidentService(db)
            inc_data = IncidentCreate(
                incident_type=IncidentType.VENDOR_CANCELLED,
                severity=IncidentSeverity.CRITICAL,
                title=f"Provider Cancellation: {vendor.name}",
                description=f"Provider {vendor.name} sent WhatsApp message: '{text}' indicating unavailability.",
                source="INBOUND_WHATSAPP",
                related_vendor_id=vendor.id,
                related_task_id=getattr(assignment, "task_id", None),
            )
            inc_service.create_incident(event_id=assignment.event_id, data=inc_data, current_user_id="inbound_agent")
        except Exception as inc_exc:
            logger.warning(f"Could not auto-create incident on cancellation: {inc_exc}")

    # 4. Process provider response through authoritative domain service
    proc_result = neg_service.process_provider_response(
        assignment_id=assignment.id,
        response_text=text,
        is_simulation=False,
    )

    return {
        "status": "PROCESSED",
        "vendor_id": vendor.id,
        "vendor_name": vendor.name,
        "assignment_id": assignment.id,
        "extracted_facts": msg_record.extracted_facts,
        "negotiation_result": proc_result,
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
