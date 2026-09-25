"""Unit and isolation tests for LLM provider foundation.

Tests MockLLMProvider, RealLLMProvider (with mocked Gemini client), error boundaries,
timeout handling, bounded retries, schema validations, and secret safety.
Does NOT require external network access for unit tests.
"""
from typing import Optional, List
from unittest.mock import MagicMock, patch
import os
import pytest
from pydantic import BaseModel, Field

from app.agent.provider import (
    LLMProvider,
    MockLLMProvider,
    RealLLMProvider,
    get_default_llm_provider,
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
from app.integrations.llm.base import get_configured_llm_provider
from google.genai import errors as genai_errors
import httpx


# --- Test Schemas ---

class SampleEventBrief(BaseModel):
    intent: str
    event_type: Optional[str] = None
    guest_count: Optional[int] = None


class ComplexOperationalSchema(BaseModel):
    action_type: str = Field(..., description="Action name")
    estimated_cost: float
    affected_vendors: List[str]


# ==============================================================================
# 1. Mock Provider Tests
# ==============================================================================

class TestMockProvider:
    def test_mock_provider_generate_text(self):
        provider = MockLLMProvider()
        result = provider.generate_text("System instructions", "User prompt here")
        assert isinstance(result, str)
        assert len(result) > 0
        assert "[MOCK_TEXT]" in result

    def test_mock_provider_generate_structured(self):
        provider = MockLLMProvider()
        result = provider.generate_structured(
            system_prompt="Extract parameters",
            user_prompt="Need wedding catering for 200",
            output_schema=SampleEventBrief,
        )
        assert isinstance(result, SampleEventBrief)
        assert result.intent is not None

    def test_mock_provider_custom_responses(self):
        provider = MockLLMProvider(custom_responses={
            "generate_text": "Custom mock output",
            "structured": {"intent": "custom_intent", "guest_count": 42},
        })
        text = provider.generate_text(None, "hello")
        assert text == "Custom mock output"

        structured = provider.generate_structured(None, "hello", SampleEventBrief)
        assert structured.intent == "custom_intent"
        assert structured.guest_count == 42

    def test_mock_provider_legacy_methods(self):
        provider = MockLLMProvider()
        interp = provider.interpret_incident("Catering vendor cancelled last minute", {}, [])
        assert interp["interpreted_type"] == "VENDOR_NO_SHOW"
        assert interp["requires_recovery"] is True

        strat = provider.select_recovery_strategy(
            [{"id": "opt-1", "is_feasible": True, "strategy_type": "REPLACE_VENDOR"}],
            {}, {},
        )
        assert strat == "opt-1"

        resp = provider.format_operational_response("COMPLETED", {})
        assert "Recovery executed and verified" in resp


# ==============================================================================
# 2. Missing API Key & Initialization Tests
# ==============================================================================

class TestProviderInitialization:
    def test_real_provider_missing_key_raises_error(self, monkeypatch):
        monkeypatch.setenv("LLM_API_KEY", "")
        monkeypatch.setenv("GEMINI_API_KEY", "")
        monkeypatch.delenv("LLM_API_KEY", raising=False)
        monkeypatch.delenv("GEMINI_API_KEY", raising=False)

        with patch("app.core.config.settings.LLM_API_KEY", None), \
             patch("app.core.config.settings.GEMINI_API_KEY", None):
            with pytest.raises(MissingAPIKeyError) as exc_info:
                RealLLMProvider(api_key=None, client=None)
            assert "missing" in str(exc_info.value).lower()
            assert exc_info.value.code == "LLM_MISSING_API_KEY"

    def test_gemini_provider_init_with_key(self):
        provider = RealLLMProvider(api_key="test-dummy-key-abc123xyz", model_name="gemini-3.6-flash")
        assert provider.model_name == "gemini-3.6-flash"
        assert provider.timeout_seconds == 30.0
        assert provider.max_retries == 2


# ==============================================================================
# 3. Successful Generation with Mocked Gemini Client
# ==============================================================================

class TestMockedClientGeneration:
    def test_successful_text_generation(self):
        mock_client = MagicMock()
        mock_response = MagicMock()
        mock_response.text = "Operational response from Gemini"
        mock_client.models.generate_content.return_value = mock_response

        provider = RealLLMProvider(api_key="fake-key", client=mock_client)
        output = provider.generate_text(
            system_prompt="You are an operations assistant.",
            user_prompt="Summarize current status.",
        )

        assert output == "Operational response from Gemini"
        mock_client.models.generate_content.assert_called_once()
        call_kwargs = mock_client.models.generate_content.call_args.kwargs
        assert call_kwargs["model"] == "gemini-3.6-flash"
        assert call_kwargs["contents"] == "Summarize current status."

    def test_successful_structured_generation(self):
        mock_client = MagicMock()
        mock_response = MagicMock()
        mock_response.text = '{"intent": "catering_delay", "event_type": "corporate", "guest_count": 350}'
        mock_client.models.generate_content.return_value = mock_response

        provider = RealLLMProvider(api_key="fake-key", client=mock_client)
        output = provider.generate_structured(
            system_prompt="Extract event brief",
            user_prompt="Corporate event with 350 guests has catering delay.",
            output_schema=SampleEventBrief,
        )

        assert isinstance(output, SampleEventBrief)
        assert output.intent == "catering_delay"
        assert output.event_type == "corporate"
        assert output.guest_count == 350


# ==============================================================================
# 4. Malformed and Validation Failure Tests
# ==============================================================================

class TestMalformedAndValidationErrors:
    def test_empty_response_raises_malformed_output_error(self):
        mock_client = MagicMock()
        mock_response = MagicMock()
        mock_response.text = ""
        mock_client.models.generate_content.return_value = mock_response

        provider = RealLLMProvider(api_key="fake-key", client=mock_client)
        with pytest.raises(MalformedOutputError) as exc_info:
            provider.generate_text("System", "User")
        assert exc_info.value.code == "LLM_MALFORMED_OUTPUT"

    def test_invalid_json_raises_malformed_output_error(self):
        mock_client = MagicMock()
        mock_response = MagicMock()
        mock_response.text = "NOT_JSON_DATA {{ unclosed"
        mock_client.models.generate_content.return_value = mock_response

        provider = RealLLMProvider(api_key="fake-key", client=mock_client)
        with pytest.raises(MalformedOutputError) as exc_info:
            provider.generate_structured("System", "User", SampleEventBrief)
        assert exc_info.value.code == "LLM_MALFORMED_OUTPUT"

    def test_schema_mismatch_raises_structured_validation_error(self):
        mock_client = MagicMock()
        mock_response = MagicMock()
        # Missing required field 'intent'
        mock_response.text = '{"event_type": "gala", "guest_count": "invalid_number_type"}'
        mock_client.models.generate_content.return_value = mock_response

        provider = RealLLMProvider(api_key="fake-key", client=mock_client)
        with pytest.raises(StructuredValidationError) as exc_info:
            provider.generate_structured("System", "User", SampleEventBrief)
        assert exc_info.value.code == "LLM_VALIDATION_ERROR"
        assert exc_info.value.details["schema_name"] == "SampleEventBrief"

    def test_invalid_output_schema_type_raises_type_error(self):
        provider = RealLLMProvider(api_key="fake-key", client=MagicMock())
        with pytest.raises(TypeError) as exc_info:
            provider.generate_structured("System", "User", dict)  # Not a BaseModel subclass
        assert "BaseModel" in str(exc_info.value)


# ==============================================================================
# 5. API Failure, Auth, Timeout, and Retry Tests
# ==============================================================================

class TestErrorHandlingAndRetry:
    def test_auth_error_raised_on_401_no_retry(self):
        mock_client = MagicMock()
        auth_error = genai_errors.ClientError(401, {"error": {"message": "API key invalid"}}, None)
        mock_client.models.generate_content.side_effect = auth_error

        provider = RealLLMProvider(api_key="bad-key", client=mock_client, max_retries=2)
        with pytest.raises(GeminiAuthError) as exc_info:
            provider.generate_text("System", "User")

        assert exc_info.value.code == "GEMINI_AUTH_ERROR"
        # Must not retry on authentication failure
        assert mock_client.models.generate_content.call_count == 1

    def test_gemini_api_error_on_client_error(self):
        mock_client = MagicMock()
        client_error = genai_errors.ClientError(400, {"error": {"message": "Bad request format"}}, None)
        mock_client.models.generate_content.side_effect = client_error

        provider = RealLLMProvider(api_key="fake-key", client=mock_client, max_retries=2)
        with pytest.raises(GeminiAPIError) as exc_info:
            provider.generate_text("System", "User")

        assert exc_info.value.code == "GEMINI_API_ERROR"

    def test_timeout_raises_llm_timeout_error(self):
        mock_client = MagicMock()
        mock_client.models.generate_content.side_effect = httpx.TimeoutException("Request timed out")

        provider = RealLLMProvider(api_key="fake-key", client=mock_client, timeout_seconds=15.0)
        with pytest.raises(LLMTimeoutError) as exc_info:
            provider.generate_text("System", "User")

        assert exc_info.value.code == "LLM_TIMEOUT"
        assert exc_info.value.details["timeout_seconds"] == 15.0

    def test_bounded_retry_on_transient_503_eventual_failure(self):
        mock_client = MagicMock()
        server_error = genai_errors.ServerError(503, {"error": {"message": "UNAVAILABLE"}}, None)
        mock_client.models.generate_content.side_effect = server_error

        provider = RealLLMProvider(api_key="fake-key", client=mock_client, max_retries=2)
        with pytest.raises(GeminiAPIError):
            provider.generate_text("System", "User")

        # Initial try + 2 retries = 3 calls total
        assert mock_client.models.generate_content.call_count == 3

    def test_transient_retry_success(self):
        mock_client = MagicMock()
        server_error = genai_errors.ServerError(503, {"error": {"message": "UNAVAILABLE"}}, None)
        success_response = MagicMock()
        success_response.text = "Success on attempt 2"

        mock_client.models.generate_content.side_effect = [server_error, success_response]

        provider = RealLLMProvider(api_key="fake-key", client=mock_client, max_retries=2)
        result = provider.generate_text("System", "User")

        assert result == "Success on attempt 2"
        assert mock_client.models.generate_content.call_count == 2


# ==============================================================================
# 6. Provider Selection and Secret Safety Tests
# ==============================================================================

class TestProviderSelectionAndSecurity:
    def test_provider_selection_mock(self):
        prov = get_configured_llm_provider(provider_override="mock")
        assert isinstance(prov, MockLLMProvider)

    def test_provider_selection_gemini(self):
        prov = get_configured_llm_provider(
            provider_override="gemini",
            api_key_override="test-key-override",
            model_override="gemini-3.6-flash",
        )
        assert isinstance(prov, RealLLMProvider)
        assert prov.model_name == "gemini-3.6-flash"

    def test_provider_selection_unsupported(self):
        with pytest.raises(UnsupportedProviderError) as exc_info:
            get_configured_llm_provider(provider_override="cohere_nonexistent")
        assert exc_info.value.code == "LLM_UNSUPPORTED_PROVIDER"

    def test_secret_safety_repr_does_not_leak_key(self):
        secret_key = "AIzaSySecretKeyNeverExposeMeInLogs"
        provider = RealLLMProvider(api_key=secret_key, client=MagicMock())
        rep = repr(provider)
        assert secret_key not in rep
        assert "has_api_key=True" in rep

    def test_secret_safety_in_errors(self):
        secret_key = "AIzaSySecretKeyNeverExposeMeInLogs"
        err = MissingAPIKeyError(provider="gemini")
        assert secret_key not in str(err)
        assert secret_key not in repr(err)


# ==============================================================================
# 7. Controlled Real Gemini Smoke Test (Optional integration test)
# ==============================================================================

@pytest.mark.integration
def test_real_gemini_smoke_test():
    """Controlled smoke test verifying actual Gemini API interaction when explicitly enabled.

    To execute live against Google Gemini:
        $env:RUN_LIVE_GEMINI_TEST="1"; pytest -k test_real_gemini_smoke_test
    """
    if os.environ.get("RUN_LIVE_GEMINI_TEST") != "1":
        pytest.skip("Skipping live Gemini smoke test: set RUN_LIVE_GEMINI_TEST=1 to execute live network test.")

    from app.core.config import settings
    api_key = os.environ.get("GEMINI_API_KEY") or getattr(settings, "LLM_API_KEY", None)

    if not api_key:
        pytest.skip("Skipping live Gemini smoke test: no GEMINI_API_KEY available in environment")

    provider = RealLLMProvider(api_key=api_key, model_name="gemini-3.6-flash", timeout_seconds=15.0)

    # 1. Text generation smoke test
    text = provider.generate_text("Answer concisely in 3 words.", "Hello from EVENTRA platform.")
    assert isinstance(text, str)
    assert len(text.strip()) > 0

    # 2. Structured generation smoke test
    structured = provider.generate_structured(
        system_prompt="You are an event operations assistant. Extract intent and parameters.",
        user_prompt="Organizing a live conference for 450 guests.",
        output_schema=SampleEventBrief,
    )
    assert isinstance(structured, SampleEventBrief)
    assert structured.intent is not None
    assert structured.guest_count == 450 or structured.guest_count is not None
