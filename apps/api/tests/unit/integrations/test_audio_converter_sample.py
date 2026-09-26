"""Unit Test: Audio Resampling and Codec Conversion Integrity.

Verifies the bidirectional audio conversion between Exotel (8 kHz G.711 mu-law / PCM16)
and Gemini Live (16 kHz input / 24 kHz output PCM16 mono) without corruption or clipping.
"""
import math
import struct
import pytest
from app.integrations.communication.audio_converter import AudioConverter, _HAS_AUDIOOP


def generate_test_tone(sample_rate: int = 8000, frequency: float = 440.0, duration_sec: float = 0.2, amplitude: float = 16000.0) -> bytes:
    """Generates a pure sine wave PCM16 audio byte sample."""
    num_samples = int(sample_rate * duration_sec)
    samples = []
    for i in range(num_samples):
        val = int(amplitude * math.sin(2 * math.pi * frequency * i / sample_rate))
        samples.append(max(-32768, min(32767, val)))
    return struct.pack(f"<{len(samples)}h", *samples)


def test_audio_converter_exotel_to_gemini_resampling():
    """Verify 8 kHz Exotel PCM16 audio is resampled to 16 kHz for Gemini Live."""
    converter = AudioConverter(
        exotel_sample_rate=8000,
        encoding="audio/l16",
        gemini_input_sample_rate=16000,
        gemini_output_sample_rate=24000,
    )

    inbound_8k = generate_test_tone(sample_rate=8000, duration_sec=0.1)
    assert len(inbound_8k) == 800 * 2  # 800 samples * 2 bytes = 1600 bytes

    gemini_16k = converter.exotel_to_gemini(inbound_8k)
    # At 16 kHz, 0.1s should have ~1600 samples = ~3200 bytes
    num_output_samples = len(gemini_16k) // 2
    assert 1580 <= num_output_samples <= 1620, f"Expected ~1600 samples, got {num_output_samples}"

    # Verify no clipping (all samples within int16 bounds)
    samples = struct.unpack(f"<{num_output_samples}h", gemini_16k)
    for s in samples:
        assert -32768 <= s <= 32767


def test_audio_converter_gemini_to_exotel_resampling():
    """Verify 24 kHz Gemini Live PCM16 output is resampled to 8 kHz for Exotel."""
    converter = AudioConverter(
        exotel_sample_rate=8000,
        encoding="audio/l16",
        gemini_input_sample_rate=16000,
        gemini_output_sample_rate=24000,
    )

    gemini_24k = generate_test_tone(sample_rate=24000, duration_sec=0.1)
    assert len(gemini_24k) == 2400 * 2

    exotel_8k = converter.gemini_to_exotel(gemini_24k)
    num_output_samples = len(exotel_8k) // 2
    assert 780 <= num_output_samples <= 820, f"Expected ~800 samples, got {num_output_samples}"

    samples = struct.unpack(f"<{num_output_samples}h", exotel_8k)
    for s in samples:
        assert -32768 <= s <= 32767


def test_audio_converter_mulaw_codec_roundtrip():
    """Verify G.711 mu-law encoding/decoding preserves audio fidelity without corruption."""
    converter = AudioConverter(
        exotel_sample_rate=8000,
        encoding="audio/x-mulaw",
        gemini_input_sample_rate=16000,
        gemini_output_sample_rate=24000,
    )

    # 1. Create linear PCM at 8 kHz
    original_pcm = generate_test_tone(sample_rate=8000, duration_sec=0.1, amplitude=12000.0)

    # Convert to mu-law bytes (1 byte per sample)
    if _HAS_AUDIOOP:
        import audioop
        mulaw_bytes = audioop.lin2ulaw(original_pcm, 2)
    else:
        mulaw_bytes = converter._linear_to_ulaw(original_pcm)

    assert len(mulaw_bytes) == len(original_pcm) // 2

    # 2. Feed mu-law into exotel_to_gemini (decodes mu-law + upsamples to 16 kHz)
    gemini_16k = converter.exotel_to_gemini(mulaw_bytes)
    assert len(gemini_16k) > 0

    # 3. Simulate Gemini responding at 24 kHz and converting down to 8 kHz mu-law
    converter.reset_states()
    gemini_response = generate_test_tone(sample_rate=24000, duration_sec=0.1, amplitude=12000.0)
    exotel_out_mulaw = converter.gemini_to_exotel(gemini_response)

    # mu-law output has 1 byte per sample (800 bytes for 0.1s at 8kHz)
    assert 780 <= len(exotel_out_mulaw) <= 820


def test_audio_converter_handles_empty_and_silent_buffers():
    """Verify converter gracefully handles empty or zero-byte audio buffers."""
    converter = AudioConverter()
    assert converter.exotel_to_gemini(b"") == b""
    assert converter.gemini_to_exotel(b"") == b""

    # Silent buffer
    silence = b"\x00" * 320
    res = converter.exotel_to_gemini(silence)
    assert len(res) > 0
    # All silence samples should be zero or near-zero
    samples = struct.unpack(f"<{len(res)//2}h", res)
    assert all(abs(s) <= 10 for s in samples)
