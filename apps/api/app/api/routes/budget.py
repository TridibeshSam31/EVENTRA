"""API Route: Budget Engine Endpoints"""
from decimal import Decimal
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.dependencies import get_db_session
from app.models.event import Event
from app.models.budget import BudgetItem
from app.engines.budget.calculator import BudgetCalculator
from app.engines.budget.validator import BudgetValidator
from app.schemas.budget import (
    BudgetSummaryResponse,
    BudgetItemResponse,
    BudgetVarianceResponse,
    BudgetValidationResponse,
    BudgetViolationResponse,
)
from app.core.exceptions import NotFoundException

router = APIRouter(prefix="/events", tags=["budget"])


@router.get("/{event_id}/budget/summary", response_model=BudgetSummaryResponse)
def get_budget_summary(
    event_id: str,
    db: Session = Depends(get_db_session),
) -> BudgetSummaryResponse:
    """Get budget summary with totals and per-category breakdown."""
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise NotFoundException(f"Event with id '{event_id}' not found.")

    budget_items = db.query(BudgetItem).filter(BudgetItem.event_id == event_id).all()

    calculator = BudgetCalculator()
    summary = calculator.calculate_totals(budget_items)

    from app.services.budget_commitments import (
        committed_by_category_from_assignments,
        committed_from_assignments,
        load_assignments,
        utilization_percent,
    )
    assignments = load_assignments(db, event_id)
    committed = committed_from_assignments(assignments)
    total_budget = Decimal(str(event.total_budget or 0))

    return BudgetSummaryResponse(
        total_committed=float(committed),
        committed_by_category={k: float(v) for k, v in committed_by_category_from_assignments(assignments).items()},
        remaining_after_committed=float(total_budget - committed),
        utilization_percent=float(utilization_percent(committed, total_budget)),
        event_id=event_id,
        total_estimated=float(summary.total_estimated),
        total_actual=float(summary.total_actual),
        total_budget=float(event.total_budget or 0),
        remaining=float(summary.remaining),
        item_count=summary.item_count,
        categories={k: float(v) for k, v in summary.categories.items()},
        items=[BudgetItemResponse.model_validate(item) for item in budget_items],
    )


@router.get("/{event_id}/budget/validate", response_model=BudgetValidationResponse)
def validate_budget(
    event_id: str,
    db: Session = Depends(get_db_session),
) -> BudgetValidationResponse:
    """Validate budget items against the total event budget ceiling."""
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise NotFoundException(f"Event with id '{event_id}' not found.")

    budget_items = db.query(BudgetItem).filter(BudgetItem.event_id == event_id).all()

    validator = BudgetValidator()
    violations = validator.validate_budget(
        Decimal(str(event.total_budget or 0)),
        budget_items,
    )

    return BudgetValidationResponse(
        is_valid=len(violations) == 0,
        violations=[
            BudgetViolationResponse(
                category=v.category,
                violation_type=v.violation_type,
                amount=float(v.amount),
                description=v.description,
            )
            for v in violations
        ],
    )
