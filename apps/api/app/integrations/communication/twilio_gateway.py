"""Twilio Media Streams Voice Gateway & WebSocket Handler.

Implements the EVENTRA <-> Twilio bidirectional voice transport layer over WebSockets.
Handles Twilio Media Streams protocol events:
- connected
- start (captures streamSid, callSid, customParameters)
- media (inbound 8kHz G.711 mu-law, decoded and forwarded to listener)
- dtmf
- mark
- stop

Implements TwilioVoiceSession (VoiceSession) with strict 20ms (160-byte) chunking
for outbound mu-law audio framing.
"""
import base64
import binascii
from enum import Enum
import json
import logging
import time
import uuid
from typing import Any, Callable, Dict, List, Optional
from pydantic import BaseModel, Field

from app.integrations.communication.audio_converter import AudioConverter
from app.integrations.communication.voice_session import VoiceSession, AudioStreamListener

logger = logging.getLogger(__name__)

# Twilio Media Streams framing: 8000 Hz, 8-bit mono mu-law -> 160 bytes = 20ms
TWILIO_CHUNK_SIZE_BYTES = 160


class TwilioSessionState(str, Enum):
    """Lifecycle state machine for a Twilio Media Stream session."""
    INITIATED = "INITIATED"
    CONNECTING = "CONNECTING"
    CONNECTED = "CONNECTED"
    STREAMING = "STREAMING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    DISCONNECTED = "DISCONNECTED"
    STOPPED = "STOPPED"


class TwilioMediaFormat(BaseModel):
    """Twilio Media Streams audio format descriptor."""
    encoding: str = "audio/x-mulaw"
    sample_rate: int = 8000
    channels: int = 1


class TwilioVoiceSession:
    """Represents an active Twilio Media Streams call session implementing VoiceSession."""

    def __init__(
        self,
        websocket: Any,
        session_id: Optional[str] = None,
    ):
        self.websocket = websocket
        self.session_id: str = session_id or str(uuid.uuid4())
        self.stream_sid: Optional[str] = None
        self.call_sid: Optional[str] = None
        self.account_sid: Optional[str] = None
        self.from_number: Optional[str] = None
        self.to_number: Optional[str] = None
        self.media_format: TwilioMediaFormat = TwilioMediaFormat()
        self.custom_parameters: Dict[str, Any] = {}
        self.state: TwilioSessionState = TwilioSessionState.CONNECTING
        self.created_at: float = time.time()
        self.started_at: Optional[float] = None
        self.stopped_at: Optional[float] = None
        self.last_activity_at: float = self.created_at
        self.error_message: Optional[str] = None
        self.listener: Optional[AudioStreamListener] = None

        self.total_inbound_chunks: int = 0
        self.total_outbound_chunks: int = 0

    @property
    def is_active(self) -> bool:
        return self.state in (
            TwilioSessionState.INITIATED,
            TwilioSessionState.CONNECTING,
            TwilioSessionState.CONNECTED,
            TwilioSessionState.STREAMING,
        )

    async def send_audio(self, pcm_bytes: bytes) -> bool:
        """Sends audio back to Twilio.
        
        pcm_bytes may be:
        1. G.711 mu-law bytes (already encoded)
        2. PCM16 bytes needing encoding
        
        Twilio strictly requires 20ms chunks (160 bytes of mu-law @ 8000Hz).
        """
        if not self.is_active or not self.stream_sid:
            logger.warning(
                "TwilioVoiceSession: Cannot send audio: session not active (state=%s, stream_sid=%s)",
                self.state,
                self.stream_sid,
            )
            return False

        if not pcm_bytes:
            return False

        try:
            # If input is already 8-bit mu-law, len is equal to num samples
            # Chunk into fixed 160-byte slices (~20ms per packet)
            total_len = len(pcm_bytes)
            for offset in range(0, total_len, TWILIO_CHUNK_SIZE_BYTES):
                chunk = pcm_bytes[offset : offset + TWILIO_CHUNK_SIZE_BYTES]
                payload = base64.b64encode(chunk).decode("utf-8")
                msg = {
                    "event": "media",
                    "streamSid": self.stream_sid,
                    "media": {
                        "payload": payload,
                    },
                }
                await self._send_json(msg)
                self.total_outbound_chunks += 1
            return True
        except Exception as err:
            logger.error(
                "TwilioVoiceSession: Failed to send outbound audio [call_sid=%s, stream_sid=%s]: %s",
                self.call_sid,
                self.stream_sid,
                err,
            )
            return False

    async def send_mark(self, name: str) -> bool:
        """Sends a mark event to Twilio to track playback position."""
        if not self.stream_sid:
            return False

        try:
            msg = {
                "event": "mark",
                "streamSid": self.stream_sid,
                "mark": {
                    "name": name,
                },
            }
            await self._send_json(msg)
            return True
        except Exception as err:
            logger.error("TwilioVoiceSession: Failed to send mark '%s': %s", name, err)
            return False

    async def clear_audio(self) -> bool:
        """Sends a clear event to Twilio to flush buffered audio (barge-in interruption)."""
        if not self.stream_sid:
            return False

        try:
            msg = {
                "event": "clear",
                "streamSid": self.stream_sid,
            }
            await self._send_json(msg)
            logger.info("TwilioVoiceSession: Outbound audio buffer cleared for stream_sid=%s", self.stream_sid)
            return True
        except Exception as err:
            logger.error("TwilioVoiceSession: Failed to clear audio: %s", err)
            return False

    async def _send_json(self, data: Dict[str, Any]) -> None:
        """Sends a JSON message over the active WebSocket."""
        text = json.dumps(data)
        if hasattr(self.websocket, "send_text"):
            await self.websocket.send_text(text)
        elif hasattr(self.websocket, "send"):
            await self.websocket.send(text)


class TwilioVoiceGateway:
    """Gateway orchestrating WebSocket connections from Twilio Media Streams."""

    def __init__(self):
        self._sessions: Dict[str, TwilioVoiceSession] = {}
        self._listener_factory: Optional[Callable[[TwilioVoiceSession], AudioStreamListener]] = None

    def register_listener_factory(
        self, factory: Callable[[TwilioVoiceSession], AudioStreamListener]
    ) -> None:
        """Registers a factory function creating an AudioStreamListener per incoming call."""
        self._listener_factory = factory

    def stop_session(self, call_sid: str) -> bool:
        """Finds active session by call_sid or session_id and transitions to STOPPED."""
        found = False
        for s in list(self._sessions.values()):
            if s.call_sid == call_sid or s.session_id == call_sid or s.stream_sid == call_sid:
                s.state = TwilioSessionState.STOPPED
                s.stopped_at = time.time()
                found = True
        return found

    async def handle_connection(self, websocket: Any) -> None:
        """Entrypoint for a new Twilio Media Streams WebSocket connection."""
        if hasattr(websocket, "accept"):
            await websocket.accept()

        session = TwilioVoiceSession(websocket=websocket)
        logger.info("TwilioVoiceGateway: New WebSocket connection accepted.")

        try:
            while True:
                # Receive message
                if hasattr(websocket, "receive_text"):
                    raw = await websocket.receive_text()
                elif hasattr(websocket, "receive"):
                    msg_obj = await websocket.receive()
                    raw = msg_obj.get("text", "")
                else:
                    break

                if not raw:
                    continue

                session.last_activity_at = time.time()
                await self._dispatch_event(raw, session)

                if session.state in (TwilioSessionState.STOPPED, TwilioSessionState.COMPLETED, TwilioSessionState.FAILED):
                    break
        except Exception as exc:
            logger.warning("Twilio connection ended or encountered exception: %s", exc)
            session.state = TwilioSessionState.FAILED
            session.error_message = str(exc)
            if session.listener:
                await session.listener.on_session_error(str(exc), session)
        finally:
            if session.stream_sid and session.stream_sid in self._sessions:
                del self._sessions[session.stream_sid]
            if session.listener:
                await session.listener.on_session_stopped(session)

    async def _dispatch_event(self, raw_json: str, session: TwilioVoiceSession) -> None:
        """Dispatches an incoming Twilio Media Streams JSON event."""
        try:
            data = json.loads(raw_json)
        except Exception:
            logger.warning("TwilioVoiceGateway: Received malformed non-JSON frame: %s", raw_json[:80])
            return

        event_type = data.get("event")

        if event_type == "connected":
            session.state = TwilioSessionState.CONNECTED
            logger.info("TwilioVoiceGateway: Received 'connected' event.")

        elif event_type == "start":
            start_data = data.get("start", {})
            session.stream_sid = data.get("streamSid") or start_data.get("streamSid")
            session.call_sid = start_data.get("callSid")
            session.account_sid = start_data.get("accountSid")
            session.custom_parameters = start_data.get("customParameters", {}) or {}

            # Extract session_id from customParameters if passed in TwiML
            if "session_id" in session.custom_parameters:
                session.session_id = session.custom_parameters["session_id"]

            media_fmt = start_data.get("mediaFormat", {})
            session.media_format = TwilioMediaFormat(
                encoding=media_fmt.get("encoding", "audio/x-mulaw"),
                sample_rate=int(media_fmt.get("sampleRate", 8000)),
                channels=int(media_fmt.get("channels", 1)),
            )

            session.state = TwilioSessionState.STREAMING
            session.started_at = time.time()
            if session.stream_sid:
                self._sessions[session.stream_sid] = session

            logger.info(
                "TwilioVoiceGateway: Call started [stream_sid=%s, call_sid=%s, session_id=%s]",
                session.stream_sid,
                session.call_sid,
                session.session_id,
            )

            # Instantiate listener via registered factory
            if self._listener_factory:
                session.listener = self._listener_factory(session)
                await session.listener.on_session_started(session)

        elif event_type == "media":
            media_data = data.get("media", {})
            payload_b64 = media_data.get("payload", "")
            if not payload_b64:
                return

            try:
                audio_bytes = base64.b64decode(payload_b64)
                session.total_inbound_chunks += 1
                if session.listener:
                    await session.listener.on_audio_received(audio_bytes, session)
            except Exception as b64_err:
                logger.warning("Failed to decode Twilio media payload: %s", b64_err)

        elif event_type == "dtmf":
            dtmf_data = data.get("dtmf", {})
            digit = dtmf_data.get("digit", "")
            if session.listener:
                await session.listener.on_dtmf_received(digit, session)

        elif event_type == "mark":
            mark_data = data.get("mark", {})
            mark_name = mark_data.get("name", "")
            if session.listener:
                await session.listener.on_mark_received(mark_name, session)

        elif event_type == "stop":
            session.state = TwilioSessionState.STOPPED
            session.stopped_at = time.time()
            logger.info(
                "TwilioVoiceGateway: Stream stopped for call_sid=%s, stream_sid=%s",
                session.call_sid,
                session.stream_sid,
            )
            if session.listener:
                await session.listener.on_session_stopped(session)


# Global gateway singleton
twilio_voice_gateway = TwilioVoiceGateway()
