"""Mock TTS service for testing."""

from pathlib import Path
from typing import List, Tuple

from app.domain.audio.services.tts_service import TTSError, TTSService
from app.domain.audio.value_objects.word_timing import WordTiming

# Synthetic timing shape used so tests can assert exact values.
_WORD_MS = 300
_GAP_MS = 50


class MockTTSService(TTSService):
    """Mock TTS implementation for testing.

    Creates a short silent MP3 and returns deterministic per-word timings so
    unit/contract tests can exercise the read-along pipeline without a real
    TTS provider. Tracks all synthesis calls.
    """

    def __init__(self, voice_id: str = "mock-voice"):
        """Initialize mock TTS service.

        Args:
            voice_id: Mock voice identifier
        """
        self._voice_id = voice_id
        self._output_format = "mp3"
        self.calls: List[Tuple[str, Path]] = []

    @property
    def voice_id(self) -> str:
        """Get the voice identifier."""
        return self._voice_id

    @property
    def output_format(self) -> str:
        """Get the output format."""
        return self._output_format

    async def synthesize_with_timings(self, text: str, output_path: Path) -> list[WordTiming]:
        """Write a silent MP3 and return deterministic synthetic timings.

        Azure TTS is used when a speech key is configured; without one, this
        mock still needs to return audio the browser can actually decode and
        play during local development. So we emit a sequence of valid (silent)
        MPEG-1 Layer III frames rather than a stub that fails to decode, and
        derive one timing per cleaned token (300 ms each, 50 ms gaps).

        Args:
            text: Text content (recorded for verification).
            output_path: Path where the file should be created.

        Returns:
            Ordered, non-overlapping timings — one per cleaned token.

        Raises:
            TTSError: If there is no text content to synthesize.
        """
        # Track the call
        self.calls.append((text, output_path))

        clean_text = self.strip_html(text)
        if not clean_text:
            raise TTSError("No text content to synthesize")

        # Ensure directory exists
        output_path.parent.mkdir(parents=True, exist_ok=True)

        # A valid MPEG-1 Layer III frame header: 128 kbps, 44.1 kHz, stereo.
        # Frame length = floor(144 * 128000 / 44100) = 417 bytes; a zeroed
        # body decodes to silence.
        frame = bytes([0xFF, 0xFB, 0x90, 0x00]) + b"\x00" * (417 - 4)
        # ~2 seconds of silence (44100 / 1152 samples-per-frame ≈ 38 frames/s).
        output_path.write_bytes(frame * 76)

        timings: list[WordTiming] = []
        start = 0
        for token in clean_text.split():
            timings.append(WordTiming(text=token, start_ms=start, duration_ms=_WORD_MS))
            start += _WORD_MS + _GAP_MS
        return timings

    def reset(self) -> None:
        """Reset call tracking."""
        self.calls.clear()
