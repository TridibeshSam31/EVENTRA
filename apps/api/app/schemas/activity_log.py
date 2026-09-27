"""Pydantic Schemas: EventActivityLog and Unified Activity Stream"""
from datetime import datetime
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field, ConfigDict


class EventActivityLogResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    event_id: str
    timestamp: datetime
    category: str
    actor: str
    action: str
    summary: str
    ref_id: Optional[str] = None
    details: Dict[str, Any] = Field(default_factory=dict)


class EventActivityStreamResponse(BaseModel):
    total: int
    items: List[EventActivityLogResponse]
