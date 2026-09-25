"""Deterministic Backend Tools for the Event Operations Agent.

Each tool wraps an existing Phase 1–10 deterministic service.
The agent MUST NOT calculate authoritative operational values itself.
All facts, validations, authorizations, and executions are delegated here.
"""
from typing import Any, Dict, List, Optional
from decimal import Decimal
from sqlalchemy.orm import Session

from app.core.exceptions import NotFoundException, ForbiddenException, BadRequestException
from app.models.event import Event
from app.models.incident import Incident
from app.models.task import Task
from app.models.budget import BudgetItem
from app.models.objective import Objective
from app.models.recovery import Recovery
from app.models.approval import Approval
from app.models.action import ActionExecution
from app.models.verification import VerificationResult
from app.schemas.approval import ApprovalRequestCreate
from app.services.incident_service import IncidentService
from app.services.recovery_service import RecoveryService
from app.services.authorization_service import AuthorizationService
from app.services.approval_service import ApprovalService
from app.services.action_service import ActionService
from app.services.verification_service import VerificationService
from app.observability.decision_trace import DecisionTraceService


def get_event_state(db: Session, event_id: str) -> Dict[str, Any]:
    """Retrieves authoritative current event state and operational telemetry."""
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise NotFoundException(f"Event with id '{event_id}' not found.")

    tasks = db.query(Task).filter(Task.event_id == event_id).all()
    budget_items = db.query(BudgetItem).filter(BudgetItem.event_id == event_id).all()
    objectives = db.query(Objective).filter(Objective.event_id == event_id).all()
    open_incidents = (
        db.query(Incident)
        .filter(Incident.event_id == event_id, Incident.status != "RESOLVED")
        .all()
    )

    total_act = sum((b.actual_amount for b in budget_items), Decimal("0.00"))
    critical_tasks = [t for t in tasks if t.is_critical_path]
    blocked_tasks = [t for t in tasks if t.status == "BLOCKED"]

    return {
        "event_id": event.id,
        "name": event.name,
        "lifecycle_state": event.lifecycle_state,
        "state": event.state,
        "total_budget": float(event.total_budget or 0),
        "budget_spent": float(total_act),
        "budget_remaining": float((event.total_budget or Decimal("0.00")) - total_act),
        "task_counts": {
            "total": len(tasks),
            "critical_path": len(critical_tasks),
            "blocked": len(blocked_tasks),
        },
        "objectives_count": len(objectives),
        "open_incidents_count": len(open_incidents),
        "execution_state": getattr(event, "execution_state", None) or "RUNNING",
    }


def get_incidents(db: Session, event_id: str) -> List[Dict[str, Any]]:
    """Retrieves all active open incidents for an event."""
    incidents = (
        db.query(Incident)
        .filter(Incident.event_id == event_id, Incident.status != "RESOLVED")
        .order_by(Incident.detected_at.desc())
        .all()
    )
    return [
        {
            "id": inc.id,
            "title": inc.title,
            "incident_type": inc.incident_type,
            "severity": inc.severity,
            "status": inc.status,
            "related_task_id": inc.related_task_id,
            "related_vendor_id": inc.related_vendor_id,
            "impact_result": inc.impact_result,
            "risk_result": inc.risk_result,
            "detected_at": inc.detected_at.isoformat() if inc.detected_at else None,
        }
        for inc in incidents
    ]


def get_incident_details(db: Session, event_id: str, incident_id: str) -> Dict[str, Any]:
    """Retrieves full details for a specific incident."""
    inc = (
        db.query(Incident)
        .filter(Incident.id == incident_id, Incident.event_id == event_id)
        .first()
    )
    if not inc:
        raise NotFoundException(f"Incident '{incident_id}' not found for event '{event_id}'.")

    return {
        "id": inc.id,
        "title": inc.title,
        "incident_type": inc.incident_type,
        "severity": inc.severity,
        "status": inc.status,
        "related_task_id": inc.related_task_id,
        "related_vendor_id": inc.related_vendor_id,
        "impact_result": inc.impact_result,
        "risk_result": inc.risk_result,
        "detected_at": inc.detected_at.isoformat() if inc.detected_at else None,
    }


def analyze_impact(db: Session, event_id: str, incident_id: str) -> Dict[str, Any]:
    """Runs deterministic impact traversal via IncidentService / ImpactAnalyzer."""
    inc = (
        db.query(Incident)
        .filter(Incident.id == incident_id, Incident.event_id == event_id)
        .first()
    )
    if not inc:
        raise NotFoundException(f"Incident '{incident_id}' not found.")

    if inc.impact_result:
        return inc.impact_result

    service = IncidentService(db)
    event = service._get_event(event_id)
    impact_result = service._run_impact_analysis(event, inc)
    inc.impact_result = impact_result
    db.commit()
    db.refresh(inc)
    return impact_result


def calculate_risk(db: Session, event_id: str, incident_id: str) -> Dict[str, Any]:
    """Runs deterministic operational risk calculation via IncidentService / RiskCalculator."""
    inc = (
        db.query(Incident)
        .filter(Incident.id == incident_id, Incident.event_id == event_id)
        .first()
    )
    if not inc:
        raise NotFoundException(f"Incident '{incident_id}' not found.")

    if inc.risk_result:
        return inc.risk_result

    service = IncidentService(db)
    event = service._get_event(event_id)
    impact_result = inc.impact_result or service._run_impact_analysis(event, inc)
    risk_result = service._run_risk_calculation(event, inc, impact_result)
    inc.risk_result = risk_result
    db.commit()
    db.refresh(inc)
    return risk_result


def generate_recovery_options(
    db: Session,
    event_id: str,
    incident_id: str,
    user_id: str = "anonymous_operator",
) -> List[Dict[str, Any]]:
    """Calls Phase 8 RecoveryEngine to generate and validate candidate recovery options."""
    inc = db.query(Incident).filter(Incident.id == incident_id, Incident.event_id == event_id).first()
    if inc:
        if not inc.impact_result:
            analyze_impact(db, event_id, incident_id)
        if not inc.risk_result:
            calculate_risk(db, event_id, incident_id)

    recovery_service = RecoveryService(db)
    options = recovery_service.generate_recovery_options(event_id, incident_id, user_id)
    return [
        {
            "id": opt.id,
            "strategy_type": opt.strategy_type,
            "status": opt.status,
            "is_feasible": opt.is_feasible,
            "score": float(opt.score or 0.0),
            "rank": opt.rank,
            "proposed_changes": opt.proposed_changes,
            "feasibility_result": opt.feasibility_result,
            "affected_tasks": opt.affected_tasks,
            "affected_providers": opt.affected_providers,
            "budget_delta": opt.budget_delta,
            "schedule_delta": opt.schedule_delta,
            "risk_after": opt.risk_after,
        }
        for opt in options
    ]


def validate_recovery_option(
    db: Session,
    event_id: str,
    incident_id: str,
    option_id: str,
    user_id: str = "anonymous_operator",
) -> Dict[str, Any]:
    """Retrieves deterministic feasibility and validation report for a recovery option."""
    opt = db.query(Recovery).filter(Recovery.id == option_id, Recovery.event_id == event_id).first()
    if not opt:
        raise NotFoundException(f"Recovery option '{option_id}' not found for event '{event_id}'.")
    return {
        "id": opt.id,
        "is_feasible": opt.is_feasible,
        "status": opt.status,
        "feasibility_result": opt.feasibility_result,
        "strategy_type": opt.strategy_type,
    }


def check_action_authorization(
    db: Session,
    event_id: str,
    user_id: str,
    action_type: str,
    target_type: str,
    target_id: Optional[str] = None,
    payload: Optional[Dict[str, Any]] = None,
    recovery_option_id: Optional[str] = None,
) -> Dict[str, Any]:
    """Evaluates Phase 9 Authorization policy to check permissions and approval requirement."""
    auth_service = AuthorizationService(db)
    decision = auth_service.authorize_action(
        event_id=event_id,
        user_id=user_id,
        action_type=action_type,
        target_type=target_type,
        target_id=target_id,
        payload=payload or {},
        recovery_option_id=recovery_option_id,
    )
    return {
        "allowed": decision.allowed,
        "requires_approval": decision.requires_approval,
        "impact_level": decision.impact_level,
        "reason": decision.reason,
        "action_type": decision.action_type,
    }


def request_action_approval(
    db: Session,
    event_id: str,
    user_id: str,
    action_type: str,
    target_type: str,
    target_id: Optional[str] = None,
    requested_action: Optional[Dict[str, Any]] = None,
    recovery_option_id: Optional[str] = None,
    notes: Optional[str] = None,
) -> Dict[str, Any]:
    """Creates an immutable, snapshot-anchored ApprovalRequest through Phase 9 ApprovalService."""
    approval_service = ApprovalService(db)
    req_data = ApprovalRequestCreate(
        action_type=action_type,
        target_type=target_type,
        target_id=target_id,
        requested_action=requested_action or {},
        recovery_option_id=recovery_option_id,
        notes=notes,
    )
    approval = approval_service.create_request(event_id, user_id, req_data)
    return {
        "id": approval.id,
        "status": approval.status,
        "impact_level": approval.impact_level,
        "action_type": approval.action_type,
        "created_at": approval.created_at.isoformat() if approval.created_at else None,
    }


def check_approval_status(
    db: Session,
    approval_id: str,
) -> Dict[str, Any]:
    """Authoritatively checks approval state directly against PostgreSQL database."""
    appr = db.query(Approval).filter(Approval.id == approval_id).first()
    if not appr:
        raise NotFoundException(f"Approval request '{approval_id}' not found.")

    return {
        "id": appr.id,
        "status": appr.status,
        "is_approved": appr.status == "APPROVED",
        "action_type": appr.action_type,
        "target_type": appr.target_type,
        "target_id": appr.target_id,
        "recovery_option_id": appr.recovery_option_id,
        "requested_action": appr.requested_action,
        "approver_id": appr.approver_id,
        "decided_at": appr.decided_at.isoformat() if appr.decided_at else None,
    }


def execute_action(
    db: Session,
    event_id: str,
    user_id: str,
    recovery_option_id: str,
    action_id: Optional[str] = None,
    approval_request_id: Optional[str] = None,
) -> Dict[str, Any]:
    """Executes an authorized/approved operational recovery option via Phase 9 ActionService."""
    action_service = ActionService(db)
    execution = action_service.execute_recovery_option(
        event_id=event_id,
        executor_id=user_id,
        recovery_option_id=recovery_option_id,
        action_id=action_id,
    )
    if approval_request_id and not execution.approval_request_id:
        execution.approval_request_id = approval_request_id
        db.commit()

    return {
        "id": execution.id,
        "action_id": execution.action_id,
        "action_type": execution.action_type,
        "status": execution.status,
        "affected_entities": execution.affected_entities,
        "executed_at": execution.executed_at.isoformat() if execution.executed_at else None,
    }


def verify_action(
    db: Session,
    event_id: str,
    action_execution_id: str,
    user_id: str = "anonymous_operator",
) -> Dict[str, Any]:
    """Executes multi-domain verification through Phase 10 VerificationService."""
    verification_service = VerificationService(db)
    result = verification_service.verify_action(
        event_id=event_id,
        action_execution_id=action_execution_id,
        current_user_id=user_id,
    )
    return {
        "id": result.id,
        "status": result.status,
        "event_state_after": result.event_state_after,
        "event_state_before": result.event_state_before,
        "risk_before": result.risk_before,
        "risk_after": result.risk_after,
        "failure_reasons": result.failure_reasons,
        "warnings": result.warnings,
        "verified_at": result.verified_at.isoformat() if result.verified_at else None,
    }


def get_decision_trace(
    db: Session,
    event_id: str,
    verification_id: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    """Retrieves factual, structured decision trace through Phase 10 DecisionTraceService."""
    dt_service = DecisionTraceService(db)
    if verification_id:
        return dt_service.get_trace_by_verification_id(event_id, verification_id)
    traces = dt_service.get_traces_for_event(event_id, limit=1)
    return traces[0] if traces else None


def start_autonomous_operations(
    db: Session,
    event_id: str,
    user_id: str = "anonymous_operator",
) -> Dict[str, Any]:
    """Executes full autonomous sourcing, provider engagement, and live transition."""
    from app.services.autonomous_operations_service import AutonomousOperationsService
    service = AutonomousOperationsService(db)
    return service.start_operations(event_id=event_id, user_id=user_id)


def modify_event_plan(
    db: Session,
    event_id: str,
    modification: str,
    user_id: str = "anonymous_operator",
) -> Dict[str, Any]:
    """Modifies event requirements/parameters and regenerates operational plan."""
    from app.services.intake_service import IntakeService
    service = IntakeService(db)
    return service.modify_plan(event_id=event_id, modification_text=modification, user_id=user_id)


def pause_event(
    db: Session,
    event_id: str,
    reason: str,
    user_id: str = "anonymous_operator",
    plan_version: Optional[int] = None,
    approval_id: Optional[str] = None,
) -> Dict[str, Any]:
    """Transactionally pauses operational execution of an event (Task 11)."""
    from app.services.pause_resume_service import PauseResumeService
    service = PauseResumeService(db)
    rec = service.pause_event(
        event_id=event_id,
        user_id=user_id,
        reason=reason,
        plan_version=plan_version,
        approval_id=approval_id,
    )
    return {
        "id": rec.id,
        "event_id": rec.event_id,
        "operation_type": rec.operation_type,
        "previous_state": rec.previous_state,
        "target_state": rec.target_state,
        "plan_version": rec.plan_version,
        "status": rec.status,
        "completed_at": rec.completed_at.isoformat() if rec.completed_at else None,
    }


def resume_event(
    db: Session,
    event_id: str,
    user_id: str = "anonymous_operator",
    reason: Optional[str] = None,
    plan_version: Optional[int] = None,
    approval_id: Optional[str] = None,
) -> Dict[str, Any]:
    """Transactionally resumes operational execution of an event (Task 11)."""
    from app.services.pause_resume_service import PauseResumeService
    service = PauseResumeService(db)
    rec = service.resume_event(
        event_id=event_id,
        user_id=user_id,
        reason=reason,
        plan_version=plan_version,
        approval_id=approval_id,
    )
    return {
        "id": rec.id,
        "event_id": rec.event_id,
        "operation_type": rec.operation_type,
        "previous_state": rec.previous_state,
        "target_state": rec.target_state,
        "plan_version": rec.plan_version,
        "status": rec.status,
        "validation_result": rec.validation_result,
        "completed_at": rec.completed_at.isoformat() if rec.completed_at else None,
    }


def get_execution_state(
    db: Session,
    event_id: str,
    user_id: Optional[str] = None,
) -> Dict[str, Any]:
    """Retrieves authoritative current execution state for an event."""
    from app.services.pause_resume_service import PauseResumeService
    service = PauseResumeService(db)
    return service.get_execution_state(event_id=event_id, user_id=user_id)


