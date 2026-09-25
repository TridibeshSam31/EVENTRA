"""Exotel AgentStream Voice Gateway & Internal Audio Interface (Task 2).

Implements the EVENTRA <-> Exotel bidirectional voice transport layer.
Handles Exotel AgentStream WebSocket protocol events:
- connected
- start
- media (inbound PCM/mulaw bytes)
- dtmf
- mark
- stop
- unknown events

Provides a clean, typed internal audio interface separating the telephony transport
from downstream voice intelligence (Gemini Live to be attached in Task 3).
"""
from abc import ABC, abstractmethod
import base64
import binascii
from enum import Enum
import json
import logging
import time
import uuid
from typing import Any, Callable, Dict, List, Optional
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)


class SessionState(str, Enum):
    """State machine lifecycle for an Exotel voice stream session."""
    INITIATED = "INITIATED"
    CONNECTING = "CONNECTING"
    CONNECTED = "CONNECTED"
    STREAMING = "STREAMING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    DISCONNECTED = "DISCONNECTED"
    TIMED_OUT = "TIMED_OUT"
    CANCELLED = "CANCELLED"

    # Backward compatibility aliases
    STARTED = "STARTED"
    STOPPED = "STOPPED"


class MediaFormat(BaseModel):
    """Audio media encoding details delivered in Exotel start event."""
    encoding: str = "audio/x-mulaw"
    sample_rate: int = 8000
    channels: int = 1


class AudioStreamListener(ABC):
    """Internal audio interface between Exotel transport and downstream voice processors.
    
    Task 3 attaches Gemini Live by implementing or registering this interface.
    The listener receives raw audio bytes and event notifications without needing
    to understand Exotel's wire WebSocket protocol.
    """

    async def on_session_started(self, session: "ExotelVoiceSession") -> None:
        """Called when Exotel start event has been successfully validated."""
        pass

    async def on_audio_received(self, pcm_bytes: bytes, session: "ExotelVoiceSession") -> None:
        """Called when a valid media frame arrives from Exotel."""
        pass

    async def on_dtmf_received(self, digit: str, session: "ExotelVoiceSession") -> None:
        """Called when vendor sends a DTMF tone."""
        pass

    async def on_mark_received(self, mark_name: str, session: "ExotelVoiceSession") -> None:
        """Called when Exotel confirms playback of a named mark."""
        pass

    async def on_session_stopped(self, session: "ExotelVoiceSession") -> None:
        """Called when Exotel terminates the stream."""
        pass

    async def on_session_error(self, error: str, session: "ExotelVoiceSession") -> None:
        """Called on unexpected error or malformed payload."""
        pass


class ExotelVoiceSession:
    """Represents an active Exotel AgentStream call session.
    
    Exposes clean methods for downstream processors to send audio, marks, and
    interrupts (clear) back to Exotel without exposing Exotel JSON formatting.
    """

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
        self.media_format: MediaFormat = MediaFormat()
        self.custom_parameters: Dict[str, Any] = {}
        self.state: SessionState = SessionState.CONNECTING
        self.created_at: float = time.time()
        self.started_at: Optional[float] = None
        self.stopped_at: Optional[float] = None
        self.last_activity_at: float = self.created_at
        self.error_message: Optional[str] = None
        self.error_classification: Optional[str] = None
        self.listener: Optional[AudioStreamListener] = None

        self.total_inbound_chunks: int = 0
        self.total_outbound_chunks: int = 0

    @property
    def is_active(self) -> bool:
        return self.state in (
            SessionState.INITIATED,
            SessionState.CONNECTING,
            SessionState.STARTED,
            SessionState.CONNECTED,
            SessionState.STREAMING,
        )

    @property
    def is_terminal(self) -> bool:
        return self.state in (
            SessionState.COMPLETED,
            SessionState.STOPPED,
            SessionState.FAILED,
            SessionState.DISCONNECTED,
            SessionState.TIMED_OUT,
            SessionState.CANCELLED,
        )

    async def send_audio(self, pcm_bytes: bytes) -> bool:
        """Sends raw audio back to Exotel over WebSocket as a media event."""
        if not self.is_active or not self.stream_sid:
            logger.warning(
                "Cannot send audio: session not active (state=%s, stream_sid=%s)",
                self.state,
                self.stream_sid,
            )
            return False

        if not pcm_bytes:
            return False

        try:
            payload = base64.b64encode(pcm_bytes).decode("utf-8")
            msg = {
                "event": "media",
                "stream_sid": self.stream_sid,
                "media": {
                    "payload": payload,
                },
            }
            await self._send_json(msg)
            self.total_outbound_chunks += 1
            return True
        except Exception as err:
            logger.error(
                "Failed to send outbound audio to Exotel [call_sid=%s, stream_sid=%s]: %s",
                self.call_sid,
                self.stream_sid,
                err,
            )
            return False

    async def send_mark(self, name: str) -> bool:
        """Sends a mark event to Exotel to track when playback reaches this point."""
        if not self.stream_sid:
            return False

        try:
            msg = {
                "event": "mark",
                "stream_sid": self.stream_sid,
                "mark": {
                    "name": name,
                },
            }
            await self._send_json(msg)
            return True
        except Exception as err:
            logger.error(
                "Failed to send mark '%s' to Exotel [stream_sid=%s]: %s",
                name,
                self.stream_sid,
                err,
            )
            return False

    async def clear_audio(self) -> bool:
        """Sends a clear event to Exotel to immediately flush playback buffer (interruption)."""
        if not self.stream_sid:
            return False

        try:
            msg = {
                "event": "clear",
                "stream_sid": self.stream_sid,
            }
            await self._send_json(msg)
            return True
        except Exception as err:
            logger.error(
                "Failed to send clear to Exotel [stream_sid=%s]: %s",
                self.stream_sid,
                err,
            )
            return False

    async def _send_json(self, data: Dict[str, Any]) -> None:
        """Sends JSON over underlying WebSocket transport."""
        text = json.dumps(data)
        if hasattr(self.websocket, "send_text"):
            await self.websocket.send_text(text)
        elif hasattr(self.websocket, "send"):
            await self.websocket.send(text)
        else:
            raise RuntimeError(f"Underlying transport {type(self.websocket)} has no send_text/send method.")


class ExotelVoiceGateway:
    """Manages Exotel AgentStream WebSocket connections, parsing, and lifecycle dispatch."""

    def __init__(self):
        self._active_sessions: Dict[str, ExotelVoiceSession] = {}
        self._listener_factory: Optional[Callable[[ExotelVoiceSession], AudioStreamListener]] = None

    def register_listener_factory(
        self,
        factory: Callable[[ExotelVoiceSession], AudioStreamListener],
    ) -> None:
        """Registers a factory that instantiates downstream listeners (e.g. Gemini Live in Task 3)."""
        self._listener_factory = factory

    def get_session(self, stream_sid_or_session_id: str) -> Optional[ExotelVoiceSession]:
        """Retrieves an active session by stream_sid or session_id."""
        if stream_sid_or_session_id in self._active_sessions:
            return self._active_sessions[stream_sid_or_session_id]

        for s in self._active_sessions.values():
            if s.session_id == stream_sid_or_session_id or s.stream_sid == stream_sid_or_session_id:
                return s
        return None

    def get_active_sessions_count(self) -> int:
        return len(self._active_sessions)

    async def handle_connection(self, websocket: Any) -> None:
        """Handles full WebSocket connection lifecycle for a single Exotel stream."""
        if hasattr(websocket, "accept"):
            await websocket.accept()

        session = ExotelVoiceSession(websocket=websocket)
        if self._listener_factory:
            try:
                session.listener = self._listener_factory(session)
            except Exception as factory_err:
                logger.error("Error creating listener from factory: %s", factory_err)

        logger.info("Exotel AgentStream connected, session_id=%s", session.session_id)

        try:
            while True:
                # Receive message text
                try:
                    if hasattr(websocket, "receive_text"):
                        message_text = await websocket.receive_text()
                    elif hasattr(websocket, "receive"):
                        msg_obj = await websocket.receive()
                        if isinstance(msg_obj, dict):
                            if msg_obj.get("type") == "websocket.disconnect":
                                break
                            message_text = msg_obj.get("text") or ""
                        elif isinstance(msg_obj, str):
                            message_text = msg_obj
                        else:
                            break
                    else:
                        break
                except Exception as rx_err:
                    # Client disconnected or transport closed
                    logger.info("Exotel connection closed for session_id=%s: %s", session.session_id, rx_err)
                    break

                if not message_text:
                    continue

                await self.process_message(message_text, session)

                if session.state in (SessionState.STOPPED, SessionState.FAILED):
                    break

        except Exception as conn_err:
            logger.error("Unhandled error in Exotel AgentStream handler: %s", conn_err)
            session.state = SessionState.FAILED
            if session.listener:
                await session.listener.on_session_error(str(conn_err), session)
        finally:
            await self._cleanup_session(session)

    async def process_message(self, message_text: str, session: ExotelVoiceSession) -> None:
        """Parses and dispatches a single Exotel AgentStream message."""
        try:
            data = json.loads(message_text)
        except Exception as json_err:
            logger.warning("Malformed JSON from Exotel [session_id=%s]: %s", session.session_id, json_err)
            session.state = SessionState.FAILED
            if session.listener:
                await session.listener.on_session_error(f"Malformed JSON: {json_err}", session)
            return

        if not isinstance(data, dict):
            logger.warning("Non-dict JSON payload from Exotel [session_id=%s]", session.session_id)
            return

        event_type = data.get("event")
        if not event_type:
            logger.warning("Missing 'event' field in Exotel payload [session_id=%s]", session.session_id)
            return

        event_lower = str(event_type).strip().lower()

        # 1. Connected Event
        if event_lower == "connected":
            protocol = data.get("protocol", "Call")
            version = data.get("version", "1.0.0")
            logger.info("Exotel handshake established [protocol=%s, version=%s]", protocol, version)
            return

        # 2. Start Event
        if event_lower == "start":
            await self._handle_start_event(data, session)
            return

        # 3. Media Event
        if event_lower == "media":
            await self._handle_media_event(data, session)
            return

        # 4. DTMF Event
        if event_lower == "dtmf":
            await self._handle_dtmf_event(data, session)
            return

        # 5. Mark Event
        if event_lower == "mark":
            await self._handle_mark_event(data, session)
            return

        # 6. Stop Event
        if event_lower == "stop":
            await self._handle_stop_event(data, session)
            return

        # 7. Unknown / Unhandled Events
        logger.info(
            "Ignored unhandled Exotel event '%s' [stream_sid=%s, call_sid=%s]",
            event_type,
            session.stream_sid,
            session.call_sid,
        )

    async def _handle_start_event(self, data: Dict[str, Any], session: ExotelVoiceSession) -> None:
        """Validates and processes start event."""
        start_obj = data.get("start")
        if not isinstance(start_obj, dict):
            # Check if fields are flat on top-level
            start_obj = data

        stream_sid = (
            start_obj.get("stream_sid")
            or start_obj.get("streamSid")
            or data.get("stream_sid")
            or data.get("streamSid")
        )
        call_sid = start_obj.get("call_sid") or start_obj.get("callSid")
        account_sid = start_obj.get("account_sid") or start_obj.get("accountSid")

        # Validate mandatory start fields
        if not stream_sid or not call_sid:
            error_msg = f"Invalid start event: missing stream_sid or call_sid (stream_sid={stream_sid}, call_sid={call_sid})"
            logger.warning(error_msg)
            session.state = SessionState.FAILED
            if session.listener:
                await session.listener.on_session_error(error_msg, session)
            return

        session.stream_sid = str(stream_sid)
        session.call_sid = str(call_sid)
        session.account_sid = str(account_sid) if account_sid else None
        session.from_number = start_obj.get("from") or start_obj.get("From")
        session.to_number = start_obj.get("to") or start_obj.get("To")

        # Parse MediaFormat
        mf_dict = start_obj.get("media_format") or start_obj.get("mediaFormat") or {}
        if isinstance(mf_dict, dict):
            session.media_format = MediaFormat(
                encoding=mf_dict.get("encoding", "audio/x-mulaw"),
                sample_rate=int(mf_dict.get("sample_rate", mf_dict.get("sampleRate", 8000))),
                channels=int(mf_dict.get("channels", 1)),
            )

        # Parse CustomParameters
        custom_params = start_obj.get("custom_parameters") or start_obj.get("customParameters") or {}
        if isinstance(custom_params, dict):
            session.custom_parameters = custom_params
            if "session_id" in custom_params:
                session.session_id = str(custom_params["session_id"])
        elif isinstance(custom_params, str):
            try:
                parsed_cp = json.loads(custom_params)
                if isinstance(parsed_cp, dict):
                    session.custom_parameters = parsed_cp
                    if "session_id" in parsed_cp:
                        session.session_id = str(parsed_cp["session_id"])
            except Exception:
                session.custom_parameters = {"raw": custom_params}

        session.state = SessionState.STARTED
        session.started_at = time.time()

        # Register in active sessions mapping
        self._active_sessions[session.stream_sid] = session
        if session.session_id:
            self._active_sessions[session.session_id] = session

        logger.info(
            "Exotel AgentStream started: call_sid=%s, stream_sid=%s, from=%s, sample_rate=%d",
            session.call_sid,
            session.stream_sid,
            session.from_number,
            session.media_format.sample_rate,
        )

        # Attach listener if factory is configured
        if self._listener_factory and not session.listener:
            try:
                session.listener = self._listener_factory(session)
            except Exception as factory_err:
                logger.error("Error creating listener from factory: %s", factory_err)

        if session.listener:
            await session.listener.on_session_started(session)

    async def _handle_media_event(self, data: Dict[str, Any], session: ExotelVoiceSession) -> None:
        """Decodes base64 audio payload and dispatches to listener."""
        # 1. Media before start protection
        if not session.stream_sid or session.state not in (
            SessionState.STARTED,
            SessionState.STREAMING,
            SessionState.CONNECTED,
        ):
            logger.warning("Media event received before valid start event [session_id=%s]", session.session_id)
            if session.listener:
                await session.listener.on_session_error("Media received before start event", session)
            return

        media_obj = data.get("media")
        if not isinstance(media_obj, dict):
            logger.warning("Malformed media event: 'media' is not a dictionary [stream_sid=%s]", session.stream_sid)
            return

        payload_b64 = media_obj.get("payload")
        if not payload_b64 or not isinstance(payload_b64, str):
            logger.warning("Empty or missing media payload [stream_sid=%s]", session.stream_sid)
            return

        # 2. Oversized payload protection (64KB boundary)
        MAX_MEDIA_PAYLOAD_SIZE = 65536
        if len(payload_b64) > MAX_MEDIA_PAYLOAD_SIZE:
            logger.warning(
                "Oversized media payload (%d bytes) exceeds 64KB limit [stream_sid=%s]",
                len(payload_b64),
                session.stream_sid,
            )
            if session.listener:
                await session.listener.on_session_error("Oversized media payload", session)
            return

        try:
            raw_audio = base64.b64decode(payload_b64, validate=True)
        except (binascii.Error, ValueError) as b64_err:
            logger.warning("Invalid base64 media payload [stream_sid=%s]: %s", session.stream_sid, b64_err)
            if session.listener:
                await session.listener.on_session_error(f"Invalid base64 audio: {b64_err}", session)
            return

        session.state = SessionState.STREAMING
        session.last_activity_at = time.time()
        session.total_inbound_chunks += 1

        if session.listener:
            try:
                await session.listener.on_audio_received(raw_audio, session)
            except Exception as listener_err:
                logger.error("Error in on_audio_received listener: %s", listener_err)

    async def _handle_dtmf_event(self, data: Dict[str, Any], session: ExotelVoiceSession) -> None:
        """Dispatches DTMF tones to listener."""
        dtmf_obj = data.get("dtmf")
        digit = ""
        if isinstance(dtmf_obj, dict):
            digit = str(dtmf_obj.get("digit", ""))
        elif dtmf_obj:
            digit = str(dtmf_obj)

        logger.info("DTMF digit '%s' received [call_sid=%s, stream_sid=%s]", digit, session.call_sid, session.stream_sid)
        if session.listener:
            await session.listener.on_dtmf_received(digit, session)

    async def _handle_mark_event(self, data: Dict[str, Any], session: ExotelVoiceSession) -> None:
        """Dispatches mark playback confirmation to listener."""
        mark_obj = data.get("mark")
        mark_name = ""
        if isinstance(mark_obj, dict):
            mark_name = str(mark_obj.get("name", ""))
        elif mark_obj:
            mark_name = str(mark_obj)

        logger.debug("Playback mark confirmed '%s' [stream_sid=%s]", mark_name, session.stream_sid)
        if session.listener:
            await session.listener.on_mark_received(mark_name, session)

    async def _handle_stop_event(self, data: Dict[str, Any], session: ExotelVoiceSession) -> None:
        """Dispatches clean call termination."""
        if session.is_terminal:
            logger.debug("Ignoring duplicate stop event [stream_sid=%s]", session.stream_sid)
            return

        session.state = SessionState.STOPPED
        session.stopped_at = time.time()
        session.last_activity_at = session.stopped_at
        logger.info(
            "Exotel AgentStream stopped [call_sid=%s, stream_sid=%s, inbound_chunks=%d, outbound_chunks=%d]",
            session.call_sid,
            session.stream_sid,
            session.total_inbound_chunks,
            session.total_outbound_chunks,
        )

        if session.listener:
            await session.listener.on_session_stopped(session)

    async def _cleanup_session(self, session: ExotelVoiceSession) -> None:
        """Cleans up internal tracking references."""
        if not session.is_terminal:
            session.state = SessionState.STOPPED
            session.stopped_at = time.time()
            session.last_activity_at = session.stopped_at
            if session.listener:
                try:
                    await session.listener.on_session_stopped(session)
                except Exception:
                    pass

        if session.stream_sid and session.stream_sid in self._active_sessions:
            del self._active_sessions[session.stream_sid]
        if session.session_id and session.session_id in self._active_sessions:
            del self._active_sessions[session.session_id]

    def cleanup_stale_sessions(self, max_age_seconds: float = 300.0) -> int:
        """Purges terminal or stale sessions exceeding maximum retention age."""
        now = time.time()
        stale_sids = []
        for sid, s in list(self._active_sessions.items()):
            is_stale = (
                s.is_terminal
                or (now - s.created_at > max_age_seconds)
                or (s.started_at and (now - s.started_at > max_age_seconds))
            )
            if is_stale:
                stale_sids.append(sid)

        purged = 0
        for sid in set(stale_sids):
            if sid in self._active_sessions:
                s = self._active_sessions.pop(sid)
                if not s.is_terminal:
                    s.state = SessionState.TIMED_OUT
                purged += 1
        return purged

    def check_session_timeout(
        self,
        session: ExotelVoiceSession,
        max_duration_seconds: float = 600.0,
        connect_timeout_seconds: float = 30.0,
    ) -> bool:
        """Checks if session has exceeded connection or conversation duration timeouts."""
        now = time.time()
        if session.state in (SessionState.INITIATED, SessionState.CONNECTING):
            if now - session.created_at > connect_timeout_seconds:
                session.state = SessionState.TIMED_OUT
                session.error_message = "Connection setup timed out."
                session.error_classification = "TRANSPORT_FAILURE"
                return True
        elif session.is_active:
            ref_time = session.started_at or session.created_at
            if now - ref_time > max_duration_seconds:
                session.state = SessionState.TIMED_OUT
                session.error_message = "Maximum call duration exceeded."
                session.error_classification = "TRANSPORT_FAILURE"
                return True
        return False


# Global singleton instance
voice_gateway = ExotelVoiceGateway()
