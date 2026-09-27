"""Service: ActivityLogService (Part A.4)

Provides a single unified activity and audit event stream across the whole lifecycle:
Discovery, Engagement, Incidents, Approvals, and Execution.
"""
import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from sqlalchemy.orm import Session

from app.models.activity_log import EventActivityLog

logger = logging.getLogger(__name__)


def utc_now():
    return datetime.now(timezone.utc).replace(tzinfo=None)


class ActivityLogService:
    """Unified activity stream logging and querying across EVENTRA."""

    def __init__(self, db: Session):
        self.db = db

    def log(
        self,
        event_id: str,
        category: str,
        actor: str,
        action: str,
        summary: str,
        ref_id: Optional[str] = None,
        details: Optional[Dict[str, Any]] = None,
        timestamp: Optional[datetime] = None,
    ) -> EventActivityLog:
        """Appends a normalized event to the unified activity stream."""
        entry = EventActivityLog(
            event_id=event_id,
            timestamp=timestamp or utc_now(),
            category=category,
            actor=actor,
            action=action,
            summary=summary,
            ref_id=ref_id,
            details=details or {},
        )
        self.db.add(entry)
        try:
            self.db.commit()
            self.db.refresh(entry)
        except Exception as exc:
            self.db.rollback()
            logger.warning(f"Failed to commit EventActivityLog: {exc}")
        return entry

    def get_stream(
        self,
        event_id: str,
        category: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> List[EventActivityLog]:
        """Retrieves chronological activity log entries for an event."""
        query = self.db.query(EventActivityLog).filter(EventActivityLog.event_id == event_id)
        if category:
            query = query.filter(EventActivityLog.category == category)
        return query.order_by(EventActivityLog.timestamp.desc()).offset(offset).limit(limit).all()

    def count(self, event_id: str, category: Optional[str] = None) -> int:
        """Counts activity log entries for an event."""
        query = self.db.query(EventActivityLog).filter(EventActivityLog.event_id == event_id)
        if category:
            query = query.filter(EventActivityLog.category == category)
        return query.count()
