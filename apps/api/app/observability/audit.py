"""Observability: Audit System.

Provides immutable historical audit recording for operational actions, approvals,
and verification results. Strictly enforces zero secrets and zero chain-of-thought.
"""
from typing import Any, Dict, List, Optional
from sqlalchemy.orm import Session
from app.models.audit import AuditRecord


class AuditRecorder:
    """Records and queries immutable structured audit trails."""

    def __init__(self, db: Session):
        self.db = db

    def record(
        self,
        event_id: str,
        action: str,
        action_type: str,
        actor_id: Optional[str] = None,
        actor_type: str = "USER",  # USER, SYSTEM, AGENT
        target_type: Optional[str] = None,
        target_id: Optional[str] = None,
        before_state: Optional[Dict[str, Any]] = None,
        after_state: Optional[Dict[str, Any]] = None,
        impact_level: Optional[str] = None,
        approval_id: Optional[str] = None,
        execution_id: Optional[str] = None,
        verification_id: Optional[str] = None,
        failure_reason: Optional[str] = None,
    ) -> AuditRecord:
        """Appends an immutable audit record to the event audit trail."""
        # Sanitize states to ensure no credentials or raw tokens are stored
        clean_before = self._sanitize_payload(before_state) if before_state else None
        clean_after = self._sanitize_payload(after_state) if after_state else None

        record = AuditRecord(
            event_id=event_id,
            actor_id=actor_id,
            actor_type=actor_type,
            action=action,
            action_type=action_type,
            target_type=target_type,
            target_id=target_id,
            before_state=clean_before,
            after_state=clean_after,
            impact_level=impact_level,
            approval_id=approval_id,
            execution_id=execution_id,
            verification_id=verification_id,
            failure_reason=failure_reason,
        )
        self.db.add(record)
        self.db.flush()
        return record

    def list_records(
        self, event_id: str, action_type: Optional[str] = None, limit: int = 100
    ) -> List[AuditRecord]:
        """Lists audit records in reverse chronological order for an event."""
        query = self.db.query(AuditRecord).filter(AuditRecord.event_id == event_id)
        if action_type:
            query = query.filter(AuditRecord.action_type == action_type)
        return query.order_by(AuditRecord.created_at.desc()).limit(limit).all()

    def _sanitize_payload(self, data: Any) -> Any:
        """Removes sensitive authentication tokens and ensures JSON serializability."""
        if hasattr(data, "_mock_name") or "mock" in type(data).__name__.lower():
            return str(data)
        if isinstance(data, (str, int, float, bool)) or data is None:
            return data
        if isinstance(data, dict):
            sanitized = {}
            for k, v in data.items():
                if any(sec in k.lower() for sec in ("password", "token", "secret", "auth", "credential", "chain_of_thought")):
                    sanitized[k] = "[REDACTED]"
                else:
                    sanitized[k] = self._sanitize_payload(v)
            return sanitized
        elif isinstance(data, (list, tuple, set)):
            return [self._sanitize_payload(item) for item in data]
        try:
            import json
            json.dumps(data)
            return data
        except Exception:
            return str(data)
