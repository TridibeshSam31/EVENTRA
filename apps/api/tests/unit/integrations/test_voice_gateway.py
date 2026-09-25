"""Unit tests for Exotel Voice Gateway & WebSocket Transport Layer (Task 2).

Tests cover:
- Full lifecycle: connected -> start -> media -> dtmf -> mark -> stop
- State machine transitions: CONNECTING -> STARTED -> STREAMING -> STOPPED / FAILED
- Call, stream, and session metadata extraction and preservation
- Raw PCM/audio base64 decode and listener dispatch
- Outbound media, mark, and clear formatting back to Exotel
- Resilience: malformed JSON, missing fields, invalid base64, unknown events, duplicate stop
- Disconnect and clean session cleanup
- FastAPI WebSocket endpoint integration via TestClient
"""
import asyncio
import base64
import json
import pytest
from unittest.mock import AsyncMock, MagicMock
from fastapi.testclient import TestClient

from app.main import app
from app.integrations.communication.exotel_gateway import (
    ExotelVoiceGateway,
    ExotelVoiceSession,
    SessionState,
    AudioStreamListener,
    MediaFormat,
    voice_gateway,
)


class MockAudioStreamListener(AudioStreamListener):
    """Test listener capturing internal audio interface events."""

    def __init__(self):
        self.started_sessions = []
        self.received_audio_chunks = []
        self.received_dtmf = []
        self.received_marks = []
        self.stopped_sessions = []
        self.errors = []

    async def on_session_started(self, session: ExotelVoiceSession) -> None:
        self.started_sessions.append(session)

    async def on_audio_received(self, pcm_bytes: bytes, session: ExotelVoiceSession) -> None:
        self.received_audio_chunks.append((pcm_bytes, session))

    async def on_dtmf_received(self, digit: str, session: ExotelVoiceSession) -> None:
        self.received_dtmf.append((digit, session))

    async def on_mark_received(self, mark_name: str, session: ExotelVoiceSession) -> None:
        self.received_marks.append((mark_name, session))

    async def on_session_stopped(self, session: ExotelVoiceSession) -> None:
        self.stopped_sessions.append(session)

    async def on_session_error(self, error: str, session: ExotelVoiceSession) -> None:
        self.errors.append((error, session))


class MockWebSocket:
    """Mock WebSocket transport for simulating Exotel AgentStream."""

    def __init__(self, incoming_messages=None):
        self.incoming = list(incoming_messages or [])
        self.sent_messages = []
        self.accepted = False
        self.closed = False

    async def accept(self):
        self.accepted = True

    async def receive_text(self):
        if self.incoming:
            return self.incoming.pop(0)
        # End of stream simulates client close
        raise Exception("Connection closed")

    async def send_text(self, text: str):
        self.sent_messages.append(text)

    async def close(self):
        self.closed = True


# ---------------------------------------------------------------------------
# 1. Full Lifecycle & Metadata Preservation
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_exotel_voice_gateway_full_lifecycle():
    gateway = ExotelVoiceGateway()
    listener = MockAudioStreamListener()
    gateway.register_listener_factory(lambda sess: listener)

    stream_sid = "str_12345"
    call_sid = "call_67890"
    sample_pcm = b"\x00\x01\x02\x03\x04\x05"
    sample_b64 = base64.b64encode(sample_pcm).decode("utf-8")

    messages = [
        json.dumps({"event": "connected", "protocol": "Call", "version": "1.0.0"}),
        json.dumps({
            "event": "start",
            "stream_sid": stream_sid,
            "start": {
                "stream_sid": stream_sid,
                "call_sid": call_sid,
                "account_sid": "acc_exotel_01",
                "from": "919876543210",
                "to": "01141189061",
                "media_format": {
                    "encoding": "audio/x-mulaw",
                    "sample_rate": 8000,
                    "channels": 1,
                },
                "custom_parameters": {
                    "session_id": "sess_eventra_999",
                    "event_id": "evt_wedding_01",
                    "task_id": "tsk_catering_02",
                    "provider_id": "prov_chef_03",
                },
            },
        }),
        json.dumps({
            "event": "media",
            "stream_sid": stream_sid,
            "media": {
                "payload": sample_b64,
            },
        }),
        json.dumps({
            "event": "dtmf",
            "stream_sid": stream_sid,
            "dtmf": {
                "digit": "5",
            },
        }),
        json.dumps({
            "event": "mark",
            "stream_sid": stream_sid,
            "mark": {
                "name": "greeting_playback_done",
            },
        }),
        json.dumps({
            "event": "stop",
            "stream_sid": stream_sid,
        }),
    ]

    ws = MockWebSocket(messages)
    await gateway.handle_connection(ws)

    assert ws.accepted is True
    assert len(listener.started_sessions) == 1
    session = listener.started_sessions[0]

    # Verify metadata preservation
    assert session.stream_sid == stream_sid
    assert session.call_sid == call_sid
    assert session.account_sid == "acc_exotel_01"
    assert session.from_number == "919876543210"
    assert session.to_number == "01141189061"
    assert session.session_id == "sess_eventra_999"
    assert session.custom_parameters["event_id"] == "evt_wedding_01"
    assert session.custom_parameters["task_id"] == "tsk_catering_02"
    assert session.media_format.encoding == "audio/x-mulaw"
    assert session.media_format.sample_rate == 8000

    # Verify audio received
    assert len(listener.received_audio_chunks) == 1
    pcm_received, _ = listener.received_audio_chunks[0]
    assert pcm_received == sample_pcm

    # Verify DTMF received
    assert len(listener.received_dtmf) == 1
    digit, _ = listener.received_dtmf[0]
    assert digit == "5"

    # Verify mark received
    assert len(listener.received_marks) == 1
    mark_name, _ = listener.received_marks[0]
    assert mark_name == "greeting_playback_done"

    # Verify stopped
    assert len(listener.stopped_sessions) == 1
    assert session.state == SessionState.STOPPED
    assert gateway.get_active_sessions_count() == 0


# ---------------------------------------------------------------------------
# 2. Outbound Audio, Mark, and Clear Formatting
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_exotel_session_outbound_formatting():
    ws = MockWebSocket()
    session = ExotelVoiceSession(websocket=ws, session_id="test_sess")
    session.stream_sid = "stream_xyz"
    session.state = SessionState.STREAMING

    # 1. Outbound Audio
    pcm_out = b"\x10\x20\x30\x40"
    sent_ok = await session.send_audio(pcm_out)
    assert sent_ok is True
    assert len(ws.sent_messages) == 1
    media_msg = json.loads(ws.sent_messages[0])
    assert media_msg["event"] == "media"
    assert media_msg["stream_sid"] == "stream_xyz"
    assert media_msg["media"]["payload"] == base64.b64encode(pcm_out).decode("utf-8")
    assert session.total_outbound_chunks == 1

    # 2. Outbound Mark
    mark_ok = await session.send_mark("chunk_marker_1")
    assert mark_ok is True
    assert len(ws.sent_messages) == 2
    mark_msg = json.loads(ws.sent_messages[1])
    assert mark_msg["event"] == "mark"
    assert mark_msg["stream_sid"] == "stream_xyz"
    assert mark_msg["mark"]["name"] == "chunk_marker_1"

    # 3. Outbound Clear
    clear_ok = await session.clear_audio()
    assert clear_ok is True
    assert len(ws.sent_messages) == 3
    clear_msg = json.loads(ws.sent_messages[2])
    assert clear_msg["event"] == "clear"
    assert clear_msg["stream_sid"] == "stream_xyz"


# ---------------------------------------------------------------------------
# 3. Error Handling & Edge Cases
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_exotel_malformed_json_resilience():
    """Malformed JSON does not crash the gateway."""
    gateway = ExotelVoiceGateway()
    listener = MockAudioStreamListener()
    gateway.register_listener_factory(lambda sess: listener)

    ws = MockWebSocket(["not a valid json {{{{"])
    await gateway.handle_connection(ws)

    assert len(listener.errors) == 1
    assert "Malformed JSON" in listener.errors[0][0]


@pytest.mark.asyncio
async def test_exotel_missing_start_fields():
    """Start event missing call_sid or stream_sid fails cleanly."""
    gateway = ExotelVoiceGateway()
    listener = MockAudioStreamListener()
    gateway.register_listener_factory(lambda sess: listener)

    ws = MockWebSocket([
        json.dumps({
            "event": "start",
            "start": {
                # missing stream_sid and call_sid
                "account_sid": "acc_01",
            },
        })
    ])
    await gateway.handle_connection(ws)

    assert len(listener.errors) == 1
    assert "Invalid start event" in listener.errors[0][0]


@pytest.mark.asyncio
async def test_exotel_invalid_base64_media():
    """Media payload with invalid base64 reports error and does not crash."""
    gateway = ExotelVoiceGateway()
    listener = MockAudioStreamListener()
    gateway.register_listener_factory(lambda sess: listener)

    ws = MockWebSocket([
        json.dumps({
            "event": "start",
            "stream_sid": "str_1",
            "start": {"stream_sid": "str_1", "call_sid": "call_1"},
        }),
        json.dumps({
            "event": "media",
            "stream_sid": "str_1",
            "media": {"payload": "!!NOT_BASE64@@"},
        }),
    ])
    await gateway.handle_connection(ws)

    assert len(listener.errors) == 1
    assert "Invalid base64 audio" in listener.errors[0][0]


@pytest.mark.asyncio
async def test_exotel_unknown_event_ignored():
    """Unknown event types are safely ignored without crashing."""
    gateway = ExotelVoiceGateway()
    listener = MockAudioStreamListener()
    gateway.register_listener_factory(lambda sess: listener)

    ws = MockWebSocket([
        json.dumps({"event": "custom_exotel_ping", "foo": "bar"}),
        json.dumps({
            "event": "start",
            "stream_sid": "str_2",
            "start": {"stream_sid": "str_2", "call_sid": "call_2"},
        }),
        json.dumps({"event": "future_unknown_event", "data": 123}),
        json.dumps({"event": "stop", "stream_sid": "str_2"}),
    ])
    await gateway.handle_connection(ws)

    assert len(listener.started_sessions) == 1
    assert len(listener.stopped_sessions) == 1
    assert len(listener.errors) == 0


@pytest.mark.asyncio
async def test_exotel_duplicate_stop_handled_safely():
    """Duplicate stop events do not fire duplicate callbacks or error."""
    gateway = ExotelVoiceGateway()
    listener = MockAudioStreamListener()
    gateway.register_listener_factory(lambda sess: listener)

    ws = MockWebSocket([
        json.dumps({
            "event": "start",
            "stream_sid": "str_dup",
            "start": {"stream_sid": "str_dup", "call_sid": "call_dup"},
        }),
        json.dumps({"event": "stop", "stream_sid": "str_dup"}),
        json.dumps({"event": "stop", "stream_sid": "str_dup"}),
    ])
    await gateway.handle_connection(ws)

    assert len(listener.stopped_sessions) == 1


# ---------------------------------------------------------------------------
# 4. FastAPI WebSocket Endpoint Test
# ---------------------------------------------------------------------------

def test_fastapi_websocket_endpoint():
    """Verifies that FastAPI accepts connections at /api/v1/voice/exotel/stream."""
    client = TestClient(app)

    listener = MockAudioStreamListener()
    voice_gateway.register_listener_factory(lambda sess: listener)

    sample_audio = b"\xaa\xbb\xcc\xdd"
    sample_b64 = base64.b64encode(sample_audio).decode("utf-8")

    with client.websocket_connect("/api/v1/voice/exotel/stream") as websocket:
        # Handshake
        websocket.send_text(json.dumps({"event": "connected", "protocol": "Call"}))

        # Start
        websocket.send_text(json.dumps({
            "event": "start",
            "stream_sid": "stream_endpoint_test",
            "start": {
                "stream_sid": "stream_endpoint_test",
                "call_sid": "call_endpoint_test",
                "from": "09876543210",
                "to": "01141189061",
                "custom_parameters": {"event_id": "evt_test_api"},
            },
        }))

        # Media chunk
        websocket.send_text(json.dumps({
            "event": "media",
            "stream_sid": "stream_endpoint_test",
            "media": {"payload": sample_b64},
        }))

        # Stop
        websocket.send_text(json.dumps({
            "event": "stop",
            "stream_sid": "stream_endpoint_test",
        }))

    assert len(listener.started_sessions) >= 1
    sess = listener.started_sessions[-1]
    assert sess.call_sid == "call_endpoint_test"
    assert sess.custom_parameters.get("event_id") == "evt_test_api"
    assert len(listener.received_audio_chunks) >= 1
    assert listener.received_audio_chunks[-1][0] == sample_audio
    assert len(listener.stopped_sessions) >= 1
