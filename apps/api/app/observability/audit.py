"""Observability: Audit System.

Provides immutable historical audit recording for operational actions, approvals,
and verification results. Strictly enforces zero secrets and zero chain-of-thought.
"""
import base64
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple, Union
from sqlalchemy import and_, or_
from sqlalchemy.orm import Session
from app.models.audit import AuditRecord
from app.core.exceptions import BadRequestException


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
        return query.order_by(AuditRecord.created_at.desc(), AuditRecord.id.desc()).limit(limit).all()

    def list_records_paginated(
        self,
        event_id: str,
        action_type: Optional[str] = None,
        limit: int = 50,
        cursor: Optional[str] = None,
        offset: Optional[int] = None,
    ) -> Tuple[List[AuditRecord], int, Optional[str]]:
        """Lists audit records with deterministic cursor-based and offset pagination (B8).
        
        Uses stable composite ordering (created_at DESC, id DESC).
        Returns:
            Tuple of (records, total_count, next_cursor)
        """
        base_query = self.db.query(AuditRecord).filter(AuditRecord.event_id == event_id)
        if action_type:
            base_query = base_query.filter(AuditRecord.action_type == action_type)

        total_count = base_query.count()

        query = base_query.order_by(AuditRecord.created_at.desc(), AuditRecord.id.desc())

        if cursor:
            try:
                decoded = base64.b64decode(cursor.encode("utf-8")).decode("utf-8")
                ts_str, record_id = decoded.split("|", 1)
                cursor_ts = datetime.fromisoformat(ts_str)
                query = query.filter(
                    or_(
                        AuditRecord.created_at < cursor_ts,
                        and_(AuditRecord.created_at == cursor_ts, AuditRecord.id < record_id),
                    )
                )
            except Exception as exc:
                raise BadRequestException(f"Invalid audit pagination cursor: {exc}")
        elif offset is not None and offset > 0:
            query = query.offset(offset)

        # Query limit + 1 to detect next page
        items = query.limit(limit + 1).all()
        next_cursor = None
        if len(items) > limit:
            last_item = items[limit - 1]
            cursor_raw = f"{last_item.created_at.isoformat()}|{last_item.id}"
            next_cursor = base64.b64encode(cursor_raw.encode("utf-8")).decode("utf-8")
            items = items[:limit]

        return items, total_count, next_cursor

    def export_records(
        self,
        event_id: str,
        action_type: Optional[str] = None,
        format_type: str = "json",
    ) -> str:
        """Exports authoritative audit trail for an event in JSON or CSV format (B7).
        
        Strictly sanitizes payloads to eliminate secrets and tokens.
        """
        query = (
            self.db.query(AuditRecord)
            .filter(AuditRecord.event_id == event_id)
            .order_by(AuditRecord.created_at.asc(), AuditRecord.id.asc())
        )
        if action_type:
            query = query.filter(AuditRecord.action_type == action_type)
        records = query.all()

        if format_type.lower() == "csv":
            import csv
            import io
            output = io.StringIO()
            writer = csv.writer(output)
            writer.writerow([
                "id", "event_id", "created_at", "actor_id", "actor_type",
                "action", "action_type", "target_type", "target_id",
                "impact_level", "approval_id", "execution_id", "verification_id", "failure_reason"
            ])
            for r in records:
                writer.writerow([
                    r.id, r.event_id, r.created_at.isoformat() if r.created_at else "",
                    r.actor_id or "", r.actor_type or "",
                    r.action, r.action_type, r.target_type or "", r.target_id or "",
                    r.impact_level or "", r.approval_id or "", r.execution_id or "",
                    r.verification_id or "", r.failure_reason or ""
                ])
            return output.getvalue()
        else:
            import json
            data = []
            for r in records:
                data.append({
                    "id": r.id,
                    "event_id": r.event_id,
                    "created_at": r.created_at.isoformat() if r.created_at else None,
                    "actor_id": r.actor_id,
                    "actor_type": r.actor_type,
                    "action": r.action,
                    "action_type": r.action_type,
                    "target_type": r.target_type,
                    "target_id": r.target_id,
                    "before_state": self._sanitize_payload(r.before_state),
                    "after_state": self._sanitize_payload(r.after_state),
                    "impact_level": r.impact_level,
                    "approval_id": r.approval_id,
                    "execution_id": r.execution_id,
                    "verification_id": r.verification_id,
                    "failure_reason": r.failure_reason,
                })
            return json.dumps(data, indent=2)

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
