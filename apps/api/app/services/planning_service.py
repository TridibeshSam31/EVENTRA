"""Domain Service: PlanningService

Orchestrates the full planning pipeline: EventSpecification → Tasks →
Dependencies → Resources → Budget Items → PLANNED lifecycle state.
"""
from decimal import Decimal
from typing import Any, Dict, List, Optional
from sqlalchemy.orm import Session

from app.models.event import Event
from app.models.task import Task
from app.models.dependency import TaskDependency
from app.models.resource import Resource
from app.models.budget import BudgetItem
from app.models.state_transition import StateTransition
from app.models.enums import EventLifecycleState
from app.services.specification_service import SpecificationService, SpecificationValidationError
from app.engines.planning.task_generator import TaskGenerator
from app.engines.planning.dependency_builder import DependencyBuilder
from app.engines.planning.resource_planner import ResourcePlanner
from app.engines.planning.budget_planner import BudgetPlanner
from app.schemas.planning import (
    EventPlan,
    PlanSummary,
    PlanTaskEntry,
    PlanDependencyEntry,
    PlanResourceEntry,
    PlanBudgetEntry,
)
from app.core.exceptions import NotFoundException, BadRequestException


class PlanningService:
    """Coordinates deterministic plan generation from event specifications."""

    def __init__(self, db: Session):
        self.db = db
        self._task_gen = TaskGenerator()
        self._dep_builder = DependencyBuilder()
        self._resource_planner = ResourcePlanner()
        self._budget_planner = BudgetPlanner()

    def generate_plan(self, event_id: str) -> EventPlan:
        """Generate a full operational plan from the event's specification.

        Pipeline:
        1. Load event, build EventSpecification
        2. Generate tasks from specification
        3. Persist tasks, build key→id mapping
        4. Build dependencies from specification + key mapping
        5. Persist dependencies
        6. Plan resources from requirements
        7. Persist resources
        8. Plan budget from provider categories
        9. Persist budget items
        10. Transition lifecycle_state → PLANNED
        11. Record StateTransition
        12. Return EventPlan summary
        """
        # 1. Load event
        event = self.db.query(Event).filter(Event.id == event_id).first()
        if not event:
            raise NotFoundException(f"Event with id '{event_id}' not found.")

        # Guard: only plan events in DRAFT or SPECIFIED states
        if event.lifecycle_state not in (
            EventLifecycleState.DRAFT.value,
            EventLifecycleState.SPECIFIED.value,
        ):
            raise BadRequestException(
                f"Cannot generate plan: event is in '{event.lifecycle_state}' state. "
                f"Planning requires DRAFT or SPECIFIED state."
            )

        # Build specification
        spec_service = SpecificationService(self.db)
        try:
            specification = spec_service.build_specification(event=event)
        except SpecificationValidationError as err:
            raise BadRequestException(f"Specification validation failed: {err}")

        # 2. Clear existing plan data (re-plan)
        self.db.query(TaskDependency).filter(TaskDependency.event_id == event_id).delete()
        self.db.query(Resource).filter(Resource.event_id == event_id).delete()
        self.db.query(BudgetItem).filter(BudgetItem.event_id == event_id).delete()
        self.db.query(Task).filter(Task.event_id == event_id).delete()
        self.db.flush()

        # 3. Generate and persist tasks
        task_dicts = self._task_gen.generate_tasks(specification)
        key_to_id: Dict[str, str] = {}
        persisted_tasks: List[Task] = []

        for td in task_dicts:
            task = Task(event_id=event_id, **td)
            self.db.add(task)
            self.db.flush()
            key_to_id[td["key"]] = task.id
            persisted_tasks.append(task)

        # 4-5. Build and persist dependencies
        dep_dicts = self._dep_builder.build_dependencies(specification, key_to_id)
        persisted_deps: List[TaskDependency] = []

        for dd in dep_dicts:
            dep = TaskDependency(event_id=event_id, **dd)
            self.db.add(dep)
            self.db.flush()
            persisted_deps.append(dep)

        # 6-7. Plan and persist resources
        resource_dicts = self._resource_planner.plan_resources(specification)
        persisted_resources: List[Resource] = []

        for rd in resource_dicts:
            res = Resource(event_id=event_id, **rd)
            self.db.add(res)
            self.db.flush()
            persisted_resources.append(res)

        # 8-9. Plan and persist budget items
        budget_dicts = self._budget_planner.plan_budget(specification)
        persisted_budget: List[BudgetItem] = []

        for bd in budget_dicts:
            item = BudgetItem(event_id=event_id, **bd)
            self.db.add(item)
            self.db.flush()
            persisted_budget.append(item)

        # 10. Transition lifecycle state
        previous_state = event.lifecycle_state
        event.lifecycle_state = EventLifecycleState.PLANNED.value

        # 11. Record state transition
        transition = StateTransition(
            event_id=event_id,
            entity_type="EVENT",
            entity_id=event_id,
            previous_state=previous_state,
            new_state=EventLifecycleState.PLANNED.value,
            reason="Plan generated from event specification",
        )
        self.db.add(transition)
        self.db.commit()
        self.db.refresh(event)

        # 12. Build response
        total_estimated = sum(
            float(b.estimated_amount) for b in persisted_budget
        )
        critical_count = sum(1 for t in persisted_tasks if t.is_critical_path)

        summary = PlanSummary(
            total_tasks=len(persisted_tasks),
            total_dependencies=len(persisted_deps),
            total_resources=len(persisted_resources),
            total_budget_items=len(persisted_budget),
            total_estimated_budget=round(total_estimated, 2),
            critical_path_tasks=critical_count,
            lifecycle_state=event.lifecycle_state,
        )

        return EventPlan(
            event_id=event_id,
            event_name=event.name,
            event_type=event.event_type,
            lifecycle_state=event.lifecycle_state,
            summary=summary,
            tasks=[PlanTaskEntry.model_validate(t) for t in persisted_tasks],
            dependencies=[PlanDependencyEntry.model_validate(d) for d in persisted_deps],
            resources=[PlanResourceEntry.model_validate(r) for r in persisted_resources],
            budget_items=[PlanBudgetEntry.model_validate(b) for b in persisted_budget],
        )

    def get_plan(self, event_id: str) -> EventPlan:
        """Retrieve the current plan for an event."""
        event = self.db.query(Event).filter(Event.id == event_id).first()
        if not event:
            raise NotFoundException(f"Event with id '{event_id}' not found.")

        tasks = self.db.query(Task).filter(Task.event_id == event_id).all()
        deps = self.db.query(TaskDependency).filter(TaskDependency.event_id == event_id).all()
        resources = self.db.query(Resource).filter(Resource.event_id == event_id).all()
        budget_items = self.db.query(BudgetItem).filter(BudgetItem.event_id == event_id).all()

        total_estimated = sum(float(b.estimated_amount) for b in budget_items)
        critical_count = sum(1 for t in tasks if t.is_critical_path)

        has_tasks = len(tasks) > 0
        is_materialized = has_tasks or event.lifecycle_state in (
            EventLifecycleState.PLANNED.value,
            EventLifecycleState.LIVE.value,
            EventLifecycleState.CONCLUDED.value,
        )
        if has_tasks:
            planning_status = "MATERIALIZED"
        elif event.lifecycle_state == EventLifecycleState.PLANNED.value:
            planning_status = "EMPTY"
        else:
            planning_status = "PENDING_PLAN"

        summary = PlanSummary(
            total_tasks=len(tasks),
            total_dependencies=len(deps),
            total_resources=len(resources),
            total_budget_items=len(budget_items),
            total_estimated_budget=round(total_estimated, 2),
            critical_path_tasks=critical_count,
            lifecycle_state=event.lifecycle_state,
            is_materialized=is_materialized,
            planning_status=planning_status,
        )

        return EventPlan(
            event_id=event_id,
            event_name=event.name,
            event_type=event.event_type,
            lifecycle_state=event.lifecycle_state,
            is_materialized=is_materialized,
            planning_status=planning_status,
            summary=summary,
            tasks=[PlanTaskEntry.model_validate(t) for t in tasks],
            dependencies=[PlanDependencyEntry.model_validate(d) for d in deps],
            resources=[PlanResourceEntry.model_validate(r) for r in resources],
            budget_items=[PlanBudgetEntry.model_validate(b) for b in budget_items],
        )
