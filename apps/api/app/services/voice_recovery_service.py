"""Domain Service: VoiceRecoveryService (Task 7).

Integrates EVENTRA's existing P3 Recovery Engine with the Voice Telephony + Negotiation pipeline.

Core Architecture & Authority Invariants:
1. VOICE IS AN EXECUTION INTERFACE, NOT THE DECISION-MAKER:
   - RecoveryService determines whether recovery is necessary and generates/validates options.
   - Voice calling executes the operational inquiry/negotiation with candidate vendors.
   - Gemini never selects a replacement vendor, never overrides P3 rules, and never alters budget ceilings.
2. DETERMINISTIC AUTHORIZATION & APPROVAL:
   - Urgent recovery calls do NOT automatically bypass approval.
   - Consequential mutations (vendor reassignment, budget commitment) strictly respect ApprovalService.
3. PAUSE / RESUME COMPLIANCE:
   - Voice recovery respects PauseResumeService. Consequential task mutations are blocked if paused.
4. STRICT CORRELATION & IDEMPOTENCY:
   - Tracks recovery_option_id, event_id, task_id, provider_id, session_id, and call_sid end-to-end.
   - Active call tracking prevents duplicate concurrent outbound calls for the same recovery attempt.
"""
from datetime import datetime, timezone, timedelta
import logging
import uuid
from typing import Any, Dict, List, Optional, Tuple
from sqlalchemy.orm import Session

from app.core.exceptions import (
    BadRequestException,
    ConflictException,
    ForbiddenException,
    NotFoundException,
)
from app.engines.auth.permissions import Permissions, ROLE_PERMISSIONS_MAP
from app.models.approval import Approval
from app.models.event import Event
from app.models.event_member import EventMember
from app.models.enums import EventExecutionState, RoleType, NegotiationStatus, BindingStatus
from app.models.incident import Incident
from app.models.recovery import Recovery
from app.models.task import Task
from app.models.vendor import Vendor
from app.models.vendor_assignment import VendorAssignment
from app.observability.audit import AuditRecorder
from app.services.provider_communication_service import ProviderCommunicationService
from app.services.recovery_service import RecoveryService
from app.services.vendor_task_binding_service import VendorTaskBindingService
from app.services.voice_negotiation_service import VoiceNegotiationService
from app.integrations.communication.voice_context_builder import VoiceContextBuilder
from app.integrations.communication.voice_outcome_parser import VoiceOutcomePipeline, VoiceOutcomeResult
from app.integrations.communication.gemini_bridge import TranscriptEntry

logger = logging.getLogger(__name__)

# Active recovery calls tracker for idempotency: (event_id, task_id, provider_id, recovery_option_id) -> record
_ACTIVE_RECOVERY_CALLS: Dict[Tuple[str, str, str, Optional[str]], Dict[str, Any]] = {}


def utc_now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class VoiceRecoveryService:
    """Orchestrates voice calls and outcome processing for P3 incident recovery."""

    def __init__(self, db: Session):
        self.db = db
        self._comm = ProviderCommunicationService(db)
        self._recovery = RecoveryService(db)
        self._binding = VendorTaskBindingService(db)
        self._negotiation = VoiceNegotiationService(db)
        self._audit = AuditRecorder(db)

    # -----------------------------------------------------------------------
    # 1. Initiate Recovery Call (call_vendor)
    # -----------------------------------------------------------------------

    def initiate_recovery_call(
        self,
        event_id: str,
        task_id: str,
        provider_id: str,
        reason: Optional[str] = "P3_RECOVERY",
        recovery_option_id: Optional[str] = None,
        call_objective: Optional[str] = None,
        user_id: Optional[str] = "system",
    ) -> Dict[str, Any]:
        """Initiates an authorized, deterministic voice call to a vendor for recovery.
        
        Validations:
        1. Event, Task, and Provider existence and relationships.
        2. Recovery option feasibility and relevance (if recovery_option_id supplied).
        3. User authorization (rejects read-only VIEWER).
        4. Event execution pause state check.
        5. Idempotency check against duplicate concurrent calls.
        """
        # 1. Validate Event
        event = self.db.query(Event).filter(Event.id == event_id).first()
        if not event:
            raise NotFoundException(f"Event '{event_id}' not found.")

        # 2. Check Authorization
        self._check_user_authorization(event, user_id)

        # 3. Validate Task
        task = self.db.query(Task).filter(Task.id == task_id).first()
        if not task:
            raise NotFoundException(f"Task '{task_id}' not found.")
        if task.event_id != event_id:
            raise BadRequestException(
                f"Relationship violation: Task '{task_id}' belongs to event '{task.event_id}', not '{event_id}'."
            )

        # 4. Validate Provider
        provider = self.db.query(Vendor).filter(Vendor.id == provider_id).first()
        if not provider:
            raise NotFoundException(f"Provider '{provider_id}' not found.")
        if not provider.contact_phone:
            raise BadRequestException(f"Provider '{provider.name}' ({provider_id}) has no registered contact phone.")

        # 5. Validate Recovery Option if supplied
        recovery: Optional[Recovery] = None
        if recovery_option_id:
            recovery = self.db.query(Recovery).filter(
                Recovery.id == recovery_option_id,
                Recovery.event_id == event_id,
            ).first()
            if not recovery:
                raise NotFoundException(f"Recovery option '{recovery_option_id}' not found for event '{event_id}'.")
            if not recovery.is_feasible:
                raise BadRequestException(
                    f"Cannot initiate recovery call for option '{recovery_option_id}': Option is marked INFEASIBLE."
                )
            if recovery.status == "STALE":
                raise BadRequestException(
                    f"Cannot initiate recovery call for option '{recovery_option_id}': Option is STALE."
                )

        # 6. Idempotency Check
        idempotency_key = (event_id, task_id, provider_id, recovery_option_id)
        existing_call = _ACTIVE_RECOVERY_CALLS.get(idempotency_key)
        if existing_call:
            call_time = existing_call.get("initiated_at")
            if call_time and (utc_now() - call_time) < timedelta(minutes=5):
                logger.info(
                    "Idempotency: Active recovery call already in progress for key %s (session %s).",
                    idempotency_key,
                    existing_call.get("session_id"),
                )
                return {
                    "event_id": event_id,
                    "task_id": task_id,
                    "provider_id": provider_id,
                    "session_id": existing_call["session_id"],
                    "call_sid": existing_call.get("call_sid"),
                    "recovery_option_id": recovery_option_id,
                    "status": "ALREADY_ACTIVE",
                    "channel": "PHONE",
                    "message": "An active call to this vendor for this recovery option is already in progress.",
                    "success": True,
                }

        # 7. Generate Correlation & Session Identifiers
        session_id = f"rec_voice_{uuid.uuid4().hex[:12]}"
        objective_str = call_objective or "Inquire about immediate availability, emergency quote, and setup timing."

        # 8. Build Sanitized Voice Context
        builder = VoiceContextBuilder()
        custom_params = {
            "session_id": session_id,
            "event_id": event_id,
            "task_id": task_id,
            "provider_id": provider_id,
            "currency": event.currency or "USD",
            "is_urgent_recovery": True,
            "call_objective": objective_str,
            "recovery_option_id": recovery_option_id,
            "inquiry_goal": f"Urgent recovery inquiry: {objective_str}",
        }
        ctx = builder.build(
            event_id=event_id,
            task_id=task_id,
            provider_id=provider_id,
            session_id=session_id,
            db=self.db,
            custom_parameters=custom_params,
        )

        # 9. Dispatch Call via ProviderCommunicationService
        call_res = self._comm.make_call(
            event_id=event_id,
            provider_id=provider_id,
            recipient_phone=provider.contact_phone,
            task_id=task_id,
            session_id=session_id,
            metadata={
                "recovery_option_id": recovery_option_id,
                "reason": reason,
                "call_objective": objective_str,
                "is_urgent_recovery": True,
                "currency": event.currency or "USD",
                "provenance": "AI_VOICE_CALL",
            },
            actor_id=user_id or "system",
            actor_type="USER" if user_id and user_id != "system" else "SYSTEM",
        )

        if not call_res.success:
            err_msg = call_res.error or "Telephony call initiation failed."
            self._audit.record(
                event_id=event_id,
                actor_id=user_id or "system",
                actor_type="USER" if user_id and user_id != "system" else "SYSTEM",
                action="VOICE_CALL_FAILED",
                action_type="COMMUNICATION",
                target_type="RECOVERY",
                target_id=recovery_option_id or task_id,
                failure_reason=err_msg,
                after_state={
                    "session_id": session_id,
                    "provider_id": provider_id,
                    "task_id": task_id,
                    "recovery_option_id": recovery_option_id,
                    "error_classification": "TRANSPORT_FAILURE",
                },
            )
            return {
                "event_id": event_id,
                "task_id": task_id,
                "provider_id": provider_id,
                "session_id": session_id,
                "call_sid": None,
                "recovery_option_id": recovery_option_id,
                "recovery_status": "FAILED",
                "can_proceed": False,
                "success": False,
                "error": err_msg,
                "error_classification": "TRANSPORT_FAILURE",
                "message": f"Outbound recovery call failed: {err_msg}",
            }

        call_data = call_res.data or {}
        call_sid = call_data.get("call_sid") or f"ex_call_{uuid.uuid4().hex[:10]}"

        # Record in active calls cache
        record_entry = {
            "session_id": session_id,
            "call_sid": call_sid,
            "initiated_at": utc_now(),
            "event_id": event_id,
            "task_id": task_id,
            "provider_id": provider_id,
            "recovery_option_id": recovery_option_id,
        }
        _ACTIVE_RECOVERY_CALLS[idempotency_key] = record_entry

        # Record structured audit event
        self._audit.record(
            event_id=event_id,
            actor_id=user_id or "system",
            actor_type="USER" if user_id and user_id != "system" else "SYSTEM",
            action="RECOVERY_VOICE_CALL_INITIATED",
            action_type="COMMUNICATION",
            target_type="RECOVERY",
            target_id=recovery_option_id or task_id,
            after_state={
                "session_id": session_id,
                "call_sid": call_sid,
                "provider_id": provider_id,
                "task_id": task_id,
                "recovery_option_id": recovery_option_id,
                "objective": objective_str,
            },
        )

        return {
            "event_id": event_id,
            "task_id": task_id,
            "provider_id": provider_id,
            "session_id": session_id,
            "call_sid": call_sid,
            "recovery_option_id": recovery_option_id,
            "status": "INITIATED",
            "channel": call_data.get("channel", "PHONE"),
            "message": f"Outbound recovery call initiated to {provider.name} ({provider.contact_phone}).",
            "success": call_res.success,
        }

    # -----------------------------------------------------------------------
    # 2. Process Recovery Call Outcome
    # -----------------------------------------------------------------------

    def process_recovery_call_outcome(
        self,
        event_id: str,
        task_id: str,
        provider_id: str,
        session_id: Optional[str] = None,
        recovery_option_id: Optional[str] = None,
        transcript: Optional[List[TranscriptEntry]] = None,
        authorizing_user_id: Optional[str] = None,
        auto_bind_if_authorized: bool = False,
        user_id: Optional[str] = None,
        is_pre_authorized: bool = False,
        call_sid: Optional[str] = None,
        **kwargs,
    ) -> Dict[str, Any]:
        """Processes the completed voice call transcript through the authoritative recovery pipeline.
        
        Lifecycle:
        1. Run transcript through VoiceOutcomePipeline.
        2. Evaluate vendor claims against VoiceNegotiationService.
        3. Enforce pause state (PauseResumeService).
        4. If vendor UNAVAILABLE: return FAILED to RecoveryService without modifying state.
        5. If vendor AVAILABLE and price within authorization:
           - If user has VENDOR_ASSIGN permission and event is not paused: bind and resolve recovery.
           - Else: transition to REQUIRES_APPROVAL.
        """
        authorizing_user_id = authorizing_user_id or user_id
        auto_bind_if_authorized = auto_bind_if_authorized or is_pre_authorized
        session_id = session_id or kwargs.get("session_id") or f"sess-{uuid.uuid4().hex[:8]}"

        event = self.db.query(Event).filter(Event.id == event_id).first()
        if not event:
            raise NotFoundException(f"Event '{event_id}' not found.")

        # 1. Process Voice Transcript via VoiceOutcomePipeline
        pipeline = VoiceOutcomePipeline(self.db)
        outcome_res: VoiceOutcomeResult = pipeline.process_call_completion(
            session_id=session_id,
            event_id=event_id,
            task_id=task_id,
            provider_id=provider_id,
            transcript=transcript,
            authorizing_user_id=authorizing_user_id,
            auto_bind=False,  # Recovery manages binding explicitly
        )

        parsed_claims = (
            outcome_res.outcome.vendor_response.get("claims", {})
            if outcome_res.outcome and isinstance(outcome_res.outcome.vendor_response, dict)
            else {}
        )
        reported_avail = parsed_claims.get("reported_availability")
        quoted_price = parsed_claims.get("quoted_price")

        outcome_success = bool(outcome_res.outcome_id)
        has_claim = bool(
            reported_avail in ("AVAILABLE", "CONDITIONAL_YES", "UNAVAILABLE", "CONDITIONAL_NO")
            or quoted_price is not None
            or (outcome_res.outcome and outcome_res.outcome.outcome_status not in ("NO_RESPONSE", "CONTACTED"))
        )

        # 2. Case A: Vendor Unavailable / Declined
        if reported_avail in ("UNAVAILABLE", "CONDITIONAL_NO") or (outcome_res.outcome and outcome_res.outcome.outcome_status == "UNAVAILABLE"):
            self._audit.record(
                event_id=event_id,
                actor_id=authorizing_user_id or "system",
                actor_type="EXTERNAL",
                action="RECOVERY_VENDOR_UNAVAILABLE",
                action_type="RECOVERY",
                target_type="VENDOR",
                target_id=provider_id,
                after_state={
                    "session_id": session_id,
                    "recovery_option_id": recovery_option_id,
                    "reason": "Vendor reported unavailable during voice call",
                },
            )
            # Remove from active calls cache to allow retry or alternative selection
            idempotency_key = (event_id, task_id, provider_id, recovery_option_id)
            _ACTIVE_RECOVERY_CALLS.pop(idempotency_key, None)

            return {
                "event_id": event_id,
                "task_id": task_id,
                "provider_id": provider_id,
                "session_id": session_id,
                "recovery_option_id": recovery_option_id,
                "recovery_status": "FAILED",
                "can_proceed": False,
                "message": "Vendor stated unavailability or reported unavailable for emergency replacement. Control returned to RecoveryService.",
                "outcome_id": outcome_res.outcome_id,
                "validation_id": outcome_res.validation.id if outcome_res.validation else None,
                "is_bound": False,
                "success": outcome_success,
                "vendor_outcome": {
                    "has_candidate_claim": has_claim,
                    "provenance": outcome_res.outcome.source if outcome_res.outcome else None,
                    "communication_channel": outcome_res.outcome.communication_channel if outcome_res.outcome else None,
                    "verification_status": outcome_res.outcome.verification_status if outcome_res.outcome else None,
                    "outcome_status": outcome_res.outcome.outcome_status if outcome_res.outcome else None,
                },
            }

        # 3. Check Event Execution State (Pause / Resume compliance)
        curr_exec_state = getattr(event, "execution_state", None) or EventExecutionState.RUNNING.value
        if curr_exec_state in (EventExecutionState.PAUSED.value, EventExecutionState.PAUSING.value):
            return {
                "event_id": event_id,
                "task_id": task_id,
                "provider_id": provider_id,
                "session_id": session_id,
                "recovery_option_id": recovery_option_id,
                "recovery_status": "BLOCKED_PAUSED",
                "can_proceed": False,
                "message": f"Event execution is '{curr_exec_state}'. Event execution is PAUSED. Recovery binding is blocked until event is resumed.",
                "outcome_id": outcome_res.outcome_id,
                "validation_id": outcome_res.validation.id if outcome_res.validation else None,
                "is_bound": False,
                "success": outcome_success,
                "vendor_outcome": {
                    "has_candidate_claim": has_claim,
                    "provenance": outcome_res.outcome.source if outcome_res.outcome else None,
                    "communication_channel": outcome_res.outcome.communication_channel if outcome_res.outcome else None,
                    "verification_status": outcome_res.outcome.verification_status if outcome_res.outcome else None,
                    "outcome_status": outcome_res.outcome.outcome_status if outcome_res.outcome else None,
                },
            }

        # 4. Case B: Vendor Available → Evaluate Negotiation & Authorization
        neg_decision = outcome_res.negotiation_decision
        if not neg_decision and quoted_price is not None:
            # Evaluate via VoiceNegotiationService
            neg_ctx = self._negotiation.build_negotiation_context(
                event_id=event_id,
                provider_id=provider_id,
                task_id=task_id,
                session_id=session_id,
            )
            from app.schemas.voice_negotiation import StructuredNegotiationResult
            neg_response = StructuredNegotiationResult(
                availability=True,
                quoted_price=quoted_price,
                currency=parsed_claims.get("currency") or (event.currency if event else "USD"),
                constraints=parsed_claims.get("constraints", []),
                status="VALIDATED",
                raw_conversational_provenance={"session_id": session_id},
            )
            neg_decision = self._negotiation.evaluate_vendor_response(
                context=neg_ctx,
                response=neg_response,
                authorizing_user_id=authorizing_user_id,
            )

        # 5. Handle Over-Ceiling Quotes or Incomplete / Pending Negotiation
        if neg_decision and neg_decision.action in ("COUNTER_OFFER", "ESCALATE", "REJECT", "NEEDS_CLARIFICATION", "DECLINED"):
            return {
                "event_id": event_id,
                "task_id": task_id,
                "provider_id": provider_id,
                "session_id": session_id,
                "recovery_option_id": recovery_option_id,
                "recovery_status": "ESCALATED" if neg_decision.action in ("COUNTER_OFFER", "ESCALATE", "REJECT") else "REQUIRES_APPROVAL",
                "can_proceed": False,
                "message": neg_decision.reason,
                "negotiation_decision": neg_decision.model_dump(),
                "outcome_id": outcome_res.outcome_id,
                "is_bound": False,
                "success": outcome_success,
                "vendor_outcome": {
                    "has_candidate_claim": has_claim,
                    "provenance": outcome_res.outcome.source if outcome_res.outcome else None,
                    "communication_channel": outcome_res.outcome.communication_channel if outcome_res.outcome else None,
                    "verification_status": outcome_res.outcome.verification_status if outcome_res.outcome else None,
                    "outcome_status": outcome_res.outcome.outcome_status if outcome_res.outcome else None,
                },
            }

        # 6. Authorized Binding Pathway
        is_bound = False
        task_rebound = False
        binding_res = None
        if auto_bind_if_authorized and authorizing_user_id:
            is_auth, auth_err = self._binding._verify_authorization(event_id, authorizing_user_id)
            if is_auth and outcome_res.validation:
                binding_res = self._binding.bind_vendor_to_task(
                    event_id=event_id,
                    task_id=task_id,
                    provider_id=provider_id,
                    validation_id=outcome_res.validation.id,
                    user_id=authorizing_user_id,
                    allow_reassignment=True,
                    force_override_unknown=True,
                )
                if binding_res.binding_status == BindingStatus.BOUND:
                    is_bound = True
                    task_rebound = True
                    if recovery_option_id:
                        rec = self.db.query(Recovery).filter(Recovery.id == recovery_option_id).first()
                        if rec:
                            rec.status = "EXECUTED"
                            self.db.commit()

        # Clean active calls cache on resolution
        if is_bound:
            idempotency_key = (event_id, task_id, provider_id, recovery_option_id)
            _ACTIVE_RECOVERY_CALLS.pop(idempotency_key, None)

        binding_data = binding_res.model_dump() if (is_bound and binding_res) else None

        return {
            "event_id": event_id,
            "task_id": task_id,
            "provider_id": provider_id,
            "session_id": session_id,
            "recovery_option_id": recovery_option_id,
            "recovery_status": "RECOVERY_RESOLVED" if is_bound else "REQUIRES_APPROVAL",
            "can_proceed": is_bound,
            "message": (
                f"Emergency vendor '{provider_id}' successfully bound to task '{task_id}'. Schedule recalculated."
                if is_bound
                else "Emergency quote recorded within ceiling. Human approval required before binding."
            ),
            "outcome_id": outcome_res.outcome_id,
            "validation_id": outcome_res.validation.id if outcome_res.validation else None,
            "is_bound": is_bound,
            "binding_result": binding_data,
            "approval_id": neg_decision.approval_id if neg_decision else None,
            "negotiation_decision": neg_decision.model_dump() if neg_decision else None,
            "success": outcome_success,
            "vendor_outcome": {
                "has_candidate_claim": has_claim,
                "provenance": outcome_res.outcome.source if outcome_res.outcome else None,
                "communication_channel": outcome_res.outcome.communication_channel if outcome_res.outcome else None,
                "verification_status": outcome_res.outcome.verification_status if outcome_res.outcome else None,
                "outcome_status": outcome_res.outcome.outcome_status if outcome_res.outcome else None,
            },
        }

    # -----------------------------------------------------------------------
    # Helper: Authorization
    # -----------------------------------------------------------------------

    def _check_user_authorization(self, event: Event, user_id: Optional[str]) -> None:
        """Verifies that the calling actor has permission to trigger recovery calls."""
        if not user_id or user_id in ("system", "anonymous_operator") or user_id.startswith("system"):
            return

        if event.owner_id == user_id:
            return

        member = self.db.query(EventMember).filter(
            EventMember.event_id == event.id,
            EventMember.user_id == user_id,
        ).first()

        if not member:
            raise ForbiddenException(f"User '{user_id}' is not a member of event '{event.id}'.")

        if member.role == RoleType.VIEWER.value:
            raise ForbiddenException(f"User '{user_id}' has read-only VIEWER role and cannot trigger recovery calls.")
