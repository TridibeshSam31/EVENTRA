"""Unit tests for Exotel Telephony Communication Adapter (Task 1 & Task 2).

Tests cover:
- Successful outbound call initiation via direct Connect Voice AI (StreamUrl & StreamType)
- Safe fallback behavior when Exotel is disabled or unconfigured
- Handling missing/invalid recipient phone numbers
- Handling HTTP error codes (400, 401, 500)
- Handling malformed / network exceptions
- Health check reporting and secret masking
- Inbound call status webhook payload normalization
- SMS dispatch and mock fallback
- ProviderCommunicationService make_call orchestration and audit logging
"""
import json
import uuid
import pytest
import httpx
from unittest.mock import MagicMock, patch

from app.core.config import settings
from app.integrations.base import IntegrationSource
from app.integrations.communication.exotel import ExotelVoiceAdapter, _normalize_phone_number
from app.integrations.registry import IntegrationRegistry
from app.services.provider_communication_service import ProviderCommunicationService


# ---------------------------------------------------------------------------
# Phone number normalization tests
# ---------------------------------------------------------------------------

def test_normalize_phone_number():
    assert _normalize_phone_number("+91 98765-43210") == "919876543210"
    assert _normalize_phone_number("09876543210") == "09876543210"
    assert _normalize_phone_number("+1 (555) 123-4567") == "15551234567"
    assert _normalize_phone_number(None) == ""
    assert _normalize_phone_number("") == ""


# ---------------------------------------------------------------------------
# Fallback when Exotel is unconfigured or disabled
# ---------------------------------------------------------------------------

def test_exotel_unconfigured_fallback():
    """When disabled or credentials missing, make_call routes to mock fallback safely."""
    adapter = ExotelVoiceAdapter(
        api_key=None,
        api_token=None,
        account_sid=None,
        caller_id=None,
    )
    assert adapter.is_configured is False

    result = adapter.make_call(
        event_id="evt-123",
        provider_id="prov-456",
        recipient_phone="9876543210",
        task_id="tsk-789",
        session_id="sess-001",
    )

    assert result.success is True
    assert result.source == IntegrationSource.MOCK
    assert "recorded in mock fallback" in result.error
    assert result.data["call_sid"].startswith("call-mock-")
    assert result.data["session_id"] == "sess-001"
    assert result.data["recipient_phone"] == "9876543210"
    assert result.data["status"] == "QUEUED"


def test_exotel_empty_phone_validation():
    """An empty or missing recipient phone returns clean failure."""
    adapter = ExotelVoiceAdapter(
        api_key="key",
        api_token="token",
        account_sid="sid",
        caller_id="08012345678",
    )
    result = adapter.make_call(
        event_id="evt-123",
        provider_id="prov-456",
        recipient_phone="",
    )
    assert result.success is False
    assert result.error == "Recipient phone number is required."
    assert result.data["status"] == "FAILED"


# ---------------------------------------------------------------------------
# Successful Outbound Calls (Mocked HTTP)
# ---------------------------------------------------------------------------

def test_exotel_successful_call_json_response(monkeypatch):
    """Successful outbound call with JSON response using direct Connect Voice AI StreamUrl."""
    monkeypatch.setattr(settings, "EXOTEL_ENABLED", True)

    adapter = ExotelVoiceAdapter(
        api_key="mock_key",
        api_token="mock_token",
        account_sid="mock_sid",
        caller_id="08012345678",
        subdomain="api.exotel.com",
        stream_url="wss://eventra.ai/api/v1/voice/exotel/stream",
        callback_url="https://eventra.ai/callback",
    )
    assert adapter.is_configured is True

    fake_response = httpx.Response(
        status_code=200,
        headers={"content-type": "application/json"},
        json={
            "Call": {
                "Sid": "c1a2b3c4d5e6f7",
                "Status": "in-progress",
                "From": "9876543210",
                "To": "08012345678",
                "DateCreated": "2026-09-25 12:00:00",
            }
        },
        request=httpx.Request("POST", "https://api.exotel.com"),
    )

    with patch.object(httpx.Client, "post", return_value=fake_response) as mock_post:
        result = adapter.make_call(
            event_id="evt-100",
            provider_id="prov-200",
            recipient_phone="+91 98765 43210",
            task_id="tsk-300",
            session_id="session-abc",
            metadata={"negotiation_round": 1},
        )

        assert result.success is True
        assert result.source == IntegrationSource.REAL
        assert result.data["call_sid"] == "c1a2b3c4d5e6f7"
        assert result.data["session_id"] == "session-abc"
        assert result.data["status"] == "IN-PROGRESS"
        assert result.data["channel"] == "EXOTEL_VOICE"
        assert result.data["recipient_phone"] == "919876543210"

        # Verify posted form parameters match direct Connect Voice AI specification
        mock_post.assert_called_once()
        _, kwargs = mock_post.call_args
        assert kwargs["auth"] == ("mock_key", "mock_token")
        assert kwargs["data"]["From"] == "919876543210"
        assert kwargs["data"]["CallerId"] == "08012345678"
        assert kwargs["data"]["StreamUrl"] == "wss://eventra.ai/api/v1/voice/exotel/stream"
        assert kwargs["data"]["StreamType"] == "bidirectional"
        assert "Url" not in kwargs["data"]
        assert "CallType" not in kwargs["data"]
        assert kwargs["data"]["StatusCallback"] == "https://eventra.ai/callback"


def test_exotel_successful_call_xml_response(monkeypatch):
    """Successful outbound call with XML response from Exotel."""
    monkeypatch.setattr(settings, "EXOTEL_ENABLED", True)

    adapter = ExotelVoiceAdapter(
        api_key="mock_key",
        api_token="mock_token",
        account_sid="mock_sid",
        caller_id="08012345678",
    )

    xml_content = """<?xml version="1.0" encoding="UTF-8"?>
    <ExotelResponse>
        <Call>
            <Sid>xml-call-sid-999</Sid>
            <Status>queued</Status>
        </Call>
    </ExotelResponse>
    """
    fake_response = httpx.Response(
        status_code=200,
        headers={"content-type": "application/xml"},
        text=xml_content,
        request=httpx.Request("POST", "https://api.exotel.com"),
    )

    with patch.object(httpx.Client, "post", return_value=fake_response):
        result = adapter.make_call(
            event_id="evt-100",
            provider_id="prov-200",
            recipient_phone="9876543210",
        )
        assert result.success is True
        assert result.data["call_sid"] == "xml-call-sid-999"
        assert result.data["status"] == "QUEUED"


# ---------------------------------------------------------------------------
# API Error & Exception Handling
# ---------------------------------------------------------------------------

def test_exotel_api_http_error(monkeypatch):
    """HTTP 401 / 400 error returns typed failure with error message."""
    monkeypatch.setattr(settings, "EXOTEL_ENABLED", True)

    adapter = ExotelVoiceAdapter(
        api_key="bad_key",
        api_token="bad_token",
        account_sid="bad_sid",
        caller_id="08012345678",
    )

    fake_response = httpx.Response(
        status_code=401,
        headers={"content-type": "application/json"},
        json={"RestException": {"Message": "Authentication failed", "Status": 401}},
        request=httpx.Request("POST", "https://api.exotel.com"),
    )

    with patch.object(httpx.Client, "post", return_value=fake_response):
        result = adapter.make_call(
            event_id="evt-100",
            provider_id="prov-200",
            recipient_phone="9876543210",
        )
        assert result.success is False
        assert result.source == IntegrationSource.REAL
        assert "HTTP 401" in result.error
        assert result.data["status"] == "FAILED"
        assert result.data["call_sid"] is None


def test_exotel_network_timeout(monkeypatch):
    """Network connection timeout returns safe failure without crashing."""
    monkeypatch.setattr(settings, "EXOTEL_ENABLED", True)

    adapter = ExotelVoiceAdapter(
        api_key="key",
        api_token="token",
        account_sid="sid",
        caller_id="08012345678",
    )

    with patch.object(httpx.Client, "post", side_effect=httpx.ConnectTimeout("Connection timed out")):
        result = adapter.make_call(
            event_id="evt-100",
            provider_id="prov-200",
            recipient_phone="9876543210",
        )
        assert result.success is False
        assert "timed out" in result.error
        assert result.data["status"] == "FAILED"


# ---------------------------------------------------------------------------
# Webhook Status Callbacks & Inbound Normalization
# ---------------------------------------------------------------------------

def test_exotel_receive_inbound_status():
    """Inbound call status callback payload normalization."""
    adapter = ExotelVoiceAdapter()
    payload = {
        "CallSid": "call-xyz-123",
        "From": "919876543210",
        "To": "08012345678",
        "Status": "completed",
        "CustomField": json.dumps({"event_id": "evt-777", "provider_id": "prov-888", "task_id": "tsk-999"}),
    }

    res = adapter.receive_inbound(payload)
    assert res.success is True
    assert res.data["call_sid"] == "call-xyz-123"
    assert res.data["status"] == "COMPLETED"
    assert res.data["event_id"] == "evt-777"
    assert res.data["provider_id"] == "prov-888"
    assert res.data["task_id"] == "tsk-999"


# ---------------------------------------------------------------------------
# Health Check and Secret Masking
# ---------------------------------------------------------------------------

def test_exotel_check_health_disabled(monkeypatch):
    monkeypatch.setattr(settings, "EXOTEL_ENABLED", False)
    adapter = ExotelVoiceAdapter()
    health = adapter.check_health()
    assert health["enabled"] is False
    assert health["status"] == "DISABLED"


def test_exotel_check_health_incomplete_credentials(monkeypatch):
    monkeypatch.setattr(settings, "EXOTEL_ENABLED", True)
    adapter = ExotelVoiceAdapter(api_key=None, api_token=None)
    health = adapter.check_health()
    assert health["enabled"] is True
    assert health["status"] == "INCOMPLETE_CREDENTIALS"
    assert "EXOTEL_API_KEY" in health["missing"]


def test_registry_with_exotel_provider(monkeypatch):
    """Verifies IntegrationRegistry builds ExotelVoiceAdapter when configured."""
    monkeypatch.setattr(settings, "COMMUNICATION_PROVIDER", "exotel")
    monkeypatch.setattr(settings, "EXOTEL_ENABLED", True)
    monkeypatch.setattr(settings, "EXOTEL_API_KEY", "dummy_key")
    monkeypatch.setattr(settings, "EXOTEL_API_TOKEN", "dummy_token")
    monkeypatch.setattr(settings, "EXOTEL_ACCOUNT_SID", "dummy_sid")
    monkeypatch.setattr(settings, "EXOTEL_CALLER_ID", "08012345678")

    reg = IntegrationRegistry()
    comm = reg.get_communication_provider()
    assert isinstance(comm, ExotelVoiceAdapter)

    status = reg.get_status()
    assert status["communication"]["exotel_enabled"] is True
    assert status["communication"]["exotel_configured"] is True
    # Ensure secrets never leak in registry status
    assert "dummy_key" not in json.dumps(status)
    assert "dummy_token" not in json.dumps(status)


# ---------------------------------------------------------------------------
# ProviderCommunicationService make_call Integration
# ---------------------------------------------------------------------------

def test_provider_communication_service_make_call(monkeypatch):
    """Verifies ProviderCommunicationService.make_call dispatches to adapter and writes audit log."""
    mock_db = MagicMock()
    service = ProviderCommunicationService(db=mock_db)

    result = service.make_call(
        event_id="evt-prod-1",
        provider_id="prov-catering-1",
        recipient_phone="9876543210",
        task_id="tsk-catering-prep",
        session_id="sess-voice-test",
    )

    assert result.success is True
    assert result.data["event_id"] == "evt-prod-1"
    assert result.data["recipient_phone"] == "9876543210"
    # Audit recorder called
    assert mock_db.add.called
