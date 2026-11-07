"""Domain Service: quotes (UX v3 §4, §6).

* ``list_quotes`` — the per-event quote comparison read model behind
  ``GET /events/{id}/quotes``. It only reports what is stored on vendor
  assignments; nothing is estimated or invented.
* ``apply_quote`` — the single place a vendor's quoted amount is written. When
  the amount changes it keeps ``previous_amount`` (in the assignment's
  ``provider_response_summary`` JSON — no schema change), records a
  "Price changed ₹X → ₹Y" activity, and, if the deal had already been approved
  or confirmed, puts it back in front of the organizer with a new approval.
"""
import logging
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

# Treat differences smaller than this as the same quote (rounding noise).
QUOTE_CHANGE_EPSILON = 0.5
# Assignment states in which the organizer has already said yes to a price.
APPROVED_NEGOTIATION_STATES = {"APPROVED", "CONFIRMED"}
QUOTE_META_KEYS = ("previous_amount", "quote_changed_at", "quote_history", "requires_reconfirmation")

CURRENCY_SYMBOLS = {"INR": "₹", "USD": "$", "EUR": "€", "GBP": "£"}


def utc_now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def format_money(amount: Optional[float], currency: Optional[str] = "INR") -> str:
    if amount is None:
        return "—"
    symbol = CURRENCY_SYMBOLS.get((currency or "INR").upper())
    value = f"{float(amount):,.0f}"
    return f"{symbol}{value}" if symbol else f"{currency} {value}"


# ---------------------------------------------------------------------------
# Writing quotes
# ---------------------------------------------------------------------------

def apply_quote(
    db: Session,
    assignment,
    new_amount: Optional[float],
    *,
    source: str = "PROVIDER",
    prior_summary: Optional[Dict[str, Any]] = None,
    requester_id: str = "anonymous_operator",
) -> Optional[Dict[str, Any]]:
    """Set ``assignment.quoted_amount`` and track price changes.

    ``prior_summary`` lets a caller that has just replaced
    ``provider_response_summary`` carry the quote-change history forward.
    Returns a description of the change, or ``None`` when the price did not change.
    Does not commit; callers own the transaction (activity logging commits on its own).
    """
    summary = dict(assignment.provider_response_summary or {})
    for key in QUOTE_META_KEYS:
        if key not in summary and prior_summary and key in prior_summary:
            summary[key] = prior_summary[key]

    previous = assignment.quoted_amount
    change: Optional[Dict[str, Any]] = None
    if new_amount is not None:
        new_val = float(new_amount)
        if previous is not None and abs(float(previous) - new_val) >= QUOTE_CHANGE_EPSILON:
            now = utc_now().isoformat()
            change = {"from": float(previous), "to": new_val, "at": now, "source": source}
            summary["previous_amount"] = float(previous)
            summary["quote_changed_at"] = now
            summary["quote_history"] = (list(summary.get("quote_history") or []) + [change])[-10:]
        assignment.quoted_amount = new_val

    assignment.provider_response_summary = summary  # reassign so the JSON column is flagged dirty

    if change is not None:
        _log_price_change(db, assignment, change)
        if _was_already_approved(db, assignment):
            _require_reconfirmation(db, assignment, change, requester_id)
    return change


def _was_already_approved(db: Session, assignment) -> bool:
    if (assignment.status or "").upper() == "CONFIRMED":
        return True
    if (assignment.negotiation_status or "").upper() in APPROVED_NEGOTIATION_STATES:
        return True
    if assignment.approval_id:
        from app.models.approval import Approval

        approval = db.get(Approval, assignment.approval_id)
        if approval is not None and (approval.status or "").upper() == "APPROVED":
            return True
    return False


def _vendor_name(db: Session, assignment) -> str:
    from app.models.vendor import Vendor

    vendor = db.get(Vendor, assignment.vendor_id) if assignment.vendor_id else None
    return vendor.name if vendor else "Vendor"


def _log_price_change(db: Session, assignment, change: Dict[str, Any]) -> None:
    currency = assignment.currency or "INR"
    name = _vendor_name(db, assignment)
    summary = f"Price changed {format_money(change['from'], currency)} → {format_money(change['to'], currency)} ({name})"
    try:
        from app.services.activity_log_service import ActivityLogService

        ActivityLogService(db).log(
            event_id=assignment.event_id,
            category="NEGOTIATION",
            actor="provider",
            action="QUOTE_CHANGED",
            summary=summary,
            ref_id=assignment.id,
            details={
                "assignment_id": assignment.id,
                "vendor_id": assignment.vendor_id,
                "category": assignment.category,
                "previous_amount": change["from"],
                "quoted_amount": change["to"],
                "currency": currency,
                "source": change.get("source"),
            },
        )
    except Exception as exc:
        logger.warning("Could not log quote change: %s", exc)


def _require_reconfirmation(db: Session, assignment, change: Dict[str, Any], requester_id: str) -> None:
    """The organizer agreed to a different price — ask again before anything proceeds."""
    from app.schemas.approval import ApprovalRequestCreate
    from app.services.approval_service import ApprovalService

    currency = assignment.currency or "INR"
    name = _vendor_name(db, assignment)
    try:
        approval = ApprovalService(db).create_request(
            assignment.event_id,
            requester_id,
            ApprovalRequestCreate(
                action_type="PROVIDER_ENGAGEMENT",
                target_type="VENDOR_ASSIGNMENT",
                target_id=assignment.id,
                requested_action={
                    "type": "RECONFIRM_CHANGED_QUOTE",
                    "vendor_id": assignment.vendor_id,
                    "vendor_name": name,
                    "category": assignment.category,
                    "quoted_amount": change["to"],
                    "previous_amount": change["from"],
                    "currency": currency,
                    "coverage_start": assignment.coverage_start,
                    "coverage_end": assignment.coverage_end,
                    "advance_required": assignment.advance_required,
                    "max_approved_amount": assignment.max_approved_amount,
                },
                notes=(
                    f"{name} changed their price from {format_money(change['from'], currency)} "
                    f"to {format_money(change['to'], currency)}. Approve the new price to keep this booking."
                ),
            ),
        )
    except Exception as exc:
        logger.warning("Could not create re-approval for changed quote: %s", exc)
        return
    assignment.approval_id = approval.id
    assignment.negotiation_status = "AWAITING_APPROVAL"
    summary = dict(assignment.provider_response_summary or {})
    summary["requires_reconfirmation"] = True
    assignment.provider_response_summary = summary


# ---------------------------------------------------------------------------
# Reading quotes
# ---------------------------------------------------------------------------

def _round_number(value: Any) -> Optional[int]:
    try:
        return int(str(value)) if value not in (None, "") else None
    except (TypeError, ValueError):
        return None


def _summary_text(summary: Dict[str, Any]) -> Optional[str]:
    for key in ("summary", "terms", "notes", "message"):
        val = summary.get(key)
        if isinstance(val, str) and val.strip():
            return val.strip()
    return None


def _category_budgets(db: Session, event_id: str) -> Dict[str, float]:
    """Remaining budget per provider category, using the same aliases as outreach limits."""
    from app.models.budget import BudgetItem
    from app.services.vendor_outreach_service import BUDGET_CATEGORY_ALIASES

    totals: Dict[str, float] = {}
    for item in db.query(BudgetItem).filter(BudgetItem.event_id == event_id).all():
        if (item.status or "").upper() == "CANCELLED":
            continue
        key = (item.category or "").upper()
        totals[key] = totals.get(key, 0.0) + float(item.estimated_amount or Decimal("0"))
    resolved: Dict[str, float] = dict(totals)
    for category, aliases in BUDGET_CATEGORY_ALIASES.items():
        amount = sum(totals.get(a.upper(), 0.0) for a in aliases)
        if amount:
            resolved[category] = amount
    return resolved


def quote_item(assignment, vendor_name: Optional[str]) -> Dict[str, Any]:
    summary = assignment.provider_response_summary if isinstance(assignment.provider_response_summary, dict) else {}
    quoted = float(assignment.quoted_amount) if assignment.quoted_amount is not None else None
    cap = float(assignment.max_approved_amount) if assignment.max_approved_amount is not None else None
    quoted_at = summary.get("quote_changed_at") or (
        assignment.updated_at.isoformat() if quoted is not None and assignment.updated_at else None
    )
    status = assignment.negotiation_status or assignment.status
    if (assignment.status or "").upper() == "CONFIRMED":
        status = "CONFIRMED"
    return {
        "assignment_id": assignment.id,
        "vendor_id": assignment.vendor_id,
        "vendor_name": vendor_name,
        "category": (assignment.category or "").upper() or None,
        "status": status,
        "quoted_amount": quoted,
        "currency": assignment.currency or "INR",
        "available": assignment.provider_available,
        "coverage_start": assignment.coverage_start,
        "coverage_end": assignment.coverage_end,
        "advance_required": assignment.advance_required,
        "summary": _summary_text(summary),
        "quoted_at": quoted_at,
        "cap": cap,
        "within_cap": (quoted <= cap) if (quoted is not None and cap is not None) else None,
        "negotiation_round": _round_number(assignment.negotiation_round),
        "previous_amount": summary.get("previous_amount"),
        "requires_reconfirmation": bool(summary.get("requires_reconfirmation")),
        "is_simulation": bool(assignment.is_simulation),
    }


def list_quotes(db: Session, event_id: str, category: Optional[str] = None) -> Dict[str, Any]:
    from app.models.vendor import Vendor
    from app.models.vendor_assignment import VendorAssignment

    query = db.query(VendorAssignment).filter(VendorAssignment.event_id == event_id)
    if category:
        query = query.filter(VendorAssignment.category.ilike(category))
    assignments = query.order_by(VendorAssignment.created_at.asc()).all()

    vendor_ids = {a.vendor_id for a in assignments if a.vendor_id}
    names = {
        v.id: v.name for v in db.query(Vendor).filter(Vendor.id.in_(list(vendor_ids))).all()
    } if vendor_ids else {}

    items: List[Dict[str, Any]] = [quote_item(a, names.get(a.vendor_id)) for a in assignments]
    # Quoted options first (cheapest first), then the ones still waiting for a price.
    items.sort(key=lambda i: (i["quoted_amount"] is None, i["quoted_amount"] or 0.0))

    budgets = _category_budgets(db, event_id)
    by_category: Dict[str, Dict[str, Any]] = {}
    for item in items:
        cat = item["category"] or "OTHER"
        bucket = by_category.setdefault(
            cat,
            {"count": 0, "quoted": 0, "lowest": None, "category_budget": budgets.get(cat)},
        )
        bucket["count"] += 1
        if item["quoted_amount"] is not None:
            bucket["quoted"] += 1
            if bucket["lowest"] is None or item["quoted_amount"] < bucket["lowest"]:
                bucket["lowest"] = item["quoted_amount"]

    return {"items": items, "by_category": by_category}
