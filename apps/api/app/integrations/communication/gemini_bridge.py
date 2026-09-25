"""Gemini Live Voice Bridge for Exotel AgentStream (Task 3).

Connects the ExotelVoiceGateway (transport layer) to the Gemini Live API
(conversational intelligence layer) via the AudioStreamListener interface.

Key architectural responsibilities:
1. Strict Per-Call Session Isolation:
   - Each Exotel call spawns its own independent GeminiLiveBridge and Gemini Live session.
   - Zero shared state, history, or queues between concurrent calls.
2. Context Sanitization:
   - Filters out internal margins, budgets, recovery strategies, notes, and credentials.
   - Forwards only safe vendor-facing inquiry metadata to Gemini.
3. System Instructions:
   - Enforces natural telephony conversation, concise 1-2 sentence replies,
     no hallucinated facts, and no autonomous booking authority.
4. Bidirectional Audio Conversion:
   - Converts Exotel audio (default 8 kHz PCM16 / mulaw) -> Gemini input (16 kHz PCM16).
   - Converts Gemini audio (24 kHz PCM16) -> Exotel audio (default 8 kHz PCM16 / mulaw).
5. Interruption / Barge-in:
   - Flushes Exotel's outbound buffer via session.clear_audio() when barge-in is signaled.
6. Safe Bounded Queues:
   - Prevents memory leaks or unbounded backpressure using bounded async queues.
7. Clean Transcript Interface:
   - Records typed transcript history for future Task 5 consumption without modifying domain models.
"""
import asyncio
from enum import Enum
import logging
import os
import time
from typing import Any, Callable, Dict, List, Optional
from pydantic import BaseModel, Field

from app.core.config import settings
from app.integrations.communication.audio_converter import AudioConverter
from app.integrations.communication.exotel_gateway import (
    AudioStreamListener,
    ExotelVoiceSession,
    SessionState,
)
from app.integrations.communication.voice_context_builder import (
    AuthorizedNegotiationContext,
    SanitizedVoiceContext,
    VoiceContextBuilder,
    VoiceContextValidationError,
)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# 1. Typed Transcript Data Models (For Task 5 consumption)
# ---------------------------------------------------------------------------

class TranscriptSpeaker(str, Enum):
    """Identifies the speaker in a conversational turn."""
    VENDOR = "VENDOR"
    AGENT = "AGENT"


class TranscriptEntry(BaseModel):
    """Represents a single spoken or transcribed conversational entry."""
    speaker: TranscriptSpeaker
    text: str
    timestamp: float = Field(default_factory=time.time)
    is_final: bool = True


# ---------------------------------------------------------------------------
# 2. Context Sanitization (Backward compatible wrapper)
# ---------------------------------------------------------------------------

def sanitize_voice_context(session: ExotelVoiceSession) -> SanitizedVoiceContext:
    """Backward-compatible helper invoking VoiceContextBuilder."""
    builder = VoiceContextBuilder()
    return builder.build_from_session(session)


# ---------------------------------------------------------------------------
# 3. System Prompt Construction
# ---------------------------------------------------------------------------

def build_vendor_system_prompt(ctx: SanitizedVoiceContext) -> str:
    """Builds a dedicated, constrained system prompt for the vendor voice assistant.
    
    Ensures natural conversational delivery while strictly prohibiting
    autonomous booking approval, price invention, or operational commitments.
    """
    vendor_part = f"with {ctx.vendor_name}" if ctx.vendor_name else "with the service provider"
    city_part = f"in {ctx.vendor_city}" if ctx.vendor_city else ""
    event_part = f"for '{ctx.event_name}'" if ctx.event_name else "for an upcoming event"
    type_part = f"({ctx.event_type})" if ctx.event_type else ""
    date_part = f"scheduled on {ctx.event_date}" if ctx.event_date else ""
    time_part = f"at {ctx.event_time_window}" if ctx.event_time_window else ""
    loc_part = f"in {ctx.event_location}" if ctx.event_location else ""
    guest_part = f"for ~{ctx.guest_count} guests" if ctx.guest_count else ""

    task_name = ctx.task_name or ctx.task_title or "Service Requirement"
    task_part = f"Service: {task_name}"
    cat_part = f"Category: {ctx.service_category}" if ctx.service_category else ""
    desc_part = f"Details: {ctx.task_description}" if ctx.task_description else ""
    dur_part = f"Estimated duration: {ctx.duration_minutes} minutes" if ctx.duration_minutes else ""

    constraints_part = ""
    if ctx.technical_constraints:
        constraints_part = "Technical requirements: " + ", ".join(ctx.technical_constraints)
    elif ctx.required_capabilities:
        constraints_part = "Required capabilities: " + ", ".join(ctx.required_capabilities)

    # Negotiation guidance
    if ctx.negotiation and ctx.negotiation.authorized and ctx.negotiation.target_price is not None:
        neg_instructions = f"""NEGOTIATION INSTRUCTIONS:
- You are authorized to inquire around a target rate of {ctx.negotiation.target_price} {ctx.negotiation.currency}.
- Constraints: {', '.join(ctx.negotiation.constraints) if ctx.negotiation.constraints else 'Standard rates'}.
- If the vendor quotes higher, note their rate and ask if that is inclusive of all taxes, equipment, and delivery.
- DO NOT agree to or finalize higher prices; note their offer for the organizer."""
    else:
        neg_instructions = """NEGOTIATION INSTRUCTIONS:
- You are NOT authorized to propose or agree to any pricing numbers.
- Ask the vendor for their standard quotation and price estimate for this requirement."""

    recovery_note = ""
    if ctx.is_urgent_recovery:
        obj_str = f": {ctx.call_objective}" if ctx.call_objective else ""
        recovery_note = f"\nOPERATIONAL NOTE: Urgent replacement requirement{obj_str}. Inquire about immediate availability and setup time."

    return f"""You are the EVENTRA Voice Coordinator, an AI voice assistant calling on behalf of the event organizing team {vendor_part} {city_part}.
Your goal: {ctx.inquiry_goal}

CALL CONTEXT (AUTHORITATIVE EVENTRA DATA):
- Event: {event_part} {type_part} {date_part} {time_part} {loc_part} {guest_part}
- {task_part} | {cat_part}
- {desc_part}
{dur_part}
{constraints_part}
{recovery_note}

{neg_instructions}

COMMUNICATION GUIDELINES:
1. Tone & Style:
   - Professional, courteous, conversational telephony tone.
   - Keep answers and statements short (1 to 2 sentences maximum).
   - Ask concise clarification questions, ONE question at a time.

2. STRICT OPERATIONAL BOUNDARIES & GUARDRAILS:
   - NEVER invent or assume availability, prices, discounts, or confirmation codes.
   - NEVER confirm or approve a booking autonomously. You do NOT have financial or booking authority.
   - NEVER claim that:
     * a booking is confirmed
     * a price is accepted
     * a vendor is selected
     * a task is completed
     * an approval has been granted
   - You do NOT have the authority to finalize bookings or contracts. Only EVENTRA's operational team can confirm.
   - Treat all vendor statements as initial quotes/proposals to be recorded.
   - If the vendor asks for final confirmation, politely explain that you are logging their quote and details for the event organizer to review and approve.
   - When all key details (availability, approximate quote, terms) are gathered, thank the vendor and conclude the call politely.
"""


# ---------------------------------------------------------------------------
# 4. GeminiLiveBridge Implementation
# ---------------------------------------------------------------------------

class GeminiLiveBridge(AudioStreamListener):
    """Bridges a single Exotel voice call to an isolated Gemini Live session.
    
    Each call instantiates its own GeminiLiveBridge to ensure strict session isolation.
    """

    def __init__(
        self,
        session: ExotelVoiceSession,
        client_factory: Optional[Callable[[], Any]] = None,
        model: Optional[str] = None,
        voice: Optional[str] = None,
        context_builder: Optional[VoiceContextBuilder] = None,
        db: Optional[Any] = None,
    ):
        self.session: ExotelVoiceSession = session
        self.client_factory: Optional[Callable[[], Any]] = client_factory
        self.model: str = model or settings.GEMINI_LIVE_MODEL
        self.voice: str = voice or settings.GEMINI_LIVE_VOICE
        self.context_builder: VoiceContextBuilder = context_builder or VoiceContextBuilder()
        self.db: Optional[Any] = db

        # Initial context & prompts
        try:
            self.sanitized_context: SanitizedVoiceContext = self.context_builder.build_from_session(session, db=self.db)
            self.system_prompt: str = build_vendor_system_prompt(self.sanitized_context)
        except Exception:
            self.sanitized_context = SanitizedVoiceContext(session_id=session.session_id)
            self.system_prompt = build_vendor_system_prompt(self.sanitized_context)

        # Audio converter (initialized with session media format)
        self.converter: AudioConverter = AudioConverter(
            exotel_sample_rate=session.media_format.sample_rate,
            encoding=session.media_format.encoding,
            gemini_input_sample_rate=16000,
            gemini_output_sample_rate=24000,
        )

        # Inbound audio queue (bounded to prevent lag / unbounded memory growth)
        self._inbound_audio_queue: asyncio.Queue[bytes] = asyncio.Queue(maxsize=100)

        # Active tasks & session state
        self._bridge_task: Optional[asyncio.Task] = None
        self._gemini_session: Optional[Any] = None
        self._is_running: bool = False
        self.error_message: Optional[str] = None
        self.error_classification: Optional[str] = None

        # Metrics & Transcript buffer (consumed by Task 5)
        self.transcript: List[TranscriptEntry] = []
        self.turn_count: int = 0
        self.started_at: Optional[float] = None
        self.stopped_at: Optional[float] = None

    # -----------------------------------------------------------------------
    # AudioStreamListener Lifecycle Callbacks
    # -----------------------------------------------------------------------

    async def on_session_started(self, session: ExotelVoiceSession) -> None:
        """Called when Exotel start event is validated. Spawns the Gemini session."""
        self.session = session
        # Authoritative context resolution and validation
        try:
            self.sanitized_context = self.context_builder.build_from_session(session, db=self.db)
            self.system_prompt = build_vendor_system_prompt(self.sanitized_context)
        except VoiceContextValidationError as val_err:
            logger.warning("Voice context validation failed [session_id=%s]: %s", session.session_id, val_err)
            self.error_message = f"Voice context validation failed: {val_err}"
            self._is_running = False
            return
        except Exception as ctx_err:
            logger.error("Unexpected error building voice context [session_id=%s]: %s", session.session_id, ctx_err)
            self.error_message = f"Voice context error: {ctx_err}"
            self._is_running = False
            return

        # Update audio converter in case media format changed in start event
        self.converter = AudioConverter(
            exotel_sample_rate=session.media_format.sample_rate,
            encoding=session.media_format.encoding,
            gemini_input_sample_rate=16000,
            gemini_output_sample_rate=24000,
        )

        self._is_running = True
        self.started_at = time.time()
        logger.info(
            "Starting GeminiLiveBridge for call_sid=%s, stream_sid=%s, session_id=%s",
            session.call_sid,
            session.stream_sid,
            session.session_id,
        )

        # Launch background loop
        self._bridge_task = asyncio.create_task(self._run_bridge())

    async def on_audio_received(self, pcm_bytes: bytes, session: ExotelVoiceSession) -> None:
        """Receives raw PCM/mulaw audio from Exotel and queues it for Gemini Live."""
        if not self._is_running or not pcm_bytes:
            return

        try:
            self._inbound_audio_queue.put_nowait(pcm_bytes)
        except asyncio.QueueFull:
            # Drop older frame to prevent queue lag and keep real-time latency tight
            logger.debug(
                "Inbound audio queue full [session_id=%s], dropping frame to maintain real-time sync",
                session.session_id,
            )

    async def on_session_stopped(self, session: ExotelVoiceSession) -> None:
        """Called when Exotel terminates the stream. Tears down Gemini Live session."""
        logger.info(
            "Terminating GeminiLiveBridge for call_sid=%s, stream_sid=%s, session_id=%s",
            session.call_sid,
            session.stream_sid,
            session.session_id,
        )
        await self._shutdown()

    async def on_session_error(self, error: str, session: ExotelVoiceSession) -> None:
        """Called on transport or gateway error."""
        logger.warning(
            "Exotel voice error received [session_id=%s]: %s",
            session.session_id,
            error,
        )
        self.error_message = error
        await self._shutdown()

    # -----------------------------------------------------------------------
    # Gemini Live Lifecycle & Background Loops
    # -----------------------------------------------------------------------

    def _get_gemini_client(self) -> Any:
        """Instantiates the Gemini GenAI client using environment credentials."""
        if self.client_factory:
            return self.client_factory()

        api_key = settings.GEMINI_API_KEY or settings.LLM_API_KEY or os.environ.get("GEMINI_API_KEY")
        if not api_key:
            raise ValueError("GEMINI_API_KEY is not configured in settings or environment.")

        from google import genai
        return genai.Client(api_key=api_key)

    async def _run_bridge(self) -> None:
        """Orchestrates connection and concurrent send/receive loops for Gemini Live."""
        try:
            client = self._get_gemini_client()
        except Exception as err:
            logger.error("Failed to initialize Gemini Live client: %s", err)
            self.error_message = f"Gemini client initialization failed: {err}"
            self.error_classification = "VOICE_AGENT_FAILURE"
            self._is_running = False
            return

        from google.genai import types

        # Build LiveConnectConfig
        config = types.LiveConnectConfig(
            response_modalities=["AUDIO"],
            speech_config=types.SpeechConfig(
                voice_config=types.VoiceConfig(
                    prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name=self.voice)
                )
            ),
            system_instruction=types.Content(
                parts=[types.Part.from_text(text=self.system_prompt)]
            ),
            input_audio_transcription=types.AudioTranscriptionConfig() if hasattr(types, "AudioTranscriptionConfig") else {},
            output_audio_transcription=types.AudioTranscriptionConfig() if hasattr(types, "AudioTranscriptionConfig") else {},
        )

        try:
            logger.info("Opening Gemini Live session with model=%s, voice=%s", self.model, self.voice)
            async with client.aio.live.connect(model=self.model, config=config) as gemini_session:
                self._gemini_session = gemini_session
                logger.info("Gemini Live session connected successfully [session_id=%s]", self.session.session_id)

                # Run send and receive loops concurrently
                send_task = asyncio.create_task(self._send_loop(gemini_session))
                receive_task = asyncio.create_task(self._receive_loop(gemini_session))

                done, pending = await asyncio.wait(
                    [send_task, receive_task],
                    return_when=asyncio.FIRST_COMPLETED,
                )

                # Cancel remaining task
                for task in pending:
                    task.cancel()
                    try:
                        await task
                    except (asyncio.CancelledError, Exception):
                        pass

                # Propagate any exceptions from the completed task
                for task in done:
                    if not task.cancelled() and task.exception():
                        exc = task.exception()
                        logger.error("Error in Gemini loop task: %s", exc)
                        self.error_message = str(exc)
                        self.error_classification = "VOICE_AGENT_FAILURE"

        except asyncio.CancelledError:
            logger.info("Gemini Live bridge loop cancelled [session_id=%s]", self.session.session_id)
        except Exception as err:
            logger.error("Gemini Live session error [session_id=%s]: %s", self.session.session_id, err)
            self.error_message = str(err)
            self.error_classification = "VOICE_AGENT_FAILURE"
        finally:
            self._is_running = False
            self.stopped_at = time.time()
            logger.info(
                "Gemini Live session closed [session_id=%s, turns=%d, transcript_entries=%d]",
                self.session.session_id,
                self.turn_count,
                len(self.transcript),
            )

    async def _send_loop(self, gemini_session: Any) -> None:
        """Reads Exotel audio from the bounded queue and streams it to Gemini Live."""
        from google.genai import types

        while self._is_running:
            try:
                # Wait for audio chunks from Exotel
                raw_chunk = await asyncio.wait_for(self._inbound_audio_queue.get(), timeout=1.0)
            except asyncio.TimeoutError:
                continue
            except asyncio.CancelledError:
                break

            if not raw_chunk:
                continue

            # Resample Exotel input rate (e.g. 8 kHz) -> Gemini input rate (16 kHz)
            resampled_16k = self.converter.exotel_to_gemini(raw_chunk)
            if not resampled_16k:
                continue

            try:
                realtime_input = types.LiveClientRealtimeInput(
                    media_chunks=[
                        types.Blob(
                            data=resampled_16k,
                            mime_type="audio/pcm;rate=16000",
                        )
                    ]
                )
                await gemini_session.send(realtime_input)
            except Exception as send_err:
                logger.warning("Error streaming audio to Gemini Live: %s", send_err)
                break

    async def _receive_loop(self, gemini_session: Any) -> None:
        """Receives Gemini Live responses, handles audio output, transcription, and barge-in."""
        try:
            async for response in gemini_session.receive():
                if not self._is_running:
                    break

                if not response:
                    continue

                server_content = getattr(response, "server_content", None)
                if not server_content:
                    continue

                # 1. Interruption / Barge-in handling
                if getattr(server_content, "interrupted", False):
                    logger.info(
                        "Interruption signal received from Gemini Live [session_id=%s]",
                        self.session.session_id,
                    )
                    self.converter.reset_states()
                    await self.session.clear_audio()

                # 2. Vendor Input Transcription
                input_tx = getattr(server_content, "input_transcription", None)
                if input_tx and getattr(input_tx, "text", None):
                    self._record_transcript(
                        speaker=TranscriptSpeaker.VENDOR,
                        text=input_tx.text,
                        is_final=getattr(input_tx, "finished", True),
                    )

                # 3. Model Output (Audio & Text)
                model_turn = getattr(server_content, "model_turn", None)
                if model_turn and getattr(model_turn, "parts", None):
                    for part in model_turn.parts:
                        # Spoken text
                        part_text = getattr(part, "text", None)
                        if part_text:
                            self._record_transcript(
                                speaker=TranscriptSpeaker.AGENT,
                                text=part_text,
                                is_final=True,
                            )

                        # Output audio PCM
                        inline_data = getattr(part, "inline_data", None)
                        if inline_data and getattr(inline_data, "data", None):
                            raw_24k_pcm = inline_data.data
                            # Resample Gemini 24 kHz -> Exotel sample rate (e.g. 8 kHz)
                            out_pcm = self.converter.gemini_to_exotel(raw_24k_pcm)
                            if out_pcm:
                                await self.session.send_audio(out_pcm)

                # 4. Agent Output Transcription (if provided separately)
                output_tx = getattr(server_content, "output_transcription", None)
                if output_tx and getattr(output_tx, "text", None):
                    self._record_transcript(
                        speaker=TranscriptSpeaker.AGENT,
                        text=output_tx.text,
                        is_final=getattr(output_tx, "finished", True),
                    )

                # 5. Turn completion tracking
                if getattr(server_content, "turn_complete", False):
                    self.turn_count += 1

        except asyncio.CancelledError:
            pass
        except Exception as recv_err:
            logger.error("Error receiving from Gemini Live: %s", recv_err)
            self.error_message = str(recv_err)
            self.error_classification = "VOICE_AGENT_FAILURE"

    def _record_transcript(self, speaker: TranscriptSpeaker, text: str, is_final: bool = True) -> None:
        """Appends or merges a transcript entry in memory with bounded buffer protection."""
        cleaned_text = text.strip()
        if not cleaned_text:
            return

        # Avoid redundant duplicate identical consecutive messages
        if self.transcript:
            last = self.transcript[-1]
            if last.speaker == speaker and last.text == cleaned_text:
                return

        # Bounded buffer protection: max 200 transcript entries
        MAX_TRANSCRIPT_ENTRIES = 200
        if len(self.transcript) >= MAX_TRANSCRIPT_ENTRIES:
            self.transcript.pop(0)

        self.transcript.append(
            TranscriptEntry(
                speaker=speaker,
                text=cleaned_text,
                timestamp=time.time(),
                is_final=is_final,
            )
        )

    async def _shutdown(self) -> None:
        """Internal cleanup helper."""
        self._is_running = False
        self.stopped_at = time.time()

        if self._bridge_task and not self._bridge_task.done():
            self._bridge_task.cancel()
            try:
                await asyncio.wait_for(self._bridge_task, timeout=2.0)
            except (asyncio.CancelledError, asyncio.TimeoutError, Exception):
                pass

        # Flush any remaining items in the audio queue
        while not self._inbound_audio_queue.empty():
            try:
                self._inbound_audio_queue.get_nowait()
            except Exception:
                break

    # -----------------------------------------------------------------------
    # Public Interface for Task 5 and Downstream Consumers
    # -----------------------------------------------------------------------

    def get_transcript(self) -> List[TranscriptEntry]:
        """Returns the in-memory transcript turns captured during this call."""
        return list(self.transcript)

    def get_full_transcript_text(self) -> str:
        """Formats the entire conversation transcript as dialogue text."""
        lines = []
        for entry in self.transcript:
            lines.append(f"{entry.speaker.value}: {entry.text}")
        return "\n".join(lines)

    def get_conversation_state(self) -> Dict[str, Any]:
        """Returns typed conversation status metadata for Task 5."""
        duration = 0.0
        if self.started_at:
            end_time = self.stopped_at or time.time()
            duration = max(0.0, end_time - self.started_at)

        return {
            "session_id": self.session.session_id,
            "call_sid": self.session.call_sid,
            "stream_sid": self.session.stream_sid,
            "event_id": self.sanitized_context.event_id if self.sanitized_context else None,
            "task_id": self.sanitized_context.task_id if self.sanitized_context else None,
            "provider_id": self.sanitized_context.provider_id if self.sanitized_context else None,
            "status": "COMPLETED" if not self.error_message else "FAILED",
            "error": self.error_message,
            "error_classification": self.error_classification,
            "turn_count": self.turn_count,
            "duration_seconds": round(duration, 2),
            "transcript_turns": len(self.transcript),
            "context": self.sanitized_context.model_dump() if self.sanitized_context else {},
        }

    def get_sanitized_context(self) -> SanitizedVoiceContext:
        """Returns the sanitized context object for this call."""
        return self.sanitized_context


def create_gemini_bridge_factory(
    client_factory: Optional[Callable[[], Any]] = None,
    model: Optional[str] = None,
    voice: Optional[str] = None,
    context_builder: Optional[VoiceContextBuilder] = None,
    db: Optional[Any] = None,
) -> Callable[[ExotelVoiceSession], GeminiLiveBridge]:
    """Factory helper to register with ExotelVoiceGateway.register_listener_factory."""
    def factory(session: ExotelVoiceSession) -> GeminiLiveBridge:
        return GeminiLiveBridge(
            session=session,
            client_factory=client_factory,
            model=model,
            voice=voice,
            context_builder=context_builder,
            db=db,
        )
    return factory
