"""API Routes: Real Vendor Conversations & Messages (Part A.2)

Provides endpoints to list conversations, inspect full message threads,
and access structured extracted facts from provider replies.
"""
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.dependencies import get_db_session
from app.models.communication import Conversation, Message
from app.schemas.communication import (
    ConversationResponse,
    ConversationListResponse,
    MessageResponse,
    MessageCreate,
)
from app.services.conversation_service import ConversationService

router = APIRouter(prefix="/events", tags=["Conversations & Messaging"])


@router.get(
    "/{event_id}/conversations",
    response_model=ConversationListResponse,
    status_code=status.HTTP_200_OK,
)
def list_conversations(
    event_id: str,
    db: Session = Depends(get_db_session),
) -> ConversationListResponse:
    """Lists all active communication sessions with vendors for an event."""
    service = ConversationService(db)
    convs = service.list_conversations(event_id)

    items: List[ConversationResponse] = []
    for c in convs:
        resp = ConversationResponse.model_validate(c)
        latest_msg = (
            db.query(Message)
            .filter(Message.conversation_id == c.id)
            .order_by(Message.timestamp.desc())
            .first()
        )
        if latest_msg:
            resp.latest_message = MessageResponse.model_validate(latest_msg)
        items.append(resp)

    return ConversationListResponse(items=items, total=len(items))


@router.get(
    "/{event_id}/conversations/{conversation_id}/messages",
    response_model=List[MessageResponse],
    status_code=status.HTTP_200_OK,
)
def get_conversation_messages(
    event_id: str,
    conversation_id: str,
    db: Session = Depends(get_db_session),
) -> List[MessageResponse]:
    """Retrieves the full chronological message thread for a conversation."""
    conv = (
        db.query(Conversation)
        .filter(Conversation.id == conversation_id, Conversation.event_id == event_id)
        .first()
    )
    if not conv:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Conversation '{conversation_id}' not found for event '{event_id}'.",
        )

    service = ConversationService(db)
    messages = service.get_messages(conversation_id)
    return [MessageResponse.model_validate(m) for m in messages]


@router.post(
    "/{event_id}/conversations/{conversation_id}/messages",
    response_model=MessageResponse,
    status_code=status.HTTP_201_CREATED,
)
def send_conversation_message(
    event_id: str,
    conversation_id: str,
    payload: MessageCreate,
    db: Session = Depends(get_db_session),
) -> MessageResponse:
    """Allows manual operator or agent reply in an existing conversation thread."""
    conv = (
        db.query(Conversation)
        .filter(Conversation.id == conversation_id, Conversation.event_id == event_id)
        .first()
    )
    if not conv:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Conversation '{conversation_id}' not found for event '{event_id}'.",
        )

    service = ConversationService(db)
    
    # Check active negotiation assignment to resolve control and stream updates
    from app.services.negotiation_service import NegotiationService
    from app.services.negotiation_broker import negotiation_broker
    import time
    assignment = NegotiationService(db).find_active_assignment(conv.vendor_id, event_id) if conv.vendor_id else None
    is_human_mode = bool(assignment and getattr(assignment, "negotiation_control", "AGENT") == "HUMAN")

    if payload.direction == "inbound":
        msg = service.record_inbound_message(
            event_id=event_id,
            raw_text=payload.raw_text,
            vendor_id=conv.vendor_id,
            channel=payload.channel or conv.channel,
            sender=payload.sender or conv.vendor_name,
        )
        sender_type = "VENDOR"
    else:
        sender_name = payload.sender or ("ORGANIZER" if is_human_mode else "AGENT")
        sender_type = "ORGANIZER" if is_human_mode or sender_name == "ORGANIZER" else "AGENT"
        from app.services.provider_communication_service import ProviderCommunicationService
        comm_service = ProviderCommunicationService(db)
        send_result = comm_service.send_message(
            event_id=event_id,
            provider_id=conv.vendor_id or "provider",
            message=payload.raw_text,
            recipient_contact=conv.recipient_contact,
            actor_id="operator",
            actor_type="OPERATOR",
        )
        msg = (
            db.query(Message)
            .filter(Message.conversation_id == conv.id)
            .order_by(Message.timestamp.desc())
            .first()
        )
        if not msg or msg.raw_text != payload.raw_text:
            msg = service.record_outbound_message(
                event_id=event_id,
                vendor_id=conv.vendor_id,
                raw_text=payload.raw_text,
                channel=payload.channel or conv.channel,
                recipient=conv.recipient_contact,
                sender=sender_name,
                status="sent" if send_result.success else "failed",
            )

    if assignment:
        ts = msg.timestamp.timestamp() if hasattr(msg.timestamp, "timestamp") else time.time()
        negotiation_broker.publish_sync(
            event_id=event_id,
            assignment_id=assignment.id,
            event_type="message_added",
            data={
                "id": msg.id,
                "sender_type": sender_type,
                "text": payload.raw_text,
                "amount_extracted": (msg.extracted_facts or {}).get("quoted_amount") if hasattr(msg, "extracted_facts") else None,
                "channel": payload.channel or conv.channel or "whatsapp",
                "timestamp": ts,
            },
        )

    return MessageResponse.model_validate(msg)
