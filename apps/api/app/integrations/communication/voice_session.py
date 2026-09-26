"""Shared Voice Session Protocol and Audio Listener Abstraction.

Provides a telephony-provider-agnostic protocol (VoiceSession) implemented by both
ExotelVoiceSession and TwilioVoiceSession, allowing downstream voice processors
(e.g., GeminiLiveBridge) to be completely independent of the telephony transport.
"""
from abc import ABC, abstractmethod
from typing import Any, Dict, Optional, Protocol, runtime_checkable


@runtime_checkable
class VoiceSession(Protocol):
    """Abstract protocol for an active telephony audio stream session."""

    session_id: str
    stream_sid: Optional[str]
    call_sid: Optional[str]
    custom_parameters: Dict[str, Any]

    @property
    def is_active(self) -> bool:
        """Indicates if the voice stream is actively open for audio."""
        ...

    async def send_audio(self, pcm_bytes: bytes) -> bool:
        """Sends raw audio back to the telephony provider over WebSocket."""
        ...

    async def send_mark(self, name: str) -> bool:
        """Sends a mark/checkpoint event to the telephony provider."""
        ...

    async def clear_audio(self) -> bool:
        """Clears/interrupts buffered outbound audio (barge-in)."""
        ...


class AudioStreamListener(ABC):
    """Telephony-provider-agnostic audio interface for downstream voice intelligence."""

    async def on_session_started(self, session: VoiceSession) -> None:
        """Called when telephony start event has been successfully validated."""
        pass

    async def on_audio_received(self, pcm_bytes: bytes, session: VoiceSession) -> None:
        """Called when a valid decoded audio frame arrives from the telephony provider."""
        pass

    async def on_dtmf_received(self, digit: str, session: VoiceSession) -> None:
        """Called when recipient sends a DTMF tone."""
        pass

    async def on_mark_received(self, mark_name: str, session: VoiceSession) -> None:
        """Called when telephony provider confirms playback of a named mark."""
        pass

    async def on_session_stopped(self, session: VoiceSession) -> None:
        """Called when telephony provider terminates the stream."""
        pass

    async def on_session_error(self, error: str, session: VoiceSession) -> None:
        """Called on unexpected error or malformed payload."""
        pass
