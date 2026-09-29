"""Identity & User Resolution Service for Event Operations and Approvals.

Ensures valid, referentially-intact user records exist in the database,
resolving requester and approver identities generically across all events.
"""
import uuid
from typing import Optional
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
import logging

from app.models.user import User
from app.models.event import Event

logger = logging.getLogger(__name__)

CANONICAL_FALLBACK_USER_ID = "organizer"
CANONICAL_FALLBACK_NAME = "Event Organizer"
CANONICAL_FALLBACK_EMAIL = "organizer@eventra.ai"


def ensure_user_exists(
    db: Session,
    user_id: Optional[str],
    name: Optional[str] = None,
    email: Optional[str] = None,
) -> User:
    """Ensures a user row with user_id exists in the users table, provisioning if missing.
    
    Guarantees referential integrity before child records (e.g. Approval) reference users.id.
    """
    if not user_id or not user_id.strip():
        user_id = CANONICAL_FALLBACK_USER_ID

    user_id = user_id.strip()

    # 1. Lookup by primary key (id)
    user = db.query(User).filter(User.id == user_id).first()
    if user:
        return user

    # 2. Determine target email avoiding collisions with other user IDs
    clean_id = user_id.lower().replace("-", "_").replace(" ", "_")
    target_email = email or f"{clean_id}@eventra.ai"
    user_by_email = db.query(User).filter(User.email == target_email).first()
    if user_by_email:
        target_email = f"{clean_id}_{uuid.uuid4().hex[:6]}@eventra.ai"

    # 3. Provision missing user
    display_name = name or user_id.replace("_", " ").replace("-", " ").title()
    new_user = User(
        id=user_id,
        name=display_name,
        email=target_email,
    )
    db.add(new_user)
    try:
        db.flush()
        return new_user
    except IntegrityError:
        db.rollback()
        existing = db.query(User).filter(User.id == user_id).first()
        if existing:
            return existing
        alt_email = f"{clean_id}_{uuid.uuid4().hex[:8]}@eventra.ai"
        fallback_user = User(id=user_id, name=display_name, email=alt_email)
        db.add(fallback_user)
        db.flush()
        return fallback_user


def resolve_requester_identity(
    db: Session,
    event_id: Optional[str] = None,
    candidate_user_id: Optional[str] = None,
) -> str:
    """Generically resolves a valid user ID for an approval or selection request.
    
    Resolution order:
    1. If candidate_user_id is provided and already exists in users, use it.
    2. If candidate_user_id is not in users but is not a generic fallback, provision and use it.
    3. If candidate_user_id is generic ('organizer', 'anonymous_operator', None) and event.owner_id exists, use event.owner_id.
    4. If candidate_user_id is provided, ensure it exists and return it.
    5. Fallback to default-operator, anonymous_operator, or canonical 'organizer' (ensured in DB).
    
    Guarantees:
    - Never returns an identity that does not exist in users.id.
    - Preserves explicit organizer/collaborator selection identities.
    """
    # 1. Check if candidate_user_id is an explicit custom user
    if candidate_user_id and candidate_user_id.strip():
        c_id = candidate_user_id.strip()
        if c_id not in ("organizer", "anonymous_operator", "default-operator"):
            user = db.query(User).filter(User.id == c_id).first()
            if user:
                return user.id
            # If explicit name passed, provision it
            return ensure_user_exists(db, c_id).id

    # 2. Check event owner
    if event_id:
        event = db.query(Event).filter(Event.id == event_id).first()
        if event and event.owner_id:
            owner = db.query(User).filter(User.id == event.owner_id).first()
            if owner:
                return owner.id
            return ensure_user_exists(db, event.owner_id).id

    # 3. If candidate_user_id is provided (e.g. 'anonymous_operator' or 'organizer')
    if candidate_user_id and candidate_user_id.strip():
        return ensure_user_exists(db, candidate_user_id.strip()).id

    # 4. Check known system operators in DB
    for default_id in ("default-operator", "anonymous_operator"):
        u = db.query(User).filter(User.id == default_id).first()
        if u:
            return u.id

    # 5. Canonical fallback
    return ensure_user_exists(db, CANONICAL_FALLBACK_USER_ID, CANONICAL_FALLBACK_NAME, CANONICAL_FALLBACK_EMAIL).id


def resolve_approver_identity(
    db: Session,
    approver_id: Optional[str] = None,
) -> Optional[str]:
    """Ensures that approver_id exists in users table if provided."""
    if not approver_id or not approver_id.strip():
        return None
    return ensure_user_exists(db, approver_id.strip()).id


def ensure_canonical_users(db: Session) -> None:
    """Ensures canonical fallback users exist in the database."""
    canonical_list = [
        ("anonymous_operator", "Elena Vance (Ops Director)", "elena.vance@eventra.local"),
        ("default-operator", "Default Operator", "default-operator@eventra.local"),
        (CANONICAL_FALLBACK_USER_ID, CANONICAL_FALLBACK_NAME, CANONICAL_FALLBACK_EMAIL),
    ]
    for uid, name, email in canonical_list:
        try:
            ensure_user_exists(db, uid, name=name, email=email)
            db.commit()
        except Exception as e:
            db.rollback()
            logger.debug(f"Canonical user '{uid}' initialization check: {e}")
