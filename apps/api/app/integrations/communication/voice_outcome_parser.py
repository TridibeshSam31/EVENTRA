"""EVENTRA Voice Outcome Parser & Pipeline Layer (Task 5).

Converts completed Gemini voice transcripts into candidate structured VendorOutcome records
and feeds them through EVENTRA's existing authoritative, deterministic domain services:
1. Voice Transcript
      ↓
2. VoiceOutcomeParser (untrusted claim extraction & ambiguity preservation)
      ↓
3. Candidate VendorOutcome (strict source="ORGANIZER_REPORTED", verification_status="UNVERIFIED")
      ↓
4. VendorOutcomeService.record_outcome(...) (relational integrity & audit recording)
      ↓
5. VendorOutcomeValidationService.validate_outcome(...) (deterministic claim evaluation)
      ↓
6. VendorTaskBindingService.evaluate_feasibility(...) & bind_vendor_to_task(...) (conditional binding)

ARCHITECTURAL INVARIANTS:
- Gemini is NOT authoritative; transcripts are treated as untrusted vendor input.
- Conversational confirmations ("sounds good", "should be able to") are NEVER treated as binding.
- Ambiguous prices or dates are marked as uncertain and never converted to exact facts.
- No direct database mutations by Gemini; all persistence and state transitions flow
  through existing deterministic EVENTRA services.
"""
from datetime import datetime, timezone
import json
import logging
import re
from typing import Any, Dict, List, Optional, Tuple, Union
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from app.core.exceptions import BadRequestException, NotFoundException
from app.models.approval import Approval
from app.models.event import Event
from app.models.vendor_assignment import VendorAssignment
from app.models.enums import (
    BindingStatus,
    BlockingReason,
    CommunicationChannel,
    NegotiationStatus,
    ReportedAvailability,
    VendorOutcomeStatus,
)
from app.models.vendor_outcome import VendorOutcome
from app.models.vendor_outcome_validation import VendorOutcomeValidation
from app.schemas.vendor_outcome import VendorOutcomeCreate
from app.schemas.vendor_binding import (
    BindingDecision,
    VendorTaskBindingResponse,
)
from app.services.vendor_outcome_service import VendorOutcomeService
from app.services.vendor_outcome_validation_service import VendorOutcomeValidationService
from app.services.vendor_task_binding_service import VendorTaskBindingService
from app.integrations.communication.gemini_bridge import (
    GeminiLiveBridge,
    TranscriptEntry,
    TranscriptSpeaker,
)
from app.integrations.communication.voice_context_builder import SanitizedVoiceContext

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# 1. Parsed Voice Outcome Claims Schema
# ---------------------------------------------------------------------------

class ParsedVoiceOutcome(BaseModel):
    """Structured extraction of claims and ambiguities from a voice transcript."""
    reported_availability: str = ReportedAvailability.UNKNOWN.value
    outcome_status: str = VendorOutcomeStatus.CONTACTED.value
    quoted_price: Optional[float] = None
    currency: str = "USD"
    capacity: Optional[int] = None
    constraints: List[str] = Field(default_factory=list)
    uncertainties: List[str] = Field(default_factory=list)
    commitments: List[str] = Field(default_factory=list)
    summary: str = ""

    model_config = ConfigDict(from_attributes=True)


# ---------------------------------------------------------------------------
# 2. Voice Outcome Parser (Deterministic Regex & Heuristics)
# ---------------------------------------------------------------------------

class VoiceOutcomeParser:
    """Parses raw telephony transcripts into candidate structured outcome claims."""

    def parse(
        self,
        transcript: List[TranscriptEntry],
        sanitized_context: Optional[SanitizedVoiceContext] = None,
        expected_currency: Optional[str] = None,
    ) -> ParsedVoiceOutcome:
        """Extracts candidate claims from vendor transcript turns, strictly preserving ambiguities."""
        default_curr = (
            (sanitized_context.currency if sanitized_context and hasattr(sanitized_context, "currency") and sanitized_context.currency else None)
            or expected_currency
            or "USD"
        )
        if not transcript:
            return ParsedVoiceOutcome(
                reported_availability=ReportedAvailability.UNKNOWN.value,
                outcome_status=VendorOutcomeStatus.NO_RESPONSE.value,
                quoted_price=None,
                currency=default_curr,
                summary="Empty transcript: No conversation turns recorded.",
                uncertainties=["No speech detected on call."],
            )

        # Separate vendor turns from agent turns
        vendor_turns = [t for t in transcript if t.speaker == TranscriptSpeaker.VENDOR]
        vendor_text = " ".join([t.text for t in vendor_turns]).strip()
        full_text = "\n".join([f"{t.speaker.value}: {t.text}" for t in transcript])

        if not vendor_text:
            return ParsedVoiceOutcome(
                reported_availability=ReportedAvailability.UNKNOWN.value,
                outcome_status=VendorOutcomeStatus.NO_RESPONSE.value,
                quoted_price=None,
                currency=default_curr,
                summary="No vendor responses recorded in transcript.",
                uncertainties=["Vendor did not speak or answer questions."],
            )

        uncertainties: List[str] = []

        # 1. Availability Extraction
        reported_avail, outcome_status, avail_ambiguous, avail_notes = self._parse_availability(vendor_text)
        uncertainties.extend(avail_notes)

        # 2. Price Extraction (inherits default_currency from authoritative event context)
        quoted_price, currency, price_ambiguous, price_notes = self._parse_price(vendor_text, default_currency=default_curr)
        uncertainties.extend(price_notes)

        # If a valid exact price was extracted, upgrade outcome_status to QUOTE_RECEIVED
        if quoted_price is not None and not price_ambiguous:
            outcome_status = VendorOutcomeStatus.QUOTE_RECEIVED.value

        # 3. Capacity Extraction
        capacity = self._parse_capacity(vendor_text)

        # 4. Constraints & Commitments
        constraints = self._parse_constraints(vendor_text)
        commitments = self._parse_commitments(vendor_text)

        # 5. Build Human-Readable Notes Summary
        task_label = (sanitized_context.task_name if sanitized_context else None) or "Service"
        summary_lines = [
            f"Voice Call Summary for {task_label}:",
            f"- Availability: {reported_avail}",
            f"- Quoted Price: {quoted_price} {currency}" if quoted_price is not None else "- Quoted Price: Not quoted or ambiguous",
            f"- Capacity: {capacity} guests/units" if capacity is not None else "- Capacity: Not specified",
        ]
        if constraints:
            summary_lines.append(f"- Vendor Constraints: {'; '.join(constraints)}")
        if commitments:
            summary_lines.append(f"- Vendor Commitments: {'; '.join(commitments)}")
        if uncertainties:
            summary_lines.append(f"- Uncertainties / Ambiguities: {'; '.join(uncertainties)}")

        summary_text = "\n".join(summary_lines)

        return ParsedVoiceOutcome(
            reported_availability=reported_avail,
            outcome_status=outcome_status,
            quoted_price=quoted_price,
            currency=currency,
            capacity=capacity,
            constraints=constraints,
            uncertainties=uncertainties,
            commitments=commitments,
            summary=summary_text,
        )

    def _parse_price(self, text: str, default_currency: str = "USD") -> Tuple[Optional[float], str, bool, List[str]]:
        """Extracts quoted price while strictly detecting currency and isolating ambiguity."""
        lower = text.lower()
        notes: List[str] = []

        # Determine explicit currency clues in text
        has_inr_marker = bool(re.search(r"(?:₹|rs\.?|inr|\brupees?\b|\blakhs?\b|\blacs?\b|\bcrores?\b)", lower))
        has_usd_marker = bool(re.search(r"(?:\$|\busd\b|\bdollars?\b|\bbucks?\b)", lower))
        has_eur_marker = bool(re.search(r"(?:€|\beur\b|\beuros?\b)", lower))
        has_gbp_marker = bool(re.search(r"(?:£|\bgbp\b|\bpounds?\b)", lower))

        explicit_currency = None
        if has_usd_marker and not (has_inr_marker or has_eur_marker or has_gbp_marker):
            explicit_currency = "USD"
        elif has_inr_marker and not (has_usd_marker or has_eur_marker or has_gbp_marker):
            explicit_currency = "INR"
        elif has_eur_marker and not (has_usd_marker or has_inr_marker or has_gbp_marker):
            explicit_currency = "EUR"
        elif has_gbp_marker and not (has_usd_marker or has_inr_marker or has_eur_marker):
            explicit_currency = "GBP"

        # Check for ambiguity markers directly adjacent to pricing
        ambiguity_pattern = (
            r"(?:around|approx|approximately|roughly|might be|maybe|probably|not sure|tentatively|estimated at|somewhere around)\s*"
            r"(?:₹|rs\.?|inr|\$|usd|eur|gbp)?\s*(\d+(?:,\d+)*(?:\.\d+)?)\s*(k|thousand|lakh|lac|m|million)?\b"
        )
        ambiguous_match = re.search(ambiguity_pattern, lower)
        if ambiguous_match:
            notes.append(f"Ambiguous price statement detected: '{ambiguous_match.group(0)}'. Exact price not finalized.")
            curr = explicit_currency or default_currency
            return None, curr, True, notes

        # Exact price patterns mapped to (pattern, explicit_currency_or_none)
        price_patterns: List[Tuple[str, Optional[str]]] = [
            # Explicit USD patterns
            (r"(?:\$)\s*(\d+(?:,\d+)*(?:\.\d+)?)\s*(k|thousand|m|million)?\b", "USD"),
            (r"\b(\d+(?:,\d+)*(?:\.\d+)?)\s*(k|thousand|m|million)?\s*(?:usd|dollars?|bucks?)\b", "USD"),
            (r"\b(?:usd|dollars?)\s*(\d+(?:,\d+)*(?:\.\d+)?)\s*(k|thousand|m|million)?\b", "USD"),
            (r"(?:charge|cost|rate|quote|fee|total|price|for)\s*(?:is|of|would be|at)?\s*\$\s*(\d+(?:,\d+)*(?:\.\d+)?)\s*(k|thousand|m|million)?\b", "USD"),
            (r"(?:charge|cost|rate|quote|fee|total|price|for)\s*(?:is|of|would be|at)?\s*(\d+(?:,\d+)*(?:\.\d+)?)\s*(k|thousand|m|million)?\s*(?:dollars?|usd)\b", "USD"),

            # Explicit INR patterns
            (r"(?:₹|rs\.?|inr)\s*(\d+(?:,\d+)*(?:\.\d+)?)\s*(k|thousand|lakh|lac)?\b", "INR"),
            (r"\b(\d+(?:,\d+)*(?:\.\d+)?)\s*(k|thousand|lakh|lac)\s*(?:rupees|inr)?\b", "INR"),
            (r"\b(\d+(?:,\d+)*(?:\.\d+)?)\s*(?:rupees|inr)\b", "INR"),
            (r"(?:charge|cost|rate|quote|fee|total|price|for)\s*(?:is|of|would be|at)?\s*(?:₹|rs\.?|inr)\s*(\d+(?:,\d+)*(?:\.\d+)?)\s*(k|thousand|lakh|lac)?\b", "INR"),
            (r"(?:charge|cost|rate|quote|fee|total|price|for)\s*(?:is|of|would be|at)?\s*(\d+(?:,\d+)*(?:\.\d+)?)\s*(k|thousand|lakh|lac)?\s*(?:rupees|inr)\b", "INR"),

            # Explicit EUR patterns
            (r"(?:€)\s*(\d+(?:,\d+)*(?:\.\d+)?)\s*(k|thousand|m|million)?\b", "EUR"),
            (r"\b(\d+(?:,\d+)*(?:\.\d+)?)\s*(k|thousand|m|million)?\s*(?:eur|euros?)\b", "EUR"),

            # Explicit GBP patterns
            (r"(?:£)\s*(\d+(?:,\d+)*(?:\.\d+)?)\s*(k|thousand|m|million)?\b", "GBP"),
            (r"\b(\d+(?:,\d+)*(?:\.\d+)?)\s*(k|thousand|m|million)?\s*(?:gbp|pounds?)\b", "GBP"),

            # Contextual rate/quote without explicit symbol (inherits explicit_currency or default_currency)
            (r"(?:charge|cost|rate|quote|fee|total|price)\s*(?:is|of|would be|at)?\s*(\d+(?:,\d+)*(?:\.\d+)?)\s*(k|thousand|lakh|lac|m|million)?\b", None),
            (r"(?:for)\s*(?:is|of|would be|at)?\s*(\d+(?:,\d+)*(?:\.\d+)?)\s*(k|thousand|lakh|lac|m|million)?\b", None),
        ]

        for pat, pat_curr in price_patterns:
            m = re.search(pat, lower)
            if m:
                raw_num = m.group(1).replace(",", "")
                try:
                    val = float(raw_num)
                    multiplier = m.group(2) if len(m.groups()) >= 2 else None
                    if multiplier in ("k", "thousand"):
                        val *= 1000.0
                    elif multiplier in ("lakh", "lac"):
                        val *= 100000.0
                    elif multiplier in ("m", "million"):
                        val *= 1000000.0
                    resolved_currency = pat_curr or explicit_currency or default_currency
                    return round(val, 2), resolved_currency, False, notes
                except (ValueError, TypeError):
                    continue

        return None, (explicit_currency or default_currency), False, notes

    def _parse_availability(self, text: str) -> Tuple[str, str, bool, List[str]]:
        """Extracts availability claim and flags conversational vs explicit statements."""
        lower = text.lower()
        notes: List[str] = []

        # 1. Definite Unavailability
        unavail_patterns = [
            r"\b(?:not available|unavailable|fully booked|already booked|booked up|no slots|cannot take|busy that day|not taking)\b",
        ]
        if any(re.search(p, lower) for p in unavail_patterns):
            return ReportedAvailability.UNAVAILABLE.value, VendorOutcomeStatus.UNAVAILABLE.value, False, notes

        # 2. Ambiguous / Conditional Availability
        conditional_patterns = [
            r"\b(?:let me check|have to check|not sure|might be able to|should be able to|probably|tentative|subject to|maybe)\b",
        ]
        if any(re.search(p, lower) for p in conditional_patterns):
            notes.append("Vendor expressed conditional or tentative availability ('let me check' / 'probably' / 'should be able to').")
            return ReportedAvailability.CONDITIONAL.value, VendorOutcomeStatus.INTERESTED.value, True, notes

        # 3. Definite Availability
        avail_patterns = [
            r"\b(?:yes,?\s+we are available|we are available|available on|can do it|can take this|can cater|date is open|we have availability)\b",
        ]
        if any(re.search(p, lower) for p in avail_patterns):
            return ReportedAvailability.AVAILABLE.value, VendorOutcomeStatus.AVAILABLE.value, False, notes

        # Default fallback
        return ReportedAvailability.UNKNOWN.value, VendorOutcomeStatus.CONTACTED.value, True, ["Availability was not explicitly stated."]

    def _parse_capacity(self, text: str) -> Optional[int]:
        """Extracts guest/unit capacity claim."""
        lower = text.lower()
        m = re.search(r"(\d+(?:,\d+)*)\s*(?:guests|people|pax|chairs|plates|attendees|persons)\b", lower)
        if m:
            try:
                return int(m.group(1).replace(",", ""))
            except (ValueError, TypeError):
                return None
        return None

    def _parse_constraints(self, text: str) -> List[str]:
        """Extracts specific operational constraints from vendor statements."""
        lower = text.lower()
        constraints = []
        if "advance" in lower or "deposit" in lower:
            constraints.append("Advance deposit required")
        if "gst" in lower or "tax" in lower:
            constraints.append("Taxes / GST terms mentioned")
        if "transport" in lower or "travel" in lower:
            constraints.append("Transportation terms mentioned")
        if "generator" in lower or "power" in lower:
            constraints.append("Power backup requirement")
        if "setup" in lower and ("hour" in lower or "time" in lower):
            constraints.append("Specific setup duration requirement")
        return constraints

    def _parse_commitments(self, text: str) -> List[str]:
        """Extracts affirmative vendor commitments from vendor statements."""
        lower = text.lower()
        commitments = []
        if "provide" in lower or "bring" in lower:
            commitments.append("Equipment / service provision commitment")
        if "clean" in lower or "pack" in lower:
            commitments.append("Post-event cleanup / teardown")
        if "staff" in lower or "crew" in lower or "team" in lower:
            commitments.append("Dedicated on-site crew included")
        return commitments


# ---------------------------------------------------------------------------
# 3. Pipeline Result Data Model
# ---------------------------------------------------------------------------

class VoiceOutcomeResult(BaseModel):
    """Authoritative result returned by VoiceOutcomePipeline."""
    outcome_id: str
    session_id: str
    event_id: str
    provider_id: str
    task_id: Optional[str] = None
    outcome: Any = None
    validation: Optional[Any] = None
    negotiation_decision: Optional[Any] = None
    binding_decision: Optional[Any] = None
    binding_result: Optional[Any] = None
    is_bound: bool = False
    idempotent_replay: bool = False

    model_config = ConfigDict(arbitrary_types_allowed=True)


# ---------------------------------------------------------------------------
# 4. Voice Outcome Pipeline (End-to-End Orchestrator)
# ---------------------------------------------------------------------------

class VoiceOutcomePipeline:
    """Orchestrates parsing, validation, and optional binding for voice calls."""

    def __init__(
        self,
        db: Session,
        parser: Optional[VoiceOutcomeParser] = None,
    ):
        self.db = db
        self.parser: VoiceOutcomeParser = parser or VoiceOutcomeParser()
        self.outcome_service: VendorOutcomeService = VendorOutcomeService(db)
        self.validation_service: VendorOutcomeValidationService = VendorOutcomeValidationService(db)
        self.binding_service: VendorTaskBindingService = VendorTaskBindingService(db)

    def process_call_completion(
        self,
        bridge: Optional[GeminiLiveBridge] = None,
        session_id: Optional[str] = None,
        event_id: Optional[str] = None,
        task_id: Optional[str] = None,
        provider_id: Optional[str] = None,
        call_sid: Optional[str] = None,
        stream_sid: Optional[str] = None,
        transcript: Optional[List[TranscriptEntry]] = None,
        sanitized_context: Optional[SanitizedVoiceContext] = None,
        authorizing_user_id: Optional[str] = None,
        auto_bind: bool = False,
    ) -> VoiceOutcomeResult:
        """Processes a completed voice session through the full deterministic EVENTRA pipeline.
        
        Lifecycle:
        1. Correlation & Identity Resolution
        2. Idempotency Check
        3. Factual Claim Extraction via VoiceOutcomeParser
        4. Candidate VendorOutcome creation (VendorOutcomeService) with source="AI_VOICE_CALL"
        5. Deterministic Claim Validation (VendorOutcomeValidationService)
        6. Optional Task Binding (strictly requiring explicit organizer authorization or pre-approved engagement)
        """
        # 1. Resolve Correlation Identifiers
        if bridge is not None:
            conv_state = bridge.get_conversation_state()
            session_id = session_id or conv_state.get("session_id")
            call_sid = call_sid or conv_state.get("call_sid")
            stream_sid = stream_sid or conv_state.get("stream_sid")
            event_id = event_id or conv_state.get("event_id")
            task_id = task_id or conv_state.get("task_id")
            provider_id = provider_id or conv_state.get("provider_id")
            if transcript is None:
                transcript = bridge.get_transcript()
            if sanitized_context is None:
                sanitized_context = bridge.get_sanitized_context()

        if not event_id:
            raise BadRequestException("event_id is required for voice outcome processing.")
        if not provider_id:
            raise BadRequestException("provider_id is required for voice outcome processing.")
        if not session_id:
            raise BadRequestException("session_id is required for voice outcome processing.")

        transcript_list = list(transcript or [])

        # 2. Strict Idempotency Check
        # Inspect if an outcome for this session_id has already been recorded
        existing_outcomes = (
            self.db.query(VendorOutcome)
            .filter(
                VendorOutcome.event_id == event_id,
                VendorOutcome.provider_id == provider_id,
            )
            .all()
        )
        for existing in existing_outcomes:
            if isinstance(existing.vendor_response, dict) and existing.vendor_response.get("session_id") == session_id:
                logger.info(
                    "Idempotent replay: Voice call session '%s' already recorded as outcome '%s'.",
                    session_id,
                    existing.id,
                )
                existing_val = self.validation_service.get_validation(existing.id)
                return VoiceOutcomeResult(
                    outcome_id=existing.id,
                    session_id=session_id,
                    event_id=event_id,
                    provider_id=provider_id,
                    task_id=existing.task_id or task_id,
                    outcome=existing,
                    validation=existing_val,
                    binding_decision=None,
                    binding_result=None,
                    is_bound=False,
                    idempotent_replay=True,
                )

        # 3. Parse Voice Transcript
        event = self.db.query(Event).filter(Event.id == event_id).first()
        event_currency = event.currency if event and event.currency else "USD"
        parsed = self.parser.parse(
            transcript_list,
            sanitized_context=sanitized_context,
            expected_currency=event_currency,
        )

        # 4. Construct Structured VendorOutcome Payload
        transcript_formatted = "\n".join([f"{t.speaker.value}: {t.text}" for t in transcript_list])
        notes_body = f"{parsed.summary}\n\nFULL TRANSCRIPT:\n{transcript_formatted}"

        structured_response = {
            "session_id": session_id,
            "call_sid": call_sid,
            "stream_sid": stream_sid,
            "provenance": {
                "source": "AI_VOICE_CALL",
                "channel": "EXOTEL_AGENTSTREAM_GEMINI_LIVE",
                "session_id": session_id,
                "call_sid": call_sid,
                "stream_sid": stream_sid,
            },
            "claims": {
                "reported_availability": parsed.reported_availability,
                "quoted_price": parsed.quoted_price,
                "currency": parsed.currency,
                "capacity": parsed.capacity,
                "constraints": parsed.constraints,
                "uncertainties": parsed.uncertainties,
                "commitments": parsed.commitments,
            },
            "transcript_turns": len(transcript_list),
        }

        outcome_create = VendorOutcomeCreate(
            provider_id=provider_id,
            task_id=task_id,
            communication_channel=CommunicationChannel.PHONE.value,
            outcome_status=parsed.outcome_status,
            quoted_price=parsed.quoted_price,
            currency=parsed.currency,
            reported_availability=parsed.reported_availability,
            organizer_notes=notes_body,
            vendor_response=structured_response,
            source="AI_VOICE_CALL",
            submitted_by="voice_agent",
        )

        # 5. Persist Candidate VendorOutcome via VendorOutcomeService
        outcome = self.outcome_service.record_outcome(
            event_id=event_id,
            payload=outcome_create,
            submitted_by="voice_agent",
        )

        # 6. Run Deterministic Validation via VendorOutcomeValidationService
        validation = self.validation_service.validate_outcome(
            outcome_id=outcome.id,
            event_id=event_id,
        )

        # 6b. Deterministic Negotiation Evaluation
        negotiation_decision: Optional[Any] = None
        assignment = (
            self.db.query(VendorAssignment)
            .filter(
                VendorAssignment.event_id == event_id,
                VendorAssignment.vendor_id == provider_id,
            )
            .first()
        )
        if assignment and (parsed.quoted_price is not None or parsed.reported_availability is not None):
            try:
                from app.services.voice_negotiation_service import VoiceNegotiationService
                from app.schemas.voice_negotiation import StructuredNegotiationResult
                voice_neg_service = VoiceNegotiationService(self.db)
                neg_ctx = voice_neg_service.build_negotiation_context(
                    event_id=event_id,
                    provider_id=provider_id,
                    task_id=task_id,
                    session_id=session_id,
                    call_sid=call_sid,
                    stream_sid=stream_sid,
                )
                neg_result = StructuredNegotiationResult(
                    availability=parsed.reported_availability == ReportedAvailability.AVAILABLE.value if parsed.reported_availability != ReportedAvailability.UNKNOWN.value else None,
                    quoted_price=parsed.quoted_price,
                    currency=parsed.currency,
                    constraints=parsed.constraints,
                    status="NEEDS_CLARIFICATION" if parsed.uncertainties else "VALIDATED",
                    is_ambiguous=bool(parsed.uncertainties),
                    raw_conversational_provenance={"session_id": session_id, "notes": notes_body},
                )
                negotiation_decision = voice_neg_service.evaluate_vendor_response(
                    context=neg_ctx,
                    response=neg_result,
                    authorizing_user_id=authorizing_user_id,
                )
            except Exception as e:
                logger.warning("Voice negotiation evaluation skipped or encountered error: %s", e)

        # 7. Evaluate Feasibility and Bind via VendorTaskBindingService
        decision: Optional[BindingDecision] = None
        binding_res: Optional[VendorTaskBindingResponse] = None
        is_bound: bool = False

        if auto_bind and task_id:
            # 7a. Deterministic Feasibility Evaluation
            decision = self.binding_service.evaluate_feasibility(
                event_id=event_id,
                task_id=task_id,
                provider_id=provider_id,
                validation_id=validation.id,
            )

            # 7b. Enforce Authorization & Engagement Boundaries
            # A voice transcript is untrusted vendor input. Conversational claims
            # NEVER cause contractual vendor binding without explicit organizer authorization
            # or pre-existing confirmed/approved engagement.
            has_auth = False
            auth_block_reason = None

            if authorizing_user_id:
                is_auth, auth_err = self.binding_service._verify_authorization(event_id, authorizing_user_id)
                if is_auth:
                    has_auth = True
                else:
                    auth_block_reason = auth_err or f"User '{authorizing_user_id}' lacks VENDOR_ASSIGN permission."
            else:
                # Check for existing pre-approved or confirmed engagement
                assignment = (
                    self.db.query(VendorAssignment)
                    .filter(
                        VendorAssignment.event_id == event_id,
                        VendorAssignment.vendor_id == provider_id,
                    )
                    .first()
                )
                if assignment:
                    if assignment.status == "CONFIRMED" or assignment.negotiation_status == NegotiationStatus.CONFIRMED.value:
                        has_auth = True
                    elif assignment.approval_id:
                        appr = (
                            self.db.query(Approval)
                            .filter(Approval.id == assignment.approval_id, Approval.status == "APPROVED")
                            .first()
                        )
                        if appr:
                            has_auth = True

            if decision.can_bind:
                if has_auth:
                    binding_res = self.binding_service.bind_vendor_to_task(
                        event_id=event_id,
                        task_id=task_id,
                        provider_id=provider_id,
                        validation_id=validation.id,
                        user_id=authorizing_user_id,
                    )
                    is_bound = getattr(binding_res, "binding_status", None) == BindingStatus.BOUND
                else:
                    decision = BindingDecision(
                        decision="BLOCK",
                        can_bind=False,
                        reason=auth_block_reason or "Binding from voice outcome strictly requires explicit organizer authorization or pre-approved engagement.",
                        reason_code=BlockingReason.APPROVAL_REQUIRED if not auth_block_reason else BlockingReason.UNAUTHORIZED,
                        blocking_factors=[auth_block_reason or "Voice conversational claims cannot autonomously commit contractual assignment without approval."],
                        validation_id=validation.id,
                        provider_id=provider_id,
                        task_id=task_id,
                        event_id=event_id,
                    )
                    logger.info(
                        "Vendor '%s' blocked from binding to task '%s': %s",
                        provider_id,
                        task_id,
                        decision.reason,
                    )
            else:
                logger.info(
                    "Vendor '%s' blocked from binding to task '%s': %s (factors=%s)",
                    provider_id,
                    task_id,
                    decision.reason,
                    decision.blocking_factors,
                )

        return VoiceOutcomeResult(
            outcome_id=outcome.id,
            session_id=session_id,
            event_id=event_id,
            provider_id=provider_id,
            task_id=task_id,
            outcome=outcome,
            validation=validation,
            negotiation_decision=negotiation_decision,
            binding_decision=decision,
            binding_result=binding_res,
            is_bound=is_bound,
            idempotent_replay=False,
        )
