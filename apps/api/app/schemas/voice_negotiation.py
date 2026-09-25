"""Pydantic Schemas for Task 6: Voice Negotiation + Deterministic Authority.

Defines:
1. VoiceNegotiationContext: Internal authoritative context containing authorized pricing,
   limits, dates, capabilities, and boundaries.
2. SanitizedNegotiationConstraints: Stripped version safe for conversational Gemini Live usage.
3. StructuredNegotiationResult: Untrusted vendor conversational claims extracted from speech.
4. NegotiationEvaluationDecision: Deterministic authority outcome produced by EVENTRA.
"""
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.models.enums import NegotiationStatus


# Forbidden sensitive patterns that must NEVER leak to Gemini or untrusted layers
FORBIDDEN_NEGOTIATION_PATTERNS = {
    "total_budget",
    "organizer_budget",
    "internal_margin",
    "target_margin",
    "margin",
    "internal_notes",
    "private_notes",
    "alternative_quotes",
    "alternative_vendor_quotes",
    "quotes_comparison",
    "competitor",
    "recovery_strategy",
    "risk_score",
    "secret",
    "api_key",
    "credentials",
    "hidden_ceiling",
    "hidden_max",
    "hard_ceiling",
}


class VoiceNegotiationContext(BaseModel):
    """Internal authoritative negotiation constraints established by EVENTRA.
    
    CRITICAL: Contains internal authorization limits (allowed_price_limit) which
    MUST NOT be shared with Gemini or the vendor.
    """
    session_id: str
    call_sid: Optional[str] = None
    stream_sid: Optional[str] = None
    event_id: str
    task_id: Optional[str] = None
    provider_id: str
    assignment_id: Optional[str] = None

    authorized: bool = False
    currency: str = "INR"
    target_price: Optional[float] = None
    allowed_price_limit: Optional[float] = None  # Internal ceiling (e.g. max_approved_amount)
    
    required_capabilities: List[str] = Field(default_factory=list)
    required_date: Optional[str] = None
    required_time: Optional[str] = None
    required_duration: Optional[int] = None
    allowed_terms: List[str] = Field(default_factory=list)
    
    escalation_required: bool = False
    authorization_source: Optional[str] = None  # e.g., "ORGANIZER_EXPLICIT", "ASSIGNMENT_APPROVED"

    model_config = ConfigDict(arbitrary_types_allowed=True)

    @model_validator(mode="after")
    def validate_sensitive_leakage(self) -> "VoiceNegotiationContext":
        """Ensures no blacklisted internal keys were passed in string fields."""
        fields_to_check = [
            self.authorization_source or "",
            " ".join(self.required_capabilities),
            " ".join(self.allowed_terms),
        ]
        combined = " ".join(fields_to_check).lower()
        for forbidden in FORBIDDEN_NEGOTIATION_PATTERNS:
            if forbidden in combined:
                raise ValueError(f"Forbidden sensitive term '{forbidden}' detected in negotiation context.")
        return self


class SanitizedNegotiationConstraints(BaseModel):
    """Sanitized constraints safe for Gemini Live to consume during voice conversation.
    
    Guarantees:
    - Never exposes internal budget, margins, competitor quotes, or ceiling limits.
    - Exposes only the authorized target price, date, time, and service requirements.
    """
    session_id: str
    event_id: str
    provider_id: str
    task_id: Optional[str] = None
    authorized: bool = False
    currency: str = "INR"
    target_price: Optional[float] = None
    required_capabilities: List[str] = Field(default_factory=list)
    required_date: Optional[str] = None
    required_time: Optional[str] = None
    required_duration: Optional[int] = None
    allowed_terms: List[str] = Field(default_factory=list)
    guidance: str = "Inquire on availability, terms, and quote around target if authorized."


class StructuredNegotiationResult(BaseModel):
    """Structured extraction of vendor claims from voice conversation.
    
    The LLM output is UNTRUSTED. All extracted fields are candidate claims
    until validated deterministically against EVENTRA authority rules.
    """
    availability: Optional[bool] = None
    quoted_price: Optional[float] = None
    currency: str = "INR"
    requested_price: Optional[float] = None
    counter_price: Optional[float] = None
    accepted_offer: Optional[bool] = None
    rejected_offer: Optional[bool] = None
    proposed_terms: Optional[str] = None
    constraints: List[str] = Field(default_factory=list)
    required_changes: List[str] = Field(default_factory=list)
    vendor_questions: List[str] = Field(default_factory=list)
    confidence: float = 1.0
    is_ambiguous: bool = False
    status: str = "VALIDATED"  # VALIDATED, NEEDS_CLARIFICATION, REJECTED, UNAVAILABLE
    raw_conversational_provenance: Dict[str, Any] = Field(default_factory=dict)

    model_config = ConfigDict(arbitrary_types_allowed=True)


class NegotiationEvaluationDecision(BaseModel):
    """Deterministic authority decision produced by EVENTRA NegotiationService.
    
    Authority Invariant:
    - Gemini suggests/reports. EVENTRA decides.
    - Even within-ceiling offers require human approval.
    - Over-ceiling offers trigger counter-offer or escalation.
    - Neither Gemini nor conversational vendor acceptance can confirm engagement.
    """
    action: str  # AWAITING_APPROVAL, NEGOTIATE, COUNTER_OFFER, DECLINED, ESCALATE, NEEDS_CLARIFICATION, REJECT
    negotiation_status: str  # Values from NegotiationStatus enum
    can_proceed_to_engagement: bool = False
    approval_required: bool = True
    counter_offer_amount: Optional[float] = None
    conversational_response: str
    reason: str
    assignment_id: Optional[str] = None
    approval_id: Optional[str] = None
    quoted_amount: Optional[float] = None
    target_amount: Optional[float] = None
    max_approved_amount: Optional[float] = None
    budget_validation: Optional[Dict[str, Any]] = None
    blocking_factors: List[str] = Field(default_factory=list)

    model_config = ConfigDict(arbitrary_types_allowed=True)
