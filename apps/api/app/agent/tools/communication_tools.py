"""Deterministic Backend Tools for Provider Communication & Negotiation.

Wraps NegotiationService and ProviderCommunicationService.
All authoritative business logic, budget checks, and approvals are executed deterministically.
"""
from typing import Any, Dict, Optional
from sqlalchemy.orm import Session


def contact_provider(
    db: Session,
    event_id: str,
    assignment_id: str,
    target_amount: Optional[float] = None,
    max_approved_amount: Optional[float] = None,
    currency: str = "INR",
    required_coverage_start: Optional[str] = None,
    required_coverage_end: Optional[str] = None,
) -> Dict[str, Any]:
    """Initiates contact with a provider for an event assignment."""
    from app.services.negotiation_service import NegotiationService
    service = NegotiationService(db)
    return service.initiate_engagement(
        event_id=event_id,
        assignment_id=assignment_id,
        target_amount=target_amount,
        max_approved_amount=max_approved_amount,
        currency=currency,
        required_coverage_start=required_coverage_start,
        required_coverage_end=required_coverage_end,
    )


def negotiate_with_provider(
    db: Session,
    assignment_id: str,
) -> Dict[str, Any]:
    """Generates and dispatches a deterministic counter-offer towards target amount."""
    from app.services.negotiation_service import NegotiationService
    service = NegotiationService(db)
    return service.negotiate(assignment_id=assignment_id)


def request_provider_approval(
    db: Session,
    event_id: str,
    assignment_id: str,
) -> Dict[str, Any]:
    """Creates a human approval request for a negotiated provider agreement."""
    from app.services.negotiation_service import NegotiationService
    service = NegotiationService(db)
    return service.request_approval(event_id=event_id, assignment_id=assignment_id)


def confirm_provider_engagement(
    db: Session,
    assignment_id: str,
) -> Dict[str, Any]:
    """Confirms the provider assignment once human approval has been granted."""
    from app.services.negotiation_service import NegotiationService
    service = NegotiationService(db)
    return service.confirm_engagement(assignment_id=assignment_id)


def simulate_provider_response(
    db: Session,
    assignment_id: str,
    scenario: str,
    quoted_amount: Optional[float] = None,
    coverage_start: Optional[str] = None,
    coverage_end: Optional[str] = None,
    advance_required: Optional[bool] = None,
    provider_count: Optional[int] = None,
    custom_message: Optional[str] = None,
) -> Dict[str, Any]:
    """Simulates provider incoming communication for interactive testing and demonstration."""
    from app.services.negotiation_service import NegotiationService
    service = NegotiationService(db)
    return service.simulate_response(
        assignment_id=assignment_id,
        scenario=scenario,
        quoted_amount=quoted_amount,
        coverage_start=coverage_start,
        coverage_end=coverage_end,
        advance_required=advance_required,
        provider_count=provider_count,
        custom_message=custom_message,
    )


def get_provider_negotiation_history(
    db: Session,
    assignment_id: str,
) -> Dict[str, Any]:
    """Fetches full communication thread and negotiation state for an assignment."""
    from app.services.negotiation_service import NegotiationService
    service = NegotiationService(db)
    return service.get_conversation(assignment_id=assignment_id)


def get_negotiation_constraints(
    db: Session,
    session_id: str,
    event_id: str,
    provider_id: str,
    task_id: Optional[str] = None,
) -> Dict[str, Any]:
    """Exposes sanitized authorized negotiation constraints for a voice call.
    
    Guarantees: Never exposes internal budget, margins, competitor quotes, or ceiling limits.
    """
    from app.services.voice_negotiation_service import VoiceNegotiationService
    service = VoiceNegotiationService(db)
    ctx = service.build_negotiation_context(
        event_id=event_id,
        provider_id=provider_id,
        task_id=task_id,
        session_id=session_id,
    )
    sanitized = service.get_sanitized_constraints_for_gemini(ctx)
    return sanitized.model_dump()


def submit_vendor_negotiation_response(
    db: Session,
    session_id: str,
    event_id: str,
    provider_id: str,
    response_data: Dict[str, Any],
    task_id: Optional[str] = None,
    authorizing_user_id: Optional[str] = None,
) -> Dict[str, Any]:
    """Deterministically evaluates untrusted vendor claims from voice conversation against EVENTRA authority."""
    from app.services.voice_negotiation_service import VoiceNegotiationService
    from app.schemas.voice_negotiation import StructuredNegotiationResult
    service = VoiceNegotiationService(db)
    ctx = service.build_negotiation_context(
        event_id=event_id,
        provider_id=provider_id,
        task_id=task_id,
        session_id=session_id,
    )
    parsed_response = StructuredNegotiationResult(**response_data)
    decision = service.evaluate_vendor_response(
        context=ctx,
        response=parsed_response,
        authorizing_user_id=authorizing_user_id,
    )
    return decision.model_dump()


def request_negotiation_approval(
    db: Session,
    session_id: str,
    event_id: str,
    assignment_id: str,
    user_id: str = "anonymous_operator",
) -> Dict[str, Any]:
    """Submits an explicit approval request for an assignment in AWAITING_APPROVAL status."""
    from app.services.voice_negotiation_service import VoiceNegotiationService
    service = VoiceNegotiationService(db)
    return service.request_negotiation_approval(
        event_id=event_id,
        assignment_id=assignment_id,
        user_id=user_id,
    )


def confirm_authorized_engagement(
    db: Session,
    session_id: str,
    event_id: str,
    assignment_id: str,
) -> Dict[str, Any]:
    """Confirms provider engagement AFTER human approval has been granted.
    
    Strictly verifies linked Approval status == 'APPROVED' and budget ceiling.
    """
    from app.services.voice_negotiation_service import VoiceNegotiationService
    service = VoiceNegotiationService(db)
    return service.confirm_authorized_engagement(assignment_id=assignment_id)


def call_vendor(
    db: Session,
    event_id: str,
    task_id: str,
    provider_id: str,
    reason: Optional[str] = "P3_RECOVERY",
    recovery_option_id: Optional[str] = None,
    call_objective: Optional[str] = None,
    user_id: Optional[str] = "system",
) -> Dict[str, Any]:
    """Initiates an authorized, deterministic voice call to a vendor for operational recovery or engagement."""
    from app.services.voice_recovery_service import VoiceRecoveryService
    service = VoiceRecoveryService(db)
    return service.initiate_recovery_call(
        event_id=event_id,
        task_id=task_id,
        provider_id=provider_id,
        reason=reason,
        recovery_option_id=recovery_option_id,
        call_objective=call_objective,
        user_id=user_id,
    )


