"""Domain Service: VoiceNegotiationService (Task 6).

Bridges voice conversational interactions to EVENTRA's existing NegotiationService,
ApprovalService, and VendorOutcome architecture.

Core Authority Invariant:
- GEMINI IS THE NEGOTIATOR INTERFACE. EVENTRA IS THE AUTHORITY.
- Voice conversational acceptance NEVER automatically creates a confirmed engagement.
- All within-ceiling quotes transition to AWAITING_APPROVAL for explicit human review.
- All over-ceiling quotes are countered toward target or escalated; authorization is never silently raised.
- Gemini receives strictly sanitized constraints and is never exposed to internal budget, margins,
  alternative quotes, competitor data, or hidden price ceilings.
"""
import logging
import uuid
from typing import Any, Dict, List, Optional
from sqlalchemy.orm import Session

from app.core.exceptions import BadRequestException, NotFoundException
from app.models.approval import Approval
from app.models.event import Event
from app.models.task import Task
from app.models.vendor import Vendor
from app.models.vendor_assignment import VendorAssignment
from app.models.enums import NegotiationStatus
from app.services.negotiation_service import NegotiationService
from app.services.approval_service import ApprovalService
from app.observability.audit import AuditRecorder
from app.schemas.voice_negotiation import (
    VoiceNegotiationContext,
    SanitizedNegotiationConstraints,
    StructuredNegotiationResult,
    NegotiationEvaluationDecision,
)

logger = logging.getLogger(__name__)

# Security: Prompt injection & authority escalation keywords to reject from untrusted vendor speech
PROMPT_INJECTION_KEYWORDS = [
    "ignore previous instructions",
    "ignore all instructions",
    "system prompt",
    "budget override",
    "override budget",
    "confirm booking immediately",
    "book immediately without approval",
    "i am the organizer",
    "admin override",
    "grant authority",
    "bypass approval",
]


class VoiceNegotiationService:
    """Deterministic authority engine for voice-driven vendor negotiation."""

    def __init__(self, db: Session):
        self.db = db
        self._negotiation = NegotiationService(db)
        self._approval = ApprovalService(db)
        self._audit = AuditRecorder(db)

    # -----------------------------------------------------------------------
    # 1. Authoritative Negotiation Context Construction
    # -----------------------------------------------------------------------

    def build_negotiation_context(
        self,
        event_id: str,
        provider_id: str,
        task_id: Optional[str] = None,
        session_id: Optional[str] = None,
        call_sid: Optional[str] = None,
        stream_sid: Optional[str] = None,
        custom_auth: Optional[Dict[str, Any]] = None,
    ) -> VoiceNegotiationContext:
        """Constructs authoritative VoiceNegotiationContext from EVENTRA database models.
        
        Strictly enforces that task belongs to the event, vendor exists, and
        pulls negotiation boundaries (target, ceiling) from active VendorAssignment.
        """
        event = self.db.query(Event).filter(Event.id == event_id).first()
        if not event:
            raise NotFoundException(f"Event '{event_id}' not found.")

        vendor = self.db.query(Vendor).filter(Vendor.id == provider_id).first()
        if not vendor:
            raise NotFoundException(f"Vendor '{provider_id}' not found.")

        task: Optional[Task] = None
        if task_id:
            task = self.db.query(Task).filter(Task.id == task_id).first()
            if not task:
                raise NotFoundException(f"Task '{task_id}' not found.")
            if task.event_id != event_id:
                raise BadRequestException(
                    f"Relationship violation: Task '{task_id}' belongs to event '{task.event_id}', not '{event_id}'."
                )

        assignment = self._negotiation.find_active_assignment(vendor_id=provider_id, event_id=event_id)

        target_price = None
        allowed_price_limit = None
        currency = event.currency or "USD"
        authorized = False
        assignment_id = None

        if assignment:
            assignment_id = assignment.id
            target_price = assignment.target_amount
            allowed_price_limit = assignment.max_approved_amount
            currency = assignment.currency or (event.currency or "USD")
            if target_price is not None or allowed_price_limit is not None:
                authorized = True

        # Custom auth override if explicitly provided by authorized operator
        if custom_auth and isinstance(custom_auth, dict):
            if custom_auth.get("authorized"):
                authorized = True
            if "target_price" in custom_auth:
                target_price = float(custom_auth["target_price"])
            if "allowed_price_limit" in custom_auth:
                allowed_price_limit = float(custom_auth["allowed_price_limit"])
            if "currency" in custom_auth:
                currency = str(custom_auth["currency"]).strip()

        # Format dates & capabilities
        req_date = event.start_datetime.strftime("%Y-%m-%d") if event.start_datetime else None
        req_time = event.start_datetime.strftime("%H:%M") if event.start_datetime else None
        req_dur = task.duration_minutes if task else None

        caps = []
        if task and task.required_provider_category:
            caps.append(task.required_provider_category)
        if vendor.capabilities:
            if isinstance(vendor.capabilities, list):
                caps.extend([str(c) for c in vendor.capabilities if c])
            elif isinstance(vendor.capabilities, str):
                caps.extend([c.strip() for c in vendor.capabilities.split(",") if c.strip()])

        return VoiceNegotiationContext(
            session_id=session_id or f"sess_{uuid.uuid4().hex[:12]}",
            call_sid=call_sid,
            stream_sid=stream_sid,
            event_id=event_id,
            task_id=task_id,
            provider_id=provider_id,
            assignment_id=assignment_id,
            authorized=authorized,
            currency=currency,
            target_price=target_price,
            allowed_price_limit=allowed_price_limit,
            required_capabilities=caps,
            required_date=req_date,
            required_time=req_time,
            required_duration=req_dur,
            allowed_terms=["Standard payment on completion", "Tax inclusive"],
            authorization_source="EVENTRA_ASSIGNMENT" if assignment else "ORGANIZER_EXPLICIT",
        )

    # -----------------------------------------------------------------------
    # 2. Sanitized Constraints for Gemini Live (No Ceilings, No Margins)
    # -----------------------------------------------------------------------

    def get_sanitized_constraints_for_gemini(
        self,
        context: VoiceNegotiationContext,
    ) -> SanitizedNegotiationConstraints:
        """Produces a strictly sanitized constraint payload for Gemini Live.
        
        CRITICAL SECURITY:
        - NEVER includes allowed_price_limit (internal ceiling).
        - NEVER includes total event budget or internal margins.
        - Exposes only the authorized target price and task specifications.
        """
        return SanitizedNegotiationConstraints(
            session_id=context.session_id,
            event_id=context.event_id,
            provider_id=context.provider_id,
            task_id=context.task_id,
            authorized=context.authorized,
            currency=context.currency,
            target_price=context.target_price if context.authorized else None,
            required_capabilities=context.required_capabilities,
            required_date=context.required_date,
            required_time=context.required_time,
            required_duration=context.required_duration,
            allowed_terms=context.allowed_terms,
            guidance=(
                f"You may discuss around target {context.target_price} {context.currency} if authorized. "
                "Do NOT agree to any price autonomously."
                if context.authorized and context.target_price
                else "Ask for vendor standard quotation. Do NOT propose or accept any price."
            ),
        )

    # -----------------------------------------------------------------------
    # 3. Deterministic Authority Decision Engine
    # -----------------------------------------------------------------------

    def evaluate_vendor_response(
        self,
        context: VoiceNegotiationContext,
        response: StructuredNegotiationResult,
        is_simulation: bool = False,
        authorizing_user_id: Optional[str] = None,
    ) -> NegotiationEvaluationDecision:
        """Authoritative evaluation of untrusted vendor conversational speech claims.
        
        Decision Matrix:
        1. Prompt Injection / Authority Escalation → REJECT
        2. Malformed / Negative / Zero Price → NEEDS_CLARIFICATION
        3. Ambiguity / Uncertain Statements → NEEDS_CLARIFICATION
        4. Incompatible Mandatory Task Constraints → ESCALATE
        5. Vendor Unavailable / Declined → DECLINED
        6. Quote <= target_price or ceiling → AWAITING_APPROVAL (Human decision required)
        7. Quote > ceiling → NEGOTIATE / COUNTER_OFFER toward target or ESCALATE
        """
        # 1. Verify Identity and Session Correlation
        if context.session_id and response.raw_conversational_provenance:
            prov_sess = response.raw_conversational_provenance.get("session_id")
            if prov_sess and prov_sess != context.session_id:
                raise BadRequestException(
                    f"Session correlation mismatch: '{prov_sess}' != '{context.session_id}'."
                )

        # 2. Security Check: Prompt Injection / Authority Escalation
        combined_text = (
            str(response.proposed_terms or "")
            + " "
            + " ".join(response.constraints)
            + " ".join(response.required_changes)
            + " "
            + str(response.raw_conversational_provenance.get("notes", ""))
        ).lower()

        if any(keyword in combined_text for keyword in PROMPT_INJECTION_KEYWORDS):
            logger.warning(
                "Prompt injection / authority override detected in voice negotiation from provider '%s'.",
                context.provider_id,
            )
            return NegotiationEvaluationDecision(
                action="REJECT",
                negotiation_status=NegotiationStatus.NEGOTIATING.value,
                can_proceed_to_engagement=False,
                approval_required=True,
                conversational_response="I am only authorized to record standard quotations for the event organizer.",
                reason="Prompt injection / unauthorized authority escalation attempt detected.",
                blocking_factors=["Untrusted prompt injection pattern identified in vendor response."],
            )

        # 3. Price Sanity & Currency Verification
        if response.quoted_price is not None:
            if response.quoted_price <= 0 or response.quoted_price > 100_000_000:
                return NegotiationEvaluationDecision(
                    action="NEEDS_CLARIFICATION",
                    negotiation_status=NegotiationStatus.NEGOTIATING.value,
                    can_proceed_to_engagement=False,
                    approval_required=True,
                    conversational_response="Could you please confirm the exact quotation amount for this requirement?",
                    reason="Invalid or absurd pricing value.",
                    blocking_factors=[f"Quoted price {response.quoted_price} is out of allowable bounds."],
                )

        if response.currency and response.currency.strip().upper() != context.currency.strip().upper():
            return NegotiationEvaluationDecision(
                action="NEEDS_CLARIFICATION",
                negotiation_status=NegotiationStatus.NEGOTIATING.value,
                can_proceed_to_engagement=False,
                approval_required=True,
                conversational_response=f"Our event is budgeted in {context.currency}. Could you provide the rate in {context.currency}?",
                reason="Currency mismatch between quote and event budget currency.",
                blocking_factors=[f"Currency {response.currency} != {context.currency}"],
            )

        # 4. Ambiguity / Clarification Check
        if response.is_ambiguous or response.status == "NEEDS_CLARIFICATION":
            return NegotiationEvaluationDecision(
                action="NEEDS_CLARIFICATION",
                negotiation_status=NegotiationStatus.WAITING_FOR_RESPONSE.value,
                can_proceed_to_engagement=False,
                approval_required=True,
                conversational_response="I'll need to confirm that before I can agree to those terms. Could you clarify your exact quotation and availability?",
                reason="Vendor statement was ambiguous or tentative.",
                blocking_factors=["Ambiguous price or availability claim."],
            )

        # 5. Mandatory Task Requirement Conflict Check
        if response.required_changes:
            conflict_found = False
            conflict_msg = ""
            for change in response.required_changes:
                lower_change = change.lower()
                if "cannot provide" in lower_change or "not include" in lower_change or "reduce hours" in lower_change:
                    conflict_found = True
                    conflict_msg = change
                    break
            if conflict_found:
                return NegotiationEvaluationDecision(
                    action="ESCALATE",
                    negotiation_status=NegotiationStatus.NEGOTIATING.value,
                    can_proceed_to_engagement=False,
                    approval_required=True,
                    conversational_response="Our event strictly requires these service specifications. I will check with the organizer if modifications are acceptable.",
                    reason=f"Vendor proposed modifications conflicting with task requirements: {conflict_msg}",
                    blocking_factors=[f"Requirement modification: {conflict_msg}"],
                )

        # 6. Resolve or Create VendorAssignment
        assignment = self._get_or_create_assignment(context)

        # 7. Availability: Unavailable / Declined
        if response.availability is False or response.rejected_offer is True:
            decline_res = self._negotiation.handle_decline(assignment.id)
            return NegotiationEvaluationDecision(
                action="DECLINED",
                negotiation_status=NegotiationStatus.DECLINED.value,
                can_proceed_to_engagement=False,
                approval_required=False,
                conversational_response="Thank you for letting us know. We understand you are unavailable for this date.",
                reason="Vendor explicitly declined or reported unavailable.",
                assignment_id=assignment.id,
            )

        # 8. Missing Price
        if response.quoted_price is None:
            return NegotiationEvaluationDecision(
                action="NEEDS_CLARIFICATION",
                negotiation_status=NegotiationStatus.CONTACTED.value,
                can_proceed_to_engagement=False,
                approval_required=True,
                conversational_response="Could you please share your rate estimate or quotation for this service?",
                reason="No price quote provided by vendor.",
                assignment_id=assignment.id,
            )

        quoted_val = float(response.quoted_price)
        assignment.quoted_amount = quoted_val

        # Ceiling & Target Authority Boundaries
        ceiling = context.allowed_price_limit
        if ceiling is None:
            ceiling = assignment.max_approved_amount
        target = context.target_price or assignment.target_amount

        # 9. Evaluate Commercial Position
        # Case A: Over Ceiling → Counter-offer toward target or Escalate
        if ceiling is not None and quoted_val > ceiling:
            round_num = int(assignment.negotiation_round or "0")
            if round_num < 3 and target is not None:
                # Deterministic counter-offer using NegotiationService rules
                assignment.negotiation_status = NegotiationStatus.NEGOTIATING.value
                self.db.commit()
                counter_result = self._negotiation.negotiate(assignment.id)
                counter_amount = counter_result.get("counter_offer_amount")
                return NegotiationEvaluationDecision(
                    action="COUNTER_OFFER",
                    negotiation_status=NegotiationStatus.COUNTER_OFFER_SENT.value,
                    can_proceed_to_engagement=False,
                    approval_required=True,
                    counter_offer_amount=counter_amount,
                    conversational_response=(
                        f"Thank you for your quotation of {context.currency} {quoted_val:,.0f}. "
                        f"That exceeds our authorized rate. Would {context.currency} {counter_amount:,.0f} "
                        "work for this coverage?"
                    ),
                    reason=f"Quoted {quoted_val} exceeds ceiling of {ceiling}. Dispatched counter-offer of {counter_amount}.",
                    assignment_id=assignment.id,
                    quoted_amount=quoted_val,
                    target_amount=target,
                    max_approved_amount=ceiling,
                )
            else:
                # Escalation path: cannot counter further without organizer approval
                assignment.negotiation_status = NegotiationStatus.NEGOTIATING.value
                self.db.commit()
                return NegotiationEvaluationDecision(
                    action="ESCALATE",
                    negotiation_status=NegotiationStatus.NEGOTIATING.value,
                    can_proceed_to_engagement=False,
                    approval_required=True,
                    conversational_response=(
                        f"Thank you. That rate of {context.currency} {quoted_val:,.0f} is outside our approved limit. "
                        "I will submit your quote for the organizer to review and decide."
                    ),
                    reason=f"Quoted {quoted_val} exceeds authorized ceiling {ceiling}. Cannot counter further; organizer approval required.",
                    assignment_id=assignment.id,
                    quoted_amount=quoted_val,
                    target_amount=target,
                    max_approved_amount=ceiling,
                    blocking_factors=[f"Price {quoted_val} exceeds authorized limit {ceiling}."],
                )

        # Case B: Within Ceiling (or target) → AWAITING_APPROVAL
        # CRITICAL AUTHORITY RULE: Even if within ceiling, agent NEVER autonomously confirms!
        # Always requires human approval via ApprovalService.
        proc_result = self._negotiation.process_provider_response(
            assignment_id=assignment.id,
            response_text=f"Vendor quoted {context.currency} {quoted_val:,.0f} via voice call.",
            is_simulation=is_simulation,
            structured_offer={
                "availability": True,
                "quoted_price": quoted_val,
                "quoted_amount": quoted_val,
                "amount": quoted_val,
                "currency": context.currency,
                "terms": response.proposed_terms,
            },
        )

        return NegotiationEvaluationDecision(
            action="AWAITING_APPROVAL",
            negotiation_status=NegotiationStatus.AWAITING_APPROVAL.value,
            can_proceed_to_engagement=False,
            approval_required=True,
            conversational_response=(
                f"Thank you for the quotation of {context.currency} {quoted_val:,.0f}. "
                "I have logged your proposal for organizer review and final approval."
            ),
            reason=f"Quote of {quoted_val} is within ceiling. Human approval is strictly required before confirmation.",
            assignment_id=assignment.id,
            approval_id=proc_result.get("assignment_id") and assignment.approval_id,
            quoted_amount=quoted_val,
            target_amount=target,
            max_approved_amount=ceiling,
            budget_validation=proc_result.get("budget_validation"),
        )

    # -----------------------------------------------------------------------
    # 4. Human Approval & Engagement Confirmation Boundaries
    # -----------------------------------------------------------------------

    def request_negotiation_approval(
        self,
        event_id: str,
        assignment_id: str,
        user_id: str = "anonymous_operator",
    ) -> Dict[str, Any]:
        """Creates an explicit approval request for an assignment in AWAITING_APPROVAL state."""
        return self._negotiation.request_approval(
            event_id=event_id,
            assignment_id=assignment_id,
            user_id=user_id,
        )

    def confirm_authorized_engagement(
        self,
        assignment_id: str,
    ) -> Dict[str, Any]:
        """Confirms provider engagement AFTER human approval.
        
        Strictly enforces:
        1. Assignment is in AWAITING_APPROVAL state.
        2. Linked ApprovalRequest exists and status == 'APPROVED'.
        3. Quoted price does not exceed max_approved_amount.
        """
        return self._negotiation.confirm_engagement(assignment_id=assignment_id)

    # -----------------------------------------------------------------------
    # Helper: Find or Create Assignment
    # -----------------------------------------------------------------------

    def _get_or_create_assignment(self, context: VoiceNegotiationContext) -> VendorAssignment:
        """Finds or safely initializes a VendorAssignment for the negotiation."""
        if context.assignment_id:
            assignment = self.db.query(VendorAssignment).filter(VendorAssignment.id == context.assignment_id).first()
            if assignment:
                return assignment

        assignment = self._negotiation.find_active_assignment(
            vendor_id=context.provider_id,
            event_id=context.event_id,
        )
        if assignment:
            context.assignment_id = assignment.id
            return assignment

        # Create initial assignment record
        category = "general"
        if context.required_capabilities:
            category = context.required_capabilities[0]

        assignment = VendorAssignment(
            event_id=context.event_id,
            vendor_id=context.provider_id,
            category=category,
            status="REQUESTED",
            negotiation_status=NegotiationStatus.CONTACTED.value,
            target_amount=context.target_price,
            max_approved_amount=context.allowed_price_limit,
            currency=context.currency,
        )
        self.db.add(assignment)
        self.db.commit()
        self.db.refresh(assignment)
        context.assignment_id = assignment.id
        return assignment
