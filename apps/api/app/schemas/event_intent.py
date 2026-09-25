"""Pydantic Schemas: Event Intent & Change Proposal for LLM Event Understanding.

Provides strongly-typed schemas for extracting natural language organizer intent,
identifying facts vs preferences vs constraints, preserving date/time ambiguity,
and representing context-aware plan modification proposals.
"""
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, ConfigDict, Field


class BudgetIntent(BaseModel):
    """Structured budget understanding extracted by LLM."""
    amount: Optional[float] = Field(None, description="Extracted numerical budget amount if explicitly stated")
    currency: str = Field("INR", description="Currency code, e.g. 'INR', 'USD'")
    expression: Optional[str] = Field(None, description="Natural language budget phrase, e.g. 'around 12 lakh', 'under 10 lakh', '$50k'")
    is_flexible: bool = Field(False, description="True if organizer indicated budget flexibility, e.g. 'can stretch slightly'")

    model_config = ConfigDict(extra="ignore")


class DateIntent(BaseModel):
    """Structured date and timing intent extracted by LLM. Preserves semantic expressions without inventing fake dates."""
    date_expression: Optional[str] = Field(None, description="Natural language date phrase, e.g. 'December', 'second week of October', 'tomorrow', '3rd December'")
    date_precision: Optional[str] = Field(None, description="Precision level: 'exact', 'day', 'week', 'month', 'season', or 'unknown'")
    exact_date: Optional[str] = Field(None, description="ISO YYYY-MM-DD string ONLY if an exact day was explicitly stated by user. NEVER invent a day.")
    start_time_expression: Optional[str] = Field(None, description="Start time phrase, e.g. '6 PM', 'morning', '9 AM'")
    end_time_expression: Optional[str] = Field(None, description="End time phrase, e.g. '10 PM', 'evening'")
    time_expression: Optional[str] = Field(None, description="General time window phrase, e.g. '6 PM to 10 PM', 'whole day'")

    model_config = ConfigDict(extra="ignore")


class ServiceRequirementIntent(BaseModel):
    """Specific service requested by organizer."""
    service_type: str = Field(..., description="Service identifier or category: venue, catering, photography, videography, decor, stage, lighting, sound, av, security, transport, dj_music, entertainment, makeup, hospitality, printing, cleaning, staffing")
    details: Optional[str] = Field(None, description="Specific details or sub-requirements, e.g. 'vegetarian catering', 'drone photography'")
    is_mandatory: bool = Field(True, description="True if mandatory requirement, False if soft preference")

    model_config = ConfigDict(extra="ignore")


class EventPreferenceIntent(BaseModel):
    """Soft preference stated by organizer (not a hard requirement)."""
    category: str = Field(..., description="Category of preference, e.g. 'catering', 'venue', 'decor'")
    preference_text: str = Field(..., description="Details of the preference, e.g. 'outdoor venue', 'vegetarian catering', 'near airport'")

    model_config = ConfigDict(extra="ignore")


class EventConstraintIntent(BaseModel):
    """Hard or soft operational constraint bounding the event."""
    constraint_type: str = Field(..., description="Type of constraint, e.g. 'capacity', 'budget_cap', 'time_curfew', 'dietary', 'location'")
    description: str = Field(..., description="Human-readable description of constraint, e.g. 'venue capacity >= 500', 'must end before 10 PM'")
    is_hard: bool = Field(True, description="True if hard requirement/constraint, False if soft preference")

    model_config = ConfigDict(extra="ignore")


class EventIntent(BaseModel):
    """Authoritative structured output representing natural-language organizer intent extracted by Gemini."""
    event_type: Optional[str] = Field(None, description="Event type enum string: 'WEDDING', 'CONFERENCE', 'COLLEGE_FEST', 'BIRTHDAY', 'FESTIVAL', 'OTHER'")
    event_title: Optional[str] = Field(None, description="Suggested or stated event title/name")
    event_description: Optional[str] = Field(None, description="Brief description or context of the event")

    # Location & Venue
    location: Optional[str] = Field(None, description="City or primary location, e.g. 'Delhi', 'Dholakpur', 'Gurgaon'")
    city: Optional[str] = Field(None, description="Extracted city name")
    area: Optional[str] = Field(None, description="Extracted area/locality name")
    venue_preferences: List[str] = Field(default_factory=list, description="Venue specific preferences, e.g. 'outdoor', '5-star hotel', 'near airport'")
    venue_requirements: List[str] = Field(default_factory=list, description="Hard venue requirements, e.g. 'capacity >= 500'")

    # Timing
    date: Optional[DateIntent] = Field(None, description="Date and timing intent details")
    event_date: Optional[str] = Field(None, description="String representation of date expression")
    date_expression: Optional[str] = Field(None, description="Natural language date phrase")
    date_precision: Optional[str] = Field(None, description="Date precision: exact, day, week, month, unknown")
    start_time: Optional[str] = Field(None, description="Extracted start time expression")
    end_time: Optional[str] = Field(None, description="Extracted end time expression")
    time_expression: Optional[str] = Field(None, description="General time window phrase")

    # Guest Capacity
    guest_count: Optional[int] = Field(None, description="Extracted scalar guest count if explicitly stated")
    guest_count_expression: Optional[str] = Field(None, description="Natural language guest count phrase, e.g. 'around 500', '300-400'")

    # Budget
    budget: Optional[BudgetIntent] = Field(None, description="Budget intent details")
    budget_amount: Optional[float] = Field(None, description="Extracted budget float amount")
    budget_currency: str = Field("INR", description="Currency code")
    budget_expression: Optional[str] = Field(None, description="Natural budget phrase, e.g. 'around 12 lakh'")
    budget_type: Optional[str] = Field(None, description="Budget flexibility type: 'target', 'max_cap', 'flexible'")

    # Services Required
    services_needed: List[ServiceRequirementIntent] = Field(default_factory=list, description="List of required or requested services")
    vendor_requirements: List[str] = Field(default_factory=list, description="Specific vendor requirements or qualifications")

    # Requirements, Constraints, Preferences & Special Requests
    requirements: List[str] = Field(default_factory=list, description="General requirements list")
    constraints: List[EventConstraintIntent] = Field(default_factory=list, description="Extracted operational constraints")
    preferences: List[EventPreferenceIntent] = Field(default_factory=list, description="Extracted soft preferences")
    special_requests: List[str] = Field(default_factory=list, description="Special requests or custom notes")

    # Missing Information & Ambiguities
    missing_information: List[str] = Field(default_factory=list, description="Details missing based on organizer prompt")
    ambiguities: List[str] = Field(default_factory=list, description="Ambiguous statements that need clarification")

    # Summary
    summary: Optional[str] = Field(None, description="Concise summary of interpreted event intent")
    notes: Optional[str] = Field(None, description="Additional notes")

    model_config = ConfigDict(extra="ignore")


class SingleChangeProposal(BaseModel):
    """Individual field or service modification proposal extracted from user follow-up message."""
    operation: str = Field(..., description="Operation type: 'SET', 'UPDATE', 'ADD_SERVICE', 'REMOVE_SERVICE', 'CLEAR'")
    field: str = Field(..., description="Target field: 'guest_count', 'budget', 'location', 'date', 'service', 'event_type', 'title', 'requirement'")
    old_value: Optional[Any] = Field(None, description="Previous value if known")
    new_value: Optional[Any] = Field(None, description="New proposed value or service identifier")
    target_service: Optional[str] = Field(None, description="Service identifier if operation is ADD_SERVICE or REMOVE_SERVICE")
    reason: Optional[str] = Field(None, description="Contextual reason or user statement for change")

    model_config = ConfigDict(extra="ignore")


class EventChangeProposal(BaseModel):
    """Structured modification proposal extracted by Gemini for updating existing event context."""
    is_modification: bool = Field(True, description="True if user message intends to modify existing event")
    changes: List[SingleChangeProposal] = Field(default_factory=list, description="List of specific field updates")
    summary: Optional[str] = Field(None, description="Concise summary of proposed changes")
    updated_intent: Optional[EventIntent] = Field(None, description="Candidate updated EventIntent after applying changes")

    model_config = ConfigDict(extra="ignore")
