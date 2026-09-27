"""Pydantic Schemas: Conversation, Message, and Structured Extracted Facts"""
from datetime import datetime
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field, ConfigDict


class ExtractedFacts(BaseModel):
    available: Optional[bool] = None
    quoted_amount: Optional[float] = None
    currency: str = "INR"
    notes: Optional[str] = None
    confidence: float = 0.0
    field_sources: Dict[str, str] = Field(default_factory=dict)


class MessageCreate(BaseModel):
    direction: str = Field("outbound", description="'inbound' or 'outbound'")
    channel: str = Field("whatsapp", description="'whatsapp', 'call', or 'email'")
    sender: Optional[str] = None
    recipient: Optional[str] = None
    raw_text: str = Field(..., description="Raw message text or voice call transcript")
    status: str = "sent"


class MessageResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    conversation_id: str
    event_id: str
    vendor_id: Optional[str] = None
    direction: str
    channel: str
    sender: Optional[str] = None
    recipient: Optional[str] = None
    raw_text: str
    status: str
    extracted_facts: Dict[str, Any] = Field(default_factory=dict)
    timestamp: datetime
    created_at: datetime


class ConversationResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    event_id: str
    vendor_id: Optional[str] = None
    vendor_name: Optional[str] = None
    channel: str
    status: str
    recipient_contact: Optional[str] = None
    last_message_at: datetime
    created_at: datetime
    updated_at: datetime
    latest_message: Optional[MessageResponse] = None


class ConversationListResponse(BaseModel):
    items: List[ConversationResponse]
    total: int
