"""Speech-to-Text (STT) Service for EVENTRA Voice-First Event Intake.

Provides a unified provider interface for multilingual transcription and translation,
supporting Gemini Audio Understanding (default) and OpenAI Whisper API.
"""
from abc import ABC, abstractmethod
from dataclasses import dataclass
import json
import logging
import os
import re
from typing import Optional

from app.core.config import settings

logger = logging.getLogger(__name__)


@dataclass
class TranscriptResult:
    """Standardized speech recognition result."""
    text: str
    detected_language: str
    english_text: str
    confidence: Optional[float] = None
    provider: str = "gemini"


class SpeechProvider(ABC):
    """Abstract interface for speech-to-text transcription providers."""

    @abstractmethod
    def transcribe(
        self,
        audio_bytes: bytes,
        mime_type: str,
        language_hint: Optional[str] = None,
    ) -> TranscriptResult:
        """Transcribes audio bytes into original text and an English translation.

        Raises:
            ValueError: If credentials or parameters are missing or invalid.
            RuntimeError: If STT service fails or fails to produce output.
        """
        pass


class GeminiSpeechProvider(SpeechProvider):
    """Multilingual STT provider using Gemini Multimodal Audio Understanding."""

    def __init__(self, api_key: Optional[str] = None, model_name: Optional[str] = None):
        self.api_key = api_key or settings.GEMINI_API_KEY or settings.LLM_API_KEY or os.environ.get("GEMINI_API_KEY")
        self.model_name = model_name or settings.LLM_MODEL or "gemini-3.6-flash"

    def transcribe(
        self,
        audio_bytes: bytes,
        mime_type: str,
        language_hint: Optional[str] = None,
    ) -> TranscriptResult:
        if not self.api_key:
            raise ValueError(
                "Gemini API key is not configured for speech-to-text. "
                "Please configure GEMINI_API_KEY or LLM_API_KEY in your environment."
            )

        if not audio_bytes:
            raise ValueError("Empty audio payload received.")

        from google import genai
        from google.genai import types

        clean_mime = mime_type.split(";")[0].strip().lower()
        # Normalize m4a / mp4 / wav types for Gemini
        if clean_mime in ("audio/m4a", "audio/x-m4a"):
            clean_mime = "audio/mp4"
        elif clean_mime == "audio/x-wav":
            clean_mime = "audio/wav"

        client = genai.Client(api_key=self.api_key)
        audio_part = types.Part.from_bytes(data=audio_bytes, mime_type=clean_mime)

        hint_phrase = f" Hint: The spoken language may be {language_hint}." if language_hint else ""

        system_prompt = (
            "You are an expert multilingual speech recognition assistant for EVENTRA event operations. "
            "Listen to the attached audio carefully. The organizer is describing an event they want to host. "
            "They may speak in any language (such as Hindi, English, Spanish, Tamil, Bengali, Marathi, etc.) "
            "or code-switch between languages (such as Hinglish - Hindi and English mixed). "
            f"{hint_phrase}\n"
            "Return a strictly valid JSON object with the following keys:\n"
            "- 'text': The exact verbatim transcript in the original spoken language/script. "
            "If the speaker spoke Hinglish (Hindi words written in Latin script or mixed), write the exact spoken phrases.\n"
            "- 'english_text': An accurate, fluent English translation and semantic rendering of everything said. "
            "If the speaker spoke primarily in English, 'english_text' should match 'text'.\n"
            "- 'detected_language': Detected language code or description (e.g. 'en', 'hi', 'hi-en', 'Hinglish', 'es').\n"
            "- 'confidence': Estimated confidence score between 0.0 and 1.0 (float).\n"
            "Do NOT hallucinate or invent any event details, numbers, dates, or words that were not spoken in the audio."
        )

        try:
            response = client.models.generate_content(
                model=self.model_name,
                contents=[audio_part, system_prompt],
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    temperature=0.1,
                ),
            )
        except Exception as e:
            logger.error("Gemini audio transcription failed: %s", e)
            raise RuntimeError(f"Speech transcription failed with Gemini: {str(e)}") from e

        raw_text = response.text or ""
        try:
            data = json.loads(raw_text)
        except Exception:
            # Fallback regex if markdown block wrapped
            json_match = re.search(r"\{.*\}", raw_text, re.DOTALL)
            if json_match:
                data = json.loads(json_match.group(0))
            else:
                logger.warning("Could not parse structured JSON from STT response: %s", raw_text)
                data = {
                    "text": raw_text.strip(),
                    "english_text": raw_text.strip(),
                    "detected_language": "unknown",
                    "confidence": 0.5,
                }

        text = (data.get("text") or "").strip()
        english_text = (data.get("english_text") or text).strip()
        detected_language = data.get("detected_language") or "unknown"
        confidence = data.get("confidence")
        if confidence is not None:
            try:
                confidence = float(confidence)
            except (ValueError, TypeError):
                confidence = 0.85

        return TranscriptResult(
            text=text,
            detected_language=detected_language,
            english_text=english_text,
            confidence=confidence,
            provider="gemini",
        )


class WhisperSpeechProvider(SpeechProvider):
    """Multilingual STT provider using OpenAI Whisper API."""

    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key or settings.OPENAI_API_KEY or os.environ.get("OPENAI_API_KEY")

    def transcribe(
        self,
        audio_bytes: bytes,
        mime_type: str,
        language_hint: Optional[str] = None,
    ) -> TranscriptResult:
        if not self.api_key:
            raise ValueError(
                "OpenAI API key is not configured for Whisper speech-to-text. "
                "Please configure OPENAI_API_KEY in your environment or switch STT_PROVIDER to 'gemini'."
            )

        if not audio_bytes:
            raise ValueError("Empty audio payload received.")

        import httpx

        clean_mime = mime_type.split(";")[0].strip().lower()
        extension = "webm"
        if "mp4" in clean_mime or "m4a" in clean_mime:
            extension = "m4a"
        elif "wav" in clean_mime:
            extension = "wav"
        elif "ogg" in clean_mime:
            extension = "ogg"
        elif "mp3" in clean_mime or "mpeg" in clean_mime:
            extension = "mp3"

        filename = f"audio.{extension}"

        # 1. Primary transcription call
        headers = {"Authorization": f"Bearer {self.api_key}"}
        files = {"file": (filename, audio_bytes, clean_mime)}
        data = {
            "model": "whisper-1",
            "response_format": "verbose_json",
        }
        if language_hint:
            data["language"] = language_hint

        with httpx.Client(timeout=45.0) as client:
            resp = client.post(
                "https://api.openai.com/v1/audio/transcriptions",
                headers=headers,
                files=files,
                data=data,
            )

            if resp.status_code != 200:
                raise RuntimeError(f"OpenAI Whisper transcription failed ({resp.status_code}): {resp.text}")

            tx_data = resp.json()
            text = (tx_data.get("text") or "").strip()
            detected_language = tx_data.get("language") or "en"

            english_text = text
            # 2. If non-English, query Whisper translation endpoint for English rendering
            if detected_language.lower() not in ("en", "english"):
                files_trans = {"file": (filename, audio_bytes, clean_mime)}
                trans_resp = client.post(
                    "https://api.openai.com/v1/audio/translations",
                    headers=headers,
                    files=files_trans,
                    data={"model": "whisper-1", "response_format": "json"},
                )
                if trans_resp.status_code == 200:
                    english_text = (trans_resp.json().get("text") or text).strip()

        return TranscriptResult(
            text=text,
            detected_language=detected_language,
            english_text=english_text,
            confidence=0.9,
            provider="whisper",
        )


def get_speech_provider() -> SpeechProvider:
    """Factory returning the configured STT provider."""
    provider_name = (settings.STT_PROVIDER or "gemini").lower().strip()
    if provider_name == "whisper":
        return WhisperSpeechProvider()
    elif provider_name == "gemini":
        return GeminiSpeechProvider()
    else:
        raise ValueError(
            f"Unsupported STT_PROVIDER '{provider_name}'. Supported options are 'gemini' and 'whisper'."
        )
