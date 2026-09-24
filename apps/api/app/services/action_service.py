"""Domain Service: ActionService (Transactional Action Execution & Concurrency)"""
import uuid
from datetime import datetime, timezone, timedelta
from decimal import Decimal
from typing import Any, Dict, List, Optional, Tuple
from sqlalchemy.orm import Session

from app.core.exceptions import (
    BadRequestException,
    NotFoundException,
    ConflictException,
)
from app.models.event import Event
from app.models.task import Task
from app.models.vendor import Vendor
from app.models.vendor_assignment import VendorAssignment
from app.models.resource import Resource
from app.models.budget import BudgetItem
from app.models.recovery import Recovery
from app.models.action import ActionExecution
from app.models.state_transition import StateTransition
from app.engines.auth.snapshot import compute_event_state_snapshot


def utc_now():
    return datetime.now(timezone.utc).replace(tzinfo=None)


class ActionService:
    """Centralized, transactional executor of real operational mutations.

    Enforces:
    - Atomic database transactions with rollback on any failure.
    - Optimistic concurrency protection against stale state snapshots.
    - Strict idempotency for duplicate execution requests.
    - State transition audit logging.
    """

    def __init__(self, db: Session):
        self.db = db

    def execute_action(
        self,
        event_id: str,
        executor_id: str,
        action_type: str,
        target_type: str,
        target_id: Optional[str] = None,
        payload: Optional[Dict[str, Any]] = None,
        action_id: Optional[str] = None,
        approval_request_id: Optional[str] = None,
        recovery_option_id: Optional[str] = None,
    ) -> ActionExecution:
        """Transactionally executes an authorized operational action."""
        payload = payload or {}
        event = self.db.query(Event).filter(Event.id == event_id).first()
        if not event:
            raise NotFoundException(f"Event with id '{event_id}' not found.")

        # 1. Idempotency Check
        action_id = action_id or str(uuid.uuid4())
        existing = (
            self.db.query(ActionExecution)
            .filter(ActionExecution.action_id == action_id)
            .first()
        )
        if existing:
            return existing

        # 2. Capture baseline state snapshot
        before_version = compute_event_state_snapshot(self.db, event_id)
        affected_entities: List[Dict[str, Any]] = []
        execution_result_data: Dict[str, Any] = {}

        try:
            # 3. Action-specific mutation execution
            if action_type == "REASSIGN_VENDOR":
                affected_entities, execution_result_data = self._execute_reassign_vendor(
                    event_id, target_id, payload
                )
            elif action_type == "REASSIGN_TASK":
                affected_entities, execution_result_data = self._execute_reassign_task(
                    event_id, target_id, payload
                )
            elif action_type == "ADJUST_SCHEDULE":
                affected_entities, execution_result_data = self._execute_adjust_schedule(
                    event_id, target_id, payload
                )
            elif action_type == "ALLOCATE_RESOURCE":
                affected_entities, execution_result_data = self._execute_allocate_resource(
                    event_id, target_id, payload
                )
            elif action_type == "ADJUST_BUDGET":
                affected_entities, execution_result_data = self._execute_adjust_budget(
                    event_id, target_id, payload
                )
            elif action_type == "PROVIDER_ENGAGEMENT":
                affected_entities, execution_result_data = self._execute_provider_engagement(
                    event_id, target_id, payload
                )
            else:
                raise BadRequestException(f"Unknown operational action type '{action_type}'.")

            self.db.flush()

            # 4. Capture after state snapshot
            after_version = compute_event_state_snapshot(self.db, event_id)

            # 5. Record StateTransition audit
            transition = StateTransition(
                event_id=event_id,
                entity_type="ACTION",
                entity_id=action_id,
                previous_state=before_version[:12],
                new_state=after_version[:12],
                reason=f"Executed operational action: {action_type}",
            )
            self.db.add(transition)

            # 6. Record ActionExecution
            execution = ActionExecution(
                action_id=action_id,
                event_id=event_id,
                action_type=action_type,
                approval_request_id=approval_request_id,
                recovery_option_id=recovery_option_id,
                executor_id=executor_id,
                status="SUCCESS",
                affected_entities=affected_entities,
                before_version=before_version,
                after_version=after_version,
                execution_payload=payload,
                execution_result_data=execution_result_data,
                executed_at=utc_now(),
            )
            self.db.add(execution)
            self.db.commit()
            self.db.refresh(execution)
            return execution

        except Exception as err:
            self.db.rollback()
            raise err

    def execute_recovery_option(
        self,
        event_id: str,
        executor_id: str,
        recovery_option_id: str,
        action_id: Optional[str] = None,
    ) -> ActionExecution:
        """Executes a Phase 8 recovery option with strict optimistic concurrency revalidation."""
        recovery = (
            self.db.query(Recovery)
            .filter(Recovery.id == recovery_option_id, Recovery.event_id == event_id)
            .first()
        )
        if not recovery:
            raise NotFoundException(f"Recovery option '{recovery_option_id}' not found for event '{event_id}'.")

        # Optimistic Concurrency Check: Verify state hasn't mutated since option was generated
        current_snapshot = compute_event_state_snapshot(self.db, event_id)
        if recovery.status == "STALE" or recovery.state_snapshot != current_snapshot:
            recovery.status = "STALE"
            self.db.commit()
            raise ConflictException(
                "STALE_ACTION: Event state has changed since recovery option was generated. Re-evaluation required."
            )

        changes = recovery.proposed_changes or {}
        action_id = action_id or str(uuid.uuid4())

        # Check idempotency
        existing = (
            self.db.query(ActionExecution)
            .filter(ActionExecution.action_id == action_id)
            .first()
        )
        if existing:
            return existing

        before_version = current_snapshot
        affected_entities: List[Dict[str, Any]] = []
        result_data: Dict[str, Any] = {"strategy_type": recovery.strategy_type}

        try:
            # Apply vendor reassignment if present
            if "vendor_id" in changes or "replacement_vendor_id" in changes or "vendor_reassignment" in changes:
                new_vid = changes.get("vendor_id") or changes.get("replacement_vendor_id") or changes.get("vendor_reassignment", {}).get("vendor_id")
                task_id = changes.get("task_id") or changes.get("vendor_reassignment", {}).get("task_id")
                if not task_id and recovery.affected_tasks:
                    task_id = recovery.affected_tasks[0]
                cost = changes.get("agreed_cost") or changes.get("vendor_reassignment", {}).get("cost", 0.0)

                if new_vid and task_id:
                    sub_entities, sub_res = self._execute_reassign_vendor(
                        event_id, task_id, {"new_vendor_id": new_vid, "agreed_cost": cost}
                    )
                    affected_entities.extend(sub_entities)
                    result_data.update(sub_res)

            # Apply schedule adjustment if present
            if "schedule_adjustment" in changes or "shift_minutes" in changes:
                sched_data = changes.get("schedule_adjustment") or {}
                task_id = sched_data.get("task_id") or (recovery.affected_tasks[0] if recovery.affected_tasks else None)
                if task_id:
                    sub_entities, sub_res = self._execute_adjust_schedule(
                        event_id, task_id, sched_data or {"shift_minutes": changes.get("shift_minutes", 0)}
                    )
                    affected_entities.extend(sub_entities)
                    result_data.update(sub_res)

            # Mark recovery option executed
            recovery.status = "EXECUTED"
            self.db.flush()

            after_version = compute_event_state_snapshot(self.db, event_id)

            # StateTransition record
            self.db.add(StateTransition(
                event_id=event_id,
                entity_type="RECOVERY_OPTION",
                entity_id=recovery.id,
                previous_state=recovery.status,
                new_state="EXECUTED",
                reason=f"Executed recovery strategy: {recovery.strategy_type}",
            ))

            execution = ActionExecution(
                action_id=action_id,
                event_id=event_id,
                action_type=f"RECOVERY_{recovery.strategy_type}",
                recovery_option_id=recovery.id,
                executor_id=executor_id,
                status="SUCCESS",
                affected_entities=affected_entities,
                before_version=before_version,
                after_version=after_version,
                execution_payload=changes,
                execution_result_data=result_data,
                executed_at=utc_now(),
            )
            self.db.add(execution)
            self.db.commit()
            self.db.refresh(execution)
            return execution

        except Exception as err:
            self.db.rollback()
            raise err

    # --- Private Transaction Handlers ---

    def _execute_reassign_vendor(
        self, event_id: str, target_id: Optional[str], payload: Dict[str, Any]
    ):
        task_id = target_id or payload.get("task_id")
        if not task_id:
            raise BadRequestException("Task ID is required for vendor reassignment.")

        task = self.db.query(Task).filter(Task.id == task_id, Task.event_id == event_id).first()
        if not task:
            raise NotFoundException(f"Task '{task_id}' not found for event '{event_id}'.")

        new_vendor_id = payload.get("new_vendor_id") or payload.get("vendor_id")
        if not new_vendor_id:
            raise BadRequestException("New vendor ID is required.")

        vendor = self.db.query(Vendor).filter(Vendor.id == new_vendor_id).first()
        if not vendor:
            raise NotFoundException(f"Vendor '{new_vendor_id}' not found.")

        cost = Decimal(str(payload.get("agreed_cost", 0.0) or 0.0))
        category = task.required_provider_category or vendor.category or "general"

        # Update or create vendor assignment
        assignment = (
            self.db.query(VendorAssignment)
            .filter(VendorAssignment.event_id == event_id, VendorAssignment.category == category)
            .first()
        )
        if assignment:
            assignment.vendor_id = vendor.id
            assignment.status = "CONFIRMED"
            if cost > 0:
                assignment.agreed_cost = cost
        else:
            assignment = VendorAssignment(
                event_id=event_id,
                vendor_id=vendor.id,
                category=category,
                status="CONFIRMED",
                agreed_cost=cost,
            )
            self.db.add(assignment)
            self.db.flush()

        task.required_provider_category = category

        # Update corresponding budget item if available
        budget_item = (
            self.db.query(BudgetItem)
            .filter(BudgetItem.event_id == event_id, BudgetItem.category == category)
            .first()
        )
        if budget_item and cost > 0:
            budget_item.actual_amount = cost

        affected = [
            {"entity_type": "TASK", "id": task.id},
            {"entity_type": "VENDOR_ASSIGNMENT", "id": assignment.id},
            {"entity_type": "VENDOR", "id": vendor.id},
        ]
        return affected, {"new_vendor_id": vendor.id, "agreed_cost": float(cost)}

    def _execute_reassign_task(
        self, event_id: str, target_id: Optional[str], payload: Dict[str, Any]
    ):
        task_id = target_id or payload.get("task_id")
        task = self.db.query(Task).filter(Task.id == task_id, Task.event_id == event_id).first()
        if not task:
            raise NotFoundException(f"Task '{task_id}' not found for event '{event_id}'.")

        if "required_provider_category" in payload:
            task.required_provider_category = payload["required_provider_category"]
        if "priority" in payload:
            task.priority = payload["priority"]
        if "duration_minutes" in payload:
            task.duration_minutes = payload["duration_minutes"]

        return [{"entity_type": "TASK", "id": task.id}], {"task_id": task.id}

    def _execute_adjust_schedule(
        self, event_id: str, target_id: Optional[str], payload: Dict[str, Any]
    ):
        task_id = target_id or payload.get("task_id")
        task = self.db.query(Task).filter(Task.id == task_id, Task.event_id == event_id).first()
        if not task:
            raise NotFoundException(f"Task '{task_id}' not found for event '{event_id}'.")

        shift = payload.get("shift_minutes") or payload.get("delay_minutes", 0)
        if shift and task.planned_start and task.planned_end:
            task.planned_start += timedelta(minutes=shift)
            task.planned_end += timedelta(minutes=shift)
            if task.slack_minutes is not None:
                task.slack_minutes = max(0, task.slack_minutes - shift)

        if "planned_start" in payload and payload["planned_start"]:
            dt_start = payload["planned_start"]
            task.planned_start = datetime.fromisoformat(dt_start) if isinstance(dt_start, str) else dt_start

        if "planned_end" in payload and payload["planned_end"]:
            dt_end = payload["planned_end"]
            task.planned_end = datetime.fromisoformat(dt_end) if isinstance(dt_end, str) else dt_end

        return [{"entity_type": "TASK", "id": task.id}], {
            "task_id": task.id,
            "planned_start": task.planned_start.isoformat() if task.planned_start else None,
            "planned_end": task.planned_end.isoformat() if task.planned_end else None,
        }

    def _execute_allocate_resource(
        self, event_id: str, target_id: Optional[str], payload: Dict[str, Any]
    ):
        res_id = target_id or payload.get("resource_id")
        resource = self.db.query(Resource).filter(Resource.id == res_id, Resource.event_id == event_id).first()
        if not resource:
            raise NotFoundException(f"Resource '{res_id}' not found for event '{event_id}'.")

        task_id = payload.get("task_id")
        if task_id:
            task = self.db.query(Task).filter(Task.id == task_id, Task.event_id == event_id).first()
            if not task:
                raise NotFoundException(f"Task '{task_id}' not found for event '{event_id}'.")
            resource.allocated_task_id = task.id
            resource.status = "ALLOCATED"

        if "quantity" in payload:
            resource.quantity = payload["quantity"]

        return [{"entity_type": "RESOURCE", "id": resource.id}], {"resource_id": resource.id}

    def _execute_adjust_budget(
        self, event_id: str, target_id: Optional[str], payload: Dict[str, Any]
    ):
        item_id = target_id or payload.get("budget_item_id")
        item = self.db.query(BudgetItem).filter(BudgetItem.id == item_id, BudgetItem.event_id == event_id).first()
        if not item:
            raise NotFoundException(f"Budget item '{item_id}' not found for event '{event_id}'.")

        if "actual_amount" in payload:
            item.actual_amount = Decimal(str(payload["actual_amount"]))
        elif "committed_amount" in payload:
            item.actual_amount = Decimal(str(payload["committed_amount"]))
        if "estimated_amount" in payload:
            item.estimated_amount = Decimal(str(payload["estimated_amount"]))

        return [{"entity_type": "BUDGET_ITEM", "id": item.id}], {
            "budget_item_id": item.id,
            "actual_amount": float(item.actual_amount) if item.actual_amount else 0.0,
            "estimated_amount": float(item.estimated_amount) if item.estimated_amount else 0.0,
        }

    def _execute_provider_engagement(
        self, event_id: str, target_id: Optional[str], payload: Dict[str, Any]
    ) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
        from app.models.vendor_assignment import VendorAssignment
        assignment_id = target_id or payload.get("assignment_id")
        assignment = self.db.query(VendorAssignment).filter_by(id=assignment_id).first()
        if not assignment:
            raise NotFoundException(f"VendorAssignment '{assignment_id}' not found.")

        assignment.negotiation_status = "APPROVED"
        return [{"entity_type": "VENDOR_ASSIGNMENT", "id": assignment.id}], {
            "assignment_id": assignment.id,
            "negotiation_status": "APPROVED",
            "quoted_amount": assignment.quoted_amount,
        }

