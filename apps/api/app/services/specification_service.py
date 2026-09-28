"""Event Specification Domain Service.

Constructs and validates deterministic EventSpecifications by combining
domain baseline knowledge with event-specific configuration.
"""
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional, Set, Tuple, Union
from sqlalchemy.orm import Session

from app.domains.base import BaseEventDomain
from app.domains.registry import get_domain, UnsupportedEventTypeException
from app.models.enums import EventType
from app.domains.types import (
    RequirementDefinition,
    TaskDefinition,
    DependencyDefinition,
)
from app.schemas.specification import (
    EventSpecification,
    ConstraintDefinition,
    ObjectiveDefinition,
)


class SpecificationValidationError(ValueError):
    """Raised when an EventSpecification fails structural or semantic validation."""
    pass


class SpecificationService:
    """Coordinates the deterministic compilation of EventSpecifications."""

    def __init__(self, db: Optional[Session] = None):
        self.db = db

    def build_specification(
        self,
        event: Union[Dict[str, Any], Any],
        custom_requirements: Optional[List[Union[RequirementDefinition, Dict[str, Any]]]] = None,
        constraints: Optional[List[Union[ConstraintDefinition, Dict[str, Any]]]] = None,
        objectives: Optional[List[Union[ObjectiveDefinition, Dict[str, Any]]]] = None,
        custom_configuration: Optional[Dict[str, Any]] = None,
    ) -> EventSpecification:
        """Construct a validated, normalized EventSpecification.
        
        Deterministic: Given identical inputs, produces identical outputs with no side-effects.
        """
        # 1. Normalize Event Properties (supporting dict and SQLAlchemy Event model)
        if isinstance(event, dict):
            event_id = str(event.get("id") or "unassigned-event-id")
            title = str(event.get("title") or event.get("name") or "Untitled Event")
            description = event.get("description")
            raw_type = event.get("event_type")
            status = str(event.get("status") or event.get("state") or "DRAFT")
            start_time = event.get("start_time") or event.get("start_datetime")
            end_time = event.get("end_time") or event.get("end_datetime")
            guest_count = event.get("guest_count", 0)
            total_budget = float(event["total_budget"]) if event.get("total_budget") is not None else None
            currency = str(event.get("currency") or "USD")
            location = event.get("location")
            created_at = event.get("created_at")
        else:
            event_id = str(getattr(event, "id", "unassigned-event-id"))
            title = str(getattr(event, "name", None) or getattr(event, "title", "Untitled Event"))
            description = getattr(event, "description", None)
            raw_type = getattr(event, "event_type", None)
            state_val = getattr(event, "state", None) or getattr(event, "status", "DRAFT")
            status = state_val.value if hasattr(state_val, "value") else str(state_val)
            start_time = getattr(event, "start_datetime", None) or getattr(event, "start_time", None)
            end_time = getattr(event, "end_datetime", None) or getattr(event, "end_time", None)
            guest_count = getattr(event, "guest_count", 0)
            budget_val = getattr(event, "total_budget", None)
            total_budget = float(budget_val) if budget_val is not None else None
            currency = str(getattr(event, "currency", "USD") or "USD")
            loc_val = getattr(event, "location", None)
            location = {"address": loc_val} if isinstance(loc_val, str) else loc_val
            created_at = getattr(event, "created_at", None)

            # If ORM relationships exist, convert them to definitions if not explicitly provided
            if custom_requirements is None and hasattr(event, "requirements") and event.requirements:
                custom_requirements = [
                    RequirementDefinition(
                        key=f"event.req.{r.id}",
                        category=r.type if hasattr(r, "type") else "GENERAL",
                        name=r.name,
                        description=r.description or "",
                        is_mandatory=bool(getattr(r, "required", True)),
                        parameters=getattr(r, "value", {}) or {},
                    )
                    for r in event.requirements
                ]

            if constraints is None and hasattr(event, "constraints") and event.constraints:
                constraints = [
                    ConstraintDefinition(
                        constraint_type=c.type if hasattr(c, "type") else "GENERAL",
                        description=c.name or c.description or "",
                        parameters=getattr(c, "value", {}) or {},
                    )
                    for c in event.constraints
                ]

            if objectives is None and hasattr(event, "objectives") and event.objectives:
                objectives = [
                    ObjectiveDefinition(
                        title=o.name,
                        priority=getattr(o, "priority", "MEDIUM"),
                        description=o.description or "",
                    )
                    for o in event.objectives
                ]

        # Check raw event_type
        if not raw_type:
            raise SpecificationValidationError("Event specification requires an 'event_type'")

        # 2. Resolve Domain
        try:
            domain: BaseEventDomain = get_domain(raw_type)
        except UnsupportedEventTypeException as e:
            raise SpecificationValidationError(str(e)) from e

        resolved_type = domain.event_type
        if isinstance(resolved_type, str):
            resolved_type = EventType(resolved_type)

        # 3. Validate Timing and Guest Count
        if not isinstance(start_time, datetime):
            now = datetime.now(timezone.utc).replace(tzinfo=None)
            start_time = now + timedelta(days=30, hours=9)
        if not isinstance(end_time, datetime) or end_time <= start_time:
            end_time = start_time + timedelta(hours=8)

        if guest_count < 0:
            raise SpecificationValidationError(
                f"Invalid guest count: {guest_count}. Capacity requirement cannot be negative"
            )

        # 4. Resolve Domain Baselines
        baseline_requirements = domain.baseline_requirements()
        baseline_tasks = domain.baseline_tasks()
        baseline_dependencies = domain.baseline_dependencies()
        provider_categories = domain.provider_categories()

        # 5. Merge Domain Baselines with Event-Specific Requirements
        # Supports overrides of baseline requirements (e.g. is_mandatory=False) and additions of new requirements.
        merged_requirements: Dict[str, RequirementDefinition] = {
            req.key: req.model_copy(deep=True) for req in baseline_requirements
        }

        if custom_requirements:
            for item in custom_requirements:
                req_obj = item if isinstance(item, RequirementDefinition) else RequirementDefinition(**item)
                if req_obj.key in merged_requirements:
                    # Override existing baseline requirement
                    existing = merged_requirements[req_obj.key]
                    merged_requirements[req_obj.key] = RequirementDefinition(
                        key=req_obj.key,
                        category=req_obj.category or existing.category,
                        name=req_obj.name or existing.name,
                        description=req_obj.description or existing.description,
                        is_mandatory=req_obj.is_mandatory,
                        parameters={**existing.parameters, **req_obj.parameters},
                    )
                else:
                    # Custom addition
                    merged_requirements[req_obj.key] = req_obj

        # 6. Parse and Validate Constraints
        parsed_constraints: List[ConstraintDefinition] = []
        if constraints:
            for c in constraints:
                c_obj = c if isinstance(c, ConstraintDefinition) else ConstraintDefinition(**c)
                if not c_obj.constraint_type.strip():
                    raise SpecificationValidationError("Constraint must have a non-empty 'constraint_type'")
                parsed_constraints.append(c_obj)

        # 7. Parse and Validate Objectives
        parsed_objectives: List[ObjectiveDefinition] = []
        if objectives:
            for obj in objectives:
                obj_item = obj if isinstance(obj, ObjectiveDefinition) else ObjectiveDefinition(**obj)
                if not obj_item.title.strip():
                    raise SpecificationValidationError("Objective must have a non-empty 'title'")
                parsed_objectives.append(obj_item)

        # 8. Validate Task and Dependency Graph Integrity
        task_map: Dict[str, TaskDefinition] = {t.key: t for t in baseline_tasks}
        seen_edges: Set[Tuple[str, str, str]] = set()

        for dep in baseline_dependencies:
            if dep.predecessor_key == dep.successor_key:
                raise SpecificationValidationError(
                    f"Self-dependency detected: task '{dep.predecessor_key}' cannot depend on itself"
                )
            if dep.predecessor_key not in task_map:
                raise SpecificationValidationError(
                    f"Unknown predecessor task '{dep.predecessor_key}' in dependency definition"
                )
            if dep.successor_key not in task_map:
                raise SpecificationValidationError(
                    f"Unknown successor task '{dep.successor_key}' in dependency definition"
                )

            edge = (dep.predecessor_key, dep.successor_key, str(dep.dependency_type))
            if edge in seen_edges:
                raise SpecificationValidationError(
                    f"Duplicate dependency edge between '{dep.predecessor_key}' and '{dep.successor_key}'"
                )
            seen_edges.add(edge)

        # 9. Construct Final Normalized EventSpecification
        specification = EventSpecification(
            event_id=event_id,
            title=title,
            description=description,
            event_type=resolved_type,
            status=status,
            start_time=start_time,
            end_time=end_time,
            guest_count=int(guest_count),
            total_budget=total_budget,
            currency=currency,
            location=location,
            requirements=list(merged_requirements.values()),
            tasks=list(baseline_tasks),
            dependencies=list(baseline_dependencies),
            provider_categories=list(provider_categories),
            constraints=parsed_constraints,
            objectives=parsed_objectives,
            custom_configuration=custom_configuration or {},
            created_at=created_at,
        )

        return specification

    def validate_specification(self, spec: EventSpecification) -> None:
        """Perform standalone deterministic structural validation of an EventSpecification."""
        if not spec.event_id:
            raise SpecificationValidationError("EventSpecification must possess a valid 'event_id'")
        if not spec.title or not spec.title.strip():
            raise SpecificationValidationError("EventSpecification must possess a non-empty 'title'")
        if spec.end_time <= spec.start_time:
            raise SpecificationValidationError("EventSpecification end_time must be strictly after start_time")
        if spec.guest_count < 0:
            raise SpecificationValidationError("EventSpecification guest_count cannot be negative")

        task_keys = {t.key for t in spec.tasks}
        seen_edges: Set[Tuple[str, str, str]] = set()

        for dep in spec.dependencies:
            if dep.predecessor_key == dep.successor_key:
                raise SpecificationValidationError(f"Self-dependency detected: {dep.predecessor_key}")
            if dep.predecessor_key not in task_keys:
                raise SpecificationValidationError(f"Predecessor '{dep.predecessor_key}' not found in tasks")
            if dep.successor_key not in task_keys:
                raise SpecificationValidationError(f"Successor '{dep.successor_key}' not found in tasks")

            edge = (dep.predecessor_key, dep.successor_key, str(dep.dependency_type))
            if edge in seen_edges:
                raise SpecificationValidationError(f"Duplicate dependency edge: {edge}")
            seen_edges.add(edge)
