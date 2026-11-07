"""Domain Service: IncidentService

Coordinates incident lifecycle: ingestion, entity validation, event-scoped authorization,
deterministic impact analysis, risk evaluation, and authoritative event state transitions.
"""
from app.services.live_events import publish
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple
from sqlalchemy.orm import Session

from app.models.event import Event
from app.models.event_member import EventMember
from app.models.incident import Incident
from app.models.task import Task
from app.models.dependency import TaskDependency
from app.models.vendor import Vendor
from app.models.vendor_assignment import VendorAssignment
from app.models.resource import Resource
from app.models.venue import Venue
from app.models.budget import BudgetItem
from app.models.objective import Objective
from app.models.constraint import Constraint
from app.models.state_transition import StateTransition
from app.models.enums import (
    EventState,
    EventLifecycleState,
    IncidentStatus,
    IncidentSeverity,
)
from app.engines.impact.analyzer import ImpactAnalyzer
from app.engines.risk.calculator import RiskCalculator
from app.schemas.incident import IncidentCreate, IncidentUpdate
from app.core.exceptions import (
    NotFoundException,
    BadRequestException,
    ForbiddenException,
)


def utc_now():
    return datetime.now(timezone.utc).replace(tzinfo=None)


class IncidentService:
    """Authoritative service for incident detection, impact analysis, and risk evaluation."""

    def __init__(self, db: Session):
        self.db = db
        self._impact_analyzer = ImpactAnalyzer()
        self._risk_calculator = RiskCalculator()

    def create_incident(
        self,
        event_id: str,
        data: IncidentCreate,
        current_user_id: str = "anonymous_operator",
    ) -> Incident:
        """Ingest, normalize, analyze impact, calculate risk, and transition event state."""
        event = self._get_event(event_id)
        self._check_authorization(event, current_user_id)
        self._validate_operational_entities(event_id, data)

        incident = Incident(
            event_id=event_id,
            incident_type=data.incident_type.value if hasattr(data.incident_type, "value") else str(data.incident_type),
            severity=data.severity.value if hasattr(data.severity, "value") else str(data.severity),
            title=data.title.strip(),
            description=data.description.strip() if data.description else None,
            source=data.source.strip() if data.source else "MANUAL",
            detected_at=utc_now(),
            occurred_at=data.occurred_at,
            related_task_id=data.related_task_id,
            related_vendor_id=data.related_vendor_id,
            related_resource_id=data.related_resource_id,
            related_venue_id=data.related_venue_id,
            status=IncidentStatus.OPEN.value,
            evidence_metadata=data.evidence_metadata or {},
        )
        self.db.add(incident)
        self.db.flush()

        # Run Deterministic Pipeline: Impact Analysis
        impact_result = self._run_impact_analysis(event, incident)
        incident.impact_result = impact_result
        if impact_result.get("severity"):
            incident.severity = impact_result["severity"]

        # Run Deterministic Pipeline: Risk Engine
        risk_result = self._run_risk_calculation(event, incident, impact_result)
        incident.risk_result = risk_result

        # Update Event State through authoritative StateTransition
        self._apply_event_state_transitions(event, incident, risk_result)

        self.db.commit()
        self.db.refresh(incident)
        publish(event_id, "incident.created", incident_id=incident.id)
        return incident

    def get_incident(
        self,
        event_id: str,
        incident_id: str,
        current_user_id: str = "anonymous_operator",
    ) -> Incident:
        """Retrieve single incident record."""
        event = self._get_event(event_id)
        self._check_authorization(event, current_user_id)

        incident = self.db.query(Incident).filter(
            Incident.id == incident_id,
            Incident.event_id == event_id,
        ).first()
        if not incident:
            raise NotFoundException(f"Incident '{incident_id}' not found for event '{event_id}'.")
        return incident

    def list_incidents(
        self,
        event_id: str,
        status: Optional[str] = None,
        incident_type: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
        current_user_id: str = "anonymous_operator",
    ) -> Tuple[List[Incident], int]:
        """List incidents for an event with deterministic pagination and ordering."""
        event = self._get_event(event_id)
        self._check_authorization(event, current_user_id)

        query = self.db.query(Incident).filter(Incident.event_id == event_id)
        if status:
            query = query.filter(Incident.status == status.strip().upper())
        if incident_type:
            query = query.filter(Incident.incident_type == incident_type.strip().upper())

        total = query.count()
        items = (
            query.order_by(Incident.created_at.desc(), Incident.id.asc())
            .offset(offset)
            .limit(limit)
            .all()
        )
        return items, total

    def recalculate_incident(
        self,
        event_id: str,
        incident_id: str,
        current_user_id: str = "anonymous_operator",
    ) -> Incident:
        """Deterministic re-evaluation of impact and risk against current live state."""
        event = self._get_event(event_id)
        self._check_authorization(event, current_user_id)
        incident = self.get_incident(event_id, incident_id, current_user_id)

        # Recalculate impact & risk
        impact_result = self._run_impact_analysis(event, incident)
        incident.impact_result = impact_result
        if impact_result.get("severity"):
            incident.severity = impact_result["severity"]

        risk_result = self._run_risk_calculation(event, incident, impact_result)
        incident.risk_result = risk_result

        # Update event state
        self._apply_event_state_transitions(event, incident, risk_result)

        self.db.commit()
        self.db.refresh(incident)
        publish(event_id, "incident.updated", incident_id=incident.id)
        return incident

    def resolve_incident(
        self,
        event_id: str,
        incident_id: str,
        resolution_notes: Optional[str] = None,
        current_user_id: str = "anonymous_operator",
    ) -> Incident:
        """Resolve incident, re-evaluate remaining active incidents, and restore state if clear."""
        event = self._get_event(event_id)
        self._check_authorization(event, current_user_id)
        incident = self.get_incident(event_id, incident_id, current_user_id)

        if incident.status == IncidentStatus.RESOLVED.value:
            return incident

        previous_status = incident.status
        incident.status = IncidentStatus.RESOLVED.value
        incident.resolution_notes = resolution_notes.strip() if resolution_notes else None
        incident.resolved_at = utc_now()

        # Check for remaining unresolved incidents
        remaining_active = self.db.query(Incident).filter(
            Incident.event_id == event_id,
            Incident.id != incident_id,
            Incident.status.in_([IncidentStatus.OPEN.value, IncidentStatus.INVESTIGATING.value, IncidentStatus.ACKNOWLEDGED.value]),
        ).all()

        if not remaining_active:
            # If no active incidents remain, de-escalate event state to NORMAL
            if event.state != EventState.NORMAL.value:
                old_state = event.state
                event.state = EventState.NORMAL.value
                self._record_transition(
                    event_id=event.id,
                    entity_type="EVENT",
                    entity_id=event.id,
                    previous_state=old_state,
                    new_state=event.state,
                    reason=f"Incident '{incident.title}' resolved; all active incidents cleared",
                )

            # If event lifecycle was in INCIDENT / EMERGENCY, restore to LIVE
            if event.lifecycle_state in (EventLifecycleState.INCIDENT.value, EventLifecycleState.EMERGENCY.value):
                old_lc = event.lifecycle_state
                event.lifecycle_state = EventLifecycleState.LIVE.value
                self._record_transition(
                    event_id=event.id,
                    entity_type="EVENT_LIFECYCLE",
                    entity_id=event.id,
                    previous_state=old_lc,
                    new_state=event.lifecycle_state,
                    reason="All operational incidents resolved; restored to LIVE",
                )
        else:
            # Recalculate highest risk from remaining active incidents
            highest_risk_state = EventState.NORMAL.value
            for act_inc in remaining_active:
                if act_inc.risk_result and act_inc.risk_result.get("target_event_state"):
                    target = act_inc.risk_result["target_event_state"]
                    # Priority order: EMERGENCY > CRITICAL > AT_RISK > NORMAL
                    if target == EventState.EMERGENCY.value:
                        highest_risk_state = EventState.EMERGENCY.value
                        break
                    elif target == EventState.CRITICAL.value and highest_risk_state != EventState.EMERGENCY.value:
                        highest_risk_state = EventState.CRITICAL.value
                    elif target == EventState.AT_RISK.value and highest_risk_state == EventState.NORMAL.value:
                        highest_risk_state = EventState.AT_RISK.value

            if event.state != highest_risk_state:
                old_state = event.state
                event.state = highest_risk_state
                self._record_transition(
                    event_id=event.id,
                    entity_type="EVENT",
                    entity_id=event.id,
                    previous_state=old_state,
                    new_state=event.state,
                    reason=f"Incident '{incident.title}' resolved; adjusted state to reflect remaining active incidents",
                )

        self.db.commit()
        self.db.refresh(incident)
        publish(event_id, "incident.resolved", incident_id=incident.id)
        return incident

    # --- Private Helpers ---

    def _get_event(self, event_id: str) -> Event:
        event = self.db.query(Event).filter(Event.id == event_id).first()
        if not event:
            raise NotFoundException(f"Event with id '{event_id}' not found.")
        return event

    def _check_authorization(self, event: Event, user_id: str) -> None:
        """Enforces event-scoped membership/ownership access."""
        if not user_id or user_id in ("anonymous_operator", "system"):
            return

        if event.owner_id == user_id:
            return

        member = self.db.query(EventMember).filter(
            EventMember.event_id == event.id,
            EventMember.user_id == user_id,
        ).first()
        if not member:
            raise ForbiddenException(f"User '{user_id}' is not an authorized member of event '{event.id}'.")

    def _validate_operational_entities(self, event_id: str, data: IncidentCreate) -> None:
        """Ensure all referenced tasks, vendors, resources, and venues exist and belong to the event."""
        if data.related_task_id:
            task = self.db.query(Task).filter(
                Task.id == data.related_task_id,
                Task.event_id == event_id,
            ).first()
            if not task:
                raise BadRequestException(f"Referenced task '{data.related_task_id}' does not belong to event '{event_id}'.")

        if data.related_vendor_id:
            vendor = self.db.query(Vendor).filter(Vendor.id == data.related_vendor_id).first()
            if not vendor:
                raise BadRequestException(f"Referenced vendor '{data.related_vendor_id}' not found.")

        if data.related_resource_id:
            resource = self.db.query(Resource).filter(
                Resource.id == data.related_resource_id,
                Resource.event_id == event_id,
            ).first()
            if not resource:
                raise BadRequestException(f"Referenced resource '{data.related_resource_id}' does not belong to event '{event_id}'.")

        if data.related_venue_id:
            venue = self.db.query(Venue).filter(Venue.id == data.related_venue_id).first()
            if not venue:
                raise BadRequestException(f"Referenced venue '{data.related_venue_id}' not found.")

    def _run_impact_analysis(self, event: Event, incident: Incident) -> Dict[str, Any]:
        """Load operational event state and execute pure deterministic ImpactAnalyzer."""
        tasks = self.db.query(Task).filter(Task.event_id == event.id).all()
        task_ids = [t.id for t in tasks]
        dependencies = (
            self.db.query(TaskDependency)
            .filter(TaskDependency.predecessor_task_id.in_(task_ids))
            .all()
        ) if task_ids else []
        resources = self.db.query(Resource).filter(Resource.event_id == event.id).all()
        vendor_assignments = self.db.query(VendorAssignment).filter(VendorAssignment.event_id == event.id).all()
        budget_items = self.db.query(BudgetItem).filter(BudgetItem.event_id == event.id).all()
        objectives = self.db.query(Objective).filter(Objective.event_id == event.id).all()
        constraints = self.db.query(Constraint).filter(Constraint.event_id == event.id).all()

        return self._impact_analyzer.analyze(
            incident=incident,
            tasks=tasks,
            dependencies=dependencies,
            resources=resources,
            vendor_assignments=vendor_assignments,
            budget_items=budget_items,
            objectives=objectives,
            constraints=constraints,
            event=event,
        )

    def _run_risk_calculation(
        self,
        event: Event,
        incident: Incident,
        impact_result: Dict[str, Any],
    ) -> Dict[str, Any]:
        """Execute pure deterministic RiskCalculator."""
        alt_providers_count = 0
        if incident.related_vendor_id:
            vendor = self.db.query(Vendor).filter(Vendor.id == incident.related_vendor_id).first()
            if vendor and vendor.category:
                alt_providers_count = self.db.query(Vendor).filter(
                    Vendor.category == vendor.category,
                    Vendor.id != vendor.id,
                    Vendor.status == "ACTIVE",
                ).count()

        return self._risk_calculator.calculate(
            incident=incident,
            impact_result=impact_result,
            event=event,
            alternative_providers_count=alt_providers_count,
        )

    def _apply_event_state_transitions(
        self,
        event: Event,
        incident: Incident,
        risk_result: Dict[str, Any],
    ) -> None:
        """Authoritatively update event state and lifecycle through StateTransition records."""
        target_state = risk_result.get("target_event_state", EventState.NORMAL.value)
        risk_level = risk_result.get("level", IncidentSeverity.MEDIUM.value)

        # Update event operational risk state
        if event.state != target_state:
            previous_state = event.state
            event.state = target_state
            self._record_transition(
                event_id=event.id,
                entity_type="EVENT",
                entity_id=event.id,
                previous_state=previous_state,
                new_state=event.state,
                reason=f"Incident '{incident.title}' evaluated at risk level {risk_level}",
            )

        # Escalate lifecycle state if in LIVE and high/critical risk
        if event.lifecycle_state == EventLifecycleState.LIVE.value and risk_level in (IncidentSeverity.HIGH.value, IncidentSeverity.CRITICAL.value):
            target_lc = (
                EventLifecycleState.EMERGENCY.value
                if risk_level == IncidentSeverity.CRITICAL.value
                else EventLifecycleState.INCIDENT.value
            )
            prev_lc = event.lifecycle_state
            event.lifecycle_state = target_lc
            self._record_transition(
                event_id=event.id,
                entity_type="EVENT_LIFECYCLE",
                entity_id=event.id,
                previous_state=prev_lc,
                new_state=event.lifecycle_state,
                reason=f"Operational escalation: {risk_level} risk from incident '{incident.title}'",
            )

    def _record_transition(
        self,
        event_id: str,
        entity_type: str,
        entity_id: str,
        previous_state: str,
        new_state: str,
        reason: str,
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
