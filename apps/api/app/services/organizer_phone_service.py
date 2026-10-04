"""Organizer Phone Normalization and User Resolution Service."""
import re
from typing import Optional
from sqlalchemy.orm import Session
from app.models.user import User


def normalize_phone_digits(contact: Optional[str]) -> str:
    """Normalizes phone number to digits only, stripping chat ID domains and formatting characters.
    
    Mirrors OpenWACommunicationAdapter._normalize_chat_id pattern.
    """
    if not contact:
        return ""
    stripped = contact.strip()
    # Strip @c.us or @g.us
    if "@" in stripped:
        stripped = stripped.split("@")[0]
    # Extract only digits
    digits = "".join(c for c in stripped if c.isdigit())
    return digits


def normalize_phone_e164(contact: Optional[str]) -> str:
    """Formats phone number to E.164-like standard (+<country_code><number>)."""
    digits = normalize_phone_digits(contact)
    if not digits:
        return ""
    # If 10 digits (standard Indian number without +91), default to 91
    if len(digits) == 10:
        return f"+91{digits}"
    return f"+{digits}"


def resolve_user_by_phone(db: Session, raw_phone: str) -> Optional[User]:
    """Resolves an organizer User from an inbound phone number or OpenWA chatId."""
    digits = normalize_phone_digits(raw_phone)
    if not digits:
        return None

    # Try matching exact phone_e164 or digits suffix
    e164_candidate = f"+{digits}"
    # Check exact match first
    user = db.query(User).filter(User.phone_e164 == e164_candidate).first()
    if user:
        return user

    # Check without +
    user = db.query(User).filter(User.phone_e164 == digits).first()
    if user:
        return user

    # If 10 digits provided, match against +91<digits>
    if len(digits) == 10:
        user = db.query(User).filter(User.phone_e164 == f"+91{digits}").first()
        if user:
            return user

    # If 12 digits starting with 91 (India), match against +91 or the last 10 digits
    if len(digits) == 12 and digits.startswith("91"):
        last_10 = digits[2:]
        user = db.query(User).filter(
            (User.phone_e164 == f"+{digits}") |
            (User.phone_e164 == f"+91{last_10}") |
            (User.phone_e164 == last_10) |
            (User.phone_e164 == f"+{last_10}")
        ).first()
        if user:
            return user

    # Fallback: search all users with non-null phone and compare digits
    users_with_phone = db.query(User).filter(User.phone_e164.isnot(None)).all()
    for u in users_with_phone:
        u_digits = normalize_phone_digits(u.phone_e164)
        if u_digits and (u_digits == digits or u_digits.endswith(digits) or digits.endswith(u_digits)):
            return u

    return None
