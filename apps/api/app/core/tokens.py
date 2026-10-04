"""Signed single-purpose tokens for deep links and remote operations."""
import hmac
import hashlib
import json
import base64
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, Optional
from app.core.config import settings


def utc_now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _get_signing_key() -> bytes:
    key = settings.DEEP_LINK_SECRET or settings.SECRET_KEY or "development-secret-key"
    return key.encode("utf-8")


def generate_approval_view_token(
    event_id: str,
    approval_id: str,
    expires_at: Optional[datetime] = None,
) -> str:
    """Generates an expiring, single-purpose HMAC-signed token for viewing an approval."""
    if not expires_at:
        expires_at = utc_now() + timedelta(hours=24)

    payload = {
        "sub": "approval_view",
        "event_id": str(event_id),
        "approval_id": str(approval_id),
        "exp": int(expires_at.replace(tzinfo=timezone.utc).timestamp() if expires_at.tzinfo else expires_at.timestamp()),
    }
    raw_json = json.dumps(payload, sort_keys=True).encode("utf-8")
    b64_payload = base64.urlsafe_b64encode(raw_json).decode("utf-8").rstrip("=")

    signature = hmac.new(
        _get_signing_key(),
        b64_payload.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()

    return f"{b64_payload}.{signature}"


def verify_approval_view_token(
    token: str,
    expected_event_id: str,
    expected_approval_id: str,
) -> bool:
    """Verifies that the token is authentic, unexpired, and matches the event & approval."""
    if not token or "." not in token:
        return False

    b64_payload, signature = token.split(".", 1)

    # 1. Verify HMAC signature
    expected_sig = hmac.new(
        _get_signing_key(),
        b64_payload.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()

    if not hmac.compare_digest(expected_sig.lower(), signature.lower()):
        return False

    # 2. Decode payload
    try:
        padding = "=" * (-len(b64_payload) % 4)
        raw_json = base64.urlsafe_b64decode(b64_payload + padding)
        data = json.loads(raw_json.decode("utf-8"))
    except Exception:
        return False

    # 3. Validate claims
    if data.get("sub") != "approval_view":
        return False
    if data.get("event_id") != expected_event_id:
        return False
    if data.get("approval_id") != expected_approval_id:
        return False

    exp = data.get("exp")
    if exp is not None:
        now_ts = int(utc_now().timestamp())
        if now_ts > exp:
            return False

    return True


def build_approval_deep_link(
    event_id: str,
    approval_id: str,
    expires_at: Optional[datetime] = None,
) -> str:
    """Builds the full frontend deep-link URL with signed view token."""
    token = generate_approval_view_token(event_id, approval_id, expires_at)
    base_url = (settings.FRONTEND_BASE_URL or "http://localhost:3000").rstrip("/")
    return f"{base_url}/events/{event_id}/approvals/{approval_id}?token={token}"
