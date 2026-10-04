"""Pydantic Schemas for Live Negotiation Engine & Realtime UI."""
from datetime import datetime
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field


class NegotiationMessage(BaseModel):
    """Normalized chat message for timeline display."""
    id: str
    sender_type: str  # AGENT | VENDOR | ORGANIZER | SYSTEM
    text: str
    amount_extracted: Optional[float] = None
    timestamp: float
    channel: str = "whatsapp"  # whatsapp | voice | system


class NegotiationTimelineResponse(BaseModel):
    """UI-ready payload for Live Negotiation screen."""
    assignment_id: str
    event_id: str
    vendor_id: str
    vendor_name: str
    vendor_type: str
    status: str
    round_number: int = 0
    control: str = "AGENT"  # AGENT | HUMAN
    cap: Optional[float] = None  # max_approved_amount
    target: Optional[float] = None  # target_amount
    latest_vendor_quote: Optional[float] = None  # quoted_amount
    latest_agent_counter: Optional[float] = None
    budget_validation: Optional[Dict[str, Any]] = None
    approval_id: Optional[str] = None
    conversation_id: Optional[str] = None
    messages: List[NegotiationMessage] = Field(default_factory=list)


class NegotiationSummaryResponse(BaseModel):
    """Overview item for negotiations list."""
    assignment_id: str
    event_id: str
    vendor_id: str
    vendor_name: str
    category: str
    status: str
    control: str = "AGENT"
    round_number: int = 0
    target_amount: Optional[float] = None
    max_approved_amount: Optional[float] = None
    quoted_amount: Optional[float] = None
    currency: str = "INR"
    approval_id: Optional[str] = None
    updated_at: Optional[str] = None


class NegotiationActionResponse(BaseModel):
    """Response returned upon takeover, resume, or cancel."""
    assignment_id: str
    negotiation_control: str
    control_changed_by: Optional[str] = None
    control_changed_at: Optional[str] = None
    status: str
    message: str


class NegotiationCancelRequest(BaseModel):
    """Optional payload when cancelling a negotiation."""
    reason: Optional[str] = None
