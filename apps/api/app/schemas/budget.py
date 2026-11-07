"""Pydantic Schemas: Budget"""
from decimal import Decimal
from typing import Dict, List, Optional
from pydantic import BaseModel, ConfigDict


class BudgetItemBase(BaseModel):
    name: str
    category: str
    estimated_amount: float = 0.0
    actual_amount: float = 0.0
    currency: str = "USD"
    status: str = "PLANNED"


class BudgetItemCreate(BudgetItemBase):
    pass


class BudgetItemResponse(BudgetItemBase):
    id: str
    event_id: str

    model_config = ConfigDict(from_attributes=True)


class BudgetSummaryResponse(BaseModel):
    """Aggregated budget summary response."""
    event_id: str
    total_estimated: float = 0.0
    total_actual: float = 0.0
    total_budget: float = 0.0
    remaining: float = 0.0
    item_count: int = 0
    categories: Dict[str, float] = {}
    items: List[BudgetItemResponse] = []
    # UX v3: single committed definition (agreed cost of CONFIRMED assignments)
    total_committed: float = 0.0
    committed_by_category: Dict[str, float] = {}
    remaining_after_committed: float = 0.0
    utilization_percent: float = 0.0
    committed_basis: str = "committed = agreed cost of confirmed vendor assignments"


class BudgetVarianceResponse(BaseModel):
    """Budget variance analysis response."""
    total_budget: float = 0.0
    total_estimated: float = 0.0
    total_actual: float = 0.0
    variance_estimated: float = 0.0
    variance_actual: float = 0.0
    is_over_budget: bool = False
    utilization_percent: float = 0.0


class BudgetViolationResponse(BaseModel):
    """Budget validation violation."""
    category: str
    violation_type: str
    amount: float
    description: str


class BudgetValidationResponse(BaseModel):
    """Budget validation result."""
    is_valid: bool = True
    violations: List[BudgetViolationResponse] = []
