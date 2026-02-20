"""Mock TTS service for testing."""

from pathlib import Path
from typing import List, Tuple

from app.domain.audio.services.tts_service import TTSService


class MockTTSService(TTSService):
    """Mock TTS implementation for testing.
    
    Creates empty audio files and tracks all synthesis calls.
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

    async def synthesize(self, text: str, output_path: Path) -> None:
        """Create a mock audio file.
        
        Args:
            text: Text content (recorded for verification)
            output_path: Path where file should be created
        """
        # Track the call
        self.calls.append((text, output_path))
        
        # Ensure directory exists
        output_path.parent.mkdir(parents=True, exist_ok=True)
        
        # Create a minimal MP3 file (just the header)
        # This is enough for tests but won't play as real audio
        mp3_header = bytes([
            0xFF, 0xFB, 0x90, 0x00,  # MP3 frame header
        ])
        
        # Create file with mock content
        output_path.write_bytes(mp3_header + b'\x00' * 256)

    def reset(self) -> None:
        """Reset call tracking."""
        self.calls.clear()
