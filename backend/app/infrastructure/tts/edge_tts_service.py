"""edge-tts (Microsoft Edge online TTS) implementation.

Uses Microsoft Edge's online text-to-speech service via the ``edge-tts``
package. Requires no API key, subscription, or Microsoft Edge/Windows install.
"""

from pathlib import Path

from app.domain.audio.services.tts_service import TTSError, TTSService
from app.domain.audio.value_objects.word_timing import WordTiming


class EdgeTTSService(TTSService):
    """Text-to-speech using Microsoft Edge's online TTS (no credentials)."""

    def __init__(self, voice_id: str = "en-US-AriaNeural"):
        """Initialize the edge-tts service.

        Args:
            voice_id: Edge neural voice identifier (e.g. "en-US-AriaNeural").
        """
        self._voice_id = voice_id
        self._output_format = "mp3"

    @property
    def voice_id(self) -> str:
        """Get the voice identifier."""
        return self._voice_id

    @property
    def output_format(self) -> str:
        """Get the output format."""
        return self._output_format

    async def synthesize_with_timings(self, text: str, output_path: Path) -> list[WordTiming]:
        """Synthesize text to MP3 and capture per-word timings via streaming.

        Iterates ``edge_tts.Communicate.stream()``: audio chunks are written to
        ``output_path`` and ``WordBoundary`` events are collected as
        :class:`WordTiming` value objects (edge-tts reports offsets/durations in
        100-nanosecond ticks, converted here to whole milliseconds).

        Args:
            text: Text content to synthesize (may contain HTML).
            output_path: Path where the MP3 file should be saved.

        Returns:
            Ordered word timings; empty when the engine emits no boundaries.

        Raises:
            TTSError: If synthesis fails or produces no audio.
        """
        try:
            import edge_tts
        except ImportError as e:
            raise TTSError("edge-tts is not installed. Run: uv add edge-tts") from e

        clean_text = self.strip_html(text)
        if not clean_text:
            raise TTSError("No text content to synthesize")

        output_path.parent.mkdir(parents=True, exist_ok=True)

        timings: list[WordTiming] = []
        try:
            # edge-tts defaults to SentenceBoundary; request WordBoundary so we
            # get per-word offsets for read-along highlighting.
            communicate = edge_tts.Communicate(clean_text, self._voice_id, boundary="WordBoundary")
            with open(output_path, "wb") as audio_file:
                async for chunk in communicate.stream():
                    if chunk["type"] == "audio":
                        audio_file.write(chunk["data"])
                    elif chunk["type"] == "WordBoundary":
                        timings.append(
                            WordTiming(
                                text=chunk["text"],
                                start_ms=chunk["offset"] // 10_000,
                                duration_ms=chunk["duration"] // 10_000,
                            )
                        )
        except Exception as e:
            raise TTSError(f"edge-tts synthesis failed: {e}") from e

        # edge-tts can silently write nothing for certain inputs; treat an
        # empty file as a failure so callers don't cache a broken clip.
        if not output_path.exists() or output_path.stat().st_size == 0:
            raise TTSError("edge-tts produced no audio")

        return timings
