"""API Route: Notifications & Web Push Subscriptions"""
from fastapi import APIRouter, Depends, HTTPException, status, Query
from typing import List, Optional, Dict, Any
from sqlalchemy.orm import Session
from datetime import datetime, timezone

from app.api.dependencies import get_db_session, get_current_user_id
from app.core.config import settings
from app.models.notification import Notification
from app.models.push_subscription import PushSubscription
from app.schemas.notification import (
    NotificationResponse,
    PushSubscriptionCreate,
    PushSubscriptionUnsubscribe,
    PushSubscriptionResponse,
)
from app.services.identity_service import ensure_user_exists

router = APIRouter(prefix="/notifications", tags=["notifications"])


def utc_now():
    return datetime.now(timezone.utc).replace(tzinfo=None)


@router.get("/")
def get_notifications_root():
    return {"status": "ok", "resource": "notifications"}


@router.get("/push/vapid-public-key")
def get_vapid_public_key():
    """Returns the application VAPID public key for browser push subscription negotiation."""
    key = settings.VAPID_PUBLIC_KEY or "MOCK_VAPID_PUBLIC_KEY_BEl4w..."
    return {
        "public_key": key,
        "is_mock": not bool(settings.VAPID_PUBLIC_KEY and settings.COMMUNICATION_PROVIDER != "mock"),
    }


@router.post(
    "/push/subscribe",
    response_model=PushSubscriptionResponse,
    status_code=status.HTTP_201_CREATED,
)
def subscribe_web_push(
    payload: PushSubscriptionCreate,
    db: Session = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user_id),
):
    """Registers or updates a browser Web Push subscription for the active user."""
    user = ensure_user_exists(db, current_user_id)

    sub = (
        db.query(PushSubscription)
        .filter(PushSubscription.endpoint == payload.endpoint)
        .first()
    )
    if sub:
        # Update user and keys if re-subscribing
        sub.user_id = user.id
        sub.p256dh = payload.keys.p256dh
        sub.auth = payload.keys.auth
        sub.user_agent = payload.user_agent
        sub.last_used = utc_now()
    else:
        sub = PushSubscription(
            user_id=user.id,
            endpoint=payload.endpoint,
            p256dh=payload.keys.p256dh,
            auth=payload.keys.auth,
            user_agent=payload.user_agent,
            created_at=utc_now(),
            last_used=utc_now(),
        )
        db.add(sub)

    db.commit()
    db.refresh(sub)
    return PushSubscriptionResponse.model_validate(sub)


@router.post("/push/unsubscribe")
def unsubscribe_web_push(
    payload: PushSubscriptionUnsubscribe,
    db: Session = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user_id),
):
    """Removes a Web Push subscription."""
    sub = (
        db.query(PushSubscription)
        .filter(PushSubscription.endpoint == payload.endpoint)
        .first()
    )
    if sub:
        db.delete(sub)
        db.commit()
        return {"status": "UNSUBSCRIBED", "endpoint": payload.endpoint}
    return {"status": "NOT_FOUND", "endpoint": payload.endpoint}


@router.get("/list", response_model=List[NotificationResponse])
def list_notifications(
    event_id: str = Query(..., description="Target event ID"),
    channel: Optional[str] = Query(None, description="Optional channel filter"),
    limit: int = Query(50, ge=1, le=100),
    db: Session = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user_id),
):
    """Lists operational notifications and delivery records for an event."""
    query = db.query(Notification).filter(Notification.event_id == event_id)
    if channel:
        query = query.filter(Notification.channel == channel.upper())
    items = query.order_by(Notification.created_at.desc()).limit(limit).all()
    return [NotificationResponse.model_validate(n) for n in items]
