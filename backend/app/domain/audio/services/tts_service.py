"""TTS (Text-to-Speech) service abstract base class."""

from abc import ABC, abstractmethod
from pathlib import Path


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
    async def synthesize(self, text: str, output_path: Path) -> None:
        """Synthesize text to audio file.
        
        Args:
            text: Text content to synthesize (may contain HTML)
            output_path: Path where audio file should be saved
            
        Raises:
            TTSError: If synthesis fails
        """
        ...

    def strip_html(self, text: str) -> str:
        """Strip HTML tags from text for synthesis.
        
        Args:
            text: Text that may contain HTML
            
        Returns:
            Plain text with HTML removed
        """
        import re
        # Remove HTML tags
        clean = re.sub(r'<[^>]+>', '', text)
        # Normalize whitespace
        clean = re.sub(r'\s+', ' ', clean)
        return clean.strip()
