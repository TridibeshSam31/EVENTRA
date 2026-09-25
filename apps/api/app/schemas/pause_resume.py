"""Pydantic Schemas for Task 11 Event Execution Pause and Resume."""
from datetime import datetime
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field


class PauseEventRequest(BaseModel):
    """Payload for pausing an event's operational execution."""
    reason: str = Field(..., min_length=3, description="Operational rationale for pausing execution")
    plan_version: Optional[int] = Field(None, ge=1, description="Observed Task 9 plan version for concurrency safety")


class ResumeEventRequest(BaseModel):
    """Payload for resuming a paused event's operational execution."""
    reason: Optional[str] = Field(None, description="Optional operational rationale for resuming execution")
    plan_version: Optional[int] = Field(None, ge=1, description="Observed Task 9 plan version for concurrency safety")


class EventExecutionStateResponse(BaseModel):
    """Authoritative operational execution state representation."""
    event_id: str
    execution_state: str = Field(..., description="RUNNING, PAUSING, PAUSED, or RESUMING")
    previous_state: Optional[str] = None
    plan_version: int
    is_paused: bool
    can_pause: bool
    can_resume: bool
    active_incidents_count: int = 0
    last_pause_record: Optional[Dict[str, Any]] = None
    updated_at: Optional[datetime] = None


class PauseResumeRecordResponse(BaseModel):
    """Structured audit record for an executed pause or resume operation."""
    id: str
    event_id: str
    operation_type: str  # PAUSE, RESUME
    requested_by: str
    requested_at: datetime
    reason: Optional[str] = None
    previous_state: str
    target_state: str
    plan_version: int
    status: str
    approval_reference: Optional[str] = None
    validation_result: Optional[Dict[str, Any]] = None
    completed_at: Optional[datetime] = None
    audit_reference: Optional[str] = None

    model_config = {"from_attributes": True}
