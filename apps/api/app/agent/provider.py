"""LLM Provider abstraction for the Event Operations Agent.

Provides an abstract LLM interface, a RealLLMProvider for real Google Gemini model
invocations, and a MockLLMProvider strictly for automated testing and offline fallback.
"""
from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional, Type, TypeVar, Union
import json
import logging
import os
import time
import warnings

from pydantic import BaseModel, Field, ValidationError
from pydantic_core import PydanticUndefined

from app.agent.errors import (
    LLMError,
    MissingAPIKeyError,
    UnsupportedProviderError,
    GeminiAuthError,
    GeminiAPIError,
    ModelInvocationError,
    LLMTimeoutError,
    MalformedOutputError,
    StructuredValidationError,
)

logger = logging.getLogger(__name__)

T = TypeVar("T", bound=BaseModel)


# --- Structured schemas for existing agent operational workflows ---

class IncidentInterpretationOutput(BaseModel):
    interpreted_type: str = Field(..., description="Operational incident category enum")
    requires_recovery: bool = Field(..., description="Whether automated or manual recovery planning is needed")
    priority: str = Field("HIGH", description="Priority level: LOW, MEDIUM, HIGH, CRITICAL")
    summary: str = Field(..., description="Concise operational summary of the situation")


class RecoverySelectionOutput(BaseModel):
    selected_option_id: Optional[str] = Field(None, description="The ID of the recommended candidate option")
    rationale: str = Field(..., description="Clear operational rationale for why this option was chosen")


class LLMProvider(ABC):
    """Abstract base class for LLM providers."""

    @abstractmethod
    def generate_text(
        self,
        system_prompt: Optional[str],
        user_prompt: str,
    ) -> str:
        """Generates plain text operational message or response."""
        pass

    @abstractmethod
    def generate_structured(
        self,
        system_prompt: Optional[str],
        user_prompt: str,
        output_schema: Type[T],
    ) -> T:
        """Generates a structured response strictly validated against output_schema (Pydantic model)."""
        pass

    @abstractmethod
    def interpret_incident(
        self,
        user_message: str,
        event_context: Dict[str, Any],
        open_incidents: List[Dict[str, Any]],
    ) -> Dict[str, Any]:
        """Interprets the natural language operational situation."""
        pass

    @abstractmethod
    def select_recovery_strategy(
        self,
        candidate_options: List[Dict[str, Any]],
        incident_context: Dict[str, Any],
        risk_context: Dict[str, Any],
    ) -> Optional[str]:
        """Reasons over deterministic candidate options and selects the optimal recovery option ID."""
        pass

    @abstractmethod
    def format_operational_response(
        self,
        status: str,
        context: Dict[str, Any],
    ) -> str:
        """Formats a clear, concise operational status message for the event operator."""
        pass


class MockLLMProvider(LLMProvider):
    """Deterministic mock provider strictly for automated tests and offline environments.
    
    WARNING: This is a test/offline fallback mock, NOT a live LLM.
    Ensures tests pass deterministically without external network or API key dependencies.
    """

    def __init__(self, custom_responses: Optional[Dict[str, Any]] = None):
        self._custom_responses = custom_responses or {}

    def generate_text(
        self,
        system_prompt: Optional[str],
        user_prompt: str,
    ) -> str:
        if "generate_text" in self._custom_responses:
            return str(self._custom_responses["generate_text"])
        return f"[MOCK_TEXT] Processed prompt: {user_prompt[:60]}"

    def generate_structured(
        self,
        system_prompt: Optional[str],
        user_prompt: str,
        output_schema: Type[T],
    ) -> T:
        if not issubclass(output_schema, BaseModel):
            raise TypeError(f"output_schema must be a Pydantic BaseModel subclass, got {output_schema}")

        if "structured" in self._custom_responses:
            custom_data = self._custom_responses["structured"]
            if isinstance(custom_data, output_schema):
                return custom_data
            if isinstance(custom_data, dict):
                return output_schema.model_validate(custom_data)

        # Build minimal valid mock instance by inspecting fields
        mock_fields: Dict[str, Any] = {}
        for field_name, field_info in output_schema.model_fields.items():
            if (
                field_info.default is not PydanticUndefined
                and field_info.default is not None
                and field_info.default != Ellipsis
            ):
                mock_fields[field_name] = field_info.default
            elif field_info.default_factory is not None:
                mock_fields[field_name] = field_info.default_factory()
            else:
                # Provide reasonable dummy value based on annotation string
                ann_str = str(field_info.annotation).lower()
                if "int" in ann_str:
                    mock_fields[field_name] = 100
                elif "float" in ann_str:
                    mock_fields[field_name] = 1.0
                elif "bool" in ann_str:
                    mock_fields[field_name] = True
                elif "list" in ann_str:
                    mock_fields[field_name] = ["mock_item"]
                elif "dict" in ann_str:
                    mock_fields[field_name] = {"mock_key": "mock_value"}
                else:
                    mock_fields[field_name] = f"mock_{field_name}"

        return output_schema.model_validate(mock_fields)

    def interpret_incident(
        self,
        user_message: str,
        event_context: Dict[str, Any],
        open_incidents: List[Dict[str, Any]],
    ) -> Dict[str, Any]:
        msg_lower = (user_message or "").lower()
        incident_type = "GENERAL_DISRUPTION"
        if "cater" in msg_lower or "vendor" in msg_lower or "no-show" in msg_lower or "cancelled" in msg_lower:
            incident_type = "VENDOR_NO_SHOW"
        elif "delay" in msg_lower or "late" in msg_lower:
            incident_type = "VENDOR_DELAY"
        elif "overheat" in msg_lower or "broken" in msg_lower or "shortage" in msg_lower:
            incident_type = "RESOURCE_SHORTAGE"

        return {
            "interpreted_type": incident_type,
            "requires_recovery": True,
            "priority": "HIGH",
            "summary": f"Interpreted operational incident from message: '{user_message}'",
        }

    def select_recovery_strategy(
        self,
        candidate_options: List[Dict[str, Any]],
        incident_context: Dict[str, Any],
        risk_context: Dict[str, Any],
    ) -> Optional[str]:
        # Filter for feasible options
        feasible = [opt for opt in candidate_options if opt.get("is_feasible", False)]
        if not feasible:
            return None

        # Prioritize REPLACE_VENDOR / BACKUP_PROVIDER or highest score
        for opt in feasible:
            st = opt.get("strategy_type", "")
            if st in ("REPLACE_VENDOR", "ASSIGN_BACKUP", "REASSIGN_VENDOR"):
                return opt.get("id")

        # Fallback to option with highest score or lowest rank
        feasible.sort(key=lambda o: (o.get("rank") or 999, -float(o.get("score") or 0.0)))
        return feasible[0].get("id")

    def format_operational_response(
        self,
        status: str,
        context: Dict[str, Any],
    ) -> str:
        incident = context.get("incident") or {}
        selected_option = context.get("selected_option") or {}
        risk = context.get("risk") or {}
        verification = context.get("verification") or {}
        approval = context.get("approval") or {}

        inc_title = incident.get("title") or incident.get("incident_type", "Operational disruption")
        strat = selected_option.get("strategy_type", "Operational recovery")
        risk_score = risk.get("composite_score") or risk.get("level", "EVALUATED")

        if status == "PENDING_APPROVAL":
            appr_id = approval.get("id", "N/A")
            impact_level = approval.get("impact_level", "MAJOR")
            return (
                f"Incident detected: {inc_title}.\n\n"
                f"Operational Risk: {risk_score}\n"
                f"Selected Strategy: {strat}\n"
                f"Impact Level: {impact_level}\n\n"
                f"This action requires human organizer approval under event governance policy.\n"
                f"Approval requested (ID: {appr_id}). Execution paused awaiting approval sign-off."
            )
        elif status == "COMPLETED":
            ver_status = verification.get("status", "VERIFIED")
            return (
                f"Recovery executed and verified.\n\n"
                f"Incident: {inc_title}\n"
                f"Strategy: {strat}\n"
                f"Verification Status: {ver_status}\n"
                f"Schedule, budget, and critical objectives protected.\n"
                f"Event operational state restored to NORMAL."
            )
        elif status == "OPTIONS_GENERATED":
            num_opts = len(context.get("recovery_options", []))
            return (
                f"Incident detected: {inc_title}.\n\n"
                f"Operational Risk: {risk_score}\n"
                f"Generated {num_opts} validated recovery options. Recommended strategy: {strat}."
            )
        elif status == "FAILED":
            reason = context.get("error", "Recovery execution or verification failed.")
            return f"Operational recovery failed: {reason}"

        return f"Operational state updated: {status}."


class RealLLMProvider(LLMProvider):
    """Real LLM Provider invoking Google Gemini model API via the official google-genai SDK.
    
    CRITICAL ARCHITECTURAL CONSTRAINTS:
    1. NEVER silently falls back to MockLLMProvider when configured.
    2. Strict typed error boundaries: MissingAPIKeyError, GeminiAuthError, GeminiAPIError,
       LLMTimeoutError, MalformedOutputError, StructuredValidationError.
    3. Bounded timeouts and bounded retries for transient HTTP errors.
    4. Structured output directly validates against Pydantic models.
    5. Security: Never logs API keys, auth headers, or raw secrets.
    """

    def __init__(
        self,
        api_key: Optional[str] = None,
        model_name: str = "gemini-3.6-flash",
        timeout_seconds: float = 30.0,
        max_retries: int = 2,
        client: Optional[Any] = None,
    ):
        from app.core.config import settings

        resolved_key = (
            api_key
            or getattr(settings, "LLM_API_KEY", None)
            or getattr(settings, "GEMINI_API_KEY", None)
            or os.environ.get("LLM_API_KEY")
            or os.environ.get("GEMINI_API_KEY")
        )
        if not resolved_key and client is None:
            raise MissingAPIKeyError(
                provider="gemini",
                message="Gemini API key is missing. Set LLM_API_KEY or GEMINI_API_KEY in .env.",
            )

        self.api_key = resolved_key
        self.model_name = model_name
        self.timeout_seconds = float(timeout_seconds)
        self.max_retries = max(0, int(max_retries))
        self._client = client

    def __repr__(self) -> str:
        # Secret-safe representation: never expose self.api_key
        return (
            f"RealLLMProvider(model={self.model_name!r}, "
            f"timeout_seconds={self.timeout_seconds}, "
            f"max_retries={self.max_retries}, "
            f"has_api_key={bool(self.api_key)})"
        )

    def _get_client(self) -> Any:
        if self._client is not None:
            return self._client

        from google import genai
        from google.genai import types

        timeout_ms = int(self.timeout_seconds * 1000)
        http_opts = types.HttpOptions(timeout=timeout_ms)
        self._client = genai.Client(api_key=self.api_key, http_options=http_opts)
        return self._client

    def _invoke_with_retry(
        self,
        fn,
        operation_name: str,
        schema_name: Optional[str] = None,
    ) -> Any:
        """Executes a model invocation callable with bounded retry for transient failures."""
        import httpx
        from google.genai import errors

        retries = 0
        start_time = time.perf_counter()

        while True:
            try:
                result = fn()
                duration_ms = (time.perf_counter() - start_time) * 1000
                logger.info(
                    "LLM invocation succeeded [provider=gemini, model=%s, operation=%s, schema=%s, duration_ms=%.1f]",
                    self.model_name,
                    operation_name,
                    schema_name or "none",
                    duration_ms,
                )
                return result

            except (errors.ClientError, errors.ServerError, errors.APIError) as e:
                status_code = getattr(e, "code", getattr(e, "status_code", None))
                msg = str(e)

                # Authentication error: 401 / 403 / API_KEY_INVALID -> NEVER retry
                if status_code in (401, 403) or "API_KEY_INVALID" in msg.upper():
                    duration_ms = (time.perf_counter() - start_time) * 1000
                    logger.error(
                        "LLM authentication failure [provider=gemini, model=%s, operation=%s, status_code=%s, duration_ms=%.1f]",
                        self.model_name,
                        operation_name,
                        status_code,
                        duration_ms,
                    )
                    raise GeminiAuthError(
                        f"Gemini authentication failed (status {status_code}): {msg}",
                        details={"status_code": status_code},
                    ) from e

                # Check if transient / retryable (e.g. 503, 429, RESOURCE_EXHAUSTED)
                is_transient = (
                    status_code in (429, 503, 504)
                    or "UNAVAILABLE" in msg.upper()
                    or "RESOURCE_EXHAUSTED" in msg.upper()
                )
                if is_transient and retries < self.max_retries:
                    retries += 1
                    backoff = 0.5 * (2 ** (retries - 1))
                    logger.warning(
                        "Transient error during LLM invocation (attempt %d/%d), retrying in %.2fs: status=%s",
                        retries,
                        self.max_retries + 1,
                        backoff,
                        status_code,
                    )
                    time.sleep(backoff)
                    continue

                # Non-retryable or retries exhausted
                duration_ms = (time.perf_counter() - start_time) * 1000
                logger.error(
                    "LLM API failure [provider=gemini, model=%s, operation=%s, status_code=%s, duration_ms=%.1f]",
                    self.model_name,
                    operation_name,
                    status_code,
                    duration_ms,
                )
                raise GeminiAPIError(
                    f"Gemini API error (status {status_code}): {msg}",
                    status_code=status_code or 502,
                    details={"status_code": status_code, "retries": retries},
                ) from e

            except (httpx.TimeoutException, TimeoutError) as e:
                duration_ms = (time.perf_counter() - start_time) * 1000
                logger.error(
                    "LLM timeout [provider=gemini, model=%s, operation=%s, timeout_s=%.1f, duration_ms=%.1f]",
                    self.model_name,
                    operation_name,
                    self.timeout_seconds,
                    duration_ms,
                )
                raise LLMTimeoutError(
                    timeout_seconds=self.timeout_seconds,
                    message=f"Gemini request timed out after {self.timeout_seconds}s: {e}",
                ) from e

            except (LLMError, TypeError):
                # Reraise known typed exceptions without wrapping
                raise

            except Exception as e:
                duration_ms = (time.perf_counter() - start_time) * 1000
                logger.error(
                    "LLM invocation unexpected failure [provider=gemini, model=%s, operation=%s, error_type=%s, duration_ms=%.1f]",
                    self.model_name,
                    operation_name,
                    type(e).__name__,
                    duration_ms,
                )
                raise ModelInvocationError(
                    f"Unexpected error during Gemini model invocation: {e}",
                    details={"error_type": type(e).__name__},
                ) from e

    def generate_text(
        self,
        system_prompt: Optional[str],
        user_prompt: str,
    ) -> str:
        """Generates plain text response using real Gemini invocation."""
        from google.genai import types

        client = self._get_client()
        config = types.GenerateContentConfig(
            system_instruction=system_prompt if system_prompt else None,
        )

        def _call() -> str:
            resp = client.models.generate_content(
                model=self.model_name,
                contents=user_prompt,
                config=config,
            )
            if not resp or not resp.text:
                raise MalformedOutputError("Gemini returned empty text response.")
            return resp.text.strip()

        return self._invoke_with_retry(_call, operation_name="generate_text")

    def generate_structured(
        self,
        system_prompt: Optional[str],
        user_prompt: str,
        output_schema: Type[T],
    ) -> T:
        """Generates structured response strictly validated against Pydantic output_schema."""
        if not (isinstance(output_schema, type) and issubclass(output_schema, BaseModel)):
            raise TypeError(f"output_schema must be a Pydantic BaseModel subclass, got {output_schema}")

        from google.genai import types

        client = self._get_client()
        config = types.GenerateContentConfig(
            system_instruction=system_prompt if system_prompt else None,
            response_mime_type="application/json",
            response_schema=output_schema,
        )

        def _call() -> T:
            resp = client.models.generate_content(
                model=self.model_name,
                contents=user_prompt,
                config=config,
            )
            if not resp or not resp.text:
                raise MalformedOutputError(
                    "Gemini returned empty structured response.",
                    raw_output=None,
                )

            raw_text = resp.text.strip()
            try:
                parsed_json = json.loads(raw_text)
            except Exception as jde:
                raise MalformedOutputError(
                    f"Gemini output could not be parsed as JSON: {jde}",
                    raw_output=raw_text,
                ) from jde

            try:
                return output_schema.model_validate(parsed_json)
            except ValidationError as ve:
                raise StructuredValidationError(
                    message=f"Gemini output failed schema validation for {output_schema.__name__}: {ve}",
                    schema_name=output_schema.__name__,
                    validation_errors=ve.errors(),
                ) from ve

        return self._invoke_with_retry(
            _call,
            operation_name="generate_structured",
            schema_name=output_schema.__name__,
        )

    def interpret_incident(
        self,
        user_message: str,
        event_context: Dict[str, Any],
        open_incidents: List[Dict[str, Any]],
    ) -> Dict[str, Any]:
        """Interprets the natural language operational situation via Gemini structured output."""
        system_prompt = (
            "You are EVENTRA's Event Operations Agent interpreting an live operational incident. "
            "Analyze the situation and return structured incident categorization."
        )
        prompt = (
            f"Event Context: {json.dumps(event_context, default=str)}\n"
            f"Open Incidents: {json.dumps(open_incidents, default=str)}\n"
            f"Operator Message: {user_message}\n\n"
            "Categorize this incident and determine if recovery is required."
        )
        structured = self.generate_structured(
            system_prompt=system_prompt,
            user_prompt=prompt,
            output_schema=IncidentInterpretationOutput,
        )
        return structured.model_dump()

    def select_recovery_strategy(
        self,
        candidate_options: List[Dict[str, Any]],
        incident_context: Dict[str, Any],
        risk_context: Dict[str, Any],
    ) -> Optional[str]:
        """Reasons over candidate options and selects optimal recovery strategy via Gemini structured output."""
        feasible_options = [opt for opt in candidate_options if opt.get("is_feasible", False)]
        if not feasible_options:
            return None

        system_prompt = (
            "You are EVENTRA's Event Operations Agent evaluating recovery tradeoffs. "
            "Select the single most suitable recovery option ID based on objective protection, "
            "feasibility, schedule slack preservation, and budget variance."
        )
        prompt = (
            f"Incident: {json.dumps(incident_context, default=str)}\n"
            f"Evaluated Risk: {json.dumps(risk_context, default=str)}\n"
            f"Feasible Candidate Options: {json.dumps(feasible_options, default=str)}\n\n"
            "Select the best option ID and explain your operational rationale."
        )
        structured = self.generate_structured(
            system_prompt=system_prompt,
            user_prompt=prompt,
            output_schema=RecoverySelectionOutput,
        )
        return structured.selected_option_id

    def format_operational_response(
        self,
        status: str,
        context: Dict[str, Any],
    ) -> str:
        """Formats a clear, concise operational status message for the event operator."""
        system_prompt = (
            "You are EVENTRA's Event Operations Agent. Compose a concise, professional operational "
            "status update for the live event control room operator."
        )
        prompt = (
            f"Execution Status: {status}\n"
            f"Operational Context: {json.dumps(context, default=str)}\n\n"
            "Provide a clear, brief operational summary."
        )
        return self.generate_text(system_prompt=system_prompt, user_prompt=prompt)


def get_default_llm_provider() -> LLMProvider:
    """Factory returns configured LLMProvider based on application settings.
    
    Provides ONE authoritative path for obtaining the configured LLM provider.
    """
    from app.integrations.llm.base import get_configured_llm_provider
    return get_configured_llm_provider()
