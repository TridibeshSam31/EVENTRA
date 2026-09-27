"""Inspection and recalculation APIs for non-executing recovery options."""
from fastapi import APIRouter, Depends, status, BackgroundTasks
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user_id, get_db_session
from app.schemas.recovery import RecoveryOptionListResponse, RecoveryOptionResponse
from app.services.recovery_service import RecoveryService
from app.agent.triggers import trigger_agent_run

router = APIRouter(prefix="/events", tags=["recovery"])


def _response(option):
    data = RecoveryOptionResponse.model_validate(option).model_dump()
    data["is_stale"] = getattr(option, "_is_stale", option.status == "STALE")
    return RecoveryOptionResponse(**data)


@router.post("/{event_id}/incidents/{incident_id}/recovery/options", response_model=RecoveryOptionListResponse, status_code=status.HTTP_201_CREATED)
def generate_options(event_id: str, incident_id: str, db: Session = Depends(get_db_session), current_user_id: str = Depends(get_current_user_id)):
    service = RecoveryService(db)
    options = service.generate_recovery_options(event_id, incident_id, current_user_id)
    snapshot = options[0].state_snapshot if options else service._build_context(event_id, incident_id, current_user_id).snapshot_version
    return RecoveryOptionListResponse(incident_id=incident_id, state_snapshot=snapshot, items=[_response(item) for item in options])


@router.get("/{event_id}/incidents/{incident_id}/recovery/options", response_model=RecoveryOptionListResponse)
def list_options(event_id: str, incident_id: str, db: Session = Depends(get_db_session), current_user_id: str = Depends(get_current_user_id)):
    service = RecoveryService(db)
    options = service.list_recovery_options(event_id, incident_id, current_user_id)
    snapshot = service._build_context(event_id, incident_id, current_user_id).snapshot_version
    return RecoveryOptionListResponse(incident_id=incident_id, state_snapshot=snapshot, items=[_response(item) for item in options])


@router.post("/{event_id}/incidents/{incident_id}/recovery/recalculate", response_model=RecoveryOptionListResponse)
def recalculate_options(event_id: str, incident_id: str, db: Session = Depends(get_db_session), current_user_id: str = Depends(get_current_user_id)):
    service = RecoveryService(db)
    options = service.recalculate_options(event_id, incident_id, current_user_id)
    snapshot = options[0].state_snapshot if options else service._build_context(event_id, incident_id, current_user_id).snapshot_version
    return RecoveryOptionListResponse(incident_id=incident_id, state_snapshot=snapshot, items=[_response(item) for item in options])


@router.get("/{event_id}/incidents/{incident_id}/recovery/options/{option_id}", response_model=RecoveryOptionResponse)
def get_option(event_id: str, incident_id: str, option_id: str, db: Session = Depends(get_db_session), current_user_id: str = Depends(get_current_user_id)):
    return _response(RecoveryService(db).get_recovery_option(event_id, incident_id, option_id, current_user_id))


@router.post("/{event_id}/incidents/{incident_id}/recovery/execute", status_code=status.HTTP_200_OK)
def execute_incident_recovery(
    event_id: str,
    incident_id: str,
    recovery_option_id: str,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user_id),
):
    """Executes a recovery option through ActionService and triggers VerificationService."""
    from app.services.action_service import ActionService
    from app.services.verification_service import VerificationService

    action_service = ActionService(db)
    execution = action_service.execute_recovery_option(
        event_id=event_id,
        executor_id=current_user_id,
        recovery_option_id=recovery_option_id,
    )
    ver_service = VerificationService(db)
    verification = ver_service.verify_action(
        event_id=event_id,
        action_execution_id=execution.id,
        current_user_id=current_user_id,
    )
    background_tasks.add_task(
        trigger_agent_run,
        event_id=event_id,
        message=f"Recovery option {recovery_option_id} executed for incident {incident_id}. Verify resolution and continue operational monitoring.",
        user_id=current_user_id,
    )
    return {
        "execution_id": execution.id,
        "action_id": execution.action_id,
        "status": execution.status,
        "action_type": execution.action_type,
        "verification_id": verification.id,
        "verification_status": verification.status,
        "is_verified": verification.status == "VERIFIED",
    }


@router.get("/{event_id}/incidents/{incident_id}/recovery/trace", status_code=status.HTTP_200_OK)
def get_incident_recovery_trace(
    event_id: str,
    incident_id: str,
    db: Session = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user_id),
):
    """Retrieves the factual structured decision trace for an incident's recovery."""
    from app.observability.decision_trace import DecisionTraceService
    service = DecisionTraceService(db)
    trace = service.get_trace_by_incident_id(event_id=event_id, incident_id=incident_id)
    return trace or {}


@router.get("/{event_id}/incidents/{incident_id}/recovery/verification", status_code=status.HTTP_200_OK)
def get_incident_recovery_verification(
    event_id: str,
    incident_id: str,
    db: Session = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user_id),
):
    """Authoritative endpoint to query current recovery execution and verification lifecycle state (B2)."""
    from app.models.recovery import Recovery
    from app.models.action import ActionExecution
    from app.models.verification import VerificationResult
    from app.core.exceptions import NotFoundException

    # Find recovery options for this incident
    options = db.query(Recovery).filter(
        Recovery.event_id == event_id,
        Recovery.incident_id == incident_id,
    ).all()
    if not options:
        raise NotFoundException(f"No recovery options found for incident '{incident_id}'.")

    option_ids = [opt.id for opt in options]

    # Find latest verification result for any of these options
    latest_verification = (
        db.query(VerificationResult)
        .filter(
            VerificationResult.event_id == event_id,
            VerificationResult.recovery_option_id.in_(option_ids),
        )
        .order_by(VerificationResult.verified_at.desc())
        .first()
    )

    # Find latest action execution
    latest_execution = (
        db.query(ActionExecution)
        .filter(
            ActionExecution.event_id == event_id,
            ActionExecution.recovery_option_id.in_(option_ids),
        )
        .order_by(ActionExecution.executed_at.desc())
        .first()
    )

    if latest_verification:
        is_verified = latest_verification.status == "VERIFIED"
        lifecycle_state = "VERIFIED" if is_verified else ("VERIFICATION_FAILED" if latest_verification.status == "FAILED" else latest_verification.status)
        return {
            "incident_id": incident_id,
            "has_execution": True,
            "execution_id": latest_verification.action_execution_id,
            "execution_status": latest_execution.status if latest_execution else "UNKNOWN",
            "verification_id": latest_verification.id,
            "verification_status": latest_verification.status,
            "is_verified": is_verified,
            "lifecycle_state": lifecycle_state,
            "actual_outcome": latest_verification.actual_outcome,
            "failure_reasons": latest_verification.failure_reasons or [],
            "warnings": latest_verification.warnings or [],
            "verified_at": latest_verification.verified_at.isoformat() if latest_verification.verified_at else None,
        }

    if latest_execution:
        return {
            "incident_id": incident_id,
            "has_execution": True,
            "execution_id": latest_execution.id,
            "execution_status": latest_execution.status,
            "verification_id": None,
            "verification_status": "PENDING",
            "is_verified": False,
            "lifecycle_state": "EXECUTED",
            "failure_reasons": [],
            "warnings": ["Verification pending or in progress"],
            "verified_at": None,
        }

    has_approval_required = any(opt.requires_approval for opt in options)
    return {
        "incident_id": incident_id,
        "has_execution": False,
        "execution_id": None,
        "execution_status": None,
        "verification_id": None,
        "verification_status": "UNVERIFIED",
        "is_verified": False,
        "lifecycle_state": "APPROVAL_REQUIRED" if has_approval_required else "PROPOSED",
        "failure_reasons": [],
        "warnings": [],
        "verified_at": None,
    }


@router.post("/{event_id}/incidents/{incident_id}/recovery/verify", status_code=status.HTTP_200_OK)
def trigger_incident_recovery_verification(
    event_id: str,
    incident_id: str,
    db: Session = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user_id),
):
    """Explicitly executes authoritative post-action verification on an executed recovery action (B2)."""
    from app.models.recovery import Recovery
    from app.models.action import ActionExecution
    from app.services.verification_service import VerificationService
    from app.core.exceptions import NotFoundException, BadRequestException

    options = db.query(Recovery).filter(
        Recovery.event_id == event_id,
        Recovery.incident_id == incident_id,
    ).all()
    if not options:
        raise NotFoundException(f"No recovery options found for incident '{incident_id}'.")

    option_ids = [opt.id for opt in options]

    latest_execution = (
        db.query(ActionExecution)
        .filter(
            ActionExecution.event_id == event_id,
            ActionExecution.recovery_option_id.in_(option_ids),
        )
        .order_by(ActionExecution.executed_at.desc())
        .first()
    )
    if not latest_execution:
        raise BadRequestException(f"No executed recovery action found to verify for incident '{incident_id}'.")

    ver_service = VerificationService(db)
    verification = ver_service.verify_action(
        event_id=event_id,
        action_execution_id=latest_execution.id,
        current_user_id=current_user_id,
    )
    return {
        "execution_id": latest_execution.id,
        "verification_id": verification.id,
        "verification_status": verification.status,
        "is_verified": verification.status == "VERIFIED",
        "lifecycle_state": "VERIFIED" if verification.status == "VERIFIED" else "VERIFICATION_FAILED",
        "verified_at": verification.verified_at.isoformat() if verification.verified_at else None,
    }
