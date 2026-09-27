"""API Routes: Event Conversational Intake & Autonomous Operations

Provides REST endpoints for natural language event intake, missing information detection,
conversational plan modification, and 'Start Operations' autonomous execution.
"""
from typing import Any, Dict, Optional
from fastapi import APIRouter, Depends, HTTPException, status, BackgroundTasks
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.dependencies import get_db_session, get_current_user_id
from app.services.intake_service import IntakeService
from app.services.autonomous_operations_service import AutonomousOperationsService
from app.services.negotiation_service import NegotiationService
from app.core.exceptions import NotFoundException, BadRequestException

router = APIRouter(prefix="/events", tags=["Event Intake & Autonomous Operations"])


# ---------------------------------------------------------------------------
# Request Schemas
# ---------------------------------------------------------------------------

class IntakeRequest(BaseModel):
    message: str = Field(..., description="Natural language description of the event or organizer intent.")
    event_id: Optional[str] = Field(None, description="Optional existing event ID if continuing a session.")
    force_plan: bool = Field(False, description="If true, generates plan immediately with sensible defaults.")


class ModifyPlanRequest(BaseModel):
    modification: str = Field(..., description="Natural language modification (e.g. 'Remove photography and add security', 'Increase budget to 10 lakh').")


class ProviderQuoteRequest(BaseModel):
    amount: float = Field(..., gt=0, description="Quoted amount received from provider.")
    notes: Optional[str] = Field(None, description="Optional quote notes or terms.")


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/intake", status_code=status.HTTP_200_OK)
def process_intake(
    req: IntakeRequest,
    db: Session = Depends(get_db_session),
) -> Dict[str, Any]:
    """Process natural language organizer input.
    
    Extracts intent, detects missing information, prompts conversationally,
    or generates the full authoritative operational plan.
    """
    service = IntakeService(db)
    try:
        result = service.process_intake(
            message=req.message,
            event_id=req.event_id,
            force_plan=req.force_plan,
        )
        return result
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to process event intake: {str(exc)}",
        )


@router.post("/{event_id}/modify-plan", status_code=status.HTTP_200_OK)
def modify_plan(
    event_id: str,
    req: ModifyPlanRequest,
    db: Session = Depends(get_db_session),
) -> Dict[str, Any]:
    """Modifies an existing event plan via natural language and regenerates tasks and dependencies."""
    service = IntakeService(db)
    try:
        result = service.modify_plan(event_id=event_id, modification_text=req.modification)
        return result
    except NotFoundException as nfe:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(nfe))
    except ValueError as ve:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(ve))
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to modify plan: {str(exc)}",
        )


@router.post("/{event_id}/start-operations", status_code=status.HTTP_200_OK)
def start_operations(
    event_id: str,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user_id),
) -> Dict[str, Any]:
    """Transitions event to LIVE and initiates autonomous operations & discovery in background.
    (Decision 1: start_operations must not run discovery synchronously in the request)
    """
    service = AutonomousOperationsService(db)
    try:
        init_result = service.initiate_operations_run(event_id=event_id, user_id=current_user_id)
        background_tasks.add_task(
            AutonomousOperationsService.run_background_operations,
            event_id=event_id,
            run_id=init_result.get("run_id"),
            user_id=current_user_id,
        )
        return init_result
    except NotFoundException as nfe:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(nfe))
    except BadRequestException as bre:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(bre))
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to start operations: {str(exc)}",
        )


@router.get("/{event_id}/operations/status", status_code=status.HTTP_200_OK)
def get_operations_status(
    event_id: str,
    db: Session = Depends(get_db_session),
) -> Dict[str, Any]:
    """Retrieves live operations telemetry, sourcing progress, budget allocation, and pending approvals."""
    service = AutonomousOperationsService(db)
    try:
        result = service.get_operations_status(event_id=event_id)
        return result
    except NotFoundException as nfe:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(nfe))
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to fetch operations status: {str(exc)}",
        )


@router.post("/{event_id}/providers/{vendor_id}/quote", status_code=status.HTTP_200_OK)
def handle_provider_quote(
    event_id: str,
    vendor_id: str,
    req: ProviderQuoteRequest,
    db: Session = Depends(get_db_session),
) -> Dict[str, Any]:
    """Processes a provider quote, performs budget validation, and triggers counter-offer or approval gate."""
    service = NegotiationService(db)
    try:
        # Find assignment for provider
        assignment = service.find_active_assignment(vendor_id=vendor_id, event_id=event_id)
        if not assignment:
            assignment = db.query(VendorAssignment).filter(
                VendorAssignment.event_id == event_id,
                VendorAssignment.vendor_id == vendor_id,
            ).first()

        if not assignment:
            raise NotFoundException(f"No assignment found for vendor '{vendor_id}' in event '{event_id}'")

        result = service.process_quote(
            assignment_id=assignment.id,
            quoted_amount=req.amount,
            notes=req.notes,
        )
        return result
    except NotFoundException as nfe:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(nfe))
    except BadRequestException as bre:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(bre))
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to process quote: {str(exc)}",
        )


class RecoveryApproveRequest(BaseModel):
    approval_id: str = Field(..., description="Approval request ID to authorize and execute.")


@router.post("/{event_id}/incidents/simulate-cancellation", status_code=status.HTTP_200_OK)
def simulate_cancellation_incident(
    event_id: str,
    db: Session = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user_id),
) -> Dict[str, Any]:
    """Simulates a sudden catering provider cancellation incident, triggers impact analysis,
    and synthesizes recovery alternatives with an approval request (Competition Scenario).
    """
    service = AutonomousOperationsService(db)
    try:
        result = service.simulate_caterer_cancellation(event_id=event_id, user_id=current_user_id)
        return result
    except NotFoundException as nfe:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(nfe))
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to simulate incident: {str(exc)}",
        )


@router.post("/{event_id}/recovery/approve", status_code=status.HTTP_200_OK)
def approve_recovery_action(
    event_id: str,
    req: RecoveryApproveRequest,
    db: Session = Depends(get_db_session),
    current_user_id: str = Depends(get_current_user_id),
) -> Dict[str, Any]:
    """Authorizes and executes an approved recovery substitution, verifies post-mutation state,
    unblocks the affected task, and restores the event state to LIVE/NORMAL.
    """
    service = AutonomousOperationsService(db)
    try:
        result = service.approve_and_execute_recovery(
            event_id=event_id,
            approval_id=req.approval_id,
            user_id=current_user_id,
        )
        return result
    except NotFoundException as nfe:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(nfe))
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to execute recovery approval: {str(exc)}",
        )

