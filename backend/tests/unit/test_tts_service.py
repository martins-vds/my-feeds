"""Unit tests for TTSService ABC and implementations.

Tests verify text-to-speech synthesis functionality.
"""

import pytest
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

from app.domain.audio.services.tts_service import TTSService, TTSError


class TestTTSServiceABC:
    """Tests for TTSService abstract base class."""

    def test_is_abstract_class(self):
        """TTSService cannot be instantiated directly."""
        with pytest.raises(TypeError):
            TTSService()

    def test_synthesize_is_abstract(self):
        """synthesize method must be implemented by subclasses."""
        assert hasattr(TTSService, "synthesize")


class TestAzureTTSService:
    """Tests for Azure Cognitive Services TTS implementation."""

    @pytest.fixture
    def azure_tts_service(self):
        """Create AzureTTSService instance with mocked config."""
        from app.infrastructure.tts.azure_tts import AzureTTSService
        return AzureTTSService(
            speech_key="test-key",
            speech_region="eastus"
        )

    @pytest.mark.asyncio
    async def test_synthesize_creates_audio_file(
        self, azure_tts_service, tmp_path
    ):
        """synthesize creates MP3 file from text."""
        output_path = tmp_path / "test.mp3"
        text = "This is a test sentence."

        with patch("azure.cognitiveservices.speech.SpeechSynthesizer") as mock_synth_class:
            mock_synthesizer = MagicMock()
            mock_result = MagicMock()
            mock_result.reason = MagicMock()
            mock_result.reason.name = "SynthesizingAudioCompleted"
            mock_synthesizer.speak_text_async.return_value.get.return_value = mock_result
            mock_synth_class.return_value = mock_synthesizer

            await azure_tts_service.synthesize(text, output_path)

            mock_synthesizer.speak_text_async.assert_called_once_with(text)

    @pytest.mark.asyncio
    async def test_synthesize_raises_on_cancellation(
        self, azure_tts_service, tmp_path
    ):
        """synthesize raises TTSError on synthesis cancellation."""
        output_path = tmp_path / "test.mp3"

        with patch("azure.cognitiveservices.speech.SpeechSynthesizer") as mock_synth_class:
            mock_synthesizer = MagicMock()
            mock_result = MagicMock()
            mock_result.reason.name = "Canceled"
            mock_result.cancellation_details = MagicMock()
            mock_result.cancellation_details.reason = "AuthenticationError"
            mock_synthesizer.speak_text_async.return_value.get.return_value = mock_result
            mock_synth_class.return_value = mock_synthesizer

            # Import ResultReason for comparison
            with patch("azure.cognitiveservices.speech.ResultReason") as mock_reason:
                mock_reason.Canceled = mock_result.reason
                
                with pytest.raises(TTSError):
                    await azure_tts_service.synthesize("Test", output_path)

    @pytest.mark.asyncio
    async def test_synthesize_strips_html_from_content(
        self, azure_tts_service, tmp_path
    ):
        """synthesize strips HTML tags before synthesis."""
        output_path = tmp_path / "test.mp3"
        html_text = "<p>Hello <strong>world</strong>!</p>"

        with patch("azure.cognitiveservices.speech.SpeechSynthesizer") as mock_synth_class:
            mock_synthesizer = MagicMock()
            mock_result = MagicMock()
            mock_result.reason.name = "SynthesizingAudioCompleted"
            mock_synthesizer.speak_text_async.return_value.get.return_value = mock_result
            mock_synth_class.return_value = mock_synthesizer

            await azure_tts_service.synthesize(html_text, output_path)

            # Should call with stripped text
            call_args = mock_synthesizer.speak_text_async.call_args[0][0]
            assert "<p>" not in call_args
            assert "<strong>" not in call_args

    def test_default_voice_is_set(self, azure_tts_service):
        """AzureTTSService uses default neural voice."""
        assert azure_tts_service.voice_id == "en-US-JennyNeural"

    def test_output_format_is_mp3(self, azure_tts_service):
        """AzureTTSService outputs MP3 format."""
        assert azure_tts_service.output_format == "mp3"


class TestMockTTSService:
    """Tests for MockTTSService used in testing."""

    @pytest.fixture
    def mock_tts_service(self):
        """Create MockTTSService instance."""
        from app.infrastructure.tts.mock_tts import MockTTSService
        return MockTTSService()

    @pytest.mark.asyncio
    async def test_synthesize_creates_empty_file(
        self, mock_tts_service, tmp_path
    ):
        """MockTTSService creates an empty file for testing."""
        output_path = tmp_path / "test.mp3"
        
        await mock_tts_service.synthesize("Test text", output_path)
        
        assert output_path.exists()

    @pytest.mark.asyncio
    async def test_tracks_synthesis_calls(self, mock_tts_service, tmp_path):
        """MockTTSService tracks all synthesis calls."""
        await mock_tts_service.synthesize("Text 1", tmp_path / "1.mp3")
        await mock_tts_service.synthesize("Text 2", tmp_path / "2.mp3")
        
        assert len(mock_tts_service.calls) == 2
        assert mock_tts_service.calls[0][0] == "Text 1"
