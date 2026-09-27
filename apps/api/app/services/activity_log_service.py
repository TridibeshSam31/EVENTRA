"""Service: ActivityLogService (Part A.4)

Provides a single unified activity and audit event stream across the whole lifecycle:
Discovery, Engagement, Incidents, Approvals, and Execution.
"""
import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from sqlalchemy.orm import Session

from app.models.activity_log import EventActivityLog
from app.models.audit import AuditRecord

logger = logging.getLogger(__name__)


def utc_now():
    return datetime.now(timezone.utc).replace(tzinfo=None)


class ActivityLogItemView:
    """Read view matching EventActivityLogResponse schema."""
    def __init__(
        self,
        id: str,
        event_id: str,
        timestamp: datetime,
        category: str,
        actor: str,
        action: str,
        summary: str,
        ref_id: Optional[str] = None,
        details: Optional[Dict[str, Any]] = None,
    ):
        self.id = id
        self.event_id = event_id
        self.timestamp = timestamp
        self.category = category
        self.actor = actor
        self.action = action
        self.summary = summary
        self.ref_id = ref_id
        self.details = details or {}


def _map_audit_to_activity(r: AuditRecord) -> ActivityLogItemView:
    act = (r.action or "").upper()
    act_type = (r.action_type or "").upper()

    # Determine category
    if "DISCOVERY" in act or "CANDIDATE" in act or "SCOUT" in act:
        category = "DISCOVERY"
    elif "MESSAGE" in act or "COMMUNICATION" in act_type or "CALL" in act or "SMS" in act or "WHATSAPP" in act:
        category = "COMMUNICATION"
    elif "APPROVAL" in act or "APPROVAL" in act_type:
        category = "APPROVAL"
    elif "INCIDENT" in act or "INCIDENT" in act_type:
        category = "INCIDENT"
    else:
        category = "DISCOVERY" if act_type == "OPERATIONS" else (act_type or "OPERATIONS")

    # Determine actor
    if (r.actor_type or "").upper() in ("AGENT", "SYSTEM") or "AGENT" in act:
        actor = "AGENT"
    else:
        actor = "ORGANIZER"

    # Human-readable summary
    details = r.after_state or {}
    if act == "PROVIDER_CANDIDATES_EVALUATED":
        summary = "Autonomous agent scouted & evaluated provider candidates"
    elif act == "PROVIDER_MESSAGE_SENT":
        channel = details.get("channel", "dispatch") if isinstance(details, dict) else "dispatch"
        summary = f"Dispatched outreach request to candidate provider via {channel}"
    elif act == "AUTONOMOUS_OPERATIONS_STARTED":
        summary = "Autonomous operations initiated across all required event categories"
    elif act == "PLAN_GENERATED":
        summary = "Generated critical path tasks and execution schedule"
    elif act == "TASK_STATUS_UPDATED":
        summary = "Execution milestone status updated"
    else:
        summary = act.replace("_", " ").lower().capitalize()

    return ActivityLogItemView(
        id=r.id,
        event_id=r.event_id,
        timestamp=r.created_at,
        category=category,
        actor=actor,
        action=r.action,
        summary=summary,
        ref_id=r.target_id,
        details=details,
    )


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
    ) -> List[Any]:
        """Retrieves unified chronological activity log entries for an event,
        merging discrete EventActivityLog entries and authoritative AuditRecords.
        """
        # 1. Fetch EventActivityLog entries
        act_query = self.db.query(EventActivityLog).filter(EventActivityLog.event_id == event_id)
        if category and category.upper() != "ALL":
            act_query = act_query.filter(EventActivityLog.category.ilike(category))
        raw_act_items = act_query.all()

        act_items = [
            ActivityLogItemView(
                id=item.id,
                event_id=item.event_id,
                timestamp=item.timestamp,
                category=item.category,
                actor=item.actor,
                action=item.action,
                summary=item.summary,
                ref_id=item.ref_id,
                details=item.details or {},
            )
            for item in raw_act_items
        ]

        # 2. Fetch AuditRecord entries
        audit_query = self.db.query(AuditRecord).filter(AuditRecord.event_id == event_id)
        raw_audit_items = audit_query.all()
        mapped_audit_items = [_map_audit_to_activity(r) for r in raw_audit_items]

        if category and category.upper() != "ALL":
            mapped_audit_items = [
                i for i in mapped_audit_items if i.category.upper() == category.upper()
            ]

        # 3. Merge, deduplicate by ID, and sort descending by timestamp
        seen_ids = set()
        merged: List[ActivityLogItemView] = []
        for item in act_items + mapped_audit_items:
            if item.id not in seen_ids:
                seen_ids.add(item.id)
                merged.append(item)

        merged.sort(key=lambda x: x.timestamp, reverse=True)
        return merged[offset : offset + limit]

    def count(self, event_id: str, category: Optional[str] = None) -> int:
        """Counts total activity entries (EventActivityLog + AuditRecord) for an event."""
        items = self.get_stream(event_id=event_id, category=category, limit=1000, offset=0)
        return len(items)
