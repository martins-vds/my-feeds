"""Azure Cognitive Services TTS implementation."""

import asyncio
from pathlib import Path

from app.domain.audio.services.tts_service import TTSError, TTSService
from app.domain.audio.value_objects.word_timing import WordTiming


class AzureTTSService(TTSService):
    """Azure Cognitive Services Speech implementation.

    Uses Azure neural voices for high-quality text-to-speech synthesis.
    """

    def __init__(
        self,
        endpoint: str,
        voice_id: str = "en-US-AndrewMultilingualNeural",
    ):
        """Initialize Azure TTS service.

        Args:
            endpoint: Speech resource endpoint
                (e.g. "https://<name>.cognitiveservices.azure.com/")
            voice_id: Neural voice identifier
        """
        self._endpoint = endpoint
        self._credential = None
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
        """Synthesize text to MP3 and capture per-word timings.

        Word offsets come from the SDK's ``synthesis_word_boundary`` event
        (100-nanosecond ticks, converted to whole milliseconds).

        Args:
            text: Text content to synthesize (may contain HTML).
            output_path: Path where the MP3 file should be saved.

        Returns:
            Ordered word timings.

        Raises:
            TTSError: If synthesis fails.
        """
        try:
            import azure.cognitiveservices.speech as speechsdk
            from azure.identity import DefaultAzureCredential
        except ImportError:
            raise TTSError(
                "Azure Speech SDK not installed. Run: uv add azure-cognitiveservices-speech"
            )

        clean_text = self.strip_html(text)
        if not clean_text:
            raise TTSError("No text content to synthesize")

        # Entra ID auth: managed identity in Azure (AZURE_CLIENT_ID), az login locally.
        if self._credential is None:
            self._credential = DefaultAzureCredential()
        speech_config = speechsdk.SpeechConfig(
            token_credential=self._credential, endpoint=self._endpoint
        )
        speech_config.speech_synthesis_voice_name = self._voice_id
        speech_config.set_speech_synthesis_output_format(
            speechsdk.SpeechSynthesisOutputFormat.Audio24Khz96KBitRateMonoMp3
        )

        output_path.parent.mkdir(parents=True, exist_ok=True)
        audio_config = speechsdk.audio.AudioOutputConfig(filename=str(output_path))
        synthesizer = speechsdk.SpeechSynthesizer(
            speech_config=speech_config, audio_config=audio_config
        )

        timings: list[WordTiming] = []

        def _on_word(evt) -> None:
            # Punctuation/sentence boundaries are also reported; keep words only.
            if evt.boundary_type == speechsdk.SpeechSynthesisBoundaryType.Word:
                timings.append(
                    WordTiming(
                        text=evt.text,
                        start_ms=evt.audio_offset // 10_000,
                        duration_ms=int(evt.duration.total_seconds() * 1000),
                    )
                )

        synthesizer.synthesis_word_boundary.connect(_on_word)

        # SDK is blocking; run in a worker thread.
        worker = asyncio.create_task(
            asyncio.to_thread(lambda: synthesizer.speak_text_async(clean_text).get())
        )
        try:
            result = await asyncio.shield(worker)
        except asyncio.CancelledError:
            # Cancelling to_thread alone does not stop the billable SDK operation.
            try:
                await asyncio.to_thread(lambda: synthesizer.stop_speaking_async().get())
            finally:
                while not worker.done():
                    try:
                        await asyncio.shield(worker)
                    except asyncio.CancelledError:
                        continue
                worker.result()
            raise

        if result.reason.name == "Canceled":
            cancellation = result.cancellation_details
            raise TTSError(
                f"Speech synthesis canceled: {cancellation.reason}. "
                f"Error details: {cancellation.error_details}"
            )

        if result.reason.name != "SynthesizingAudioCompleted":
            raise TTSError(f"Unexpected synthesis result: {result.reason}")

        return timings

    async def synthesize(self, text: str, output_path: Path) -> None:
        """Synthesize text to an MP3 file, discarding word timings.

        Raises:
            TTSError: If synthesis fails
        """
        await self.synthesize_with_timings(text, output_path)
