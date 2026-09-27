"""Pydantic Schemas: DiscoveryRun and DiscoveryRunEvent"""
from datetime import datetime
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field, ConfigDict


class DiscoveryRunEventResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    run_id: str
    iteration: int
    event_type: str
    message: str
    data: Dict[str, Any] = Field(default_factory=dict)
    timestamp: datetime


class DiscoveryRunResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    run_id: str = Field(..., alias="id")
    event_id: str
    category: str
    status: str
    trigger: str
    incident_id: Optional[str] = None
    current_iteration: int
    max_iterations: int
    radius_km: float
    target_count: int

    # Dynamic Funnel Stage terms (Appendix Section 8.2)
    discovered: int
    unique: int = Field(..., alias="unique_count")
    relevant: int
    matching: int
    shortlisted: int

    summary: Optional[str] = None
    parameters: Dict[str, Any] = Field(default_factory=dict)
    created_at: datetime
    updated_at: datetime

    latest_events: Optional[List[DiscoveryRunEventResponse]] = None


class DiscoveryRunListResponse(BaseModel):
    items: List[DiscoveryRunResponse]
    total: int
