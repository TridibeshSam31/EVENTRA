"""Organizer-facing operational summary, aggregated from authoritative records only.

Status is a transparent rule, not a score:
  CRITICAL  - an open incident with severity CRITICAL or EMERGENCY
  AT_RISK   - any other open incident, or a blocked/failed critical-path task
  ON_TRACK  - the event has tasks or vendors and none of the above
  UNKNOWN   - nothing to judge yet (no tasks and no vendors)
Every status comes with the reasons that produced it.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

from app.models.activity_log import EventActivityLog
from app.models.approval import Approval
from app.models.event import Event
from app.models.incident import Incident
from app.models.shortlist import EventShortlistEntry
from app.models.task import Task
from app.models.vendor import Vendor
from app.models.vendor_assignment import VendorAssignment

OPEN_INCIDENT = ("OPEN", "ACKNOWLEDGED", "INVESTIGATING")
SEVERITY_RANK = {"LOW": 0, "MEDIUM": 1, "HIGH": 2, "CRITICAL": 3, "EMERGENCY": 4}
TROUBLE_TASK = ("BLOCKED", "FAILED")


def utc_now() -> datetime:
    # Naive UTC, matching how the models store timestamps.
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _iso(value: Optional[datetime]) -> Optional[str]:
    return value.isoformat() if value else None


class OperationalSummaryService:
    def __init__(self, db: Session):
        self.db = db

    def build(self, event: Event) -> Dict[str, Any]:
        event_id = event.id
        tasks: List[Task] = self.db.query(Task).filter(Task.event_id == event_id).all()
        incidents: List[Incident] = (
            self.db.query(Incident)
            .filter(Incident.event_id == event_id, Incident.status.in_(OPEN_INCIDENT))
            .all()
        )
        incidents.sort(key=lambda i: (-SEVERITY_RANK.get(i.severity, 0), i.detected_at or utc_now()))
        approvals: List[Approval] = (
            self.db.query(Approval)
            .filter(Approval.event_id == event_id, Approval.status == "PENDING")
            .order_by(Approval.created_at.asc())
            .all()
        )
        assignments: List[VendorAssignment] = (
            self.db.query(VendorAssignment).filter(VendorAssignment.event_id == event_id).all()
        )
        entries: List[EventShortlistEntry] = (
            self.db.query(EventShortlistEntry).filter(EventShortlistEntry.event_id == event_id).all()
        )

        task_block = self._tasks(tasks)
        vendors = self._vendors(entries, assignments)
        issues = self._issues(event_id, incidents, tasks, vendors)
        status, reasons = self._status(incidents, tasks, vendors)
        budget = self._budget(event, assignments)

        return {
            "event": {
                "id": event.id,
                "name": event.name,
                "start_datetime": _iso(event.start_datetime),
                "lifecycle_state": event.lifecycle_state,
                "state": event.state,
            },
            "status": status,
            "status_reasons": reasons,
            "tasks": task_block,
            "vendors": vendors,
            "pending_approvals": [
                {
                    "id": a.id,
                    "action_type": a.action_type,
                    "impact_level": a.impact_level,
                    "recovery_option_id": a.recovery_option_id,
                    "created_at": _iso(a.created_at),
                    "link": f"/events/{event_id}/approvals/{a.id}",
                }
                for a in approvals
            ],
            "milestones": self._milestones(tasks),
            "budget": budget,
            "issues": issues,
            "next_action": self._next_action(event_id, issues, approvals),
            "timeline": self._timeline(event_id),
            "generated_at": utc_now().isoformat(),
        }

    # -- parts ----------------------------------------------------------------
    @staticmethod
    def _tasks(tasks: List[Task]) -> Dict[str, Any]:
        by_status: Dict[str, int] = {}
        for t in tasks:
            by_status[t.status] = by_status.get(t.status, 0) + 1
        return {
            "total": len(tasks),
            "completed": by_status.get("COMPLETED", 0),
            "in_progress": by_status.get("IN_PROGRESS", 0),
            "blocked": by_status.get("BLOCKED", 0),
            "failed": by_status.get("FAILED", 0),
            "by_status": by_status,
        }

    def _vendors(self, entries: List[EventShortlistEntry], assignments: List[VendorAssignment]) -> List[Dict[str, Any]]:
        """One row per vendor. Communication state and commitment state are kept apart."""
        by_vendor: Dict[str, Dict[str, Any]] = {}
        for e in entries:
            vid = e.provider_id or e.candidate_id
            comm = (e.candidate_data or {}).get("communication") or {}
            selected = e.status == "SELECTED" or e.selection_source == "ORGANIZER_SELECTION"
            if not selected and not comm:
                continue  # only a recommendation; not part of the operation yet
            by_vendor[vid] = {
                "vendor_id": vid,
                "name": e.candidate_name,
                "category": e.category,
                "selected": selected,
                "contact_approval": comm.get("approval_status") or "NOT_REQUESTED",
                "whatsapp": comm.get("whatsapp_status") or "NOT_ATTEMPTED",
                "call": comm.get("call_status") or "NOT_ATTEMPTED",
                "commitment": "NONE",
                "agreed_cost": None,
            }
        names = {v.id: v.name for v in self.db.query(Vendor).filter(Vendor.id.in_([a.vendor_id for a in assignments])).all()} if assignments else {}
        for a in assignments:
            row = by_vendor.setdefault(a.vendor_id, {
                "vendor_id": a.vendor_id,
                "name": names.get(a.vendor_id),
                "category": a.category,
                "selected": True,
                "contact_approval": "NOT_REQUESTED",
                "whatsapp": "NOT_ATTEMPTED",
                "call": "NOT_ATTEMPTED",
            })
            # REQUESTED / CONFIRMED / CANCELLED as recorded on the assignment; never inferred from messages.
            row["commitment"] = (a.status or "REQUESTED").upper()
            row["agreed_cost"] = a.agreed_cost
        return sorted(by_vendor.values(), key=lambda r: (r.get("category") or "", r.get("name") or ""))

    @staticmethod
    def _status(incidents: List[Incident], tasks: List[Task], vendors: List[Dict[str, Any]]):
        reasons: List[str] = []
        critical = [i for i in incidents if SEVERITY_RANK.get(i.severity, 0) >= SEVERITY_RANK["CRITICAL"]]
        if critical:
            reasons += [f"Open {i.severity.lower()} incident: {i.title}" for i in critical]
            return "CRITICAL", reasons
        trouble = [t for t in tasks if t.is_critical_path and t.status in TROUBLE_TASK]
        if incidents or trouble:
            reasons += [f"Open {i.severity.lower()} incident: {i.title}" for i in incidents]
            reasons += [f"Critical task '{t.name}' is {t.status.lower()}" for t in trouble]
            return "AT_RISK", reasons
        if not tasks and not vendors:
            return "UNKNOWN", ["No tasks or vendors yet, so there is nothing to judge."]
        return "ON_TRACK", ["No open incidents and no blocked critical tasks."]

    @staticmethod
    def _issues(event_id: str, incidents: List[Incident], tasks: List[Task], vendors: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        issues: List[Dict[str, Any]] = []
        covered_tasks = {i.related_task_id for i in incidents if i.related_task_id}
        covered_vendors = {i.related_vendor_id for i in incidents if i.related_vendor_id}
        for i in incidents:
            impact = i.impact_result or {}
            schedule = impact.get("schedule_impact") or {}
            consequence = []
            if schedule.get("delay_minutes"):
                consequence.append(f"about {schedule['delay_minutes']} min delay")
            if schedule.get("critical_path_breached"):
                consequence.append("critical path affected")
            n_affected = len(impact.get("directly_affected_tasks") or []) + len(impact.get("indirectly_affected_tasks") or [])
            if n_affected:
                consequence.append(f"{n_affected} task(s) affected")
            evidence = ((i.evidence_metadata or {}).get("signals") or [{}])[-1].get("message")
            issues.append({
                "kind": "INCIDENT",
                "id": i.id,
                "title": i.title,
                "severity": i.severity,
                "status": i.status,
                "vendor_id": i.related_vendor_id,
                "task_id": i.related_task_id,
                "evidence": evidence or i.description,
                "detected_at": _iso(i.detected_at),
                "updated_at": _iso(i.updated_at),
                "consequence": ", ".join(consequence) or None,
                "action": {"label": "Review recovery options", "href": f"/events/{event_id}/recovery?incidentId={i.id}"},
            })
        for t in tasks:
            if t.status in TROUBLE_TASK and t.id not in covered_tasks:
                issues.append({
                    "kind": "TASK",
                    "id": t.id,
                    "title": f"Task '{t.name}' is {t.status.lower()}",
                    "severity": "HIGH" if t.is_critical_path else "MEDIUM",
                    "status": t.status,
                    "task_id": t.id,
                    "evidence": "Recorded task status." + (" It is on the critical path." if t.is_critical_path else ""),
                    "detected_at": _iso(t.updated_at),
                    "consequence": "Later tasks that depend on it cannot start." if t.is_critical_path else None,
                    "action": {"label": "Open tasks", "href": f"/events/{event_id}/tasks"},
                })
        for v in vendors:
            if v["vendor_id"] in covered_vendors:
                continue
            failed = [ch for ch in ("whatsapp", "call") if v.get(ch) == "FAILED"]
            if failed:
                issues.append({
                    "kind": "COMMUNICATION",
                    "id": f"comm-{v['vendor_id']}",
                    "title": f"Could not reach {v.get('name') or 'a vendor'}",
                    "severity": "MEDIUM",
                    "status": "FAILED",
                    "vendor_id": v["vendor_id"],
                    "evidence": f"{' and '.join(failed).replace('whatsapp', 'WhatsApp')} attempt failed.",
                    "detected_at": None,
                    "consequence": "This vendor has not received your request.",
                    "action": {"label": "Retry contact", "href": f"/events/{event_id}"},
                })
        issues.sort(key=lambda x: -SEVERITY_RANK.get(x["severity"], 0))
        return issues

    @staticmethod
    def _milestones(tasks: List[Task]) -> List[Dict[str, Any]]:
        now = utc_now()
        upcoming = [
            t for t in tasks
            if t.is_critical_path and t.planned_start and t.planned_start >= now and t.status not in ("COMPLETED", "CANCELLED")
        ]
        upcoming.sort(key=lambda t: t.planned_start)
        return [
            {"task_id": t.id, "name": t.name, "planned_start": _iso(t.planned_start), "status": t.status}
            for t in upcoming[:5]
        ]

    @staticmethod
    def _budget(event: Event, assignments: List[VendorAssignment]) -> Dict[str, Any]:
        total = float(event.total_budget) if getattr(event, "total_budget", None) is not None else None
        from app.services.budget_commitments import committed_from_assignments, is_confirmed
        committed = float(committed_from_assignments(assignments))
        pending = sum(
            a.quoted_amount or 0
            for a in assignments
            if not is_confirmed(a) and (a.status or "").upper() != "CANCELLED" and a.quoted_amount
        )
        return {
            "currency": getattr(event, "currency", None) or "INR",
            "total": total,
            "committed": committed,
            "pending_quotes": pending,
            "remaining": (total - committed) if total is not None else None,
            "basis": "committed = agreed cost of confirmed vendors; pending_quotes = latest quotes not yet confirmed",
        }

    @staticmethod
    def _next_action(event_id: str, issues: List[Dict[str, Any]], approvals: List[Approval]) -> Optional[Dict[str, Any]]:
        top = issues[0] if issues else None
        if top and SEVERITY_RANK.get(top["severity"], 0) >= SEVERITY_RANK["HIGH"]:
            return {"title": top["title"], "reason": top.get("consequence") or top.get("evidence"), **top["action"]}
        if approvals:
            return {
                "title": f"{len(approvals)} request(s) waiting for your OK",
                "reason": "Nothing happens for these until you approve or decline.",
                "label": "Review approvals",
                "href": f"/events/{event_id}/approvals",
            }
        if top:
            return {"title": top["title"], "reason": top.get("consequence") or top.get("evidence"), **top["action"]}
        return None

    def _timeline(self, event_id: str, limit: int = 15) -> List[Dict[str, Any]]:
        rows = (
            self.db.query(EventActivityLog)
            .filter(EventActivityLog.event_id == event_id)
            .order_by(EventActivityLog.timestamp.desc())
            .limit(limit)
            .all()
        )
        return [
            {
                "id": r.id,
                "at": _iso(r.timestamp),
                "actor": r.actor,
                "category": r.category,
                "action": r.action,
                "summary": r.summary,
                "needs_review": bool((r.details or {}).get("needs_review")),
            }
            for r in rows
        ]
