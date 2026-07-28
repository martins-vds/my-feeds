"""TTS (Text-to-Speech) service abstract base class."""

from abc import ABC, abstractmethod
from pathlib import Path

from app.domain.audio.value_objects.word_timing import WordTiming


class TTSError(Exception):
    """Exception raised when TTS synthesis fails."""

    pass


class TTSService(ABC):
    """Abstract base class for text-to-speech synthesis.

    Implementations provide the actual synthesis using various providers
    (Azure, Google, AWS, or local).
    """

    @property
    @abstractmethod
    def voice_id(self) -> str:
        """Get the voice identifier used for synthesis."""
        ...

    @property
    @abstractmethod
    def output_format(self) -> str:
        """Get the output audio format (mp3, ogg, wav)."""
        ...

    @abstractmethod
    async def synthesize_with_timings(self, text: str, output_path: Path) -> list[WordTiming]:
        """Synthesize ``text`` to an MP3 and return ordered word timings.

        Args:
            text: Text content to synthesize (may contain HTML).
            output_path: Path where the audio file should be saved.

        Returns:
            Word timings in spoken order (title words then body words). An
            empty list when the engine emits no word boundaries.

        Raises:
            TTSError: If synthesis fails or produces no audio.
        """
        ...

    async def synthesize(self, text: str, output_path: Path) -> None:
        """Synthesize text to an audio file, discarding word timings.

        Retained for callers that only need the audio; delegates to
        :meth:`synthesize_with_timings`.

        Args:
            text: Text content to synthesize (may contain HTML)
            output_path: Path where audio file should be saved

        Raises:
            TTSError: If synthesis fails
        """
        await self.synthesize_with_timings(text, output_path)

    def strip_html(self, text: str) -> str:
        """Strip HTML tags from text for synthesis.

        Each tag is replaced with a single space so adjacent words separated
        only by markup (e.g. ``for<code>x</code>loop``) do not fuse into one
        spoken token. Whitespace is then collapsed.

        Args:
            text: Text that may contain HTML

        Returns:
            Plain text with HTML removed
        """
        import re

        # Replace each HTML tag with a space so tag boundaries never fuse words.
        clean = re.sub(r"<[^>]+>", " ", text)
        # Normalize whitespace
        clean = re.sub(r"\s+", " ", clean)
        return clean.strip()
