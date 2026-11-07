"""Single definition of "committed" budget (UX v3 contract §6).

committed = sum of ``agreed_cost`` over CONFIRMED vendor assignments.

Estimates (BudgetItem.estimated_amount) are plans, not commitments; quotes that
are not yet confirmed are "pending", not committed. Every surface that reports
committed spend, utilization or remaining budget must use these helpers so the
Overview, Budget page, live state and execution plan always agree.
"""
from __future__ import annotations

from decimal import Decimal
from typing import Dict, Iterable, List, Optional

from sqlalchemy.orm import Session

from app.models.vendor_assignment import VendorAssignment

CONFIRMED = "CONFIRMED"
_CENTS = Decimal("0.01")


def is_confirmed(assignment) -> bool:
    status = (getattr(assignment, "status", None) or "").upper()
    negotiation = (getattr(assignment, "negotiation_status", None) or "").upper()
    return status == CONFIRMED or negotiation == CONFIRMED


def _agreed(assignment) -> Decimal:
    value = getattr(assignment, "agreed_cost", None)
    if value is None:
        return Decimal("0.00")
    return Decimal(str(value))


def committed_from_assignments(assignments: Iterable) -> Decimal:
    total = sum((_agreed(a) for a in assignments if is_confirmed(a)), Decimal("0.00"))
    return total.quantize(_CENTS)


def committed_by_category_from_assignments(assignments: Iterable) -> Dict[str, Decimal]:
    out: Dict[str, Decimal] = {}
    for a in assignments:
        if not is_confirmed(a):
            continue
        cat = (getattr(a, "category", None) or "UNKNOWN").upper()
        out[cat] = (out.get(cat, Decimal("0.00")) + _agreed(a)).quantize(_CENTS)
    return out


def load_assignments(db: Session, event_id: str) -> List[VendorAssignment]:
    return db.query(VendorAssignment).filter(VendorAssignment.event_id == event_id).all()


def committed_total(db: Session, event_id: str) -> Decimal:
    return committed_from_assignments(load_assignments(db, event_id))


def committed_by_category(db: Session, event_id: str) -> Dict[str, Decimal]:
    return committed_by_category_from_assignments(load_assignments(db, event_id))


def utilization_percent(committed: Decimal, total_budget: Optional[Decimal]) -> Decimal:
    if not total_budget or total_budget <= 0:
        return Decimal("0.00")
    return ((committed / total_budget) * Decimal("100")).quantize(_CENTS)
