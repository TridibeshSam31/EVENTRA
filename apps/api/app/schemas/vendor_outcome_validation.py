"""Pydantic Schemas: VendorOutcomeValidation (Deterministic Claims & Validation)"""
from datetime import datetime
from typing import Any, List, Optional
from pydantic import BaseModel, ConfigDict, Field

from app.models.enums import (
    ClaimType,
    ClaimValidationStatus,
    OverallValidationStatus,
)


class ExtractedClaim(BaseModel):
    """An atomic fact extracted from organizer-reported vendor outcome text or inputs."""
    claim_type: str = Field(..., description="Categorization: CAPACITY, PRICE, AVAILABILITY, VEGETARIAN, etc.")
    field: str = Field(..., description="Normalized field name, e.g. capacity, quoted_price, vegetarian")
    raw_value: Any = Field(..., description="Original raw value as reported by organizer")
    normalized_value: Optional[Any] = Field(None, description="Deterministically normalized value")
    unit: Optional[str] = Field(None, description="Unit of measurement: guests, INR, days, etc.")
    source_text: Optional[str] = Field(None, description="Exact phrase or excerpt from organizer note")
    confidence: float = Field(1.0, ge=0.0, le=1.0, description="Extraction confidence score")
    precision: str = Field("EXACT", description="EXACT, APPROXIMATE, or RANGE")


class VendorOutcomeClaims(BaseModel):
    """Container for all claims extracted semantically via LLM from a vendor outcome."""
    claims: List[ExtractedClaim] = Field(default_factory=list, description="List of structured claims")
    summary: Optional[str] = Field(None, description="Concise extraction summary")
    ambiguities: List[str] = Field(default_factory=list, description="Vague or unresolvable statements preserved as ambiguous")


class ClaimValidationDetail(BaseModel):
    """Evaluation result for an individual claim against authoritative system state."""
    claim_type: str = Field(..., description="Claim or requirement category")
    field: str = Field(..., description="Field or requirement evaluated")
    status: ClaimValidationStatus = Field(..., description="Evaluation status: PASS, FAIL, UNKNOWN, CONFLICT")
    is_hard_requirement: bool = Field(True, description="True for hard requirement/constraint; False for preference")
    reported_value: Optional[Any] = Field(None, description="What the organizer/vendor reported")
    authoritative_value: Optional[Any] = Field(None, description="Authoritative system value compared against")
    explanation: str = Field(..., description="Concise deterministic rationale for this result")
    source_evidence: Optional[str] = Field(None, description="Source quote or provenance evidence")


class VendorOutcomeValidationResponse(BaseModel):
    """Authoritative API response schema for a persisted vendor outcome validation."""
    id: str
    vendor_outcome_id: str
    event_id: str
    task_id: Optional[str] = None
    provider_id: str

    overall_status: OverallValidationStatus
    extracted_claims: List[ExtractedClaim] = Field(default_factory=list)
    claim_results: List[ClaimValidationDetail] = Field(default_factory=list)

    hard_requirements_passed: List[str] = Field(default_factory=list)
    hard_requirements_failed: List[str] = Field(default_factory=list)
    preferences_matched: List[str] = Field(default_factory=list)
    conflicts: List[str] = Field(default_factory=list)
    unknown_facts: List[str] = Field(default_factory=list)

    validator_version: str = "1.0.0"
    summary: Optional[str] = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
