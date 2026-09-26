"""Pydantic Schemas: Event"""
from datetime import datetime
from decimal import Decimal
from typing import Optional
from pydantic import BaseModel, ConfigDict
from app.models.enums import EventType, EventState


class EventBase(BaseModel):
    name: str
    description: Optional[str] = None
    event_type: str = EventType.OTHER.value
    location: Optional[str] = None
    start_datetime: Optional[datetime] = None
    end_datetime: Optional[datetime] = None
    guest_count: int = 0
    state: str = EventState.NORMAL.value
    manual_mode: bool = False
    total_budget: Decimal = Decimal("0.00")
    currency: str = "USD"


class EventCreate(EventBase):
    owner_id: str


class EventUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    event_type: Optional[str] = None
    location: Optional[str] = None
    start_datetime: Optional[datetime] = None
    end_datetime: Optional[datetime] = None
    guest_count: Optional[int] = None
    state: Optional[str] = None
    manual_mode: Optional[bool] = None
    total_budget: Optional[Decimal] = None
    currency: Optional[str] = None


class EventResponse(EventBase):
    id: str
    owner_id: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)
