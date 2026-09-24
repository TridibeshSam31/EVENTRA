"""LLM Integration Hub connecting EVENTRA configuration to LLM providers."""
from typing import Optional
import os

from app.core.config import settings
from app.agent.provider import (
    LLMProvider,
    RealLLMProvider,
    MockLLMProvider,
)
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


def get_configured_llm_provider(
    provider_override: Optional[str] = None,
    api_key_override: Optional[str] = None,
    model_override: Optional[str] = None,
) -> LLMProvider:
    """Instantiates configured LLMProvider based on application settings.
    
    CRITICAL ARCHITECTURAL CONSTRAINTS:
    - If LLM_PROVIDER == 'mock', returns MockLLMProvider for deterministic offline execution.
    - If LLM_PROVIDER == 'gemini', validates credentials and returns RealLLMProvider.
      If credentials are missing, raises MissingAPIKeyError (NEVER silently falls back to mock).
    - If LLM_PROVIDER is unsupported, raises UnsupportedProviderError.
    """
    provider_type = (provider_override or settings.LLM_PROVIDER or "mock").lower().strip()

    if provider_type == "mock":
        return MockLLMProvider()

    if provider_type == "gemini":
        api_key = (
            api_key_override
            or getattr(settings, "LLM_API_KEY", None)
            or getattr(settings, "GEMINI_API_KEY", None)
            or os.environ.get("LLM_API_KEY")
            or os.environ.get("GEMINI_API_KEY")
        )
        if not api_key:
            raise MissingAPIKeyError(
                provider="gemini",
                message=(
                    "LLM_PROVIDER is set to 'gemini' but no API key was found. "
                    "Please configure LLM_API_KEY or GEMINI_API_KEY in .env."
                ),
            )

        model_name = (
            model_override
            or getattr(settings, "LLM_MODEL", None)
            or "gemini-3.6-flash"
        )
        timeout_seconds = getattr(settings, "LLM_TIMEOUT_SECONDS", 30)

        return RealLLMProvider(
            api_key=api_key,
            model_name=model_name,
            timeout_seconds=timeout_seconds,
        )

    raise UnsupportedProviderError(provider=provider_type)


__all__ = [
    "LLMProvider",
    "RealLLMProvider",
    "MockLLMProvider",
    "get_configured_llm_provider",
    "LLMError",
    "MissingAPIKeyError",
    "UnsupportedProviderError",
    "GeminiAuthError",
    "GeminiAPIError",
    "ModelInvocationError",
    "LLMTimeoutError",
    "MalformedOutputError",
    "StructuredValidationError",
]
