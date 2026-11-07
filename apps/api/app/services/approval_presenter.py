"""Approval presenter (UX v3 contract §1).

Turns an ``Approval`` row into the human-facing fields the organizer needs before
deciding: what exactly happens, how much money is involved, what it does to the
budget, and what approving / declining actually does.

Everything here is derived from data that already exists (``requested_action``,
linked vendor assignments, vendors, tasks, budget items). Nothing is invented:
when a value cannot be determined it is returned as ``None``. The approve/decline
consequences describe what ``ActionService`` / ``ApprovalService`` really do for
each action type. No approved action has a rollback path, so ``reversible`` is
always ``False``.
"""
from __future__ import annotations

from decimal import Decimal, InvalidOperation
from typing import Any, Dict, Optional

from sqlalchemy.orm import Session

from app.models.approval import Approval
from app.models.budget import BudgetItem
from app.models.event import Event
from app.models.task import Task
from app.models.vendor import Vendor
from app.models.vendor_assignment import VendorAssignment
from app.services.budget_commitments import committed_by_category, is_confirmed

# Action types whose execution commits or changes money.
MONEY_ACTIONS = {"PROVIDER_ENGAGEMENT", "CONTRACT_VENDOR", "REASSIGN_VENDOR", "ADJUST_BUDGET"}

# Keys under which callers store a monetary amount in ``requested_action``.
AMOUNT_KEYS = (
    "agreed_cost",
    "quoted_amount",
    "provider_cost",
    "cost",
    "amount",
    "committed_amount",
    "actual_amount",
)

CATEGORY_LABELS = {
    "AV": "AV",
    "AV_TECH": "AV & tech",
    "DJ_MUSIC": "DJ & music",
    "DECOR": "Décor",
}

_NOT_REVERSIBLE = False  # no undo / rollback endpoint exists for executed actions


# ── small helpers ──────────────────────────────────────────────────────────

def _dec(value: Any) -> Optional[Decimal]:
    if value is None or value == "" or isinstance(value, bool):
        return None
    try:
        d = Decimal(str(value))
    except (InvalidOperation, ValueError):
        return None
    if d.is_nan() or d <= 0:
        return None
    return d


def _num(value: Optional[Decimal]) -> Optional[float]:
    return float(value) if value is not None else None


def _category_label(category: Optional[str]) -> str:
    if not category:
        return "this service"
    key = category.strip().upper().replace(" ", "_").replace("-", "_")
    if key in CATEGORY_LABELS:
        return CATEGORY_LABELS[key]
    return key.replace("_", " ").lower()


def _indian_grouping(n: int) -> str:
    s = str(abs(n))
    if len(s) <= 3:
        out = s
    else:
        head, tail = s[:-3], s[-3:]
        parts = []
        while len(head) > 2:
            parts.insert(0, head[-2:])
            head = head[:-2]
        if head:
            parts.insert(0, head)
        out = ",".join(parts) + "," + tail
    return ("-" if n < 0 else "") + out


def format_money(amount: Optional[Decimal], currency: Optional[str]) -> Optional[str]:
    if amount is None:
        return None
    cur = (currency or "INR").upper()
    whole = int(amount.quantize(Decimal("1")))
    if cur == "INR":
        return f"₹{_indian_grouping(whole)}"
    return f"{cur} {whole:,}"


# ── presenter ──────────────────────────────────────────────────────────────

class ApprovalPresenter:
    """Computes the UX v3 approval fields. Read-only: never mutates the session."""

    def __init__(self, db: Session):
        self.db = db
        self._event_cache: Dict[str, Optional[Event]] = {}
        self._committed_cache: Dict[str, Dict[str, Decimal]] = {}

    # -- lookups --------------------------------------------------------
    def _event(self, event_id: str) -> Optional[Event]:
        if event_id not in self._event_cache:
            self._event_cache[event_id] = self.db.query(Event).filter(Event.id == event_id).first()
        return self._event_cache[event_id]

    def _committed(self, event_id: str) -> Dict[str, Decimal]:
        if event_id not in self._committed_cache:
            self._committed_cache[event_id] = committed_by_category(self.db, event_id)
        return self._committed_cache[event_id]

    def _vendor(self, vendor_id: Optional[str]) -> Optional[Vendor]:
        if not vendor_id:
            return None
        return self.db.query(Vendor).filter(Vendor.id == vendor_id).first()

    def _task(self, event_id: str, task_id: Optional[str]) -> Optional[Task]:
        if not task_id:
            return None
        return self.db.query(Task).filter(Task.id == task_id, Task.event_id == event_id).first()

    def _assignment(self, event_id: str, assignment_id: Optional[str]) -> Optional[VendorAssignment]:
        if not assignment_id:
            return None
        return (
            self.db.query(VendorAssignment)
            .filter(VendorAssignment.id == assignment_id, VendorAssignment.event_id == event_id)
            .first()
        )

    def _assignment_for(self, event_id: str, vendor_id: Optional[str], category: Optional[str]) -> Optional[VendorAssignment]:
        """Mirror the lookup order ActionService uses to pick the assignment it will update."""
        q = self.db.query(VendorAssignment).filter(VendorAssignment.event_id == event_id)
        if vendor_id and category:
            hit = q.filter(VendorAssignment.vendor_id == vendor_id, VendorAssignment.category == category).first()
            if hit:
                return hit
        if vendor_id:
            hit = q.filter(VendorAssignment.vendor_id == vendor_id).first()
            if hit:
                return hit
        if category:
            return q.filter(VendorAssignment.category == category).first()
        return None

    # -- derivation -----------------------------------------------------
    def _resolve(self, approval: Approval) -> Dict[str, Any]:
        """Collect vendor / category / amount / affected-assignment facts for one approval."""
        event_id = approval.event_id
        action = (approval.action_type or "").upper()
        payload: Dict[str, Any] = dict(approval.requested_action or {})

        vendor_name: Optional[str] = (
            payload.get("candidate_name")
            or payload.get("vendor_name")
            or payload.get("replacement_vendor_name")
        )
        category: Optional[str] = payload.get("category") or payload.get("required_provider_category")
        currency: Optional[str] = payload.get("currency")
        amount: Optional[Decimal] = None
        for key in AMOUNT_KEYS:
            amount = _dec(payload.get(key))
            if amount is not None:
                break

        assignment: Optional[VendorAssignment] = None
        task: Optional[Task] = None
        vendor_id: Optional[str] = (
            payload.get("new_vendor_id")
            or payload.get("vendor_id")
            or payload.get("replacement_vendor_id")
            or payload.get("provider_id")
        )

        if action == "COMMUNICATION_OUTREACH":
            # target_type carries the shortlist category (upper-cased) for outreach approvals.
            category = category or (approval.target_type if approval.target_type not in (None, "VENDOR") else None)
        elif action == "PROVIDER_ENGAGEMENT":
            assignment = self._assignment(event_id, approval.target_id or payload.get("assignment_id"))
            if assignment:
                category = category or assignment.category
                currency = currency or assignment.currency
                vendor_id = vendor_id or assignment.vendor_id
                if amount is None:
                    amount = _dec(assignment.quoted_amount) or _dec(assignment.agreed_cost)
        elif action == "CONTRACT_VENDOR":
            vendor_id = vendor_id or approval.target_id
            assignment = self._assignment(event_id, payload.get("assignment_id")) or self._assignment_for(
                event_id, vendor_id, category
            )
            if assignment:
                category = category or assignment.category
                currency = currency or assignment.currency
                if amount is None:
                    amount = _dec(assignment.quoted_amount)
        elif action == "REASSIGN_VENDOR":
            task = self._task(event_id, payload.get("task_id") or (approval.target_id if approval.target_type == "TASK" else None))
            vendor = self._vendor(vendor_id)
            category = category or (task.required_provider_category if task else None) or (vendor.category if vendor else None)
            assignment = self._assignment_for(event_id, vendor_id, category)
            if vendor and not vendor_name:
                vendor_name = vendor.name
        elif action == "ADJUST_BUDGET":
            item_id = payload.get("budget_item_id") or approval.target_id
            item = (
                self.db.query(BudgetItem)
                .filter(BudgetItem.id == item_id, BudgetItem.event_id == event_id)
                .first()
                if item_id
                else None
            )
            if item:
                category = category or item.category
                currency = currency or item.currency
        elif action in ("REASSIGN_TASK", "ADJUST_SCHEDULE"):
            task = self._task(event_id, approval.target_id or payload.get("task_id"))

        if not vendor_name and vendor_id:
            vendor = self._vendor(vendor_id)
            if vendor:
                vendor_name = vendor.name

        if not currency:
            event = self._event(event_id)
            currency = event.currency if event and event.currency else None
        if amount is None:
            currency = currency if action in MONEY_ACTIONS else None

        return {
            "action": action,
            "payload": payload,
            "vendor_name": vendor_name,
            "category": category.upper() if category else None,
            "currency": currency.upper() if currency else None,
            "amount": amount,
            "assignment": assignment,
            "task": task,
        }

    def _budget_impact(self, approval: Approval, facts: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Committed spend in the category before vs after, for actions that book a vendor."""
        if facts["action"] not in ("PROVIDER_ENGAGEMENT", "CONTRACT_VENDOR", "REASSIGN_VENDOR"):
            return None
        amount: Optional[Decimal] = facts["amount"]
        category: Optional[str] = facts["category"]
        if amount is None or not category:
            return None

        event = self._event(approval.event_id)
        committed = self._committed(approval.event_id)
        before = committed.get(category, Decimal("0.00"))

        # The booking replaces the agreed cost of the assignment it updates (if that one is already committed).
        replaced = Decimal("0.00")
        assignment: Optional[VendorAssignment] = facts["assignment"]
        if assignment is not None and is_confirmed(assignment) and assignment.agreed_cost is not None:
            if (assignment.category or "").upper() == category:
                replaced = Decimal(str(assignment.agreed_cost))
        after = (before - replaced + amount).quantize(Decimal("0.01"))

        items = (
            self.db.query(BudgetItem)
            .filter(BudgetItem.event_id == approval.event_id)
            .all()
        )
        cat_items = [i for i in items if (i.category or "").upper() == category]
        category_budget = (
            sum((Decimal(str(i.estimated_amount or 0)) for i in cat_items), Decimal("0.00")) if cat_items else None
        )
        if category_budget is not None and category_budget <= 0:
            category_budget = None

        total_budget = None
        if event is not None and event.total_budget is not None:
            tb = Decimal(str(event.total_budget))
            total_budget = tb if tb > 0 else None

        return {
            "category": category,
            "category_budget": _num(category_budget),
            "committed_before": float(before),
            "committed_after": float(after),
            "total_budget": _num(total_budget),
            "over_category_budget": (after > category_budget) if category_budget is not None else None,
        }

    def _texts(self, facts: Dict[str, Any]) -> Dict[str, str]:
        action = facts["action"]
        payload = facts["payload"]
        name = facts["vendor_name"] or "this vendor"
        cat = _category_label(facts["category"])
        money = format_money(facts["amount"], facts["currency"])
        at_money = f" at {money}" if money else ""
        task: Optional[Task] = facts["task"]
        task_name = f"'{task.name}'" if task is not None and getattr(task, "name", None) else "the task"
        default_reject = "Nothing changes. The request is closed and nothing is executed."

        if action == "COMMUNICATION_OUTREACH":
            return {
                "summary": f"Contact {name} ({cat[:1].upper() + cat[1:]}) on WhatsApp and by phone",
                "on_approve": (
                    f"EVENTRA will send {name} a WhatsApp message and place an AI phone call to ask about "
                    "availability and price. Nothing is booked by this step."
                ),
                "on_reject": f"{name} won't be contacted and this option is dismissed. You can pick another vendor.",
            }
        if action == "PROVIDER_ENGAGEMENT":
            quote = f"quote of {money}" if money else "quote"
            return {
                "summary": f"Accept {name}'s {quote} for {cat}",
                "on_approve": (
                    f"{name}'s {quote} is marked approved. The booking becomes final when it is confirmed, "
                    "which also sends the vendor a confirmation message."
                ),
                "on_reject": f"The quote is not approved. {name} stays unbooked and is not notified automatically.",
            }
        if action == "CONTRACT_VENDOR":
            return {
                "summary": f"Book {name} for {cat}{at_money}",
                "on_approve": (
                    f"{name} is confirmed for {cat}{at_money}. Matching tasks are assigned to them"
                    + (f" and the {cat} budget line is marked committed." if money else ".")
                    + " The vendor is not messaged automatically."
                ),
                "on_reject": default_reject,
            }
        if action == "REASSIGN_VENDOR":
            return {
                "summary": f"Switch {cat} to {name}{at_money}",
                "on_approve": (
                    f"{name} is confirmed for {cat}{at_money} and {task_name} is reassigned to them"
                    + (f"; the {cat} budget line is updated to {money}." if money else ".")
                ),
                "on_reject": "The current arrangement stays as it is. " + default_reject,
            }
        if action == "ADJUST_BUDGET":
            new_amt = format_money(_dec(payload.get("actual_amount") or payload.get("committed_amount")), facts["currency"])
            new_est = format_money(_dec(payload.get("estimated_amount")), facts["currency"])
            parts = []
            if new_amt:
                parts.append(f"actual spend set to {new_amt}")
            if new_est:
                parts.append(f"estimate set to {new_est}")
            detail = " and ".join(parts) if parts else "updated"
            return {
                "summary": f"Change the {cat} budget line" + (f" to {new_amt or new_est}" if (new_amt or new_est) else ""),
                "on_approve": f"The {cat} budget line is {detail}.",
                "on_reject": default_reject,
            }
        if action == "ADJUST_SCHEDULE":
            shift = payload.get("shift_minutes") or payload.get("delay_minutes")
            by = f" by {shift} minutes" if shift else ""
            return {
                "summary": f"Reschedule {task_name}{by}",
                "on_approve": f"{task_name[0].upper() + task_name[1:]} moves{by}; its remaining slack shrinks accordingly.",
                "on_reject": default_reject,
            }
        if action == "REASSIGN_TASK":
            return {
                "summary": f"Change {task_name}",
                "on_approve": f"{task_name[0].upper() + task_name[1:]} is updated with the requested category, priority or duration.",
                "on_reject": default_reject,
            }
        if action == "ALLOCATE_RESOURCE":
            return {
                "summary": "Allocate a resource",
                "on_approve": "The resource is allocated" + (" to the requested task." if payload.get("task_id") else "."),
                "on_reject": default_reject,
            }
        label = action.replace("_", " ").lower() if action else "action"
        return {
            "summary": label[:1].upper() + label[1:],
            "on_approve": "The requested action is executed.",
            "on_reject": default_reject,
        }

    def present(self, approval: Approval) -> Dict[str, Any]:
        """Return the computed UX v3 fields for one approval."""
        facts = self._resolve(approval)
        texts = self._texts(facts)
        action = facts["action"]
        channel = "WHATSAPP_AND_CALL" if action == "COMMUNICATION_OUTREACH" else None
        return {
            "summary": texts["summary"],
            "vendor_name": facts["vendor_name"],
            "category": facts["category"],
            "channel": channel,
            "involves_money": action in MONEY_ACTIONS,
            "amount": _num(facts["amount"]),
            "currency": facts["currency"],
            "budget_impact": self._budget_impact(approval, facts),
            "on_approve": texts["on_approve"],
            "on_reject": texts["on_reject"],
            "reversible": _NOT_REVERSIBLE,
        }
