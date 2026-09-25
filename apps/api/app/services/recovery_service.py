"""Read-mostly orchestration for deterministic recovery-option snapshots."""
import hashlib
import json
from typing import List

from sqlalchemy.orm import Session, selectinload

from app.core.exceptions import BadRequestException, ForbiddenException, NotFoundException
from app.engines.recovery.generator import RecoveryGenerator
from app.engines.recovery.scorer import RecoveryScorer
from app.engines.recovery.simulator import RecoverySimulator
from app.engines.recovery.types import RecoveryContext
from app.engines.recovery.validator import RecoveryValidator
from app.models.budget import BudgetItem
from app.models.constraint import Constraint
from app.models.dependency import TaskDependency
from app.models.event import Event
from app.models.event_member import EventMember
from app.models.incident import Incident
from app.models.objective import Objective
from app.models.recovery import Recovery
from app.models.resource import Resource
from app.models.task import Task
from app.models.vendor import Vendor
from app.models.vendor_assignment import VendorAssignment
from app.models.venue import Venue
from app.services.live_state_service import LiveStateService
from app.services.final_execution_plan_service import FinalExecutionPlanService


class RecoveryService:
    """Generate options only; this service contains no approval or action pathway."""

    def __init__(self, db: Session):
        self.db = db
        self._generator = RecoveryGenerator()
        self._simulator = RecoverySimulator()
        self._validator = RecoveryValidator()
        self._scorer = RecoveryScorer()

    def generate_recovery_options(self, event_id: str, incident_id: str, current_user_id: str = "anonymous_operator") -> List[Recovery]:
        context = self._build_context(event_id, incident_id, current_user_id)
        # Task 9 owns the authoritative operational version.  A recovery option is
        # bound to that version so it cannot be applied to a newer execution plan.
        execution_plan = FinalExecutionPlanService(self.db).compile_plan(
            event_id=event_id, user_id=current_user_id
        )
        self.db.query(Recovery).filter(Recovery.event_id == event_id, Recovery.incident_id == incident_id, Recovery.status != "STALE").update({Recovery.status: "STALE"}, synchronize_session=False)
        pending: List[Recovery] = []
        for candidate in self._generator.generate_candidates(context):
            simulation = self._simulator.simulate(candidate, context)
            validation = self._validator.validate(simulation, context)
            record = Recovery(
                event_id=event_id, incident_id=incident_id, strategy_type=candidate.strategy_type,
                status="FEASIBLE" if validation.feasible else "INFEASIBLE", is_feasible=validation.feasible,
                state_snapshot=context.snapshot_version, affected_tasks=candidate.affected_task_ids,
                affected_providers=candidate.affected_provider_ids, affected_resources=candidate.affected_resource_ids,
                proposed_changes=candidate.proposed_changes, schedule_delta=simulation.schedule_delta,
                budget_delta=simulation.budget_delta, resource_delta=simulation.resource_delta,
                provider_delta=simulation.provider_delta, objective_delta=simulation.objective_delta,
                constraint_impact=simulation.constraint_impact, risk_before=context.risk_result,
                risk_after=simulation.risk_after,
                feasibility_result={"feasible": validation.feasible, "violations": validation.violations,
                                    "warnings": validation.warnings,
                                    "plan_version": execution_plan.plan_version,
                                    "validation_timestamp": validation.validation_timestamp.isoformat()},
            )
            if validation.feasible:
                record.score = self._scorer.score(simulation, context)
            pending.append(record)
            self.db.add(record)
        self.db.flush()
        for index, record in enumerate(sorted((r for r in pending if r.is_feasible), key=lambda r: (-r.score, r.strategy_type, r.id)), start=1):
            record.rank = index
        self.db.commit()
        return self._ordered_options(event_id, incident_id)

    def recalculate_options(self, event_id: str, incident_id: str, current_user_id: str = "anonymous_operator") -> List[Recovery]:
        return self.generate_recovery_options(event_id, incident_id, current_user_id)

    def list_recovery_options(self, event_id: str, incident_id: str, current_user_id: str = "anonymous_operator") -> List[Recovery]:
        context = self._build_context(event_id, incident_id, current_user_id)
        options = self._ordered_options(event_id, incident_id)
        for option in options:
            option._is_stale = option.status == "STALE" or option.state_snapshot != context.snapshot_version
        return options

    def get_recovery_option(self, event_id: str, incident_id: str, option_id: str, current_user_id: str = "anonymous_operator") -> Recovery:
        options = self.list_recovery_options(event_id, incident_id, current_user_id)
        option = next((item for item in options if item.id == option_id), None)
        if not option:
            raise NotFoundException(f"Recovery option '{option_id}' not found for incident '{incident_id}'.")
        return option

    def _build_context(self, event_id: str, incident_id: str, current_user_id: str) -> RecoveryContext:
        event = self.db.query(Event).filter(Event.id == event_id).first()
        if not event:
            raise NotFoundException(f"Event with id '{event_id}' not found.")
        self._check_authorization(event, current_user_id)
        incident = self.db.query(Incident).filter(Incident.id == incident_id, Incident.event_id == event_id).first()
        if not incident:
            raise NotFoundException(f"Incident '{incident_id}' not found for event '{event_id}'.")
        if not event.start_datetime or not event.end_datetime:
            raise BadRequestException("Recovery generation requires event start_datetime and end_datetime.")
        if not incident.impact_result or not incident.risk_result:
            raise BadRequestException("Recovery generation requires deterministic impact and risk results.")
        tasks = self.db.query(Task).filter(Task.event_id == event_id).order_by(Task.id).all()
        dependencies = self.db.query(TaskDependency).filter(TaskDependency.event_id == event_id).order_by(TaskDependency.id).all()
        resources = self.db.query(Resource).filter(Resource.event_id == event_id).order_by(Resource.id).all()
        assignments = self.db.query(VendorAssignment).filter(VendorAssignment.event_id == event_id).order_by(VendorAssignment.id).all()
        providers = self.db.query(Vendor).options(selectinload(Vendor.availabilities)).order_by(Vendor.id).all()
        budget_items = self.db.query(BudgetItem).filter(BudgetItem.event_id == event_id).order_by(BudgetItem.id).all()
        objectives = self.db.query(Objective).filter(Objective.event_id == event_id).order_by(Objective.id).all()
        constraints = self.db.query(Constraint).filter(Constraint.event_id == event_id).order_by(Constraint.id).all()
        snapshot = self._snapshot(event, incident, tasks, dependencies, resources, assignments, providers, budget_items, objectives, constraints)
        live = LiveStateService(self.db).get_live_state(event_id).model_dump(mode="json")
        return RecoveryContext(event, incident, incident.impact_result, incident.risk_result, tasks, dependencies,
                               budget_items, resources, providers, assignments,
                               self.db.query(Venue).filter(Venue.id == incident.related_venue_id).first() if incident.related_venue_id else None,
                               objectives, constraints,
                               live, snapshot)

    @staticmethod
    def _snapshot(event, incident, tasks, dependencies, resources, assignments, providers, budget_items, objectives, constraints) -> str:
        records = [event, incident, *tasks, *dependencies, *resources, *assignments, *providers, *budget_items, *objectives, *constraints]
        availability_records = [availability for provider in providers for availability in provider.availabilities]
        payload = [(type(record).__name__, str(getattr(record, "id", "")), str(getattr(record, "updated_at", "")), str(getattr(record, "status", "")), str(getattr(record, "planned_start", "")), str(getattr(record, "planned_end", "")), str(getattr(record, "actual_end", ""))) for record in [*records, *availability_records]]
        return hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()

    def _ordered_options(self, event_id: str, incident_id: str) -> List[Recovery]:
        return self.db.query(Recovery).filter(Recovery.event_id == event_id, Recovery.incident_id == incident_id).order_by(Recovery.generated_at.desc(), Recovery.is_feasible.desc(), Recovery.rank.asc().nullslast(), Recovery.id.asc()).all()

    def _check_authorization(self, event: Event, user_id: str) -> None:
        if not user_id or user_id in {"anonymous_operator", "system"} or event.owner_id == user_id:
            return
        member = self.db.query(EventMember).filter(EventMember.event_id == event.id, EventMember.user_id == user_id).first()
        if not member:
            raise ForbiddenException(f"User '{user_id}' is not an authorized member of event '{event.id}'.")
