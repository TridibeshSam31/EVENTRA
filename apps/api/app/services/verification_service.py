"""Domain Service: VerificationService

Coordinates deterministic post-action verification, updates operational event state,
records immutable audit records, and manages the verification lifecycle.
"""
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from sqlalchemy.orm import Session

from app.core.exceptions import ForbiddenException, NotFoundException
from app.engines.auth.snapshot import compute_event_state_snapshot
from app.engines.verification.types import VerificationContext, VerificationStatus
from app.engines.verification.verifier import VerificationEngine
from app.models.action import ActionExecution
from app.models.budget import BudgetItem
from app.models.constraint import Constraint
from app.models.dependency import TaskDependency
from app.models.event import Event
from app.models.event_member import EventMember
from app.models.incident import Incident
from app.models.objective import Objective
from app.models.recovery import Recovery
from app.models.resource import Resource
from app.models.state_transition import StateTransition
from app.models.task import Task
from app.models.vendor import Vendor
from app.models.vendor_assignment import VendorAssignment
from app.models.venue import Venue
from app.models.verification import VerificationResult
from app.observability.audit import AuditRecorder


def utc_now():
    return datetime.now(timezone.utc).replace(tzinfo=None)


class VerificationService:
    """Authoritative service for post-action and recovery verification."""

    def __init__(self, db: Session):
        self.db = db
        self._engine = VerificationEngine()
        self._audit = AuditRecorder(db)

    def _verify_event_access(self, event_id: str, user_id: str) -> Event:
        event = self.db.query(Event).filter(Event.id == event_id).first()
        if not event:
            raise NotFoundException(f"Event '{event_id}' not found.")

        if user_id in ("anonymous_operator", "system", "SYSTEM"):
            return event

        # Check owner or member
        if event.owner_id == user_id:
            return event

        member = (
            self.db.query(EventMember)
            .filter(EventMember.event_id == event_id, EventMember.user_id == user_id)
            .first()
        )
        if not member:
            raise ForbiddenException(f"User '{user_id}' is not a member of event '{event_id}'.")
        return event

    def verify_action(
        self,
        event_id: str,
        action_execution_id: str,
        current_user_id: str = "anonymous_operator",
    ) -> VerificationResult:
        """Executes comprehensive verification on an executed operational action."""
        event = self._verify_event_access(event_id, current_user_id)

        # 1. Load ActionExecution
        action = (
            self.db.query(ActionExecution)
            .filter(
                (ActionExecution.id == action_execution_id) | (ActionExecution.action_id == action_execution_id),
                ActionExecution.event_id == event_id,
            )
            .first()
        )
        if not action:
            raise NotFoundException(f"ActionExecution '{action_execution_id}' not found for event '{event_id}'.")

        # 2. Load related RecoveryOption and Incident if present
        recovery_opt = None
        if action.recovery_option_id:
            recovery_opt = self.db.query(Recovery).filter(Recovery.id == action.recovery_option_id).first()

        incident = None
        if recovery_opt and recovery_opt.incident_id:
            incident = self.db.query(Incident).filter(Incident.id == recovery_opt.incident_id).first()

        # 3. Load authoritative domain entities
        tasks = self.db.query(Task).filter(Task.event_id == event_id).all()
        dependencies = self.db.query(TaskDependency).filter(TaskDependency.event_id == event_id).all()
        budget_items = self.db.query(BudgetItem).filter(BudgetItem.event_id == event_id).all()
        resources = self.db.query(Resource).filter(Resource.event_id == event_id).all()
        assignments = self.db.query(VendorAssignment).filter(VendorAssignment.event_id == event_id).all()
        providers = self.db.query(Vendor).all()
        venue_id = getattr(event, "venue_id", None)
        venue = self.db.query(Venue).filter(Venue.id == venue_id).first() if venue_id else None
        objectives = self.db.query(Objective).filter(Objective.event_id == event_id).all()
        constraints = self.db.query(Constraint).filter(Constraint.event_id == event_id).all()

        current_snapshot = compute_event_state_snapshot(self.db, event_id)

        # 4. Assemble VerificationContext
        context = VerificationContext(
            event_id=event_id,
            event=event,
            action_execution=action,
            action_type=action.action_type,
            target_type=None,
            target_id=(action.affected_entities[0].get("id") if action.affected_entities else None),
            payload=action.execution_payload or {},
            recovery_option=recovery_opt,
            incident=incident,
            original_impact=(getattr(incident, "impact_result", None) or getattr(incident, "impact_data", None)) if incident else None,
            original_risk=getattr(incident, "risk_result", None) if incident else None,
            tasks=tasks,
            dependencies=dependencies,
            budget_items=budget_items,
            resources=resources,
            providers=providers,
            vendor_assignments=assignments,
            venue=venue,
            objectives=objectives,
            constraints=constraints,
            current_snapshot=current_snapshot,
        )

        # 5. Execute Verification Engine
        res_data = self._engine.verify(context)

        # Check if state changed significantly between execution and verification
        final_status = res_data.status
        if action.after_version and current_snapshot != action.after_version:
            # If current snapshot mutated after execution, mark as STALE
            final_status = VerificationStatus.STALE
            res_data.warnings.append("Event state mutated between action execution and verification.")

        # 6. Apply StateTransition if operational state should transition
        if res_data.event_state_after != event.state and final_status != VerificationStatus.STALE:
            prev_state = event.state
            event.state = res_data.event_state_after
            self.db.add(StateTransition(
                event_id=event_id,
                entity_type="EVENT",
                entity_id=event_id,
                previous_state=prev_state,
                new_state=res_data.event_state_after,
                reason=f"Action verification completed with status: {final_status.value}.",
            ))

        # 7. Persist VerificationResult
        ver = VerificationResult(
            event_id=event_id,
            action_execution_id=action.id,
            recovery_option_id=action.recovery_option_id,
            status=final_status.value,
            intended_outcome=res_data.intended_outcome,
            actual_outcome=res_data.actual_outcome,
            objective_results=res_data.objective_results,
            schedule_result=res_data.schedule_result,
            budget_result=res_data.budget_result,
            resource_result=res_data.resource_result,
            provider_result=res_data.provider_result,
            venue_result=res_data.venue_result,
            constraint_result=res_data.constraint_result,
            risk_before=res_data.risk_before,
            risk_after=res_data.risk_after,
            event_state_before=res_data.event_state_before,
            event_state_after=res_data.event_state_after,
            state_snapshot=current_snapshot,
            failure_reasons=res_data.failure_reasons,
            warnings=res_data.warnings,
            verified_at=utc_now(),
        )
        self.db.add(ver)
        self.db.flush()

        # If fully verified and there was an associated incident, resolve the incident
        if final_status == VerificationStatus.VERIFIED and incident and incident.status != "RESOLVED":
            from app.services.incident_service import IncidentService
            IncidentService(self.db).resolve_incident(
                event_id=event_id,
                incident_id=incident.id,
                resolution_notes=f"Resolved via verified recovery action: {action.action_type}",
                current_user_id=current_user_id,
            )

        # 8. Record Audit Trail
        self._audit.record(
            event_id=event_id,
            action="VERIFY_ACTION",
            action_type="VERIFICATION",
            actor_id=current_user_id,
            target_type="ACTION_EXECUTION",
            target_id=action.id,
            execution_id=action.id,
            verification_id=ver.id,
            after_state={"status": final_status.value, "snapshot": current_snapshot},
            failure_reason=("; ".join(res_data.failure_reasons) if res_data.failure_reasons else None),
        )

        self.db.commit()
        self.db.refresh(ver)
        return ver

    def reverify(
        self,
        event_id: str,
        verification_id: str,
        reason: Optional[str] = None,
        current_user_id: str = "anonymous_operator",
    ) -> VerificationResult:
        """Re-evaluates an existing verification against the latest live state."""
        event = self._verify_event_access(event_id, current_user_id)

        ver = (
            self.db.query(VerificationResult)
            .filter(VerificationResult.id == verification_id, VerificationResult.event_id == event_id)
            .first()
        )
        if not ver:
            raise NotFoundException(f"VerificationResult '{verification_id}' not found for event '{event_id}'.")

        action = None
        if ver.action_execution_id:
            action = self.db.query(ActionExecution).filter(ActionExecution.id == ver.action_execution_id).first()

        recovery_opt = None
        if ver.recovery_option_id:
            recovery_opt = self.db.query(Recovery).filter(Recovery.id == ver.recovery_option_id).first()

        incident = None
        if recovery_opt and recovery_opt.incident_id:
            incident = self.db.query(Incident).filter(Incident.id == recovery_opt.incident_id).first()

        tasks = self.db.query(Task).filter(Task.event_id == event_id).all()
        dependencies = self.db.query(TaskDependency).filter(TaskDependency.event_id == event_id).all()
        budget_items = self.db.query(BudgetItem).filter(BudgetItem.event_id == event_id).all()
        resources = self.db.query(Resource).filter(Resource.event_id == event_id).all()
        assignments = self.db.query(VendorAssignment).filter(VendorAssignment.event_id == event_id).all()
        providers = self.db.query(Vendor).all()
        venue_id = getattr(event, "venue_id", None)
        venue = self.db.query(Venue).filter(Venue.id == venue_id).first() if venue_id else None
        objectives = self.db.query(Objective).filter(Objective.event_id == event_id).all()
        constraints = self.db.query(Constraint).filter(Constraint.event_id == event_id).all()

        current_snapshot = compute_event_state_snapshot(self.db, event_id)

        context = VerificationContext(
            event_id=event_id,
            event=event,
            action_execution=action,
            action_type=(action.action_type if action else "UNKNOWN"),
            target_type=None,
            target_id=None,
            payload=(action.execution_payload if action else {}),
            recovery_option=recovery_opt,
            incident=incident,
            tasks=tasks,
            dependencies=dependencies,
            budget_items=budget_items,
            resources=resources,
            providers=providers,
            vendor_assignments=assignments,
            venue=venue,
            objectives=objectives,
            constraints=constraints,
            current_snapshot=current_snapshot,
        )

        res_data = self._engine.verify(context)

        # Update event state if needed
        if res_data.event_state_after != event.state:
            prev_state = event.state
            event.state = res_data.event_state_after
            self.db.add(StateTransition(
                event_id=event_id,
                entity_type="EVENT",
                entity_id=event_id,
                previous_state=prev_state,
                new_state=res_data.event_state_after,
                reason=f"Re-verification ({reason or 'Scheduled re-evaluation'}): State transitioned.",
            ))

        ver.status = res_data.status.value
        ver.actual_outcome = res_data.actual_outcome
        ver.objective_results = res_data.objective_results
        ver.schedule_result = res_data.schedule_result
        ver.budget_result = res_data.budget_result
        ver.resource_result = res_data.resource_result
        ver.provider_result = res_data.provider_result
        ver.constraint_result = res_data.constraint_result
        ver.risk_after = res_data.risk_after
        ver.event_state_after = res_data.event_state_after
        ver.state_snapshot = current_snapshot
        ver.failure_reasons = res_data.failure_reasons
        ver.warnings = res_data.warnings
        ver.verified_at = utc_now()

        # Record Audit
        self._audit.record(
            event_id=event_id,
            action="REVERIFY_ACTION",
            action_type="VERIFICATION",
            actor_id=current_user_id,
            verification_id=ver.id,
            after_state={"status": res_data.status.value, "reason": reason},
            failure_reason=("; ".join(res_data.failure_reasons) if res_data.failure_reasons else None),
        )

        self.db.commit()
        self.db.refresh(ver)
        return ver

    def get_verification(
        self, event_id: str, verification_id: str, current_user_id: str = "anonymous_operator"
    ) -> VerificationResult:
        self._verify_event_access(event_id, current_user_id)
        ver = (
            self.db.query(VerificationResult)
            .filter(VerificationResult.id == verification_id, VerificationResult.event_id == event_id)
            .first()
        )
        if not ver:
            raise NotFoundException(f"VerificationResult '{verification_id}' not found for event '{event_id}'.")
        return ver

    def list_verifications(
        self,
        event_id: str,
        current_user_id: str = "anonymous_operator",
        status: Optional[str] = None,
    ) -> List[VerificationResult]:
        self._verify_event_access(event_id, current_user_id)
        query = self.db.query(VerificationResult).filter(VerificationResult.event_id == event_id)
        if status:
            query = query.filter(VerificationResult.status == status)
        return query.order_by(VerificationResult.verified_at.desc()).all()
