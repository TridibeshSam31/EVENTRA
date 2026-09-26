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
