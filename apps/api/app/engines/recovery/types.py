"""Small value objects used by the recovery pipeline."""
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Dict, List, Optional


class RecoveryStrategy:
    WAIT = "WAIT"
    BACKUP = "BACKUP"
    REASSIGN = "REASSIGN"
    RESCHEDULE = "RESCHEDULE"
    COMPRESS = "COMPRESS"
    SCOPE_SHED = "SCOPE_SHED"
    CAPACITY_ADJUST = "CAPACITY_ADJUST"


@dataclass
class RecoveryContext:
    event: Any
    incident: Any
    impact_result: Dict[str, Any]
    risk_result: Dict[str, Any]
    tasks: List[Any]
    dependencies: List[Any]
    budget_items: List[Any]
    resources: List[Any]
    providers: List[Any]
    provider_assignments: List[Any]
    venue: Optional[Any]
    objectives: List[Any]
    constraints: List[Any]
    live_state: Dict[str, Any]
    snapshot_version: str


@dataclass
class RecoveryCandidate:
    strategy_type: str
    affected_task_ids: List[str]
    affected_provider_ids: List[str] = field(default_factory=list)
    affected_resource_ids: List[str] = field(default_factory=list)
    proposed_changes: Dict[str, Any] = field(default_factory=dict)


@dataclass
class RecoverySimulation:
    candidate: RecoveryCandidate
    schedule_delta: Dict[str, Any]
    budget_delta: Dict[str, Any]
    resource_delta: Dict[str, Any]
    provider_delta: Dict[str, Any]
    objective_delta: Dict[str, Any]
    constraint_impact: Dict[str, Any]
    risk_after: Dict[str, Any]
    simulated_tasks: List[Dict[str, Any]]


@dataclass
class ValidationResult:
    feasible: bool
    violations: List[str] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)
    validation_timestamp: Optional[datetime] = None
