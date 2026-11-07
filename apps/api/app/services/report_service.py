"""Post-event summary (UX v3 §5, docs/contracts/ux-v3-api.md).

Aggregates existing records only. Money "committed" uses one definition
everywhere: the sum of `agreed_cost` on CONFIRMED vendor assignments.
Unknown values are returned as null, never estimated.
"""
from __future__ import annotations

from collections import Counter
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

from app.models.approval import Approval
from app.models.budget import BudgetItem
from app.models.communication import Message
from app.models.communication_attempt import CommunicationAttempt
from app.models.event import Event
from app.models.incident import Incident
from app.models.task import Task
from app.models.vendor import Vendor
from app.models.vendor_assignment import VendorAssignment
from app.services.readiness_service import OPEN_INCIDENT_EXCLUDED, canonical_category, category_label


def _iso(dt) -> Optional[str]:
    return dt.isoformat() if dt else None


def _is_confirmed(a: VendorAssignment) -> bool:
    return (a.status or "").upper() == "CONFIRMED" or (a.negotiation_status or "").upper() == "CONFIRMED"


class ReportService:
    def __init__(self, db: Session):
        self.db = db

    def build(self, event: Event) -> Dict[str, Any]:
        db = self.db
        eid = event.id

        assignments = db.query(VendorAssignment).filter(VendorAssignment.event_id == eid).all()
        budget_items = db.query(BudgetItem).filter(BudgetItem.event_id == eid).all()
        incidents = db.query(Incident).filter(Incident.event_id == eid).all()
        approvals = db.query(Approval).filter(Approval.event_id == eid).all()
        attempts = db.query(CommunicationAttempt).filter(CommunicationAttempt.event_id == eid).all()
        messages = db.query(Message.direction).filter(Message.event_id == eid).all()
        tasks = db.query(Task).filter(Task.event_id == eid).all()

        vendor_ids = {a.vendor_id for a in assignments if a.vendor_id}
        vendor_names: Dict[str, str] = {}
        if vendor_ids:
            for v_id, v_name in db.query(Vendor.id, Vendor.name).filter(Vendor.id.in_(list(vendor_ids))).all():
                vendor_names[v_id] = v_name

        # ── Budget ──
        confirmed = [a for a in assignments if _is_confirmed(a)]
        committed_known = [a.agreed_cost for a in confirmed if a.agreed_cost is not None]
        committed_total = float(sum(committed_known)) if committed_known else (0.0 if not confirmed else None)

        by_cat: Dict[str, Dict[str, Any]] = {}
        for item in budget_items:
            key = canonical_category(item.category) or "OTHER"
            row = by_cat.setdefault(key, {"category": category_label(key), "estimated": 0.0, "committed": 0.0})
            row["estimated"] += float(item.estimated_amount or 0)
        for a in confirmed:
            key = canonical_category(a.category) or "OTHER"
            row = by_cat.setdefault(key, {"category": category_label(key), "estimated": None, "committed": 0.0})
            if a.agreed_cost is not None:
                row["committed"] = (row["committed"] or 0.0) + float(a.agreed_cost)

        total_budget = float(event.total_budget) if event.total_budget and float(event.total_budget) > 0 else None

        # ── Vendors ──
        vendors: List[Dict[str, Any]] = []
        for a in assignments:
            status = "CONFIRMED" if _is_confirmed(a) else (a.status or a.negotiation_status or "UNKNOWN").upper()
            vendors.append({
                "name": vendor_names.get(a.vendor_id) or "Unknown vendor",
                "category": category_label(a.category),
                "status": status,
                "agreed_cost": a.agreed_cost,
            })
        vendors.sort(key=lambda v: (v["status"] != "CONFIRMED", v["category"], v["name"]))

        # ── Incidents ──
        resolved = [i for i in incidents if (i.status or "").upper() == "RESOLVED"]
        open_ = [i for i in incidents if (i.status or "").upper() not in OPEN_INCIDENT_EXCLUDED]
        by_type = Counter((i.incident_type or "OTHER").upper() for i in incidents)
        incident_items = [
            {
                "title": i.title,
                "severity": (i.severity or "").upper() or None,
                "status": (i.status or "").upper() or None,
                "resolution": i.resolution_notes,
            }
            for i in sorted(incidents, key=lambda x: x.detected_at or x.created_at)
        ]

        # ── Approvals ──
        approval_counts = Counter((a.status or "").upper() for a in approvals)

        # ── Communication ──
        directions = Counter((d[0] or "").lower() for d in messages)
        calls_made = sum(
            1 for a in attempts
            if (a.channel or "").upper() == "CALL" and (a.status or "").upper() not in ("NOT_ATTEMPTED",)
        )
        whatsapp_replied = sum(
            1 for a in attempts if (a.channel or "").upper() == "WHATSAPP" and (a.status or "").upper() == "REPLIED"
        )
        calls_answered = sum(
            1 for a in attempts if (a.channel or "").upper() == "CALL" and (a.status or "").upper() == "COMPLETED"
        )
        whatsapp_sent = sum(
            1 for a in attempts
            if (a.channel or "").upper() == "WHATSAPP"
            and (a.status or "").upper() in ("SENT", "DELIVERED", "READ", "REPLIED", "ACCEPTED")
        )

        # ── Timeline ──
        done = [t for t in tasks if (t.status or "").upper() == "COMPLETED"]
        on_time = sum(1 for t in done if t.actual_end and t.planned_end and t.actual_end <= t.planned_end)
        late = sum(1 for t in done if t.actual_end and t.planned_end and t.actual_end > t.planned_end)

        return {
            "event": {
                "id": eid,
                "name": event.name,
                "type": event.event_type,
                "start": _iso(event.start_datetime),
                "end": _iso(event.end_datetime),
                "location": event.location,
                "guests": event.guest_count or None,
                "status": (event.lifecycle_state or "").upper() or None,
                "currency": event.currency,
            },
            "budget": {
                "total": total_budget,
                "committed": committed_total,
                "spent_by_category": sorted(by_cat.values(), key=lambda r: r["category"]),
            },
            "vendors": vendors,
            "incidents": {
                "total": len(incidents),
                "resolved": len(resolved),
                "open": len(open_),
                "by_type": dict(by_type),
                "items": incident_items,
            },
            "approvals": {
                "total": len(approvals),
                "approved": approval_counts.get("APPROVED", 0),
                "rejected": approval_counts.get("REJECTED", 0),
                "expired": approval_counts.get("EXPIRED", 0),
            },
            "communication": {
                "messages_sent": max(directions.get("outbound", 0), whatsapp_sent),
                "calls_made": calls_made,
                "replies": max(directions.get("inbound", 0), whatsapp_replied + calls_answered),
            },
            "timeline": {
                "tasks_total": len(tasks),
                "tasks_done": len(done),
                "on_time": on_time,
                "late": late,
            },
        }
