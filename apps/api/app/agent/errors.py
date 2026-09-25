"""Typed exceptions for LLM providers in EVENTRA.

Provides distinct error classes for configuration, authentication, API failures,
timeouts, malformed outputs, and schema validation failures.
"""
from typing import Any, Dict, Optional
from app.core.exceptions import AppException


class LLMError(AppException):
    """Base exception for all LLM provider errors."""

    def __init__(
        self,
        message: str,
        code: str = "LLM_ERROR",
        details: Optional[Dict[str, Any]] = None,
        status_code: int = 502,
    ):
        super().__init__(message=message, status_code=status_code, code=code, details=details)


class MissingAPIKeyError(LLMError):
    """Raised when an LLM provider requires an API key but none is configured."""

    def __init__(self, provider: str = "gemini", message: Optional[str] = None):
        super().__init__(
            message=message or f"API key for LLM provider '{provider}' is missing or empty. Please set LLM_API_KEY or GEMINI_API_KEY in .env.",
            code="LLM_MISSING_API_KEY",
            details={"provider": provider},
            status_code=500,
        )


class UnsupportedProviderError(LLMError):
    """Raised when an unsupported LLM provider is requested."""

    def __init__(self, provider: str):
        super().__init__(
            message=f"Unsupported LLM provider '{provider}'. Supported providers are: 'gemini', 'mock'.",
            code="LLM_UNSUPPORTED_PROVIDER",
            details={"provider": provider},
            status_code=400,
        )


class GeminiAuthError(LLMError):
    """Raised when Gemini rejects the API key or credentials (HTTP 401 / 403)."""

    def __init__(
        self,
        message: str = "Gemini authentication failed. Invalid API key.",
        details: Optional[Dict[str, Any]] = None,
    ):
        super().__init__(
            message=message,
            code="GEMINI_AUTH_ERROR",
            details=details,
            status_code=401,
        )


class GeminiAPIError(LLMError):
    """Raised when the Gemini API returns a server or client error."""

    def __init__(
        self,
        message: str,
        status_code: int = 502,
        details: Optional[Dict[str, Any]] = None,
    ):
        super().__init__(
            message=message,
            code="GEMINI_API_ERROR",
            details=details,
            status_code=status_code,
        )


class ModelInvocationError(LLMError):
    """Raised when model invocation fails generally during processing."""

    def __init__(self, message: str, details: Optional[Dict[str, Any]] = None):
        super().__init__(
            message=message,
            code="LLM_INVOCATION_ERROR",
            details=details,
            status_code=502,
        )


class LLMTimeoutError(LLMError):
    """Raised when an LLM request exceeds the bounded timeout."""

    def __init__(self, timeout_seconds: float, message: Optional[str] = None):
        super().__init__(
            message=message or f"LLM request timed out after {timeout_seconds} seconds.",
            code="LLM_TIMEOUT",
            details={"timeout_seconds": timeout_seconds},
            status_code=504,
        )


class MalformedOutputError(LLMError):
    """Raised when Gemini returns malformed output (e.g. empty or non-JSON when structured output requested)."""

    def __init__(
        self,
        message: str,
        raw_output: Optional[str] = None,
        details: Optional[Dict[str, Any]] = None,
    ):
        safe_details = dict(details or {})
        if raw_output is not None:
            safe_details["raw_length"] = len(raw_output)
        super().__init__(
            message=message,
            code="LLM_MALFORMED_OUTPUT",
            details=safe_details,
            status_code=502,
        )


class StructuredValidationError(LLMError):
    """Raised when model output fails Pydantic schema validation."""

    def __init__(
        self,
        message: str,
        schema_name: str,
        validation_errors: Optional[Any] = None,
    ):
        super().__init__(
            message=message,
            code="LLM_VALIDATION_ERROR",
            details={
                "schema_name": schema_name,
                "validation_errors": str(validation_errors) if validation_errors else None,
            },
            status_code=422,
        )
