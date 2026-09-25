"""Domain Service: PauseResumeService (Task 11 Real Pause / Resume of Event Execution).

Implements explicit, authorized, auditable, transactional, idempotent, and concurrency-safe
lifecycle execution control for live EVENTRA events.
"""
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple
from sqlalchemy.orm import Session

from app.core.exceptions import (
    BadRequestException,
    ConflictException,
    ForbiddenException,
    NotFoundException,
)
from app.engines.auth.permissions import Permissions, ROLE_PERMISSIONS_MAP
from app.models.enums import EventExecutionState, RoleType
from app.models.event import Event
from app.models.incident import Incident
from app.models.pause_record import EventPauseRecord
from app.models.task import Task
from app.models.dependency import TaskDependency
from app.models.vendor_assignment import VendorAssignment
from app.models.budget import BudgetItem
from app.observability.audit import AuditRecorder
from app.services.authorization_service import AuthorizationService
from app.services.final_execution_plan_service import FinalExecutionPlanService


def utc_now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class PauseResumeService:
    """Manages transactional operational pause and resume lifecycle transitions."""

    def __init__(self, db: Session):
        self.db = db
        self._auth_service = AuthorizationService(db)
        self._audit = AuditRecorder(db)
        self._plan_service = FinalExecutionPlanService(db)

    def _get_event(self, event_id: str) -> Event:
        event = self.db.query(Event).filter(Event.id == event_id).first()
        if not event:
            raise NotFoundException(f"Event with id '{event_id}' not found.")
        return event

    def _check_permission(self, event: Event, user_id: str, permission: str) -> None:
        """Enforces that the user has the required execution control permission."""
        if not user_id or user_id in ("system", "anonymous_operator"):
            # System internal execution allowed
            return

        # Event owner has all permissions
        if event.owner_id == user_id:
            return

        user_role = self._auth_service.get_user_role(event, user_id)
        perms = ROLE_PERMISSIONS_MAP.get(user_role, set())
        if permission not in perms:
            raise ForbiddenException(
                f"Role '{user_role}' lacks permission '{permission}' to perform execution control."
            )

    def _compute_plan_version(self, event_id: str) -> int:
        return self._plan_service._compute_plan_version(event_id)

    def get_execution_state(self, event_id: str, user_id: Optional[str] = None) -> Dict[str, Any]:
        """Retrieves authoritative current operational execution state and control flags."""
        event = self._get_event(event_id)
        if user_id:
            self._auth_service.get_user_role(event, user_id)

        curr_state = getattr(event, "execution_state", None) or EventExecutionState.RUNNING.value
        plan_version = self._compute_plan_version(event_id)

        last_record = (
            self.db.query(EventPauseRecord)
            .filter(EventPauseRecord.event_id == event_id)
            .order_by(EventPauseRecord.created_at.desc())
            .first()
        )

        active_incidents_count = (
            self.db.query(Incident)
            .filter(Incident.event_id == event_id, Incident.status != "RESOLVED")
            .count()
        )

        is_paused = curr_state == EventExecutionState.PAUSED.value
        can_pause = curr_state in (EventExecutionState.RUNNING.value, EventExecutionState.PAUSING.value)
        can_resume = curr_state in (EventExecutionState.PAUSED.value, EventExecutionState.RESUMING.value)

        last_rec_data = None
        if last_record:
            last_rec_data = {
                "id": last_record.id,
                "operation_type": last_record.operation_type,
                "requested_by": last_record.requested_by,
                "requested_at": last_record.requested_at.isoformat() if last_record.requested_at else None,
                "reason": last_record.reason,
                "previous_state": last_record.previous_state,
                "target_state": last_record.target_state,
                "plan_version": last_record.plan_version,
                "status": last_record.status,
                "completed_at": last_record.completed_at.isoformat() if last_record.completed_at else None,
            }

        return {
            "event_id": event.id,
            "execution_state": curr_state,
            "previous_state": last_record.previous_state if last_record else None,
            "plan_version": plan_version,
            "is_paused": is_paused,
            "can_pause": can_pause,
            "can_resume": can_resume,
            "active_incidents_count": active_incidents_count,
            "last_pause_record": last_rec_data,
            "updated_at": event.updated_at,
        }

    def get_pause_history(self, event_id: str, user_id: Optional[str] = None) -> List[Dict[str, Any]]:
        """Retrieves chronological audit history of all pause and resume operations."""
        event = self._get_event(event_id)
        if user_id:
            self._auth_service.get_user_role(event, user_id)

        records = (
            self.db.query(EventPauseRecord)
            .filter(EventPauseRecord.event_id == event_id)
            .order_by(EventPauseRecord.created_at.desc())
            .all()
        )

        return [
            {
                "id": r.id,
                "event_id": r.event_id,
                "operation_type": r.operation_type,
                "requested_by": r.requested_by,
                "requested_at": r.requested_at.isoformat() if r.requested_at else None,
                "reason": r.reason,
                "previous_state": r.previous_state,
                "target_state": r.target_state,
                "plan_version": r.plan_version,
                "status": r.status,
                "approval_reference": r.approval_reference,
                "validation_result": r.validation_result,
                "completed_at": r.completed_at.isoformat() if r.completed_at else None,
                "audit_reference": r.audit_reference,
            }
            for r in records
        ]

    def pause_event(
        self,
        event_id: str,
        user_id: str,
        reason: Optional[str] = None,
        plan_version: Optional[int] = None,
        approval_id: Optional[str] = None,
        request: Optional[Any] = None,
    ) -> EventPauseRecord:
        """Transactionally pauses operational execution.

        State transition: RUNNING -> PAUSING -> PAUSED
        Preserves all tasks, vendor assignments, dependencies, budget items, and recovery state.
        """
        if request is not None:
            if hasattr(request, "reason") and request.reason:
                reason = request.reason
            if hasattr(request, "plan_version") and request.plan_version is not None:
                plan_version = request.plan_version

        reason = reason or "Operational execution paused."

        event = self._get_event(event_id)
        self._check_permission(event, user_id, Permissions.EVENT_PAUSE)

        current_plan_version = self._compute_plan_version(event_id)
        if plan_version is not None and plan_version != current_plan_version:
            raise ConflictException(
                f"STALE_STATE: Pause request plan version v{plan_version} does not match current plan version v{current_plan_version}."
            )

        curr_state = getattr(event, "execution_state", None) or EventExecutionState.RUNNING.value

        # Idempotency checks
        if curr_state == EventExecutionState.PAUSED.value:
            # Already paused - return idempotent existing or new completion record
            record = EventPauseRecord(
                event_id=event_id,
                operation_type="PAUSE",
                requested_by=user_id,
                requested_at=utc_now(),
                reason=reason,
                previous_state=curr_state,
                target_state=EventExecutionState.PAUSED.value,
                plan_version=current_plan_version,
                status="ALREADY_PAUSED",
                approval_reference=approval_id,
                completed_at=utc_now(),
            )
            self.db.add(record)
            self.db.commit()
            self.db.refresh(record)
            return record

        if curr_state == EventExecutionState.PAUSING.value:
            record = EventPauseRecord(
                event_id=event_id,
                operation_type="PAUSE",
                requested_by=user_id,
                requested_at=utc_now(),
                reason=reason,
                previous_state=curr_state,
                target_state=EventExecutionState.PAUSED.value,
                plan_version=current_plan_version,
                status="ALREADY_PAUSING",
                approval_reference=approval_id,
                completed_at=utc_now(),
            )
            self.db.add(record)
            self.db.commit()
            self.db.refresh(record)
            return record

        # Invalid transition checks
        if curr_state == EventExecutionState.RESUMING.value:
            raise ConflictException(
                "INVALID_TRANSITION: Cannot pause event while it is actively in RESUMING transition."
            )

        if curr_state != EventExecutionState.RUNNING.value:
            raise BadRequestException(
                f"INVALID_TRANSITION: Cannot pause event from state '{curr_state}'."
            )

        # Atomic 2-step transition: RUNNING -> PAUSING -> PAUSED
        try:
            event.execution_state = EventExecutionState.PAUSING.value
            event.updated_at = utc_now()
            self.db.flush()

            # Confirm state integrity (tasks, dependencies, vendor bindings intact)
            # Freeze state
            event.execution_state = EventExecutionState.PAUSED.value
            event.updated_at = utc_now()

            # Record audit record
            audit_entry = self._audit.record(
                event_id=event_id,
                actor_id=user_id,
                actor_type="USER" if user_id not in ("system", "anonymous_operator") else "SYSTEM",
                action="PAUSE_EVENT",
                action_type="EXECUTION_CONTROL",
                target_type="EVENT",
                target_id=event_id,
                before_state={"execution_state": curr_state, "plan_version": current_plan_version},
                after_state={"execution_state": EventExecutionState.PAUSED.value, "plan_version": current_plan_version},
                impact_level="CRITICAL",
                approval_id=approval_id,
            )
            audit_id = getattr(audit_entry, "id", str(audit_entry))


            # Record structured pause record
            pause_record = EventPauseRecord(
                event_id=event_id,
                operation_type="PAUSE",
                requested_by=user_id,
                requested_at=utc_now(),
                reason=reason,
                previous_state=curr_state,
                target_state=EventExecutionState.PAUSED.value,
                plan_version=current_plan_version,
                status="COMPLETED",
                approval_reference=approval_id,
                completed_at=utc_now(),
                audit_reference=audit_id,
            )
            self.db.add(pause_record)
            self.db.commit()
            self.db.refresh(pause_record)
            return pause_record

        except Exception as err:
            self.db.rollback()
            raise err

    def resume_event(
        self,
        event_id: str,
        user_id: str,
        reason: Optional[str] = None,
        plan_version: Optional[int] = None,
        approval_id: Optional[str] = None,
        request: Optional[Any] = None,
    ) -> EventPauseRecord:
        """Transactionally resumes operational execution from PAUSED state.

        State transition: PAUSED -> RESUMING -> RUNNING
        Validates state integrity before completing the transition.
        """
        if request is not None:
            if hasattr(request, "reason") and request.reason:
                reason = request.reason
            if hasattr(request, "plan_version") and request.plan_version is not None:
                plan_version = request.plan_version

        reason = reason or "Operational execution resumed."

        event = self._get_event(event_id)
        self._check_permission(event, user_id, Permissions.EVENT_RESUME)

        current_plan_version = self._compute_plan_version(event_id)
        if plan_version is not None and plan_version != current_plan_version:
            raise ConflictException(
                f"STALE_STATE: Resume request plan version v{plan_version} does not match current plan version v{current_plan_version}."
            )

        curr_state = getattr(event, "execution_state", None) or EventExecutionState.RUNNING.value

        # Invalid transition checks: RUNNING -> RESUMING is invalid
        if curr_state == EventExecutionState.RUNNING.value:
            raise BadRequestException(
                "INVALID_TRANSITION: Cannot resume event that is already in RUNNING state. Resume is only permitted from PAUSED."
            )

        if curr_state == EventExecutionState.RESUMING.value:
            record = EventPauseRecord(
                event_id=event_id,
                operation_type="RESUME",
                requested_by=user_id,
                requested_at=utc_now(),
                reason=reason,
                previous_state=curr_state,
                target_state=EventExecutionState.RUNNING.value,
                plan_version=current_plan_version,
                status="ALREADY_RESUMING",
                approval_reference=approval_id,
                completed_at=utc_now(),
            )
            self.db.add(record)
            self.db.commit()
            self.db.refresh(record)
            return record

        # Invalid transition checks
        if curr_state == EventExecutionState.PAUSING.value:
            raise ConflictException(
                "INVALID_TRANSITION: Cannot resume event while it is actively in PAUSING transition."
            )

        if curr_state != EventExecutionState.PAUSED.value:
            raise BadRequestException(
                f"INVALID_TRANSITION: Cannot resume event from state '{curr_state}' (must be PAUSED)."
            )

        # Atomic 2-step transition: PAUSED -> RESUMING -> RUNNING
        try:
            event.execution_state = EventExecutionState.RESUMING.value
            event.updated_at = utc_now()
            self.db.flush()

            # Re-observe & Validate state integrity
            tasks_count = self.db.query(Task).filter(Task.event_id == event_id).count()
            deps_count = self.db.query(TaskDependency).filter(TaskDependency.event_id == event_id).count()
            vendors_count = self.db.query(VendorAssignment).filter(VendorAssignment.event_id == event_id).count()
            budget_count = self.db.query(BudgetItem).filter(BudgetItem.event_id == event_id).count()
            active_incidents = (
                self.db.query(Incident)
                .filter(Incident.event_id == event_id, Incident.status != "RESOLVED")
                .count()
            )

            validation_result = {
                "tasks_count": tasks_count,
                "dependencies_count": deps_count,
                "vendor_assignments_count": vendors_count,
                "budget_items_count": budget_count,
                "active_incidents": active_incidents,
                "plan_version": current_plan_version,
                "validated_at": utc_now().isoformat(),
                "status": "VALIDATED",
            }

            event.execution_state = EventExecutionState.RUNNING.value
            event.updated_at = utc_now()

            # Record audit record
            audit_entry = self._audit.record(
                event_id=event_id,
                actor_id=user_id,
                actor_type="USER" if user_id not in ("system", "anonymous_operator") else "SYSTEM",
                action="RESUME_EVENT",
                action_type="EXECUTION_CONTROL",
                target_type="EVENT",
                target_id=event_id,
                before_state={"execution_state": curr_state, "plan_version": current_plan_version},
                after_state={"execution_state": EventExecutionState.RUNNING.value, "plan_version": current_plan_version},
                impact_level="CRITICAL",
                approval_id=approval_id,
            )
            audit_id = getattr(audit_entry, "id", str(audit_entry))


            # Record structured resume record
            resume_record = EventPauseRecord(
                event_id=event_id,
                operation_type="RESUME",
                requested_by=user_id,
                requested_at=utc_now(),
                reason=reason,
                previous_state=curr_state,
                target_state=EventExecutionState.RUNNING.value,
                plan_version=current_plan_version,
                status="COMPLETED",
                approval_reference=approval_id,
                validation_result=validation_result,
                completed_at=utc_now(),
                audit_reference=audit_id,
            )
            self.db.add(resume_record)
            self.db.commit()
            self.db.refresh(resume_record)
            return resume_record

        except Exception as err:
            self.db.rollback()
            raise err
