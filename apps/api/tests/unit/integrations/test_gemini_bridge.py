"""Unit and integration tests for GeminiLiveBridge (Task 3).

Verifies:
- Context sanitization (strict whitelist, stripping internal budget/margin/recovery)
- System prompt construction and behavioral guardrails
- Audio format conversion & sample-rate resampling (8kHz <-> 16kHz <-> 24kHz)
- Exotel audio -> Gemini Live forwarding
- Gemini Live audio -> Exotel playback forwarding
- Barge-in / interruption triggering Exotel clear_audio
- Transcript capture (vendor input & agent output)
- Gemini connection failure resilience without crashing
- Per-call session isolation across concurrent calls
- End-to-end Exotel Voice Gateway + Gemini Live integration
"""
import asyncio
import base64
import json
import time
from typing import Any, AsyncIterator, List, Optional
import pytest
from unittest.mock import MagicMock

from app.core.config import settings
from app.integrations.communication.audio_converter import AudioConverter, _resample_pcm16_linear
from app.integrations.communication.exotel_gateway import (
    ExotelVoiceGateway,
    ExotelVoiceSession,
    MediaFormat,
    SessionState,
)
from app.integrations.communication.gemini_bridge import (
    GeminiLiveBridge,
    SanitizedVoiceContext,
    TranscriptEntry,
    TranscriptSpeaker,
    build_vendor_system_prompt,
    create_gemini_bridge_factory,
    sanitize_voice_context,
)


# ---------------------------------------------------------------------------
# Test Helpers & Mock Classes
# ---------------------------------------------------------------------------

class MockWebSocket:
    """Mock WebSocket capturing sent messages and providing incoming stream."""
    def __init__(self, incoming: Optional[List[str]] = None, delay: float = 0.05):
        self.incoming = list(incoming or [])
        self.delay = delay
        self.sent_messages: List[str] = []
        self.is_closed = False

    async def accept(self):
        pass

    async def send_text(self, text: str):
        self.sent_messages.append(text)

    async def receive_text(self) -> str:
        if self.delay > 0:
            await asyncio.sleep(self.delay)
        if not self.incoming:
            raise Exception("WebSocket disconnected")
        return self.incoming.pop(0)


class MockInlineData:
    def __init__(self, data: bytes, mime_type: str = "audio/pcm;rate=24000"):
        self.data = data
        self.mime_type = mime_type


class MockPart:
    def __init__(self, text: Optional[str] = None, data: Optional[bytes] = None):
        self.text = text
        self.inline_data = MockInlineData(data) if data else None


class MockModelTurn:
    def __init__(self, parts: List[MockPart]):
        self.parts = parts


class MockTranscription:
    def __init__(self, text: str, finished: bool = True):
        self.text = text
        self.finished = finished


class MockServerContent:
    def __init__(
        self,
        model_turn: Optional[MockModelTurn] = None,
        input_transcription: Optional[MockTranscription] = None,
        output_transcription: Optional[MockTranscription] = None,
        interrupted: bool = False,
        turn_complete: bool = False,
    ):
        self.model_turn = model_turn
        self.input_transcription = input_transcription
        self.output_transcription = output_transcription
        self.interrupted = interrupted
        self.turn_complete = turn_complete


class MockLiveServerMessage:
    def __init__(self, server_content: Optional[MockServerContent] = None):
        self.server_content = server_content


class MockGeminiSession:
    """Mock Gemini Live AsyncSession."""
    def __init__(self, responses: Optional[List[MockLiveServerMessage]] = None):
        self.sent_messages: List[Any] = []
        self.responses: List[MockLiveServerMessage] = list(responses or [])
        self.is_closed = False
        self._receive_queue: asyncio.Queue[Optional[MockLiveServerMessage]] = asyncio.Queue()
        for r in self.responses:
            self._receive_queue.put_nowait(r)

    async def send(self, input: Any, end_of_turn: bool = False):
        self.sent_messages.append(input)

    async def receive(self) -> AsyncIterator[MockLiveServerMessage]:
        while not self.is_closed:
            try:
                msg = await asyncio.wait_for(self._receive_queue.get(), timeout=0.2)
                if msg is None:
                    break
                yield msg
            except asyncio.TimeoutError:
                break

    def inject_response(self, msg: MockLiveServerMessage):
        self._receive_queue.put_nowait(msg)


class MockLiveContextManager:
    def __init__(self, session: MockGeminiSession):
        self.session = session

    async def __aenter__(self):
        return self.session

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        self.session.is_closed = True


class MockLiveClient:
    def __init__(self, session: Optional[MockGeminiSession] = None):
        self.session = session or MockGeminiSession()
        self.connected_models: List[str] = []
        self.connected_configs: List[Any] = []

        class Aio:
            def __init__(self, outer):
                class Live:
                    def __init__(self, outer):
                        self.outer = outer

                    def connect(self, model: str, config: Any = None):
                        self.outer.connected_models.append(model)
                        self.outer.connected_configs.append(config)
                        return MockLiveContextManager(self.outer.session)
                self.live = Live(outer)
        self.aio = Aio(self)


# ---------------------------------------------------------------------------
# Unit Tests
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_sanitized_context_whitelist_and_blacklist():
    """Verify context sanitization preserves safe fields and strips sensitive internals."""
    ws = MockWebSocket()
    session = ExotelVoiceSession(websocket=ws)
    session.call_sid = "call_123"
    session.stream_sid = "stream_456"
    session.to_number = "+919876543210"
    session.custom_parameters = {
        # Safe fields
        "event_id": "evt_001",
        "task_id": "tsk_002",
        "provider_id": "prv_003",
        "vendor_name": "Royal Banquet Caterers",
        "task_title": "Dinner Buffet Service",
        "task_description": "Buffet for 150 guests on terrace",
        "event_name": "Tech Annual Gala",
        "event_date": "2026-10-15",
        "event_location": "Bangalore",
        # Sensitive fields that MUST be stripped
        "organizer_budget": 500000,
        "internal_margin": 0.15,
        "internal_notes": "Vendor is known to overcharge; offer max 300/plate",
        "alternative_quotes": [{"name": "Other", "rate": 250}],
        "recovery_strategy": "FALLBACK_P3",
        "auth_token": "secret_abc123",
    }

    ctx = sanitize_voice_context(session)

    # Allowed fields present
    assert ctx.session_id == session.session_id
    assert ctx.call_sid == "call_123"
    assert ctx.stream_sid == "stream_456"
    assert ctx.event_id == "evt_001"
    assert ctx.task_id == "tsk_002"
    assert ctx.provider_id == "prv_003"
    assert ctx.vendor_name == "Royal Banquet Caterers"
    assert ctx.task_title == "Dinner Buffet Service"
    assert ctx.event_name == "Tech Annual Gala"
    assert ctx.vendor_phone == "+919876543210"

    # Verify sensitive internals are not present anywhere in dumped dict
    dumped = ctx.model_dump()
    for sensitive_key in ["budget", "margin", "internal", "recovery", "auth_token", "alternative_quotes"]:
        assert sensitive_key not in dumped
        for val in dumped.values():
            assert sensitive_key not in str(val).lower()


def test_system_prompt_construction():
    """Verify system prompt enforces natural tone, concise speech, and operational boundaries."""
    ctx = SanitizedVoiceContext(
        session_id="sess_1",
        vendor_name="DJ Sounds",
        task_title="Sound System Setup",
        task_description="PA system with 4 mics",
        event_name="Product Launch",
        event_date="2026-11-01",
        event_location="Mumbai",
    )

    prompt = build_vendor_system_prompt(ctx)

    assert "EVENTRA Voice Coordinator" in prompt
    assert "DJ Sounds" in prompt
    assert "Sound System Setup" in prompt
    assert "Product Launch" in prompt
    # Strict guardrails
    assert "NEVER invent or assume availability" in prompt
    assert "NEVER confirm or approve a booking autonomously" in prompt
    assert "You do NOT have financial or booking authority" in prompt
    assert "1 to 2 sentences maximum" in prompt


def test_audio_converter_resampling():
    """Verify audio converter performs 8kHz <-> 16kHz and 24kHz <-> 8kHz conversion."""
    conv = AudioConverter(
        exotel_sample_rate=8000,
        encoding="audio/l16",
        gemini_input_sample_rate=16000,
        gemini_output_sample_rate=24000,
    )

    # 1. Inbound: Exotel 8kHz (160 bytes = 80 samples) -> Gemini 16kHz
    exotel_in = b"\x00\x00\x10\x00" * 40  # 160 bytes
    gemini_in = conv.exotel_to_gemini(exotel_in)
    assert len(gemini_in) > len(exotel_in)
    # At 2x upsampling, sample count doubles
    assert len(gemini_in) >= 300

    # 2. Outbound: Gemini 24kHz (480 bytes = 240 samples) -> Exotel 8kHz
    gemini_out = b"\x00\x00\x10\x00" * 120  # 480 bytes
    exotel_out = conv.gemini_to_exotel(gemini_out)
    assert len(exotel_out) < len(gemini_out)
    # At 3:1 downsampling, length should be roughly 160 bytes
    assert 140 <= len(exotel_out) <= 180

    # 3. Mu-law conversion
    conv_mulaw = AudioConverter(exotel_sample_rate=8000, encoding="audio/x-mulaw")
    assert conv_mulaw.is_mulaw is True
    mulaw_bytes = b"\xff\x00" * 40
    lin_pcm = conv_mulaw.exotel_to_gemini(mulaw_bytes)
    assert len(lin_pcm) > len(mulaw_bytes)

    # 4. State reset
    conv.reset_states()
    assert conv._inbound_state is None
    assert conv._outbound_state is None


@pytest.mark.asyncio
async def test_exotel_audio_forwarded_to_gemini():
    """Verify inbound Exotel PCM audio is resampled and sent to Gemini Live."""
    ws = MockWebSocket()
    session = ExotelVoiceSession(websocket=ws)
    session.stream_sid = "stream_1"
    session.call_sid = "call_1"

    mock_gemini = MockGeminiSession()
    mock_client = MockLiveClient(mock_gemini)

    bridge = GeminiLiveBridge(session=session, client_factory=lambda: mock_client)
    await bridge.on_session_started(session)

    # Send 8kHz PCM chunk
    chunk = b"\x10\x00" * 80  # 80 samples = 160 bytes
    await bridge.on_audio_received(chunk, session)

    # Allow background send task to process queue
    await asyncio.sleep(0.05)

    assert len(mock_gemini.sent_messages) >= 1
    sent_input = mock_gemini.sent_messages[0]
    # Verify sent payload contains media chunks
    assert hasattr(sent_input, "media_chunks")
    blob = sent_input.media_chunks[0]
    assert blob.mime_type == "audio/pcm;rate=16000"
    assert len(blob.data) > len(chunk)  # Resampled from 8k to 16k

    await bridge.on_session_stopped(session)


@pytest.mark.asyncio
async def test_gemini_audio_forwarded_to_exotel():
    """Verify outbound Gemini Live 24kHz audio is converted and delivered via session.send_audio."""
    ws = MockWebSocket()
    session = ExotelVoiceSession(websocket=ws)
    session.stream_sid = "stream_out_1"
    session.call_sid = "call_out_1"
    session.state = SessionState.STREAMING

    # Prepare Gemini response with 24kHz audio
    raw_24k_audio = b"\x20\x00" * 240  # 480 bytes
    part = MockPart(data=raw_24k_audio)
    server_content = MockServerContent(model_turn=MockModelTurn([part]))
    response_msg = MockLiveServerMessage(server_content=server_content)

    mock_gemini = MockGeminiSession(responses=[response_msg])
    mock_client = MockLiveClient(mock_gemini)

    bridge = GeminiLiveBridge(session=session, client_factory=lambda: mock_client)
    await bridge.on_session_started(session)

    await asyncio.sleep(0.08)

    # Verify session received outbound audio over websocket
    assert len(ws.sent_messages) >= 1
    out_msg = json.loads(ws.sent_messages[0])
    assert out_msg["event"] == "media"
    assert out_msg["stream_sid"] == "stream_out_1"

    # Decode payload and check that downsampled length is smaller than original 24k
    out_pcm = base64.b64decode(out_msg["media"]["payload"])
    assert len(out_pcm) < len(raw_24k_audio)

    await bridge.on_session_stopped(session)


@pytest.mark.asyncio
async def test_gemini_interruption_triggers_session_clear():
    """Verify Gemini barge-in / interruption triggers session.clear_audio()."""
    ws = MockWebSocket()
    session = ExotelVoiceSession(websocket=ws)
    session.stream_sid = "stream_int_1"
    session.state = SessionState.STREAMING

    server_content = MockServerContent(interrupted=True)
    response_msg = MockLiveServerMessage(server_content=server_content)

    mock_gemini = MockGeminiSession(responses=[response_msg])
    mock_client = MockLiveClient(mock_gemini)

    bridge = GeminiLiveBridge(session=session, client_factory=lambda: mock_client)
    await bridge.on_session_started(session)

    await asyncio.sleep(0.08)

    # Check that clear event was sent to Exotel
    assert len(ws.sent_messages) == 1
    clear_msg = json.loads(ws.sent_messages[0])
    assert clear_msg["event"] == "clear"
    assert clear_msg["stream_sid"] == "stream_int_1"

    await bridge.on_session_stopped(session)


@pytest.mark.asyncio
async def test_transcription_capture():
    """Verify typed transcript entries are captured for vendor and agent turns."""
    ws = MockWebSocket()
    session = ExotelVoiceSession(websocket=ws)
    session.stream_sid = "stream_tx_1"

    # 1. Vendor input transcript
    vendor_msg = MockLiveServerMessage(
        server_content=MockServerContent(
            input_transcription=MockTranscription("Hello, this is Royal Catering."),
        )
    )
    # 2. Agent output transcript and text
    agent_msg = MockLiveServerMessage(
        server_content=MockServerContent(
            model_turn=MockModelTurn([MockPart(text="Hi, I am calling from EVENTRA regarding dinner buffet.")]),
            turn_complete=True,
        )
    )

    mock_gemini = MockGeminiSession(responses=[vendor_msg, agent_msg])
    mock_client = MockLiveClient(mock_gemini)

    bridge = GeminiLiveBridge(session=session, client_factory=lambda: mock_client)
    await bridge.on_session_started(session)

    await asyncio.sleep(0.08)

    transcript = bridge.get_transcript()
    assert len(transcript) == 2
    assert transcript[0].speaker == TranscriptSpeaker.VENDOR
    assert "Royal Catering" in transcript[0].text
    assert transcript[1].speaker == TranscriptSpeaker.AGENT
    assert "dinner buffet" in transcript[1].text

    full_text = bridge.get_full_transcript_text()
    assert "VENDOR: Hello, this is Royal Catering." in full_text
    assert "AGENT: Hi, I am calling from EVENTRA regarding dinner buffet." in full_text

    state = bridge.get_conversation_state()
    assert state["status"] == "COMPLETED"
    assert state["turn_count"] == 1
    assert state["transcript_turns"] == 2

    await bridge.on_session_stopped(session)


@pytest.mark.asyncio
async def test_gemini_connection_failure_handling():
    """Verify Gemini connection failure does not crash the gateway and records error state."""
    ws = MockWebSocket()
    session = ExotelVoiceSession(websocket=ws)
    session.stream_sid = "stream_err_1"

    class FailingClient:
        class Aio:
            class Live:
                def connect(self, model: str, config: Any = None):
                    raise ConnectionError("Gemini live connection failed")
            live = Live()
        aio = Aio()

    bridge = GeminiLiveBridge(session=session, client_factory=lambda: FailingClient())
    await bridge.on_session_started(session)

    await asyncio.sleep(0.05)

    assert bridge._is_running is False
    assert bridge.error_message is not None
    assert "Gemini live connection failed" in bridge.error_message

    state = bridge.get_conversation_state()
    assert state["status"] == "FAILED"
    assert "Gemini live connection failed" in state["error"]


@pytest.mark.asyncio
async def test_per_call_session_isolation():
    """Verify two concurrent calls operate completely isolated Gemini sessions and transcripts."""
    ws1 = MockWebSocket()
    ws2 = MockWebSocket()

    s1 = ExotelVoiceSession(websocket=ws1, session_id="call_one")
    s1.stream_sid = "sid_1"
    s1.state = SessionState.STREAMING

    s2 = ExotelVoiceSession(websocket=ws2, session_id="call_two")
    s2.stream_sid = "sid_2"
    s2.state = SessionState.STREAMING

    msg_s1 = MockLiveServerMessage(
        server_content=MockServerContent(
            input_transcription=MockTranscription("Speaker One says hello"),
            turn_complete=True,
        )
    )
    msg_s2 = MockLiveServerMessage(
        server_content=MockServerContent(
            input_transcription=MockTranscription("Speaker Two says goodbye"),
            turn_complete=True,
        )
    )

    mock_gemini_1 = MockGeminiSession(responses=[msg_s1])
    mock_gemini_2 = MockGeminiSession(responses=[msg_s2])

    bridge1 = GeminiLiveBridge(session=s1, client_factory=lambda: MockLiveClient(mock_gemini_1))
    bridge2 = GeminiLiveBridge(session=s2, client_factory=lambda: MockLiveClient(mock_gemini_2))

    await bridge1.on_session_started(s1)
    await bridge2.on_session_started(s2)

    # Feed audio to s1 only
    await bridge1.on_audio_received(b"\x10\x00" * 40, s1)
    await asyncio.sleep(0.08)

    # Check isolation of sent messages
    assert len(mock_gemini_1.sent_messages) == 1
    assert len(mock_gemini_2.sent_messages) == 0

    # Check isolation of transcripts
    assert len(bridge1.get_transcript()) == 1
    assert "Speaker One" in bridge1.get_transcript()[0].text

    assert len(bridge2.get_transcript()) == 1
    assert "Speaker Two" in bridge2.get_transcript()[0].text

    assert bridge1.session.session_id != bridge2.session.session_id

    await bridge1.on_session_stopped(s1)
    await bridge2.on_session_stopped(s2)


@pytest.mark.asyncio
async def test_exotel_disconnect_cleanup():
    """Verify Exotel disconnect stops the bridge and frees background tasks."""
    ws = MockWebSocket()
    session = ExotelVoiceSession(websocket=ws)
    session.stream_sid = "stream_disc_1"

    mock_gemini = MockGeminiSession()
    mock_client = MockLiveClient(mock_gemini)

    bridge = GeminiLiveBridge(session=session, client_factory=lambda: mock_client)
    await bridge.on_session_started(session)

    assert bridge._is_running is True
    assert bridge._bridge_task is not None

    # Call stopped
    await bridge.on_session_stopped(session)

    assert bridge._is_running is False
    assert bridge.stopped_at is not None
    assert bridge._inbound_audio_queue.empty()


@pytest.mark.asyncio
async def test_gemini_malformed_response_handling():
    """Verify malformed or unexpected Gemini server messages do not crash the bridge."""
    ws = MockWebSocket()
    session = ExotelVoiceSession(websocket=ws)
    session.stream_sid = "stream_malformed"

    # Inject objects with None server_content, unexpected attributes, or malformed parts
    malformed_msg1 = MockLiveServerMessage(server_content=None)
    malformed_msg2 = "string_message_not_obj"  # Non-object
    valid_msg = MockLiveServerMessage(
        server_content=MockServerContent(
            input_transcription=MockTranscription("Valid message after malformed"),
            turn_complete=True,
        )
    )

    mock_gemini = MockGeminiSession(responses=[malformed_msg1, malformed_msg2, valid_msg])
    mock_client = MockLiveClient(mock_gemini)

    bridge = GeminiLiveBridge(session=session, client_factory=lambda: mock_client)
    await bridge.on_session_started(session)

    await asyncio.sleep(0.08)

    # Valid message after malformed was still processed
    assert len(bridge.get_transcript()) == 1
    assert "Valid message after malformed" in bridge.get_transcript()[0].text
    await bridge.on_session_stopped(session)


@pytest.mark.asyncio
async def test_gemini_missing_api_key_handling(monkeypatch):
    """Verify missing Gemini API key gracefully sets error state without crashing."""
    ws = MockWebSocket()
    session = ExotelVoiceSession(websocket=ws)
    session.stream_sid = "stream_no_key"

    monkeypatch.setattr(settings, "GEMINI_API_KEY", None)
    monkeypatch.setattr(settings, "LLM_API_KEY", None)
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("LLM_API_KEY", raising=False)

    bridge = GeminiLiveBridge(session=session, client_factory=None)
    await bridge.on_session_started(session)

    await asyncio.sleep(0.05)

    assert bridge._is_running is False
    assert bridge.error_message is not None
    assert "GEMINI_API_KEY is not configured" in bridge.error_message
    state = bridge.get_conversation_state()
    assert state["status"] == "FAILED"


# ---------------------------------------------------------------------------
# Integration Test (End-to-End Gateway + Gemini Bridge)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_end_to_end_gateway_and_gemini_bridge():
    """End-to-end integration test:
    Exotel start -> Gemini session created -> Exotel PCM -> Gemini response -> Exotel outbound media -> stop.
    """
    raw_response_pcm = b"\x30\x00" * 240  # 480 bytes at 24kHz
    part = MockPart(text="Confirmed, we have recorded your availability.", data=raw_response_pcm)
    gemini_resp = MockLiveServerMessage(
        server_content=MockServerContent(
            model_turn=MockModelTurn([part]),
            turn_complete=True,
        )
    )

    mock_gemini = MockGeminiSession(responses=[gemini_resp])
    mock_client = MockLiveClient(mock_gemini)

    # Create gateway and register GeminiLiveBridge factory
    gateway = ExotelVoiceGateway()
    bridge_factory = create_gemini_bridge_factory(client_factory=lambda: mock_client)
    gateway.register_listener_factory(bridge_factory)

    # Exotel protocol messages
    start_payload = json.dumps({
        "event": "start",
        "stream_sid": "stream_e2e_100",
        "start": {
            "stream_sid": "stream_e2e_100",
            "call_sid": "call_e2e_200",
            "account_sid": "acc_300",
            "from": "+911141189061",
            "to": "+919876543210",
            "media_format": {"encoding": "audio/l16", "sample_rate": 8000, "channels": 1},
            "custom_parameters": {
                "vendor_name": "Grand Decorators",
                "task_title": "Floral stage decor",
                "event_name": "Summer Wedding",
            },
        },
    })

    inbound_pcm = b"\x00\x00\x10\x00" * 40  # 160 bytes at 8kHz
    media_payload = json.dumps({
        "event": "media",
        "stream_sid": "stream_e2e_100",
        "media": {
            "payload": base64.b64encode(inbound_pcm).decode("utf-8"),
        },
    })

    stop_payload = json.dumps({
        "event": "stop",
        "stream_sid": "stream_e2e_100",
    })

    ws = MockWebSocket(incoming=[start_payload, media_payload, stop_payload])

    # Run gateway connection loop
    await gateway.handle_connection(ws)

    # Verify session was created and attached to listener
    assert len(mock_client.connected_models) == 1
    assert "gemini" in mock_client.connected_models[0].lower()

    # Verify inbound PCM reached Gemini mock
    await asyncio.sleep(0.08)
    assert len(mock_gemini.sent_messages) >= 1

    # Verify outbound audio response reached Exotel websocket
    media_sent = [json.loads(m) for m in ws.sent_messages if '"event": "media"' in m or '"event":"media"' in m]
    assert len(media_sent) >= 1
    assert media_sent[0]["stream_sid"] == "stream_e2e_100"
    outbound_payload = base64.b64decode(media_sent[0]["media"]["payload"])
    assert len(outbound_payload) > 0

    # Verify gateway cleanly closed sessions
    assert gateway.get_active_sessions_count() == 0
