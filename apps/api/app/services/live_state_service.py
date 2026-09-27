"""Domain Service: LiveStateService

Manages live event operations: go-live transition, task progress tracking,
deviation detection, and event conclusion.
"""
from datetime import datetime, timezone
from decimal import Decimal
from typing import List, Optional
from sqlalchemy.orm import Session

from app.models.event import Event
from app.models.task import Task
from app.models.budget import BudgetItem
from app.models.vendor_assignment import VendorAssignment
from app.models.vendor import Vendor
from app.models.state_transition import StateTransition
from app.models.enums import EventLifecycleState, TaskStatus
from app.engines.state.event_state import EventStateMachine
from app.engines.state.transitions import TransitionValidator
from app.engines.state.deviation import DeviationDetector
from app.schemas.live_state import (
    EventLiveState,
    TaskProgress,
    ScheduleDeviationResponse,
    BudgetDeviationResponse,
    ProviderOperationalSummary,
)
from app.core.exceptions import NotFoundException, BadRequestException
from app.services.live_broker import live_broker


def utc_now():
    return datetime.now(timezone.utc).replace(tzinfo=None)


class LiveStateService:
    """Coordinates live event state operations."""

    def __init__(self, db: Session):
        self.db = db
        self._state_machine = EventStateMachine()
        self._transition_validator = TransitionValidator()
        self._deviation_detector = DeviationDetector()

    def go_live(self, event_id: str, reason: str = "Event going live") -> EventLiveState:
        """Transition an event from PLANNED to LIVE.

        Validates readiness, transitions lifecycle state, and records the transition.
        """
        event = self._get_event(event_id)
        tasks = self.db.query(Task).filter(Task.event_id == event_id).all()

        # Validate readiness
        failures = self._transition_validator.validate_go_live_readiness(event, tasks)
        if failures:
            raise BadRequestException(
                "Event is not ready to go live",
                details={"validation_failures": failures},
            )

        # Validate state transition
        try:
            self._state_machine.validate_transition(
                event.lifecycle_state, EventLifecycleState.LIVE.value
            )
        except ValueError as err:
            raise BadRequestException(str(err))

        # Perform transition
        previous_state = event.lifecycle_state
        event.lifecycle_state = EventLifecycleState.LIVE.value
        self._record_transition(event_id, "EVENT", event_id, previous_state, event.lifecycle_state, reason)

        # Transition all PENDING tasks to READY
        for task in tasks:
            if task.status == TaskStatus.PENDING.value:
                predecessors_complete = self._check_predecessors_complete(task)
                if predecessors_complete:
                    old_status = task.status
                    task.status = TaskStatus.READY.value
                    self._record_transition(
                        event_id, "TASK", task.id, old_status, task.status, "Event went live"
                    )

        self.db.commit()
        self.db.refresh(event)

        return self.get_live_state(event_id)

    def update_task_status(
        self,
        event_id: str,
        task_id: str,
        new_status: str,
        actual_start: Optional[datetime] = None,
        actual_end: Optional[datetime] = None,
    ) -> Task:
        """Update a task's status and actual timing during live operations."""
        event = self._get_event(event_id)

        if event.lifecycle_state != EventLifecycleState.LIVE.value:
            raise BadRequestException(
                f"Cannot update task status: event is in '{event.lifecycle_state}' state. "
                f"Task updates require LIVE state."
            )

        task = self.db.query(Task).filter(
            Task.id == task_id, Task.event_id == event_id
        ).first()
        if not task:
            raise NotFoundException(f"Task with id '{task_id}' not found in event '{event_id}'")

        # Validate status transition
        valid_status_transitions = {
            TaskStatus.PENDING.value: {TaskStatus.READY.value, TaskStatus.CANCELLED.value},
            TaskStatus.READY.value: {TaskStatus.IN_PROGRESS.value, TaskStatus.CANCELLED.value},
            TaskStatus.IN_PROGRESS.value: {TaskStatus.COMPLETED.value, TaskStatus.BLOCKED.value, TaskStatus.FAILED.value},
            TaskStatus.BLOCKED.value: {TaskStatus.READY.value, TaskStatus.IN_PROGRESS.value, TaskStatus.CANCELLED.value},
            TaskStatus.COMPLETED.value: set(),
            TaskStatus.FAILED.value: {TaskStatus.READY.value},
            TaskStatus.CANCELLED.value: set(),
        }

        allowed = valid_status_transitions.get(task.status, set())
        if new_status not in allowed:
            raise BadRequestException(
                f"Invalid task status transition: {task.status} → {new_status}. "
                f"Allowed: {sorted(allowed)}"
            )

        old_status = task.status
        task.status = new_status

        if actual_start:
            task.actual_start = actual_start
        elif new_status == TaskStatus.IN_PROGRESS.value and not task.actual_start:
            task.actual_start = utc_now()

        if actual_end:
            task.actual_end = actual_end
        elif new_status == TaskStatus.COMPLETED.value and not task.actual_end:
            task.actual_end = utc_now()

        # Critical requirement: 'EXECUTED' is distinct from 'VERIFIED'
        if new_status == TaskStatus.COMPLETED.value:
            if getattr(task, "verification_status", None) not in ("VERIFIED", "VERIFYING"):
                task.verification_status = "EXECUTED"

        self._record_transition(event_id, "TASK", task_id, old_status, new_status, "Manual status update")

        # When a task completes, check if downstream tasks become READY
        if new_status == TaskStatus.COMPLETED.value:
            self._cascade_readiness(event_id, task_id)

        self.db.commit()
        self.db.refresh(task)

        # Broadcast live operational update to SSE subscribers
        live_broker.publish_sync(
            event_id,
            {
                "type": "TASK_UPDATED",
                "task_id": task.id,
                "status": task.status,
                "verification_status": getattr(task, "verification_status", "UNKNOWN"),
            },
        )
        return task

    def update_task_verification(
        self,
        event_id: str,
        task_id: str,
        new_verification_status: str,
        notes: Optional[str] = None,
        actor_id: Optional[str] = None,
    ) -> Task:
        """Authoritatively update task verification state (B6).
        
        Enforces valid verification lifecycles:
        PENDING, IN_PROGRESS, EXECUTED, VERIFYING, VERIFIED, FAILED, UNKNOWN.
        """
        valid_statuses = {
            "PENDING",
            "IN_PROGRESS",
            "EXECUTED",
            "VERIFYING",
            "VERIFIED",
            "FAILED",
            "UNKNOWN",
        }
        if new_verification_status not in valid_statuses:
            raise BadRequestException(
                f"Invalid verification status: '{new_verification_status}'. "
                f"Allowed: {sorted(valid_statuses)}"
            )

        task = self.db.query(Task).filter(
            Task.id == task_id, Task.event_id == event_id
        ).first()
        if not task:
            raise NotFoundException(f"Task with id '{task_id}' not found in event '{event_id}'")

        old_verification = getattr(task, "verification_status", "PENDING")
        task.verification_status = new_verification_status
        if notes:
            task.verification_notes = notes

        if new_verification_status == "VERIFIED":
            task.verified_at = utc_now()

        self._record_transition(
            event_id,
            "TASK_VERIFICATION",
            task_id,
            old_verification,
            new_verification_status,
            notes or f"Verification state updated by {actor_id or 'operator'}",
        )

        self.db.commit()
        self.db.refresh(task)

        # Broadcast live verification change
        live_broker.publish_sync(
            event_id,
            {
                "type": "TASK_VERIFIED",
                "task_id": task.id,
                "verification_status": task.verification_status,
                "notes": notes,
            },
        )
        return task

    def get_live_state(self, event_id: str) -> EventLiveState:
        """Get aggregated live operational state snapshot."""
        event = self._get_event(event_id)
        tasks = self.db.query(Task).filter(Task.event_id == event_id).all()
        budget_items = self.db.query(BudgetItem).filter(BudgetItem.event_id == event_id).all()

        # Task summary by status
        task_summary = {}
        for task in tasks:
            task_summary[task.status] = task_summary.get(task.status, 0) + 1

        completed = sum(1 for t in tasks if t.status == TaskStatus.COMPLETED.value)
        total = len(tasks)
        progress = round((completed / total * 100), 1) if total > 0 else 0.0

        # Build task progress entries
        schedule_devs = self._deviation_detector.detect_schedule_deviations(tasks)
        dev_by_task = {}
        for d in schedule_devs:
            if d.task_id not in dev_by_task:
                dev_by_task[d.task_id] = d

        task_progress = []
        for task in tasks:
            dev = dev_by_task.get(task.id)
            task_progress.append(TaskProgress(
                task_id=task.id,
                task_name=task.name,
                key=task.key,
                status=task.status,
                priority=task.priority,
                planned_start=task.planned_start,
                planned_end=task.planned_end,
                actual_start=task.actual_start,
                actual_end=task.actual_end,
                is_critical_path=task.is_critical_path,
                deviation_minutes=dev.deviation_minutes if dev else 0,
                deviation_type=dev.deviation_type if dev else "ON_TIME",
            ))

        # Schedule deviation list
        sched_dev_responses = [
            ScheduleDeviationResponse(
                task_id=d.task_id,
                task_name=d.task_name,
                deviation_type=d.deviation_type,
                planned_value=d.planned_value,
                actual_value=d.actual_value,
                deviation_minutes=d.deviation_minutes,
            )
            for d in schedule_devs
        ]

        # Budget deviation
        budget_dev = None
        if budget_items:
            total_budget = float(event.total_budget or 0)
            bd = self._deviation_detector.detect_budget_deviation(
                budget_items, Decimal(str(total_budget))
            )
            budget_dev = BudgetDeviationResponse(
                total_budget=float(bd.total_budget),
                total_spent=float(bd.total_spent),
                total_estimated=float(bd.total_estimated),
                variance=float(bd.variance),
                is_over_budget=bd.is_over_budget,
            )

        # Provider Operational Summary
        provider_summary = self.get_provider_live_state(event_id)

        return EventLiveState(
            event_id=event_id,
            event_name=event.name,
            event_type=event.event_type,
            lifecycle_state=event.lifecycle_state,
            task_summary=task_summary,
            total_tasks=total,
            completed_tasks=completed,
            progress_percent=progress,
            task_progress=task_progress,
            schedule_deviations=sched_dev_responses,
            budget_deviation=budget_dev,
            provider_summary=provider_summary,
        )

    def get_provider_live_state(self, event_id: str) -> ProviderOperationalSummary:
        """Aggregates active provider engagements, confirmations, and commitments for live context."""
        assignments = (
            self.db.query(VendorAssignment)
            .filter(VendorAssignment.event_id == event_id)
            .all()
        )
        confirmed_count = sum(
            1 for a in assignments if a.negotiation_status == "CONFIRMED" or a.status == "CONFIRMED"
        )
        awaiting_approval_count = sum(
            1 for a in assignments if a.negotiation_status == "AWAITING_APPROVAL"
        )
        in_negotiation_count = sum(
            1
            for a in assignments
            if a.negotiation_status
            in ("CONTACTED", "QUOTATION_RECEIVED", "NEGOTIATING", "COUNTER_OFFER_SENT")
        )
        total_committed_cost = sum(
            float(a.agreed_cost or a.quoted_amount or 0)
            for a in assignments
            if a.negotiation_status == "CONFIRMED" or a.status == "CONFIRMED"
        )

        assignment_items = []
        for a in assignments:
            vendor = a.vendor
            assignment_items.append({
                "assignment_id": a.id,
                "vendor_id": a.vendor_id,
                "vendor_name": vendor.name if vendor else "Unknown",
                "category": a.category,
                "status": a.status,
                "negotiation_status": a.negotiation_status,
                "quoted_amount": a.quoted_amount,
                "agreed_cost": a.agreed_cost,
                "currency": a.currency or "INR",
                "approval_id": a.approval_id,
                "is_simulation": a.is_simulation,
            })

        return ProviderOperationalSummary(
            total_assignments=len(assignments),
            confirmed_count=confirmed_count,
            in_negotiation_count=in_negotiation_count,
            awaiting_approval_count=awaiting_approval_count,
            total_committed_cost=total_committed_cost,
            assignments=assignment_items,
        )

    def conclude_event(self, event_id: str, reason: str = "Event concluded") -> Event:
        """Transition an event from LIVE to CONCLUDED."""
        event = self._get_event(event_id)
        tasks = self.db.query(Task).filter(Task.event_id == event_id).all()

        # Validate conclude readiness
        failures = self._transition_validator.validate_conclude_readiness(event, tasks)
        if failures:
            raise BadRequestException(
                "Event is not ready to conclude",
                details={"validation_failures": failures},
            )

        # Validate state transition
        try:
            self._state_machine.validate_transition(
                event.lifecycle_state, EventLifecycleState.CONCLUDED.value
            )
        except ValueError as err:
            raise BadRequestException(str(err))

        previous_state = event.lifecycle_state
        event.lifecycle_state = EventLifecycleState.CONCLUDED.value
        self._record_transition(event_id, "EVENT", event_id, previous_state, event.lifecycle_state, reason)

        self.db.commit()
        self.db.refresh(event)
        return event

    # --- Private helpers ---

    def _get_event(self, event_id: str) -> Event:
        event = self.db.query(Event).filter(Event.id == event_id).first()
        if not event:
            raise NotFoundException(f"Event with id '{event_id}' not found.")
        return event

    def _record_transition(
        self, event_id: str, entity_type: str, entity_id: str,
        previous_state: str, new_state: str, reason: str,
    ) -> None:
        transition = StateTransition(
            event_id=event_id,
            entity_type=entity_type,
            entity_id=entity_id,
            previous_state=previous_state,
            new_state=new_state,
            reason=reason,
        )
        self.db.add(transition)

    def _check_predecessors_complete(self, task: Task) -> bool:
        """Check if all predecessor tasks are complete."""
        from app.models.dependency import TaskDependency
        deps = self.db.query(TaskDependency).filter(
            TaskDependency.successor_task_id == task.id
        ).all()

        if not deps:
            return True

        for dep in deps:
            pred = self.db.query(Task).filter(Task.id == dep.predecessor_task_id).first()
            if pred and pred.status != TaskStatus.COMPLETED.value:
                return False

        return True

    def _cascade_readiness(self, event_id: str, completed_task_id: str) -> None:
        """When a task completes, check if its successors can become READY."""
        from app.models.dependency import TaskDependency
        deps = self.db.query(TaskDependency).filter(
            TaskDependency.predecessor_task_id == completed_task_id
        ).all()

        for dep in deps:
            successor = self.db.query(Task).filter(Task.id == dep.successor_task_id).first()
            if successor and successor.status == TaskStatus.PENDING.value:
                if self._check_predecessors_complete(successor):
                    old_status = successor.status
                    successor.status = TaskStatus.READY.value
                    self._record_transition(
                        event_id, "TASK", successor.id, old_status,
                        TaskStatus.READY.value, f"Predecessor '{completed_task_id}' completed"
                    )
