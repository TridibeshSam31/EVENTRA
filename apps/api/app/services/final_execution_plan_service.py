"""Domain Service: FinalExecutionPlanService (Task 9).

Compiles authoritative post-Task-8 state into an execution-ready operational plan:
1. Pure deterministic plan compilation (no database mutation, strictly idempotent).
2. Authoritative state ingestion (Task, VendorAssignment, Dependencies, CPM, Schedule, Budget).
3. Topological DAG sequence ordering.
4. Predecessor and successor context generation.
5. Critical path and slack extraction.
6. Decimal monetary budget evaluation.
7. Deterministic consistency verification (DAG acyclicity, schedule precedence, deadline violations, budget overrun).
8. Readiness classification (READY, PARTIALLY_READY, BLOCKED, INCOMPLETE).
9. Operational checkpoints, blockers, warnings, and unresolved unknowns.
10. Current and next task tracking for executing teams.
"""
import logging
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Dict, List, Optional
from sqlalchemy.orm import Session

from app.core.exceptions import NotFoundException, ForbiddenException
from app.models.event import Event
from app.models.task import Task
from app.models.vendor import Vendor
from app.models.dependency import TaskDependency
from app.models.vendor_assignment import VendorAssignment
from app.models.budget import BudgetItem
from app.models.resource import Resource
from app.models.requirement import Requirement
from app.models.vendor_outcome_validation import VendorOutcomeValidation
from app.models.state_transition import StateTransition
from app.models.enums import TaskStatus, BudgetItemStatus
from app.engines.dependency.graph import DependencyGraph
from app.engines.budget.calculator import BudgetCalculator
from app.schemas.execution_plan import (
    PlanReadiness,
    PlanBlocker,
    PlanWarning,
    UnresolvedUnknown,
    TaskPredecessorInfo,
    TaskSuccessorInfo,
    ExecutionPlanTask,
    CriticalPathEntry,
    ExecutionCheckpoint,
    BudgetSummaryPlan,
    ResourceSummaryPlan,
    EventSummary,
    CurrentAndNextTasks,
    FinalExecutionPlan,
)

logger = logging.getLogger(__name__)


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class FinalExecutionPlanService:
    """Authoritative compiler for the real final execution plan."""

    def __init__(self, db: Session, llm_provider: Optional[Any] = None):
        self.db = db
        self.llm_provider = llm_provider

    def _compute_plan_version(self, event_id: str) -> int:
        """Computes current plan version from immutable state transitions."""
        transition_count = self.db.query(StateTransition).filter(StateTransition.event_id == event_id).count()
        return 1 + transition_count

    def _verify_authorization(self, event: Event, user_id: Optional[str]) -> None:
        """Verifies caller has view access to the event."""
        if not user_id or user_id in ("system", "anonymous_operator") or user_id.startswith("system") or user_id.startswith("agent"):
            return
        if event.owner_id == user_id:
            return
        is_member = any(m.user_id == user_id for m in (event.members or []))
        if not is_member:
            raise ForbiddenException(f"User '{user_id}' is not authorized to access event '{event.id}'.")

    def compile_plan(
        self,
        event_id: str,
        user_id: Optional[str] = None,
        reference_time: Optional[datetime] = None,
    ) -> FinalExecutionPlan:
        """Deterministically compiles the final execution plan from authoritative state."""
        # 1. Load Authoritative State
        event = self.db.query(Event).filter(Event.id == event_id).first()
        if not event:
            raise NotFoundException(f"Event with id '{event_id}' not found.")

        self._verify_authorization(event, user_id)

        tasks: List[Task] = self.db.query(Task).filter(Task.event_id == event_id).all()
        dependencies: List[TaskDependency] = self.db.query(TaskDependency).filter(TaskDependency.event_id == event_id).all()
        assignments: List[VendorAssignment] = self.db.query(VendorAssignment).filter(VendorAssignment.event_id == event_id).all()
        budget_items: List[BudgetItem] = self.db.query(BudgetItem).filter(BudgetItem.event_id == event_id).all()
        resources: List[Resource] = self.db.query(Resource).filter(Resource.event_id == event_id).all()
        requirements: List[Requirement] = self.db.query(Requirement).filter(Requirement.event_id == event_id).all()
        validations: List[VendorOutcomeValidation] = self.db.query(VendorOutcomeValidation).filter(VendorOutcomeValidation.event_id == event_id).all()

        plan_version = self._compute_plan_version(event_id)
        generated_at = utc_now_iso()

        blockers: List[PlanBlocker] = []
        warnings: List[PlanWarning] = []
        unresolved_unknowns: List[UnresolvedUnknown] = []
        consistency_errors: List[str] = []

        # 2. Basic Incompleteness Check
        if not tasks:
            blockers.append(
                PlanBlocker(
                    task_id=None,
                    reason_code="NO_TASKS_DEFINED",
                    message="No operational tasks exist for this event.",
                )
            )
            consistency_errors.append("No operational tasks exist for event.")

        # 3. Dependency Integrity Checks & Missing References
        tasks_by_id: Dict[str, Task] = {t.id: t for t in tasks}
        valid_dependencies: List[TaskDependency] = []
        for dep in dependencies:
            has_error = False
            if dep.predecessor_task_id not in tasks_by_id:
                err = f"Dependency references missing predecessor task ID '{dep.predecessor_task_id}'."
                blockers.append(PlanBlocker(task_id=dep.successor_task_id if dep.successor_task_id in tasks_by_id else None, reason_code="INVALID_DEPENDENCY", message=err))
                consistency_errors.append(err)
                has_error = True
            if dep.successor_task_id not in tasks_by_id:
                err = f"Dependency references missing successor task ID '{dep.successor_task_id}'."
                blockers.append(PlanBlocker(task_id=dep.predecessor_task_id if dep.predecessor_task_id in tasks_by_id else None, reason_code="INVALID_DEPENDENCY", message=err))
                consistency_errors.append(err)
                has_error = True
            if not has_error:
                valid_dependencies.append(dep)

        # 4. Deterministic Dependency Graph & Topological Sequence
        graph = DependencyGraph.from_tasks_and_dependencies(tasks, valid_dependencies)
        is_dag_acyclic = graph.is_acyclic()

        if not is_dag_acyclic:
            blockers.append(
                PlanBlocker(
                    task_id=None,
                    reason_code="DAG_CYCLE_DETECTED",
                    message="Dependency graph contains cyclical dependencies, making execution order impossible.",
                )
            )
            consistency_errors.append("Cyclical dependency detected in task DAG.")
            ordered_task_ids = [t.id for t in sorted(tasks, key=lambda x: (x.planned_start or datetime.max, x.name))]
        else:
            ordered_task_ids = graph.topological_sort()

        ordered_tasks: List[Task] = [tasks_by_id[tid] for tid in ordered_task_ids if tid in tasks_by_id]
        # Include any detached tasks that may not have been in ordered_task_ids
        for t in tasks:
            if t not in ordered_tasks:
                ordered_tasks.append(t)

        # 5. Predecessors and Successors Map
        pred_map: Dict[str, List[TaskPredecessorInfo]] = {t.id: [] for t in tasks}
        succ_map: Dict[str, List[TaskSuccessorInfo]] = {t.id: [] for t in tasks}

        for dep in valid_dependencies:
            pred = tasks_by_id.get(dep.predecessor_task_id)
            succ = tasks_by_id.get(dep.successor_task_id)
            if pred and succ:
                pred_map[succ.id].append(
                    TaskPredecessorInfo(
                        task_id=pred.id,
                        task_name=pred.name,
                        status=pred.status,
                        planned_end=pred.planned_end.isoformat() if pred.planned_end else None,
                    )
                )
                succ_map[pred.id].append(
                    TaskSuccessorInfo(
                        task_id=succ.id,
                        task_name=succ.name,
                        status=succ.status,
                        planned_start=succ.planned_start.isoformat() if succ.planned_start else None,
                    )
                )

        # 6. Schedule Integrity & Precedence Checks
        for t in tasks:
            if t.planned_start and t.planned_end:
                if t.planned_start >= t.planned_end:
                    err = f"Task '{t.name}' planned start ({t.planned_start.strftime('%H:%M')}) is not strictly before planned end ({t.planned_end.strftime('%H:%M')})."
                    blockers.append(PlanBlocker(task_id=t.id, reason_code="SCHEDULE_INCONSISTENCY", message=err))
                    consistency_errors.append(err)

        for dep in dependencies:
            pred = tasks_by_id.get(dep.predecessor_task_id)
            succ = tasks_by_id.get(dep.successor_task_id)
            if pred and succ and pred.planned_end and succ.planned_start:
                if succ.planned_start < pred.planned_end:
                    err = f"Successor task '{succ.name}' starts at {succ.planned_start.strftime('%H:%M')} before predecessor '{pred.name}' finishes at {pred.planned_end.strftime('%H:%M')}."
                    blockers.append(PlanBlocker(task_id=succ.id, reason_code="SCHEDULE_DEPENDENCY_CONFLICT", message=err))
                    consistency_errors.append(err)

        # 7. Event Deadline Verification
        if event.end_datetime:
            for t in tasks:
                if t.planned_end and t.planned_end > event.end_datetime:
                    err = f"Task '{t.name}' planned end ({t.planned_end.strftime('%Y-%m-%d %H:%M')}) violates event deadline ({event.end_datetime.strftime('%Y-%m-%d %H:%M')})."
                    blockers.append(PlanBlocker(task_id=t.id, reason_code="EVENT_DEADLINE_VIOLATION", message=err))
                    consistency_errors.append(err)

        # 8. Vendor Mapping, Authoritative Assignments & Missing Vendor Checks
        vendor_ids = {t.provider_id for t in tasks if t.provider_id}
        vendors_in_db = self.db.query(Vendor).filter(Vendor.id.in_(vendor_ids)).all() if vendor_ids else []
        vendors_by_id: Dict[str, Vendor] = {v.id: v for v in vendors_in_db}
        # VendorAssignment has no task foreign key.  Task 8's authoritative pairing
        # is therefore the task provider plus its matching, confirmed assignment.
        assignments_by_vendor: Dict[str, List[VendorAssignment]] = {}
        for assignment in assignments:
            assignments_by_vendor.setdefault(assignment.vendor_id, []).append(assignment)

        compiled_tasks: List[ExecutionPlanTask] = []
        for t in ordered_tasks:
            assigned_provider_id: Optional[str] = None
            assigned_provider_name: Optional[str] = None
            assigned_provider_category: Optional[str] = None
            is_assigned: bool = False
            task_committed_amount: Optional[Decimal] = None
            task_readiness: str = "READY"

            if t.provider_id:
                provider = vendors_by_id.get(t.provider_id)
                if not provider:
                    err = f"Task '{t.name}' is bound to missing provider ID '{t.provider_id}'."
                    blockers.append(PlanBlocker(task_id=t.id, reason_code="PROVIDER_NOT_FOUND", message=err))
                    consistency_errors.append(err)
                    task_readiness = "BLOCKED"
                else:
                    assigned_provider_id = provider.id
                    assigned_provider_name = provider.name
                    assigned_provider_category = t.required_provider_category or provider.category
                    is_assigned = True

                    matching_assignments = assignments_by_vendor.get(provider.id, [])
                    assignment = next(
                        (
                            candidate
                            for candidate in matching_assignments
                            if candidate.status == "CONFIRMED"
                            and (
                                not t.required_provider_category
                                or candidate.category.upper() == t.required_provider_category.upper()
                            )
                        ),
                        None,
                    )
                    if not assignment:
                        err = (
                            f"Task '{t.name}' provider '{provider.name}' has no matching confirmed "
                            "VendorAssignment record."
                        )
                        blockers.append(
                            PlanBlocker(task_id=t.id, reason_code="ASSIGNMENT_RECORD_MISSING", message=err)
                        )
                        consistency_errors.append(err)
                        task_readiness = "BLOCKED"
                    elif assignment.agreed_cost is not None:
                        task_committed_amount = Decimal(str(assignment.agreed_cost)).quantize(Decimal("0.01"))
            else:
                # Unassigned task evaluation
                is_assigned = False
                if t.required_provider_category:
                    if t.is_critical_path:
                        blockers.append(
                            PlanBlocker(
                                task_id=t.id,
                                reason_code="UNASSIGNED_CRITICAL_TASK",
                                message=f"Task '{t.name}' ({t.required_provider_category}) is on the critical path but has no assigned vendor.",
                            )
                        )
                        task_readiness = "BLOCKED"
                    else:
                        warnings.append(
                            PlanWarning(
                                task_id=t.id,
                                reason_code="NON_CRITICAL_TASK_UNASSIGNED",
                                message=f"Task '{t.name}' requires a {t.required_provider_category} provider but remains unassigned.",
                            )
                        )
                        task_readiness = "UNASSIGNED"

            # Check task budget allocation
            category_key = (t.required_provider_category or assigned_provider_category or "").upper()
            budget_alloc: Optional[Decimal] = None
            if category_key:
                matched_item = next((b for b in budget_items if b.category and b.category.upper() == category_key), None)
                if matched_item:
                    budget_alloc = Decimal(str(matched_item.estimated_amount)).quantize(Decimal("0.01"))

            # Build Task Requirements & Resources
            task_resources = [r.name for r in resources if r.allocated_task_id == t.id]
            task_requirements: List[str] = []
            if t.required_provider_category:
                task_requirements.append(f"Category: {t.required_provider_category}")
            # Requirements are event-scoped in the current domain model.  Include
            # only those whose type names the task's provider category, plus general
            # required facts; never manufacture task-specific requirements.
            for requirement in requirements:
                requirement_type = (requirement.type or "").upper()
                category = (t.required_provider_category or "").upper()
                if requirement.required and (requirement_type == "GENERAL" or (category and requirement_type == category)):
                    detail = requirement.description or requirement.name
                    task_requirements.append(detail)

            compiled_tasks.append(
                ExecutionPlanTask(
                    task_id=t.id,
                    task_name=t.name,
                    description=t.description,
                    status=t.status,
                    phase=t.phase,
                    required_provider_category=t.required_provider_category,
                    assigned_provider_id=assigned_provider_id,
                    assigned_provider_name=assigned_provider_name,
                    assigned_provider_category=assigned_provider_category,
                    is_assigned=is_assigned,
                    planned_start=t.planned_start.isoformat() if t.planned_start else None,
                    planned_end=t.planned_end.isoformat() if t.planned_end else None,
                    duration_minutes=t.duration_minutes or 0,
                    slack_minutes=t.slack_minutes,
                    is_critical_path=bool(t.is_critical_path),
                    predecessors=pred_map.get(t.id, []),
                    successors=succ_map.get(t.id, []),
                    budget_allocation=budget_alloc,
                    committed_amount=task_committed_amount,
                    requirements=task_requirements,
                    resources=task_resources,
                    readiness_state=task_readiness,
                    operational_notes=f"Assigned to {assigned_provider_name}" if assigned_provider_name else "Awaiting provider assignment",
                )
            )

        # 9. Budget Summary & Consistency
        total_budget = Decimal(str(event.total_budget or 0)).quantize(Decimal("0.01"))
        budget_totals = BudgetCalculator().calculate_totals(budget_items)
        total_estimated = budget_totals.total_estimated
        total_committed = Decimal("0.00")
        category_commitments: Dict[str, Decimal] = {}

        for item in budget_items:
            act = Decimal(str(item.actual_amount or 0))
            if item.status == BudgetItemStatus.COMMITTED.value or act > 0:
                total_committed += act
                category_commitments[item.category] = category_commitments.get(item.category, Decimal("0.00")) + act

        # Also ensure any confirmed assignments without dedicated budget items are reflected
        for a in assignments:
            if a.status == "CONFIRMED" and a.agreed_cost is not None:
                cost = Decimal(str(a.agreed_cost)).quantize(Decimal("0.01"))
                if a.category not in category_commitments:
                    total_committed += cost
                    category_commitments[a.category] = cost

        total_committed = total_committed.quantize(Decimal("0.01"))
        remaining_budget = (total_budget - total_committed).quantize(Decimal("0.01"))

        # Compute uncommitted allocation
        uncommitted_allocation = Decimal("0.00")
        for item in budget_items:
            if item.status != BudgetItemStatus.COMMITTED.value and item.category not in category_commitments:
                uncommitted_allocation += Decimal(str(item.estimated_amount or 0))
        uncommitted_allocation = uncommitted_allocation.quantize(Decimal("0.01"))

        is_over_budget = total_committed > total_budget
        utilization_percent = Decimal("0.00")
        if total_budget > 0:
            utilization_percent = ((total_committed / total_budget) * Decimal("100")).quantize(Decimal("0.01"))

        if is_over_budget:
            blockers.append(
                PlanBlocker(
                    task_id=None,
                    reason_code="BUDGET_EXCEEDED",
                    message=f"Committed spend (₹{total_committed:,.2f}) exceeds total budget ceiling (₹{total_budget:,.2f}).",
                )
            )
            consistency_errors.append(f"Committed spend ₹{total_committed} exceeds budget ceiling ₹{total_budget}")
        elif remaining_budget < uncommitted_allocation:
            warnings.append(
                PlanWarning(
                    task_id=None,
                    reason_code="BUDGET_INSUFFICIENT",
                    message=f"Remaining budget (₹{remaining_budget:,.2f}) is lower than uncommitted planned estimates (₹{uncommitted_allocation:,.2f}).",
                )
            )

        budget_summary = BudgetSummaryPlan(
            total_budget=total_budget,
            total_committed=total_committed,
            total_estimated=total_estimated,
            remaining_budget=remaining_budget,
            uncommitted_allocation=uncommitted_allocation,
            currency=event.currency or "INR",
            is_over_budget=is_over_budget,
            utilization_percent=utilization_percent,
            category_commitments=category_commitments,
        )

        # 10. Resource Summary
        allocated_res = [r for r in resources if r.status == "ALLOCATED" or r.allocated_task_id is not None]
        available_res = [r for r in resources if r.status == "AVAILABLE" and r.allocated_task_id is None]
        depleted_res = [r for r in resources if r.status == "DEPLETED"]

        resource_items: List[Dict[str, Any]] = [
            {
                "id": r.id,
                "name": r.name,
                "type": r.type,
                "quantity": r.quantity,
                "unit": r.unit,
                "status": r.status,
                "allocated_task_id": r.allocated_task_id,
            }
            for r in resources
        ]

        resource_summary = ResourceSummaryPlan(
            total_resources=len(resources),
            allocated_count=len(allocated_res),
            available_count=len(available_res),
            depleted_count=len(depleted_res),
            items=resource_items,
        )

        # 11. Critical Path Construction
        # Task 9 is a compiler, not a planner.  CPM values must be the authoritative
        # Task 8 values; a missing CPM result is surfaced rather than recalculated or
        # written onto ORM task objects during a read-only request.
        has_cpm = any(t.is_critical_path or t.slack_minutes is not None for t in ordered_tasks)
        if tasks and not has_cpm:
            warnings.append(
                PlanWarning(
                    task_id=None,
                    reason_code="CPM_STATE_UNAVAILABLE",
                    message="Critical-path and slack values have not been recalculated in authoritative Task 8 state.",
                )
            )

        critical_path_entries: List[CriticalPathEntry] = []
        seq = 1
        total_critical_duration = 0
        for t in ordered_tasks:
            if t.is_critical_path or (t.slack_minutes is not None and t.slack_minutes == 0):
                provider = vendors_by_id.get(t.provider_id) if t.provider_id else None
                critical_path_entries.append(
                    CriticalPathEntry(
                        sequence_order=seq,
                        task_id=t.id,
                        task_name=t.name,
                        planned_start=t.planned_start.strftime("%H:%M") if t.planned_start else None,
                        planned_end=t.planned_end.strftime("%H:%M") if t.planned_end else None,
                        duration_minutes=t.duration_minutes or 0,
                        slack_minutes=t.slack_minutes or 0,
                        assigned_provider_name=provider.name if provider else "Unassigned",
                        status=t.status,
                    )
                )
                total_critical_duration += (t.duration_minutes or 0)
                seq += 1

        # 12. Execution Checkpoints Generation
        checkpoints: List[ExecutionCheckpoint] = []
        scheduled_tasks = [t for t in ordered_tasks if t.planned_start is not None]
        scheduled_tasks.sort(key=lambda x: x.planned_start)

        for t in scheduled_tasks:
            start_str = t.planned_start.strftime("%H:%M")
            checkpoints.append(
                ExecutionCheckpoint(
                    checkpoint_id=f"chk-start-{t.id[:8]}",
                    time=start_str,
                    title=f"{t.name} begins",
                    description=f"Execution kicks off for '{t.name}'. Duration: {t.duration_minutes or 0}m.",
                    task_id=t.id,
                    checkpoint_type="START",
                )
            )
            # Create milestone completion checkpoints for critical or prominent phases
            if t.is_critical_path or any(k in t.name.lower() for k in ("setup", "ceremony", "arrival", "dinner", "breakdown")):
                if t.planned_end:
                    end_str = t.planned_end.strftime("%H:%M")
                    checkpoints.append(
                        ExecutionCheckpoint(
                            checkpoint_id=f"chk-comp-{t.id[:8]}",
                            time=end_str,
                            title=f"{t.name} completed",
                            description=f"Verify operational handoff and completion criteria for '{t.name}'.",
                            task_id=t.id,
                            checkpoint_type="COMPLETION",
                        )
                    )

        if event.end_datetime:
            checkpoints.append(
                ExecutionCheckpoint(
                    checkpoint_id="chk-deadline",
                    time=event.end_datetime.strftime("%H:%M"),
                    title="Event Execution Deadline",
                    description="Final operational boundary: all activities, teardown, and site handover must be completed.",
                    task_id=None,
                    checkpoint_type="DEADLINE",
                )
            )

        # Sort checkpoints chronologically
        checkpoints.sort(key=lambda x: x.time)

        # 13. Unresolved Unknowns & Outcome Validation Inspection
        for val in validations:
            for u in (val.unknown_facts or []):
                field_name = u if isinstance(u, str) else u.get("field", "operational_detail")
                desc = u if isinstance(u, str) else u.get("description", str(u))
                val_task = tasks_by_id.get(val.task_id) if val.task_id else None
                is_crit = val_task.is_critical_path if val_task else False

                unresolved_unknowns.append(
                    UnresolvedUnknown(
                        task_id=val.task_id,
                        provider_id=val.provider_id,
                        category=val_task.required_provider_category if val_task else None,
                        field=field_name,
                        description=desc,
                        is_critical=is_crit,
                    )
                )

                warnings.append(
                    PlanWarning(
                        task_id=val.task_id,
                        reason_code="UNRESOLVED_OPERATIONAL_FACT",
                        message=f"Provider detail '{field_name}' is UNKNOWN: {desc}",
                    )
                )

            for c in (val.conflicts or []):
                c_desc = c if isinstance(c, str) else c.get("description", str(c))
                blockers.append(
                    PlanBlocker(
                        task_id=val.task_id,
                        reason_code="VALIDATION_CONFLICT",
                        message=f"Operational conflict unresolved: {c_desc}",
                    )
                )

        # 14. Current and Next Tasks Identification
        current_task_compiled: Optional[ExecutionPlanTask] = None
        next_task_compiled: Optional[ExecutionPlanTask] = None
        now_time = reference_time or datetime.now(timezone.utc).replace(tzinfo=None)

        if event.start_datetime and now_time < event.start_datetime:
            # Pre-event: Next task is the very first task in sequence
            if compiled_tasks:
                next_task_compiled = compiled_tasks[0]
            position_note = "Event has not started yet. Ready for initial task execution."
        else:
            # Event in progress or completed
            for ct in compiled_tasks:
                orig_t = tasks_by_id.get(ct.task_id)
                if orig_t and orig_t.planned_start and orig_t.planned_end:
                    if orig_t.planned_start <= now_time <= orig_t.planned_end or orig_t.status == TaskStatus.IN_PROGRESS.value:
                        current_task_compiled = ct
                        break

            if current_task_compiled:
                curr_idx = compiled_tasks.index(current_task_compiled)
                if curr_idx + 1 < len(compiled_tasks):
                    next_task_compiled = compiled_tasks[curr_idx + 1]
                position_note = f"Currently executing '{current_task_compiled.task_name}'."
            else:
                # Find next upcoming task
                upcoming = [ct for ct in compiled_tasks if tasks_by_id.get(ct.task_id) and tasks_by_id[ct.task_id].planned_start and tasks_by_id[ct.task_id].planned_start > now_time]
                if upcoming:
                    next_task_compiled = upcoming[0]
                    position_note = f"Awaiting start of '{next_task_compiled.task_name}'."
                elif compiled_tasks:
                    position_note = "All scheduled execution tasks have concluded."
                else:
                    position_note = "No scheduled tasks found."

        current_and_next = CurrentAndNextTasks(
            current_task=current_task_compiled,
            next_task=next_task_compiled,
            position_note=position_note,
        )

        # 15. Overall Readiness Status
        if len(blockers) > 0:
            readiness_status = PlanReadiness.BLOCKED
        elif len(tasks) == 0:
            readiness_status = PlanReadiness.INCOMPLETE
        elif len(warnings) > 0 or any(t.readiness_state in ("PARTIALLY_READY", "UNASSIGNED") for t in compiled_tasks):
            readiness_status = PlanReadiness.PARTIALLY_READY
        else:
            readiness_status = PlanReadiness.READY

        # 16. Operational Focus Summary
        operational_focus = self._synthesize_operational_focus(
            event=event,
            plan_version=plan_version,
            readiness_status=readiness_status,
            critical_path=critical_path_entries,
            blockers=blockers,
            warnings=warnings,
            budget_summary=budget_summary,
        )

        # 17. Event Summary
        event_summary = EventSummary(
            event_id=event.id,
            event_name=event.name,
            event_type=event.event_type,
            location=event.location,
            start_datetime=event.start_datetime.isoformat() if event.start_datetime else None,
            end_datetime=event.end_datetime.isoformat() if event.end_datetime else None,
            guest_count=event.guest_count or 0,
            lifecycle_state=event.lifecycle_state,
            total_budget=total_budget,
            currency=event.currency or "INR",
        )

        return FinalExecutionPlan(
            plan_id=f"plan-{event.id[:8]}-v{plan_version}",
            event_id=event.id,
            plan_version=plan_version,
            generated_at=generated_at,
            event_summary=event_summary,
            readiness_status=readiness_status,
            tasks=compiled_tasks,
            critical_path=critical_path_entries,
            total_critical_duration_minutes=total_critical_duration,
            budget_summary=budget_summary,
            resource_summary=resource_summary,
            current_and_next=current_and_next,
            execution_checkpoints=checkpoints,
            blockers=blockers,
            warnings=warnings,
            unresolved_unknowns=unresolved_unknowns,
            operational_focus=operational_focus,
            is_consistent=(len(consistency_errors) == 0),
            consistency_errors=consistency_errors,
        )

    def _synthesize_operational_focus(
        self,
        event: Event,
        plan_version: int,
        readiness_status: PlanReadiness,
        critical_path: List[CriticalPathEntry],
        blockers: List[PlanBlocker],
        warnings: List[PlanWarning],
        budget_summary: BudgetSummaryPlan,
    ) -> str:
        """Generates a concise operational focus summary strictly grounded on authoritative plan facts."""
        cp_names = " → ".join(cp.task_name for cp in critical_path) if critical_path else "None"
        
        status_line = f"Plan Version v{plan_version} is {readiness_status.value}."
        cp_line = f"Critical path encompasses {len(critical_path)} tasks ({cp_names})."
        
        if readiness_status == PlanReadiness.BLOCKED:
            reasons = "; ".join(b.message for b in blockers[:2])
            guidance = f"CRITICAL ATTENTION REQUIRED: {reasons}"
        elif readiness_status == PlanReadiness.PARTIALLY_READY:
            warn_msg = "; ".join(w.message for w in warnings[:2])
            guidance = f"Operational focus: Non-critical items require monitoring ({warn_msg})."
        elif readiness_status == PlanReadiness.INCOMPLETE:
            guidance = "Operational focus: Complete event specifications and task definition."
        else:
            budget_line = f"Budget committed: ₹{budget_summary.total_committed:,.2f} of ₹{budget_summary.total_budget:,.2f} ({budget_summary.utilization_percent}%)."
            guidance = f"Execution ready. {budget_line} All operational constraints verified."

        return f"{status_line} {cp_line} {guidance}"
