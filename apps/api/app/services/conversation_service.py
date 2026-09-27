"""Service: ConversationService (Part A.2)

Manages real, persisted vendor conversations and message logs across WhatsApp,
telephony, and email, orchestrating structured fact extraction and state updates.
"""
import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from sqlalchemy.orm import Session

from app.models.communication import Conversation, Message
from app.models.vendor import Vendor
from app.services.quote_extraction_service import QuoteExtractionService
from app.services.activity_log_service import ActivityLogService

logger = logging.getLogger(__name__)


def utc_now():
    return datetime.now(timezone.utc).replace(tzinfo=None)


class ConversationService:
    """Orchestrates threaded conversations, message persistence, and structured extraction."""

    def __init__(self, db: Session):
        self.db = db
        self.extractor = QuoteExtractionService()
        self.activity_log = ActivityLogService(db)

    def get_or_create_conversation(
        self,
        event_id: str,
        vendor_id: Optional[str] = None,
        vendor_name: Optional[str] = None,
        channel: str = "whatsapp",
        recipient_contact: Optional[str] = None,
    ) -> Conversation:
        """Finds or creates a persistent conversation thread."""
        query = self.db.query(Conversation).filter(
            Conversation.event_id == event_id,
        )
        if vendor_id:
            query = query.filter(Conversation.vendor_id == vendor_id)
        elif recipient_contact:
            query = query.filter(Conversation.recipient_contact == recipient_contact)

        conv = query.first()
        if not conv:
            if not vendor_name and vendor_id:
                v = self.db.query(Vendor).filter(Vendor.id == vendor_id).first()
                if v:
                    vendor_name = v.name
                    recipient_contact = recipient_contact or v.contact_phone

            conv = Conversation(
                event_id=event_id,
                vendor_id=vendor_id,
                vendor_name=vendor_name or "Provider Contact",
                channel=channel,
                status="active",
                recipient_contact=recipient_contact,
                last_message_at=utc_now(),
            )
            self.db.add(conv)
            self.db.commit()
            self.db.refresh(conv)

        return conv

    def record_outbound_message(
        self,
        event_id: str,
        vendor_id: Optional[str],
        raw_text: str,
        channel: str = "whatsapp",
        recipient: Optional[str] = None,
        sender: str = "EVENTRA Operations Agent",
        status: str = "sent",
    ) -> Message:
        """Records an outbound message dispatched by agent or operator."""
        conv = self.get_or_create_conversation(
            event_id=event_id,
            vendor_id=vendor_id,
            channel=channel,
            recipient_contact=recipient,
        )

        msg = Message(
            conversation_id=conv.id,
            event_id=event_id,
            vendor_id=vendor_id,
            direction="outbound",
            channel=channel,
            sender=sender,
            recipient=recipient,
            raw_text=raw_text,
            status=status,
            extracted_facts={},
            timestamp=utc_now(),
        )
        self.db.add(msg)
        conv.last_message_at = msg.timestamp
        self.db.commit()
        self.db.refresh(msg)

        # Log to unified activity stream
        self.activity_log.log(
            event_id=event_id,
            category="engagement",
            actor="agent",
            action="OUTBOUND_MESSAGE_DISPATCHED",
            summary=f"Dispatched {channel.upper()} inquiry to {conv.vendor_name or recipient}",
            ref_id=msg.id,
            details={"channel": channel, "recipient": recipient, "message_id": msg.id},
        )
        return msg

    def record_inbound_message(
        self,
        event_id: str,
        raw_text: str,
        vendor_id: Optional[str] = None,
        channel: str = "whatsapp",
        sender: Optional[str] = None,
        recipient: Optional[str] = None,
        context: Optional[Dict[str, Any]] = None,
    ) -> Message:
        """Records an inbound provider response, extracts structured facts, and updates state."""
        conv = self.get_or_create_conversation(
            event_id=event_id,
            vendor_id=vendor_id,
            channel=channel,
            recipient_contact=sender,
        )

        # Extract structured facts from free-text / transcript
        facts = self.extractor.extract_facts(raw_text=raw_text, context=context)

        msg = Message(
            conversation_id=conv.id,
            event_id=event_id,
            vendor_id=vendor_id,
            direction="inbound",
            channel=channel,
            sender=sender,
            recipient=recipient,
            raw_text=raw_text,
            status="received",
            extracted_facts=facts.model_dump(mode="json"),
            timestamp=utc_now(),
        )
        self.db.add(msg)
        conv.last_message_at = msg.timestamp
        self.db.commit()
        self.db.refresh(msg)

        # Log to unified activity stream
        summary_note = f"Received {channel.upper()} reply from {conv.vendor_name or sender}"
        if facts.available is not None:
            status_desc = "Available" if facts.available else "Unavailable"
            summary_note += f": {status_desc}"
            if facts.quoted_amount:
                summary_note += f" (Quote: {facts.currency} {facts.quoted_amount:,.2f})"

        self.activity_log.log(
            event_id=event_id,
            category="engagement",
            actor="external",
            action="INBOUND_MESSAGE_RECEIVED",
            summary=summary_note,
            ref_id=msg.id,
            details={
                "channel": channel,
                "sender": sender,
                "extracted_facts": facts.model_dump(mode="json"),
                "conversation_id": conv.id,
            },
        )
        return msg

    def list_conversations(self, event_id: str) -> List[Conversation]:
        """Lists active conversations for an event ordered by last activity."""
        return (
            self.db.query(Conversation)
            .filter(Conversation.event_id == event_id)
            .order_by(Conversation.last_message_at.desc())
            .all()
        )

    def get_messages(self, conversation_id: str) -> List[Message]:
        """Lists message thread for a conversation."""
        return (
            self.db.query(Message)
            .filter(Message.conversation_id == conversation_id)
            .order_by(Message.timestamp.asc())
            .all()
        )
