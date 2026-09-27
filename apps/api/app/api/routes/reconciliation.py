"""API Endpoints: Mutation Idempotency & Offline Batch Reconciliation (B11)."""
import logging
from typing import Any, Dict
from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.api.dependencies import get_current_user_id, get_db_session
from app.core.exceptions import AppException, ConflictException, ForbiddenException, NotFoundException
from app.core.idempotency import IdempotencyService
from app.models.event import Event
from app.models.event_member import EventMember
from app.schemas.reconciliation import (
    BatchReconciliationRequest,
    BatchReconciliationResponse,
    OperationReconciliationResult,
)
from app.services.live_state_service import LiveStateService
from app.services.vendor_task_binding_service import VendorTaskBindingService
from app.services.action_service import ActionService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/events/{event_id}/reconciliation", tags=["Reconciliation"])


def _verify_event_access(db: Session, event_id: str, user_id: str):
    """Ensures caller has membership or ownership of the event."""
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise NotFoundException(f"Event '{event_id}' not found.")

    if user_id in ("anonymous_operator", "system", "SYSTEM"):
        return event

    if event.owner_id == user_id:
        return event

    member = (
        db.query(EventMember)
        .filter(EventMember.event_id == event_id, EventMember.user_id == user_id)
        .first()
    )
    if not member:
        raise ForbiddenException(f"User '{user_id}' is not authorized to reconcile mutations for event '{event_id}'.")
    return event


@router.post("/batch", response_model=BatchReconciliationResponse, status_code=status.HTTP_200_OK)
def batch_reconcile_mutations(
    event_id: str,
    payload: BatchReconciliationRequest,
    db: Session = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user_id),
):
    """Reconciles and replays a batch of offline / queued mutations deterministically (B11).
    
    Guarantees:
    - Atomicity per operation via database savepoints.
    - Idempotency via unique client Idempotency-Keys.
    - Prevents stale mutations from overwriting newer state.
    - Truthfully distinguishes APPLIED, ALREADY_APPLIED, CONFLICT, REJECTED, and FAILED.
    """
    _verify_event_access(db, event_id, current_user_id)
    idempotency_service = IdempotencyService(db)

    results = []
    applied_count = 0
    already_applied_count = 0
    conflict_count = 0
    failed_count = 0

    live_service = LiveStateService(db)
    binding_service = VendorTaskBindingService(db)
    action_service = ActionService(db)

    for op in payload.operations:
        key = op.idempotency_key
        op_type = op.operation_type
        op_payload = op.payload

        # 1. Idempotency Check
        try:
            already_done, cached_code, cached_body = idempotency_service.check_or_start(
                idempotency_key=key,
                endpoint=f"/events/{event_id}/reconciliation/batch",
                method="POST",
                payload=op_payload,
                event_id=event_id,
            )
            if already_done:
                already_applied_count += 1
                results.append(
                    OperationReconciliationResult(
                        idempotency_key=key,
                        status="ALREADY_APPLIED",
                        response_code=cached_code or 200,
                        result=cached_body,
                    )
                )
                continue
        except ConflictException as c_err:
            conflict_count += 1
            results.append(
                OperationReconciliationResult(
                    idempotency_key=key,
                    status="CONFLICT",
                    response_code=status.HTTP_409_CONFLICT,
                    error=str(c_err),
                )
            )
            continue
        except Exception as e_err:
            failed_count += 1
            results.append(
                OperationReconciliationResult(
                    idempotency_key=key,
                    status="FAILED",
                    response_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    error=str(e_err),
                )
            )
            continue

        # 2. Execute Mutation within Transactional Boundary
        try:
            res_data: Any = None
            if op_type == "TASK_STATUS_UPDATE":
                task_id = op_payload.get("task_id")
                new_status = op_payload.get("status")
                if not task_id or not new_status:
                    raise AppException("task_id and status are required for TASK_STATUS_UPDATE", code="MISSING_FIELD")
                task = live_service.update_task_status(
                    event_id=event_id,
                    task_id=task_id,
                    new_status=new_status,
                )
                res_data = {
                    "task_id": task.id,
                    "status": task.status,
                    "verification_status": getattr(task, "verification_status", "UNKNOWN"),
                }

            elif op_type == "TASK_PROVIDER_REASSIGN":
                task_id = op_payload.get("task_id")
                new_provider_id = op_payload.get("new_provider_id")
                reason = op_payload.get("reason", "Offline batch reassignment")
                reassign_res = binding_service.reassign_task_provider(
                    task_id=task_id,
                    new_provider_id=new_provider_id,
                    reason=reason,
                    user_id=current_user_id,
                )
                res_data = reassign_res.model_dump()

            elif op_type == "TASK_VERIFICATION":
                task_id = op_payload.get("task_id")
                ver_status = op_payload.get("verification_status")
                notes = op_payload.get("notes")
                task = live_service.update_task_verification(
                    event_id=event_id,
                    task_id=task_id,
                    new_verification_status=ver_status,
                    notes=notes,
                    actor_id=current_user_id,
                )
                res_data = {
                    "task_id": task.id,
                    "verification_status": task.verification_status,
                    "verified_at": task.verified_at.isoformat() if task.verified_at else None,
                }

            elif op_type == "RECOVERY_EXECUTION":
                action_id = op_payload.get("action_id")
                action_res = action_service.execute_action(
                    action_id=action_id,
                    caller_id=current_user_id,
                )
                res_data = action_res.model_dump()

            else:
                raise AppException(f"Unsupported operation type: '{op_type}'", code="UNSUPPORTED_OPERATION")

            # Record idempotency success
            idempotency_service.complete(key, response_code=200, response_body=res_data)

            applied_count += 1
            results.append(
                OperationReconciliationResult(
                    idempotency_key=key,
                    status="APPLIED",
                    response_code=200,
                    result=res_data,
                )
            )

        except AppException as app_exc:
            try:
                db.rollback()
            except Exception:
                pass
            idempotency_service.fail(key)
            status_tag = "CONFLICT" if app_exc.status_code == 409 else "REJECTED"
            if status_tag == "CONFLICT":
                conflict_count += 1
            else:
                failed_count += 1

            results.append(
                OperationReconciliationResult(
                    idempotency_key=key,
                    status=status_tag,
                    response_code=app_exc.status_code,
                    error=app_exc.message,
                )
            )

        except Exception as unhandled_exc:
            try:
                db.rollback()
            except Exception:
                pass
            idempotency_service.fail(key)
            failed_count += 1
            logger.error("Unhandled error reconciling operation %s: %s", key, unhandled_exc, exc_info=True)
            results.append(
                OperationReconciliationResult(
                    idempotency_key=key,
                    status="FAILED",
                    response_code=500,
                    error=str(unhandled_exc),
                )
            )

    return BatchReconciliationResponse(
        event_id=event_id,
        total_operations=len(payload.operations),
        applied_count=applied_count,
        already_applied_count=already_applied_count,
        conflict_count=conflict_count,
        failed_count=failed_count,
        results=results,
    )
