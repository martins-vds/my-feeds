"""Azure Cognitive Services TTS implementation."""

import asyncio
from pathlib import Path

from app.domain.audio.services.tts_service import TTSService, TTSError


class AzureTTSService(TTSService):
    """Azure Cognitive Services Speech implementation.
    
    Uses Azure neural voices for high-quality text-to-speech synthesis.
    """

    def __init__(
        self,
        speech_key: str,
        speech_region: str,
        voice_id: str = "en-US-JennyNeural",
    ):
        """Initialize Azure TTS service.
        
        Args:
            speech_key: Azure Speech subscription key
            speech_region: Azure region (e.g., "eastus")
            voice_id: Neural voice identifier
        """
        self._speech_key = speech_key
        self._speech_region = speech_region
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

    async def synthesize(self, text: str, output_path: Path) -> None:
        """Synthesize text to audio file using Azure TTS.
        
        Args:
            text: Text content to synthesize
            output_path: Path where MP3 file should be saved
            
        Raises:
            TTSError: If synthesis fails
        """
        # Import Azure SDK (optional dependency)
        try:
            import azure.cognitiveservices.speech as speechsdk
        except ImportError:
            raise TTSError(
                "Azure Speech SDK not installed. "
                "Run: uv add azure-cognitiveservices-speech"
            )

        # Strip HTML from content
        clean_text = self.strip_html(text)
        
        if not clean_text:
            raise TTSError("No text content to synthesize")

        # Configure speech synthesis
        speech_config = speechsdk.SpeechConfig(
            subscription=self._speech_key,
            region=self._speech_region
        )
        speech_config.speech_synthesis_voice_name = self._voice_id
        speech_config.set_speech_synthesis_output_format(
            speechsdk.SpeechSynthesisOutputFormat.Audio16Khz64KBitRateMonoMp3
        )

        # Ensure output directory exists
        output_path.parent.mkdir(parents=True, exist_ok=True)

        # Configure audio output to file
        audio_config = speechsdk.audio.AudioOutputConfig(
            filename=str(output_path)
        )

        # Create synthesizer
        synthesizer = speechsdk.SpeechSynthesizer(
            speech_config=speech_config,
            audio_config=audio_config
        )

        # Run synthesis in thread pool (SDK is blocking)
        def _synthesize():
            return synthesizer.speak_text_async(clean_text).get()

        result = await asyncio.to_thread(_synthesize)

        # Check result
        if result.reason == speechsdk.ResultReason.Canceled:
            cancellation = result.cancellation_details
            raise TTSError(
                f"Speech synthesis canceled: {cancellation.reason}. "
                f"Error details: {cancellation.error_details}"
            )
        
        if result.reason != speechsdk.ResultReason.SynthesizingAudioCompleted:
            raise TTSError(f"Unexpected synthesis result: {result.reason}")
