"""Deterministic Engine: budget.calculator

Computes budget totals, variance analysis, and financial summaries
using exact Decimal arithmetic for monetary precision.
"""
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any, Dict, List


@dataclass
class BudgetSummary:
    """Aggregated budget summary."""
    total_estimated: Decimal = Decimal("0.00")
    total_actual: Decimal = Decimal("0.00")
    total_committed: Decimal = Decimal("0.00")
    remaining: Decimal = Decimal("0.00")
    item_count: int = 0
    categories: Dict[str, Decimal] = field(default_factory=dict)


@dataclass
class BudgetVariance:
    """Budget variance analysis result."""
    total_budget: Decimal = Decimal("0.00")
    total_estimated: Decimal = Decimal("0.00")
    total_actual: Decimal = Decimal("0.00")
    variance_estimated: Decimal = Decimal("0.00")  # total_budget - total_estimated
    variance_actual: Decimal = Decimal("0.00")      # total_budget - total_actual
    is_over_budget: bool = False
    utilization_percent: Decimal = Decimal("0.00")


class BudgetCalculator:
    """Pure deterministic budget calculator using Decimal arithmetic."""

    def calculate_totals(self, budget_items: List[Any]) -> BudgetSummary:
        """Sum estimated, actual, and committed amounts across all budget items.

        Args:
            budget_items: List of BudgetItem ORM objects or dicts.

        Returns:
            BudgetSummary with totals and per-category breakdown.
        """
        total_estimated = Decimal("0.00")
        total_actual = Decimal("0.00")
        categories: Dict[str, Decimal] = {}

        for item in budget_items:
            if isinstance(item, dict):
                est = Decimal(str(item.get("estimated_amount", 0)))
                act = Decimal(str(item.get("actual_amount", 0)))
                cat = item.get("category", "UNKNOWN")
            else:
                est = Decimal(str(getattr(item, "estimated_amount", 0)))
                act = Decimal(str(getattr(item, "actual_amount", 0)))
                cat = getattr(item, "category", "UNKNOWN")

            total_estimated += est
            total_actual += act
            categories[cat] = categories.get(cat, Decimal("0.00")) + est

        return BudgetSummary(
            total_estimated=total_estimated.quantize(Decimal("0.01")),
            total_actual=total_actual.quantize(Decimal("0.01")),
            # Item-level spend only. Event-level "committed" (confirmed vendor agreed cost)
            # lives in services/budget_commitments.py; this was previously mislabelled estimates.
            total_committed=total_actual.quantize(Decimal("0.01")),
            remaining=(total_estimated - total_actual).quantize(Decimal("0.01")),
            item_count=len(budget_items),
            categories=categories,
        )

    def calculate_variance(
        self,
        total_budget: Decimal,
        budget_items: List[Any],
    ) -> BudgetVariance:
        """Compute budget variance against the total event budget.

        Args:
            total_budget: The total event budget ceiling.
            budget_items: List of BudgetItem records.

        Returns:
            BudgetVariance with over/under budget analysis.
        """
        summary = self.calculate_totals(budget_items)

        total_budget = Decimal(str(total_budget))
        variance_est = (total_budget - summary.total_estimated).quantize(Decimal("0.01"))
        variance_act = (total_budget - summary.total_actual).quantize(Decimal("0.01"))

        utilization = Decimal("0.00")
        if total_budget > 0:
            utilization = (
                (summary.total_actual / total_budget) * Decimal("100")
            ).quantize(Decimal("0.01"))

        return BudgetVariance(
            total_budget=total_budget.quantize(Decimal("0.01")),
            total_estimated=summary.total_estimated,
            total_actual=summary.total_actual,
            variance_estimated=variance_est,
            variance_actual=variance_act,
            is_over_budget=summary.total_actual > total_budget,
            utilization_percent=utilization,
        )
