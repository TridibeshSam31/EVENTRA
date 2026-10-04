"""Pydantic Schema: Notification & Web Push Subscriptions"""
from pydantic import BaseModel, ConfigDict
from typing import Optional, List, Dict, Any
from datetime import datetime


class NotificationBase(BaseModel):
    event_id: str
    notification_type: str
    channel: str = "IN_APP"
    recipient: Optional[str] = None
    title: str
    message: str
    payload: Dict[str, Any] = {}
    status: str = "DELIVERED"


class NotificationResponse(NotificationBase):
    id: str
    created_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


class PushSubscriptionKeys(BaseModel):
    p256dh: str
    auth: str


class PushSubscriptionCreate(BaseModel):
    endpoint: str
    keys: PushSubscriptionKeys
    user_agent: Optional[str] = None


class PushSubscriptionUnsubscribe(BaseModel):
    endpoint: str


class PushSubscriptionResponse(BaseModel):
    id: str
    user_id: str
    endpoint: str
    created_at: datetime
    last_used: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)
