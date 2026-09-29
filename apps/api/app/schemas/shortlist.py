"""Pydantic schemas for EventShortlistEntry API."""
from datetime import datetime
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field, ConfigDict


class ShortlistEntryCreate(BaseModel):
    candidate_id: str = Field(..., description="Unique candidate identifier or provider ID")
    provider_id: Optional[str] = Field(None, description="Optional DB provider ID if entity is in database")
    category: Optional[str] = Field(None, description="Category of candidate (e.g. CATERING, VENUE, PHOTOGRAPHY)")
    candidate_name: Optional[str] = Field(None, description="Display name of candidate")
    status: Optional[str] = Field("SHORTLISTED", description="Status (SHORTLISTED, ENGAGED, REJECTED)")
    ranking: Optional[int] = Field(None, description="Order ranking in shortlist")
    selection_source: Optional[str] = Field("ORGANIZER_SELECTION", description="Source (ORGANIZER_SELECTION, AGENT_RECOMMENDATION)")
    selected_by: Optional[str] = Field(None, description="ID of user who selected this candidate")
    selected_at: Optional[datetime] = Field(None, description="Timestamp when selected")
    notes: Optional[str] = Field(None, description="User or organizer notes")
    candidate_data: Optional[Dict[str, Any]] = Field(default_factory=dict, description="Metadata snapshot of candidate")


class ShortlistCandidateSelect(BaseModel):
    selected_by: Optional[str] = Field(None, description="Identifier of organizer making selection")


class ShortlistEntryResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    event_id: str
    candidate_id: str
    provider_id: Optional[str] = None
    category: Optional[str] = None
    candidate_name: Optional[str] = None
    status: str
    ranking: Optional[int] = None
    selection_source: Optional[str] = "ORGANIZER_SELECTION"
    selected_by: Optional[str] = None
    selected_at: Optional[datetime] = None
    notes: Optional[str] = None
    candidate_data: Optional[Dict[str, Any]] = None
    created_at: datetime
    updated_at: datetime


class ShortlistListResponse(BaseModel):
    items: List[ShortlistEntryResponse]
    total: int
