"""EVENTRA Authoritative Voice Context Builder (Task 4).

Dynamically prepares safe, task-specific, read-only context for Gemini Live
before and during vendor calls.

Key Principles:
1. EVENTRA IS AUTHORITATIVE:
   - Context is retrieved from authoritative EVENTRA database models (Event, Task, Vendor, VendorAssignment).
   - Gemini is strictly conversational intelligence; it never owns or mutates EVENTRA state.
2. TASK-SPECIFIC & STRICT WHITELIST:
   - Includes only fields required for the specific vendor conversation (e.g., event date/location,
     task requirements, capabilities, constraints).
3. EXPLICIT SENSITIVITY STRIPPING:
   - Explicitly forbids and strips organizer total budget, internal margins, alternative quotes,
     recovery strategies, credentials, private notes, risk scores, and authorization internals.
4. CONTROLLED NEGOTIATION BOUNDARIES:
   - Negotiation position is included ONLY when EVENTRA explicitly authorizes it.
   - Internal budget ceilings, margins, or alternative quote calculations are never exposed.
5. DETERMINISTIC & BOUNDED VALIDATION:
   - Verifies event/task/vendor relationships (e.g. task belongs to the event).
   - Enforces character size boundaries to prevent token explosion or prompt injection.
   - Fails closed safely if context is ambiguous, invalid, or missing.
"""
from datetime import datetime
import json
import logging
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field, model_validator
from sqlalchemy.orm import Session

from app.models.event import Event
from app.models.task import Task
from app.models.vendor import Vendor
from app.models.vendor_assignment import VendorAssignment

logger = logging.getLogger(__name__)

# Maximum total character limit for serialized context strings to prevent oversized injection
MAX_CONTEXT_CHAR_LIMIT = 4000

# Blacklisted sensitive keys that must NEVER appear in the context supplied to Gemini
FORBIDDEN_SENSITIVE_PATTERNS = {
    "budget",
    "total_budget",
    "margin",
    "internal_margin",
    "target_margin",
    "internal_notes",
    "private_notes",
    "notes_internal",
    "alternative_quotes",
    "alternative_vendor_quotes",
    "quotes_comparison",
    "max_cost",
    "max_approved_amount",
    "ceiling",
    "secret",
    "token",
    "key",
    "api_key",
    "auth",
    "authorization",
    "credential",
    "credentials",
    "recovery_strategy",
    "risk_score",
    "approval_state",
    "hidden_ranking",
}


class VoiceContextValidationError(Exception):
    """Raised when authoritative voice context validation fails."""
    pass


class AuthorizedNegotiationContext(BaseModel):
    """Explicitly authorized negotiation constraints supplied by EVENTRA."""
    authorized: bool = False
    target_price: Optional[float] = None
    currency: str = "USD"
    constraints: List[str] = Field(default_factory=list)


class SanitizedVoiceContext(BaseModel):
    """Whitelisted, sanitized task-specific context provided to Gemini Live."""
    # Correlation & identity
    session_id: str
    call_sid: Optional[str] = None
    stream_sid: Optional[str] = None
    event_id: Optional[str] = None
    task_id: Optional[str] = None
    provider_id: Optional[str] = None

    # Event context (safe fields only)
    event_name: Optional[str] = None
    event_type: Optional[str] = None
    event_date: Optional[str] = None
    event_time_window: Optional[str] = None
    event_location: Optional[str] = None
    guest_count: Optional[int] = None
    currency: str = "USD"

    # Task context (safe fields only)
    task_name: Optional[str] = None
    task_title: Optional[str] = None  # Alias for backward compatibility
    task_description: Optional[str] = None
    service_category: Optional[str] = None
    service_type: Optional[str] = None  # Alias for backward compatibility
    duration_minutes: Optional[int] = None
    technical_constraints: List[str] = Field(default_factory=list)
    required_capabilities: List[str] = Field(default_factory=list)

    # Vendor context (safe fields only)
    vendor_name: Optional[str] = None
    vendor_phone: Optional[str] = None
    vendor_city: Optional[str] = None

    # Authorized negotiation boundaries
    negotiation: AuthorizedNegotiationContext = Field(default_factory=AuthorizedNegotiationContext)

    # Conversational goal & recovery objective
    inquiry_goal: str = "Inquire about service availability, technical capability, and pricing quotation."
    call_objective: Optional[str] = None
    is_urgent_recovery: bool = False
    recovery_option_id: Optional[str] = None

    @model_validator(mode="after")
    def sync_aliases(self) -> "SanitizedVoiceContext":
        """Syncs task_name/task_title and service_category/service_type aliases."""
        if not self.task_title and self.task_name:
            self.task_title = self.task_name
        elif not self.task_name and self.task_title:
            self.task_name = self.task_title

        if not self.service_category and self.service_type:
            self.service_category = self.service_type
        elif not self.service_type and self.service_category:
            self.service_type = self.service_category
        return self


class VoiceContextBuilder:
    """Produces sanitized, deterministic voice context from EVENTRA state."""

    def __init__(self, max_char_limit: int = MAX_CONTEXT_CHAR_LIMIT):
        self.max_char_limit = max_char_limit

    def build(
        self,
        event_id: Optional[str] = None,
        task_id: Optional[str] = None,
        provider_id: Optional[str] = None,
        session_id: Optional[str] = None,
        call_sid: Optional[str] = None,
        stream_sid: Optional[str] = None,
        db: Optional[Session] = None,
        custom_parameters: Optional[Dict[str, Any]] = None,
        negotiation_auth: Optional[Dict[str, Any]] = None,
        vendor_phone: Optional[str] = None,
    ) -> SanitizedVoiceContext:
        """Builds and validates authoritative SanitizedVoiceContext."""
        params = dict(custom_parameters or {})
        session_id = session_id or params.get("session_id") or "sess_default"

        # 1. Authoritative Database Resolution (when db is provided)
        if db is not None:
            return self._build_from_db(
                db=db,
                event_id=event_id or params.get("event_id"),
                task_id=task_id or params.get("task_id"),
                provider_id=provider_id or params.get("provider_id"),
                session_id=session_id,
                call_sid=call_sid or params.get("call_sid"),
                stream_sid=stream_sid or params.get("stream_sid"),
                custom_parameters=params,
                negotiation_auth=negotiation_auth,
                vendor_phone=vendor_phone,
            )

        # 2. Parameter-based resolution (when db is None or in unit tests)
        return self._build_from_params(
            event_id=event_id or params.get("event_id"),
            task_id=task_id or params.get("task_id"),
            provider_id=provider_id or params.get("provider_id"),
            session_id=session_id,
            call_sid=call_sid or params.get("call_sid"),
            stream_sid=stream_sid or params.get("stream_sid"),
            params=params,
            negotiation_auth=negotiation_auth,
            vendor_phone=vendor_phone,
        )

    def build_from_session(
        self,
        session: Any,
        db: Optional[Session] = None,
    ) -> SanitizedVoiceContext:
        """Builds SanitizedVoiceContext directly from an active ExotelVoiceSession."""
        params = getattr(session, "custom_parameters", {}) or {}
        negotiation_auth = params.get("negotiation_auth") or params.get("negotiation")
        phone = getattr(session, "to_number", None) or params.get("vendor_phone") or params.get("phone")

        return self.build(
            event_id=params.get("event_id"),
            task_id=params.get("task_id"),
            provider_id=params.get("provider_id"),
            session_id=getattr(session, "session_id", None) or params.get("session_id"),
            call_sid=getattr(session, "call_sid", None) or params.get("call_sid"),
            stream_sid=getattr(session, "stream_sid", None) or params.get("stream_sid"),
            db=db,
            custom_parameters=params,
            negotiation_auth=negotiation_auth if isinstance(negotiation_auth, dict) else None,
            vendor_phone=phone,
        )

    def _build_from_db(
        self,
        db: Session,
        event_id: Optional[str],
        task_id: Optional[str],
        provider_id: Optional[str],
        session_id: str,
        call_sid: Optional[str],
        stream_sid: Optional[str],
        custom_parameters: Dict[str, Any],
        negotiation_auth: Optional[Dict[str, Any]],
        vendor_phone: Optional[str] = None,
    ) -> SanitizedVoiceContext:
        """Retrieves and validates authoritative state from SQLAlchemy DB models."""
        event: Optional[Event] = None
        task: Optional[Task] = None
        vendor: Optional[Vendor] = None
        assignment: Optional[VendorAssignment] = None

        # 1. Fetch Event
        if event_id:
            event = db.query(Event).filter(Event.id == event_id).first()
            if not event:
                raise VoiceContextValidationError(f"Authoritative Event '{event_id}' not found.")

        # 2. Fetch Task
        if task_id:
            task = db.query(Task).filter(Task.id == task_id).first()
            if not task:
                raise VoiceContextValidationError(f"Authoritative Task '{task_id}' not found.")

            # Verify Task <-> Event relationship
            if event and task.event_id != event.id:
                raise VoiceContextValidationError(
                    f"Relationship violation: Task '{task_id}' belongs to event '{task.event_id}', not '{event.id}'."
                )

        # 3. Fetch Vendor
        if provider_id:
            vendor = db.query(Vendor).filter(Vendor.id == provider_id).first()
            if not vendor:
                raise VoiceContextValidationError(f"Authoritative Vendor '{provider_id}' not found.")

            # Verify Vendor <-> Task relationship if task is bound
            if task and task.provider_id and task.provider_id != vendor.id:
                raise VoiceContextValidationError(
                    f"Relationship violation: Task '{task_id}' is assigned to vendor '{task.provider_id}', not '{vendor.id}'."
                )

        # 4. Fetch VendorAssignment
        if event and vendor:
            assignment = (
                db.query(VendorAssignment)
                .filter(
                    VendorAssignment.event_id == event.id,
                    VendorAssignment.vendor_id == vendor.id,
                )
                .first()
            )

        # 5. Build Authorized Negotiation Context
        event_currency = event.currency if event and event.currency else "USD"
        negotiation = self._resolve_negotiation(
            negotiation_auth=negotiation_auth,
            assignment=assignment,
            default_currency=event_currency,
        )

        # 6. Extract safe fields
        event_date_str = None
        event_time_str = None
        if event and event.start_datetime:
            event_date_str = event.start_datetime.strftime("%Y-%m-%d")
            event_time_str = event.start_datetime.strftime("%H:%M")

        caps = []
        if vendor and vendor.capabilities:
            if isinstance(vendor.capabilities, list):
                caps = [str(c) for c in vendor.capabilities if c]
            elif isinstance(vendor.capabilities, str):
                caps = [c.strip() for c in vendor.capabilities.split(",") if c.strip()]

        context = SanitizedVoiceContext(
            session_id=session_id,
            call_sid=call_sid,
            stream_sid=stream_sid,
            event_id=event.id if event else event_id,
            task_id=task.id if task else task_id,
            provider_id=vendor.id if vendor else provider_id,
            event_name=event.name if event else custom_parameters.get("event_name"),
            event_type=event.event_type if event else custom_parameters.get("event_type"),
            event_date=event_date_str or custom_parameters.get("event_date"),
            event_time_window=event_time_str or custom_parameters.get("event_time_window"),
            event_location=event.location if event else custom_parameters.get("event_location"),
            guest_count=event.guest_count if event else custom_parameters.get("guest_count"),
            currency=event_currency,
            task_name=task.name if task else (custom_parameters.get("task_name") or custom_parameters.get("task_title")),
            task_description=task.description if task else custom_parameters.get("task_description"),
            service_category=task.required_provider_category if task else (custom_parameters.get("service_category") or custom_parameters.get("service_type")),
            duration_minutes=task.duration_minutes if task else custom_parameters.get("duration_minutes"),
            technical_constraints=self._clean_string_list(custom_parameters.get("technical_constraints")),
            required_capabilities=caps or self._clean_string_list(custom_parameters.get("required_capabilities")),
            vendor_name=vendor.name if vendor else custom_parameters.get("vendor_name"),
            vendor_phone=vendor.contact_phone if vendor else (custom_parameters.get("vendor_phone") or custom_parameters.get("phone")),
            vendor_city=vendor.city if vendor else custom_parameters.get("vendor_city"),
            negotiation=negotiation,
            inquiry_goal=custom_parameters.get("inquiry_goal") or "Inquire about service availability, technical capability, and pricing quotation.",
            call_objective=custom_parameters.get("call_objective"),
            is_urgent_recovery=bool(custom_parameters.get("is_urgent_recovery", False)),
            recovery_option_id=custom_parameters.get("recovery_option_id"),
        )

        self._validate_size(context)
        return context

    def _build_from_params(
        self,
        event_id: Optional[str],
        task_id: Optional[str],
        provider_id: Optional[str],
        session_id: str,
        call_sid: Optional[str],
        stream_sid: Optional[str],
        params: Dict[str, Any],
        negotiation_auth: Optional[Dict[str, Any]],
        vendor_phone: Optional[str] = None,
    ) -> SanitizedVoiceContext:
        """Constructs sanitized context from dictionaries with strict relationship and blacklist checks."""
        # 1. Relationship checks when IDs and parent IDs are present in parameters
        task_event_id = params.get("task_event_id")
        if event_id and task_event_id and task_event_id != event_id:
            raise VoiceContextValidationError(
                f"Relationship violation: Task belongs to event '{task_event_id}', not '{event_id}'."
            )

        task_provider_id = params.get("task_provider_id")
        if provider_id and task_provider_id and task_provider_id != provider_id:
            raise VoiceContextValidationError(
                f"Relationship violation: Task is bound to provider '{task_provider_id}', not '{provider_id}'."
            )

        def get_safe_str(key: str) -> Optional[str]:
            if any(forbidden in key.lower() for forbidden in FORBIDDEN_SENSITIVE_PATTERNS):
                return None
            val = params.get(key)
            return str(val).strip() if val is not None and not isinstance(val, (dict, list)) else None

        default_currency = get_safe_str("currency") or params.get("event_currency") or "USD"

        # 2. Resolve Negotiation
        negotiation = self._resolve_negotiation(
            negotiation_auth=negotiation_auth or params.get("negotiation") or params.get("negotiation_auth"),
            assignment=None,
            default_currency=default_currency,
        )

        # Format guest count safely
        guest_count = None
        raw_guests = params.get("guest_count")
        if raw_guests is not None:
            try:
                guest_count = int(raw_guests)
            except (ValueError, TypeError):
                guest_count = None

        # Format duration safely
        duration_minutes = None
        raw_dur = params.get("duration_minutes")
        if raw_dur is not None:
            try:
                duration_minutes = int(raw_dur)
            except (ValueError, TypeError):
                duration_minutes = None

        context = SanitizedVoiceContext(
            session_id=session_id,
            call_sid=call_sid,
            stream_sid=stream_sid,
            event_id=get_safe_str("event_id") or event_id,
            task_id=get_safe_str("task_id") or task_id,
            provider_id=get_safe_str("provider_id") or provider_id,
            event_name=get_safe_str("event_name"),
            event_type=get_safe_str("event_type"),
            event_date=get_safe_str("event_date"),
            event_time_window=get_safe_str("event_time_window"),
            event_location=get_safe_str("event_location"),
            guest_count=guest_count,
            currency=default_currency,
            task_name=get_safe_str("task_name") or get_safe_str("task_title"),
            task_description=get_safe_str("task_description"),
            service_category=get_safe_str("service_category") or get_safe_str("service_type"),
            duration_minutes=duration_minutes,
            technical_constraints=self._clean_string_list(params.get("technical_constraints")),
            required_capabilities=self._clean_string_list(params.get("required_capabilities")),
            vendor_name=get_safe_str("vendor_name"),
            vendor_phone=vendor_phone or get_safe_str("vendor_phone") or get_safe_str("phone"),
            vendor_city=get_safe_str("vendor_city"),
            negotiation=negotiation,
            inquiry_goal=get_safe_str("inquiry_goal") or "Inquire about service availability, technical capability, and pricing quotation.",
            call_objective=get_safe_str("call_objective"),
            is_urgent_recovery=bool(params.get("is_urgent_recovery", False)),
            recovery_option_id=get_safe_str("recovery_option_id"),
        )

        self._validate_size(context)
        return context

    def _resolve_negotiation(
        self,
        negotiation_auth: Optional[Dict[str, Any]],
        assignment: Optional[VendorAssignment],
        default_currency: str = "USD",
    ) -> AuthorizedNegotiationContext:
        """Enforces that negotiation position is present ONLY if explicitly authorized."""
        if not negotiation_auth or not isinstance(negotiation_auth, dict):
            return AuthorizedNegotiationContext(authorized=False, currency=default_currency)

        is_authorized = bool(negotiation_auth.get("authorized", False))
        if not is_authorized:
            return AuthorizedNegotiationContext(authorized=False, currency=default_currency)

        # Target price: must be explicitly provided in negotiation_auth
        raw_price = negotiation_auth.get("target_price")
        if raw_price is None and assignment and assignment.target_amount:
            raw_price = assignment.target_amount

        if raw_price is None:
            # Cannot negotiate without an explicit target price
            return AuthorizedNegotiationContext(authorized=False, currency=default_currency)

        try:
            target_price = float(raw_price)
        except (ValueError, TypeError):
            logger.warning("Invalid target_price in negotiation authorization: %s", raw_price)
            return AuthorizedNegotiationContext(authorized=False, currency=default_currency)

        currency = str(
            negotiation_auth.get("currency")
            or (assignment.currency if assignment and assignment.currency else default_currency)
        ).strip()
        raw_constraints = negotiation_auth.get("constraints") or []
        constraints = [str(c).strip() for c in raw_constraints if str(c).strip()]

        return AuthorizedNegotiationContext(
            authorized=True,
            target_price=target_price,
            currency=currency,
            constraints=constraints,
        )

    def _clean_string_list(self, raw_list: Any) -> List[str]:
        """Cleans and filters lists of strings, removing forbidden keywords."""
        if not raw_list or not isinstance(raw_list, list):
            return []
        cleaned = []
        for item in raw_list:
            if not isinstance(item, str):
                continue
            item_str = item.strip()
            if any(forbidden in item_str.lower() for forbidden in FORBIDDEN_SENSITIVE_PATTERNS):
                continue
            if item_str:
                cleaned.append(item_str)
        return cleaned

    def _validate_size(self, context: SanitizedVoiceContext) -> None:
        """Validates that total context size is bounded to prevent oversized injections."""
        serialized = json.dumps(context.model_dump(), default=str)
        total_chars = len(serialized)
        if total_chars > self.max_char_limit:
            raise VoiceContextValidationError(
                f"Sanitized voice context exceeds maximum character limit ({total_chars} > {self.max_char_limit})."
            )
