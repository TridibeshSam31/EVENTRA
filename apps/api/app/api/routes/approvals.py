from typing import Optional
from fastapi import APIRouter, Depends, Query, status, BackgroundTasks
from sqlalchemy.orm import Session

from app.api.dependencies import get_db_session, get_current_user_id
from app.services.approval_service import ApprovalService
from app.agent.triggers import trigger_agent_run
from app.schemas.approval import (
    ApprovalRequestCreate,
    ApprovalDecisionRequest,
    ApprovalRejectionRequest,
    ApprovalRequestResponse,
    ApprovalRequestListResponse,
)
from app.schemas.action import ActionExecutionResponse

router = APIRouter(prefix="/events", tags=["approvals"])


@router.post(
    "/{event_id}/approvals",
    response_model=ApprovalRequestResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_approval_request(
    event_id: str,
    payload: ApprovalRequestCreate,
    db: Session = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user_id),
) -> ApprovalRequestResponse:
    """Submit an operational action for formal approval review."""
    service = ApprovalService(db)
    approval = service.create_request(event_id, current_user_id, payload)
    return ApprovalRequestResponse.model_validate(approval)


@router.get(
    "/{event_id}/approvals",
    response_model=ApprovalRequestListResponse,
)
def list_approval_requests(
    event_id: str,
    status: Optional[str] = Query(None, description="Filter by status (PENDING, APPROVED, REJECTED, CANCELLED)"),
    requester_id: Optional[str] = Query(None, description="Filter by requester user ID"),
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user_id),
) -> ApprovalRequestListResponse:
    """Lists approval requests for an event with deterministic pagination."""
    service = ApprovalService(db)
    items, total = service.list_requests(
        event_id=event_id,
        status=status,
        requester_id=requester_id,
        limit=limit,
        offset=offset,
        current_user_id=current_user_id,
    )
    return ApprovalRequestListResponse(
        total=total,
        items=[ApprovalRequestResponse.model_validate(item) for item in items],
        limit=limit,
        offset=offset,
    )


@router.get(
    "/{event_id}/approvals/{approval_id}",
    response_model=ApprovalRequestResponse,
)
def get_approval_request(
    event_id: str,
    approval_id: str,
    db: Session = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user_id),
) -> ApprovalRequestResponse:
    """Retrieves a single approval request with current decision status."""
    service = ApprovalService(db)
    approval = service.get_request(event_id, approval_id, current_user_id)
    return ApprovalRequestResponse.model_validate(approval)


@router.post(
    "/{event_id}/approvals/{approval_id}/approve",
    response_model=ApprovalRequestResponse,
)
def approve_request(
    event_id: str,
    approval_id: str,
    background_tasks: BackgroundTasks,
    payload: ApprovalDecisionRequest = ApprovalDecisionRequest(),
    db: Session = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user_id),
) -> ApprovalRequestResponse:
    """Approves a request, enforces separation of duties, revalidates state freshness, and executes mutation."""
    service = ApprovalService(db)
    approval, _ = service.approve(
        event_id=event_id,
        approval_id=approval_id,
        approver_id=current_user_id,
        decision_notes=payload.decision_notes,
    )
    background_tasks.add_task(
        trigger_agent_run,
        event_id=event_id,
        message=f"Approval granted for request {approval_id}. Resume action execution and verification.",
        user_id=current_user_id,
        approval_id=approval_id,
    )
    return ApprovalRequestResponse.model_validate(approval)


@router.post(
    "/{event_id}/approvals/{approval_id}/reject",
    response_model=ApprovalRequestResponse,
)
def reject_request(
    event_id: str,
    approval_id: str,
    payload: ApprovalRejectionRequest,
    db: Session = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user_id),
) -> ApprovalRequestResponse:
    """Rejects an approval request with mandatory reason."""
    service = ApprovalService(db)
    approval = service.reject(
        event_id=event_id,
        approval_id=approval_id,
        approver_id=current_user_id,
        reason=payload.reason,
    )
    return ApprovalRequestResponse.model_validate(approval)


@router.post(
    "/{event_id}/approvals/{approval_id}/cancel",
    response_model=ApprovalRequestResponse,
)
def cancel_request(
    event_id: str,
    approval_id: str,
    payload: ApprovalRejectionRequest = ApprovalRejectionRequest(reason="Cancelled by requester"),
    db: Session = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user_id),
) -> ApprovalRequestResponse:
    """Cancels a pending approval request."""
    service = ApprovalService(db)
    approval = service.cancel(
        event_id=event_id,
        approval_id=approval_id,
        requester_id=current_user_id,
        reason=payload.reason,
    )
    return ApprovalRequestResponse.model_validate(approval)
