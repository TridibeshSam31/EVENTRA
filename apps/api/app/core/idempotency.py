"""Idempotency and Mutation Reconciliation Framework (B11).

Provides:
1. Deterministic payload hashing.
2. Safe idempotency checking & atomic response recording.
3. Conflict detection for payload tampering on key reuse.
4. Automatic TTL / expiration handling.
"""
import hashlib
import json
import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional, Tuple
from sqlalchemy.orm import Session

from app.models.idempotency import IdempotencyRecord
from app.core.exceptions import ConflictException

logger = logging.getLogger(__name__)


def utc_now():
    return datetime.now(timezone.utc).replace(tzinfo=None)


def compute_payload_hash(payload: Any) -> str:
    """Computes a canonical SHA-256 hash of a payload dictionary, string, or primitive."""
    if payload is None:
        payload = {}
    if isinstance(payload, str):
        serialized = payload
    else:
        try:
            serialized = json.dumps(payload, sort_keys=True, default=str)
        except Exception:
            serialized = str(payload)
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()


class IdempotencyService:
    """Manages transactional idempotency records."""

    def __init__(self, db: Session):
        self.db = db

    def check_or_start(
        self,
        idempotency_key: str,
        endpoint: str,
        method: str,
        payload: Any,
        event_id: Optional[str] = None,
        ttl_hours: int = 24,
    ) -> Tuple[bool, Optional[int], Optional[Any]]:
        """Checks if a mutation with this key has already been executed.

        Returns:
            Tuple: (already_completed: bool, response_code: Optional[int], response_body: Optional[Any])
        Raises:
            ConflictException: If key was used with a different payload or is currently processing.
        """
        request_hash = compute_payload_hash(payload)
        now = utc_now()

        existing = (
            self.db.query(IdempotencyRecord)
            .filter(IdempotencyRecord.idempotency_key == idempotency_key)
            .first()
        )

        if existing:
            # Check expiration
            if existing.expires_at < now:
                # Expired key; delete and allow replacement
                self.db.delete(existing)
                self.db.flush()
            else:
                # Check payload match
                if existing.request_hash != request_hash:
                    raise ConflictException(
                        f"Idempotency-Key '{idempotency_key}' was previously used with a materially different payload.",
                        details={"idempotency_key": idempotency_key, "error": "KEY_PAYLOAD_MISMATCH"},
                    )

                if existing.status == "COMPLETED":
                    return True, existing.response_code, existing.response_body
                elif existing.status == "PROCESSING":
                    raise ConflictException(
                        f"A request with Idempotency-Key '{idempotency_key}' is currently being processed. Please retry later.",
                        details={"idempotency_key": idempotency_key, "error": "CONCURRENT_PROCESSING"},
                    )
                # If existing.status == "FAILED", allow retry by replacing record

        # Register new processing state
        expires_at = now + timedelta(hours=ttl_hours)
        if existing and existing.expires_at >= now:
            existing.endpoint = endpoint
            existing.method = method
            existing.request_hash = request_hash
            existing.status = "PROCESSING"
            existing.expires_at = expires_at
            existing.response_code = None
            existing.response_body = None
        else:
            record = IdempotencyRecord(
                idempotency_key=idempotency_key,
                event_id=event_id,
                endpoint=endpoint,
                method=method,
                request_hash=request_hash,
                status="PROCESSING",
                created_at=now,
                expires_at=expires_at,
            )
            self.db.add(record)

        try:
            self.db.commit()
        except Exception:
            self.db.rollback()
            existing_race = (
                self.db.query(IdempotencyRecord)
                .filter(IdempotencyRecord.idempotency_key == idempotency_key)
                .first()
            )
            if existing_race:
                if existing_race.request_hash != request_hash:
                    raise ConflictException("Idempotency key collision with different payload.")
                if existing_race.status == "COMPLETED":
                    return True, existing_race.response_code, existing_race.response_body
                raise ConflictException("Concurrent request with same idempotency key is processing.")
            raise

        return False, None, None

    def complete(
        self,
        idempotency_key: str,
        response_code: int,
        response_body: Any,
    ):
        """Finalizes an idempotency record with authoritative response data."""
        record = (
            self.db.query(IdempotencyRecord)
            .filter(IdempotencyRecord.idempotency_key == idempotency_key)
            .first()
        )
        if record:
            record.status = "COMPLETED"
            record.response_code = response_code
            record.response_body = response_body
            try:
                self.db.commit()
            except Exception as exc:
                logger.error("Failed to commit idempotency completion for %s: %s", idempotency_key, exc)
                self.db.rollback()

    def fail(self, idempotency_key: str):
        """Marks the idempotency record as failed so the operation can be retried."""
        record = (
            self.db.query(IdempotencyRecord)
            .filter(IdempotencyRecord.idempotency_key == idempotency_key)
            .first()
        )
        if record:
            record.status = "FAILED"
            try:
                self.db.commit()
            except Exception:
                self.db.rollback()
