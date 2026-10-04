"""API Route: Auth and User Profile"""
from fastapi import APIRouter, Depends, HTTPException, status
from typing import List, Optional, Dict, Any
from sqlalchemy.orm import Session

from app.api.dependencies import get_db_session, get_current_user_id
from app.models.user import User
from app.schemas.user import UserResponse, UserPhoneUpdate
from app.services.organizer_phone_service import normalize_phone_e164
from app.services.identity_service import ensure_user_exists

router = APIRouter(prefix="/auth", tags=["auth"])


@router.get("/")
def get_auth_root():
    return {"status": "ok", "resource": "auth"}


@router.get("/me", response_model=UserResponse)
def get_current_user_profile(
    db: Session = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user_id),
):
    """Retrieves current user identity profile."""
    user = ensure_user_exists(db, current_user_id)
    return UserResponse.model_validate(user)


@router.put("/me/phone", response_model=UserResponse)
def update_current_user_phone(
    payload: UserPhoneUpdate,
    db: Session = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user_id),
):
    """Updates the phone number for the current user in E.164 format."""
    user = ensure_user_exists(db, current_user_id)
    normalized = normalize_phone_e164(payload.phone)
    if not normalized:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid phone number: no digits found.",
        )
    user.phone_e164 = normalized
    db.commit()
    db.refresh(user)
    return UserResponse.model_validate(user)


@router.put("/users/{user_id}/phone", response_model=UserResponse)
def update_user_phone_by_id(
    user_id: str,
    payload: UserPhoneUpdate,
    db: Session = Depends(get_db_session),
):
    """Admin / direct way to set user phone number."""
    user = ensure_user_exists(db, user_id)
    normalized = normalize_phone_e164(payload.phone)
    if not normalized:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid phone number: no digits found.",
        )
    user.phone_e164 = normalized
    db.commit()
    db.refresh(user)
    return UserResponse.model_validate(user)
