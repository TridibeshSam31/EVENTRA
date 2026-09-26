"""Unit tests for Priority 2: Twilio Voice Adapter, Gateway, and Audio Framing."""
import asyncio
import base64
import json
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from app.integrations.base import IntegrationSource
from app.integrations.communication.twilio import TwilioVoiceAdapter
from app.integrations.communication.twilio_gateway import (
    TwilioVoiceGateway,
    TwilioVoiceSession,
    TwilioSessionState,
    TWILIO_CHUNK_SIZE_BYTES,
)
from app.integrations.communication.voice_session import AudioStreamListener


def test_twilio_adapter_configuration_status():
    unconfigured = TwilioVoiceAdapter(account_sid=None, auth_token=None, caller_number=None)
    assert unconfigured.is_configured is False

    configured = TwilioVoiceAdapter(
        account_sid="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        auth_token="test_token_secret_1234",
        caller_number="+1234567890",
        stream_url="wss://tunnel.eventra.internal/voice/twilio/stream",
    )
    assert configured.is_configured is True
    health = configured.check_health()
    assert health["status"] == "CONFIGURED"
    assert health["account_sid_suffix"] == "...xxxx"


def test_twilio_make_call_fails_loudly_without_stream_url():
    adapter = TwilioVoiceAdapter(
        account_sid="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        auth_token="test_token_secret_1234",
        caller_number="+1234567890",
        stream_url="",  # Intentionally missing
    )
    with pytest.raises(ValueError, match="CRITICAL CONFIGURATION ERROR: TWILIO_STREAM_URL is not set"):
        adapter.make_call(
            event_id="evt-1",
            provider_id="prov-1",
            recipient_phone="+919717639355",
        )


def test_twilio_make_call_fails_loudly_on_placeholder_stream_url():
    adapter = TwilioVoiceAdapter(
        account_sid="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        auth_token="test_token_secret_1234",
        caller_number="+1234567890",
        stream_url="wss://api.eventra.ai/voice/twilio/stream",  # Fake domain
    )
    with pytest.raises(ValueError, match="contains unresolvable domain"):
        adapter.make_call(
            event_id="evt-1",
            provider_id="prov-1",
            recipient_phone="+919717639355",
        )


def test_twilio_make_call_dispatches_with_twiml():
    adapter = TwilioVoiceAdapter(
        account_sid="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
        auth_token="test_token_secret_1234",
        caller_number="+1234567890",
        stream_url="wss://my-tunnel.ngrok-free.app/voice/twilio/stream",
    )

    mock_call = MagicMock()
    mock_call.sid = "CA1234567890abcdef"
    mock_call.status = "queued"

    import sys
    mock_twilio_module = MagicMock()
    sys.modules["twilio"] = mock_twilio_module
    sys.modules["twilio.rest"] = mock_twilio_module.rest

    with patch("twilio.rest.Client") as mock_client_cls:
        mock_instance = MagicMock()
        mock_instance.calls.create.return_value = mock_call
        mock_client_cls.return_value = mock_instance
        mock_instance = MagicMock()
        mock_instance.calls.create.return_value = mock_call
        mock_client_cls.return_value = mock_instance

        res = adapter.make_call(
            event_id="evt-delhi-1",
            provider_id="caterer-1",
            recipient_phone="+919717639355",
            task_id="task-lunch",
            session_id="sess-custom-123",
        )

        assert res.success is True
        assert res.source == IntegrationSource.REAL
        assert res.data["call_sid"] == "CA1234567890abcdef"
        assert res.data["session_id"] == "sess-custom-123"

        # Verify call was created with correct twiml
        mock_instance.calls.create.assert_called_once()
        kwargs = mock_instance.calls.create.call_args[1]
        assert kwargs["to"] == "+919717639355"
        assert kwargs["from_"] == "+1234567890"
        assert "Stream url=\"wss://my-tunnel.ngrok-free.app/voice/twilio/stream\"" in kwargs["twiml"]
        assert "Parameter name=\"session_id\" value=\"sess-custom-123\"" in kwargs["twiml"]


@pytest.mark.asyncio
async def test_twilio_outbound_audio_chunks_to_160_bytes():
    """Twilio Media Streams strictly requires 20ms chunks (160 bytes of mu-law @ 8000Hz)."""
    mock_ws = AsyncMock()
    session = TwilioVoiceSession(websocket=mock_ws)
    session.stream_sid = "MZ12345"
    session.state = TwilioSessionState.STREAMING

    # Send 480 bytes of audio (exactly 3 frames of 160 bytes / 60ms)
    test_audio = b"\xff" * 480
    success = await session.send_audio(test_audio)
    assert success is True

    # Assert exactly 3 WebSocket messages were sent
    assert mock_ws.send_text.call_count == 3
    for call in mock_ws.send_text.call_args_list:
        payload_json = json.loads(call[0][0])
        assert payload_json["event"] == "media"
        assert payload_json["streamSid"] == "MZ12345"
        raw_decoded = base64.b64decode(payload_json["media"]["payload"])
        assert len(raw_decoded) == TWILIO_CHUNK_SIZE_BYTES  # exactly 160 bytes!


@pytest.mark.asyncio
async def test_twilio_session_clear_and_mark():
    mock_ws = AsyncMock()
    session = TwilioVoiceSession(websocket=mock_ws)
    session.stream_sid = "MZ12345"
    session.state = TwilioSessionState.STREAMING

    # Test barge-in clear event
    clear_ok = await session.clear_audio()
    assert clear_ok is True
    clear_msg = json.loads(mock_ws.send_text.call_args[0][0])
    assert clear_msg == {"event": "clear", "streamSid": "MZ12345"}

    # Test mark event
    mark_ok = await session.send_mark("turn_1_complete")
    assert mark_ok is True
    mark_msg = json.loads(mock_ws.send_text.call_args[0][0])
    assert mark_msg == {"event": "mark", "streamSid": "MZ12345", "mark": {"name": "turn_1_complete"}}


@pytest.mark.asyncio
async def test_twilio_gateway_event_dispatch():
    gateway = TwilioVoiceGateway()
    mock_listener = AsyncMock(spec=AudioStreamListener)
    gateway.register_listener_factory(lambda s: mock_listener)

    mock_ws = AsyncMock()
    session = TwilioVoiceSession(websocket=mock_ws)

    # 1. Connected
    await gateway._dispatch_event(json.dumps({"event": "connected"}), session)
    assert session.state == TwilioSessionState.CONNECTED

    # 2. Start
    start_event = {
        "event": "start",
        "streamSid": "MZ999",
        "start": {
            "streamSid": "MZ999",
            "callSid": "CA999",
            "accountSid": "AC999",
            "customParameters": {"session_id": "sess-test-999", "event_id": "evt-1"},
            "mediaFormat": {"encoding": "audio/x-mulaw", "sampleRate": 8000, "channels": 1},
        },
    }
    await gateway._dispatch_event(json.dumps(start_event), session)
    assert session.state == TwilioSessionState.STREAMING
    assert session.stream_sid == "MZ999"
    assert session.session_id == "sess-test-999"
    mock_listener.on_session_started.assert_called_once_with(session)

    # 3. Media
    media_b64 = base64.b64encode(b"\x00" * 160).decode()
    media_event = {
        "event": "media",
        "streamSid": "MZ999",
        "media": {"payload": media_b64},
    }
    await gateway._dispatch_event(json.dumps(media_event), session)
    mock_listener.on_audio_received.assert_called_once_with(b"\x00" * 160, session)

    # 4. Stop
    stop_event = {"event": "stop", "streamSid": "MZ999"}
    await gateway._dispatch_event(json.dumps(stop_event), session)
    assert session.state == TwilioSessionState.STOPPED
    mock_listener.on_session_stopped.assert_called_once_with(session)
