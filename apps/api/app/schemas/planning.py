"""Pydantic Schemas: Planning Engine Output"""
from datetime import datetime
from decimal import Decimal
from typing import List, Optional
from pydantic import BaseModel, ConfigDict, Field


class PlanTaskEntry(BaseModel):
    """A task entry in the generated plan."""
    id: str
    key: Optional[str] = None
    name: str
    description: Optional[str] = None
    status: str
    priority: str
    phase: Optional[str] = None
    required_provider_category: Optional[str] = None
    duration_minutes: Optional[int] = None
    is_critical_path: bool = False
    planned_start: Optional[datetime] = None
    planned_end: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


class PlanDependencyEntry(BaseModel):
    """A dependency edge in the generated plan."""
    id: str
    predecessor_task_id: str
    successor_task_id: str
    dependency_type: str
    lag_minutes: int = 0

    model_config = ConfigDict(from_attributes=True)


class PlanResourceEntry(BaseModel):
    """A resource allocation in the generated plan."""
    id: str
    name: str
    type: str
    quantity: int
    unit: str
    status: str
    allocated_task_id: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


class PlanBudgetEntry(BaseModel):
    """A budget line item in the generated plan."""
    id: str
    name: str
    category: str
    estimated_amount: float
    actual_amount: float = 0.0
    currency: str = "USD"
    status: str

    model_config = ConfigDict(from_attributes=True)


class PlanSummary(BaseModel):
    """Summary statistics for a generated plan."""
    total_tasks: int = 0
    total_dependencies: int = 0
    total_resources: int = 0
    total_budget_items: int = 0
    total_estimated_budget: float = 0.0
    critical_path_tasks: int = 0
    lifecycle_state: str = "PLANNED"
    is_materialized: bool = True
    planning_status: str = "MATERIALIZED"


class EventPlan(BaseModel):
    """Complete plan output for an event."""
    event_id: str
    event_name: str
    event_type: str
    lifecycle_state: str
    is_materialized: bool = True
    planning_status: str = "MATERIALIZED"
    planning_error: Optional[str] = None
    summary: PlanSummary
    tasks: List[PlanTaskEntry] = []
    dependencies: List[PlanDependencyEntry] = []
    resources: List[PlanResourceEntry] = []
    budget_items: List[PlanBudgetEntry] = []
