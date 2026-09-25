"""Audio Resampling and Format Conversion Layer (Task 3).

Provides isolated, bidirectional audio format conversion and sample-rate resampling
between the Exotel AgentStream telephony transport and the Gemini Live API.

Conversion paths:
1. Inbound: Exotel PCM/mulaw (typically 8000 Hz) -> Gemini Live input (16000 Hz PCM16 mono)
2. Outbound: Gemini Live output (24000 Hz PCM16 mono) -> Exotel PCM/mulaw (typically 8000 Hz)

Maintains continuous filter states across audio chunks for seamless, click-free streaming.
"""
import logging
import struct
from typing import Any, Optional, Tuple

logger = logging.getLogger(__name__)

# Try to import audioop (standard library in Python <= 3.12)
try:
    import warnings
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", DeprecationWarning)
        import audioop
    _HAS_AUDIOOP = True
except ImportError:
    _HAS_AUDIOOP = False


def _resample_pcm16_linear(
    pcm_bytes: bytes,
    in_rate: int,
    out_rate: int,
) -> bytes:
    """Pure Python linear interpolation resampler for signed 16-bit little-endian mono PCM."""
    if in_rate == out_rate or not pcm_bytes:
        return pcm_bytes

    num_samples = len(pcm_bytes) // 2
    if num_samples == 0:
        return b""

    samples = struct.unpack(f"<{num_samples}h", pcm_bytes)
    out_samples_len = int(round(num_samples * out_rate / in_rate))
    if out_samples_len == 0:
        return b""

    ratio = (num_samples - 1) / max(1, (out_samples_len - 1)) if out_samples_len > 1 else 0.0
    out_samples = []
    for i in range(out_samples_len):
        src_idx = i * ratio
        idx0 = int(src_idx)
        idx1 = min(idx0 + 1, num_samples - 1)
        frac = src_idx - idx0
        val = int(round(samples[idx0] * (1.0 - frac) + samples[idx1] * frac))
        val = max(-32768, min(32767, val))
        out_samples.append(val)

    return struct.pack(f"<{len(out_samples)}h", *out_samples)


class AudioConverter:
    """Isolated audio converter handling sample rate and codec transformations."""

    def __init__(
        self,
        exotel_sample_rate: int = 8000,
        encoding: str = "audio/l16",
        gemini_input_sample_rate: int = 16000,
        gemini_output_sample_rate: int = 24000,
    ):
        self.exotel_sample_rate: int = int(exotel_sample_rate or 8000)
        self.encoding: str = (encoding or "").strip().lower()
        self.is_mulaw: bool = "mulaw" in self.encoding or "u-law" in self.encoding
        self.gemini_input_sample_rate: int = int(gemini_input_sample_rate)
        self.gemini_output_sample_rate: int = int(gemini_output_sample_rate)

        # State tracking for continuous streaming with audioop.ratecv
        self._inbound_state: Optional[Tuple[Any, ...]] = None
        self._outbound_state: Optional[Tuple[Any, ...]] = None

    def reset_states(self) -> None:
        """Resets resampler filter states (e.g., after barge-in / clear or stream restart)."""
        self._inbound_state = None
        self._outbound_state = None

    def exotel_to_gemini(self, audio_bytes: bytes) -> bytes:
        """Converts Exotel inbound audio to Gemini Live 16 kHz PCM16 mono.
        
        Exotel input rate (e.g. 8000 Hz) -> Gemini input rate (16000 Hz).
        """
        if not audio_bytes:
            return b""

        # 1. Decode mu-law to linear PCM16 if necessary
        pcm16 = audio_bytes
        if self.is_mulaw:
            if _HAS_AUDIOOP:
                pcm16 = audioop.ulaw2lin(audio_bytes, 2)
            else:
                # Basic mu-law expansion fallback
                pcm16 = self._ulaw_to_linear(audio_bytes)

        # 2. Resample Exotel sample rate -> Gemini input rate (default: 8000 -> 16000)
        if self.exotel_sample_rate == self.gemini_input_sample_rate:
            return pcm16

        if _HAS_AUDIOOP:
            try:
                resampled, self._inbound_state = audioop.ratecv(
                    pcm16,
                    2,  # 16-bit
                    1,  # mono
                    self.exotel_sample_rate,
                    self.gemini_input_sample_rate,
                    self._inbound_state,
                )
                return resampled
            except Exception as err:
                logger.debug("audioop.ratecv failed, falling back to linear: %s", err)

        return _resample_pcm16_linear(
            pcm16,
            self.exotel_sample_rate,
            self.gemini_input_sample_rate,
        )

    def gemini_to_exotel(self, pcm_bytes: bytes) -> bytes:
        """Converts Gemini Live output 24 kHz PCM16 mono to Exotel stream audio.
        
        Gemini output rate (24000 Hz) -> Exotel output rate (e.g. 8000 Hz).
        """
        if not pcm_bytes:
            return b""

        # 1. Resample Gemini output rate -> Exotel sample rate (default: 24000 -> 8000)
        resampled_pcm = pcm_bytes
        if self.gemini_output_sample_rate != self.exotel_sample_rate:
            if _HAS_AUDIOOP:
                try:
                    resampled_pcm, self._outbound_state = audioop.ratecv(
                        pcm_bytes,
                        2,  # 16-bit
                        1,  # mono
                        self.gemini_output_sample_rate,
                        self.exotel_sample_rate,
                        self._outbound_state,
                    )
                except Exception as err:
                    logger.debug("audioop.ratecv outbound failed, falling back to linear: %s", err)
                    resampled_pcm = _resample_pcm16_linear(
                        pcm_bytes,
                        self.gemini_output_sample_rate,
                        self.exotel_sample_rate,
                    )
            else:
                resampled_pcm = _resample_pcm16_linear(
                    pcm_bytes,
                    self.gemini_output_sample_rate,
                    self.exotel_sample_rate,
                )

        # 2. Convert to mu-law if Exotel expects mu-law
        if self.is_mulaw:
            if _HAS_AUDIOOP:
                return audioop.lin2ulaw(resampled_pcm, 2)
            else:
                return self._linear_to_ulaw(resampled_pcm)

        return resampled_pcm

    @staticmethod
    def _ulaw_to_linear(ulaw_bytes: bytes) -> bytes:
        """Fallback lookup-based mu-law to 16-bit linear PCM conversion."""
        # Standard G.711 mu-law table
        out = []
        for b in ulaw_bytes:
            u = ~b & 0xFF
            sign = -1 if (u & 0x80) else 1
            exponent = (u >> 4) & 0x07
            mantissa = u & 0x0F
            sample = sign * ((mantissa << 3) + 0x84) << exponent
            sample -= sign * 0x84
            val = max(-32768, min(32767, sample))
            out.append(val)
        return struct.pack(f"<{len(out)}h", *out)

    @staticmethod
    def _linear_to_ulaw(pcm_bytes: bytes) -> bytes:
        """Fallback 16-bit linear PCM to mu-law conversion."""
        num_samples = len(pcm_bytes) // 2
        if num_samples == 0:
            return b""
        samples = struct.unpack(f"<{num_samples}h", pcm_bytes)
        out = bytearray()
        for sample in samples:
            # Simple approximation of mu-law compression
            sign = 0x80 if sample < 0 else 0x00
            if sample < 0:
                sample = -sample
            sample = min(sample, 32767) + 0x84
            exponent = 7
            for exp in range(7):
                if sample <= (0x84 << (exp + 1)):
                    exponent = exp
                    break
            mantissa = (sample >> (exponent + 3)) & 0x0F
            u = ~(sign | (exponent << 4) | mantissa) & 0xFF
            out.append(u)
        return bytes(out)
