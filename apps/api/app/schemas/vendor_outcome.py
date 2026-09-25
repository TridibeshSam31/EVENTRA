"""Pydantic Schemas for Task 6: Organizer Vendor Outcome Input."""
from datetime import datetime
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, ConfigDict, Field


class VendorOutcomeBase(BaseModel):
    """Base schema for organizer-reported vendor outcome."""
    provider_id: str = Field(..., description="Target vendor/provider UUID")
    task_id: Optional[str] = Field(None, description="Optional event task UUID associated with this outcome")
    communication_channel: str = Field(
        default="OTHER",
        description="External communication channel used (PHONE, EMAIL, WHATSAPP_EXTERNAL, IN_PERSON, OTHER)",
    )
    outcome_status: str = Field(
        default="CONTACTED",
        description="Status of interaction (CONTACTED, INTERESTED, AVAILABLE, UNAVAILABLE, QUOTE_RECEIVED, ACCEPTED, DECLINED, NO_RESPONSE, UNKNOWN)",
    )
    quoted_price: Optional[float] = Field(
        default=None,
        description="Quoted price in specified currency. None if not quoted or unknown.",
    )
    currency: str = Field(default="INR", description="Currency of quoted price (e.g. INR, USD)")
    reported_availability: str = Field(
        default="UNKNOWN",
        description="Vendor availability stated during contact (AVAILABLE, UNAVAILABLE, CONDITIONAL, UNKNOWN)",
    )
    organizer_notes: Optional[str] = Field(
        default=None,
        description="Organizer notes capturing context, verbal quotes, conditions, and hold dates",
    )
    vendor_response: Optional[Dict[str, Any]] = Field(
        default=None,
        description="Any additional structured facts or conditions reported by the vendor",
    )


class VendorOutcomeCreate(VendorOutcomeBase):
    """Input payload for recording a vendor outcome."""
    submitted_by: Optional[str] = Field(default=None, description="User ID of the organizer recording the outcome")


class VendorOutcomeResponse(VendorOutcomeBase):
    """Authoritative API response schema for recorded vendor outcomes."""
    id: str = Field(..., description="Unique outcome record UUID")
    event_id: str = Field(..., description="Associated event UUID")
    source: str = Field(
        default="ORGANIZER_REPORTED",
        description="Data provenance: Always ORGANIZER_REPORTED for Task 6 input",
    )
    verification_status: str = Field(
        default="UNVERIFIED",
        description="Verification state: Always UNVERIFIED until Task 7 validation",
    )
    submitted_by: Optional[str] = Field(default=None, description="User ID of submitter")
    created_at: datetime = Field(..., description="Record creation timestamp")
    updated_at: datetime = Field(..., description="Record last update timestamp")
    provider_name: Optional[str] = Field(default=None, description="Human-readable provider name")
    task_name: Optional[str] = Field(default=None, description="Human-readable task name if task_id provided")

    model_config = ConfigDict(from_attributes=True)


class PaginatedVendorOutcomesResponse(BaseModel):
    """Paginated collection of vendor outcome records."""
    total: int = Field(..., description="Total outcome records matching filter")
    items: List[VendorOutcomeResponse] = Field(..., description="List of vendor outcome responses")
