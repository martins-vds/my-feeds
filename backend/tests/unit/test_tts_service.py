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

        return AzureTTSService(speech_key="test-key", speech_region="eastus")

    @pytest.mark.asyncio
    async def test_synthesize_creates_audio_file(self, azure_tts_service, tmp_path):
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
    async def test_synthesize_raises_on_cancellation(self, azure_tts_service, tmp_path):
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
    async def test_synthesize_strips_html_from_content(self, azure_tts_service, tmp_path):
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

    @pytest.mark.asyncio
    async def test_synthesize_with_timings_delegates_and_returns_empty(
        self, azure_tts_service, tmp_path
    ):
        """Azure word-boundary capture is deferred (T009): synthesis still runs,
        but no timings are returned yet, so keyed Azure deployments play without
        read-along. Pins the deferred contract until parity is implemented."""
        output_path = tmp_path / "azure.mp3"
        azure_tts_service.synthesize = AsyncMock()

        timings = await azure_tts_service.synthesize_with_timings("Hello world", output_path)

        assert timings == []
        azure_tts_service.synthesize.assert_awaited_once_with("Hello world", output_path)


class TestMockTTSService:
    """Tests for MockTTSService used in testing."""

    @pytest.fixture
    def mock_tts_service(self):
        """Create MockTTSService instance."""
        from app.infrastructure.tts.mock_tts import MockTTSService

        return MockTTSService()

    @pytest.mark.asyncio
    async def test_synthesize_creates_empty_file(self, mock_tts_service, tmp_path):
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


def _fake_edge_stream(chunks):
    """Build a factory returning a fresh async iterator over ``chunks``.

    Mirrors ``edge_tts.Communicate.stream()`` which yields dict chunks of
    ``{"type": "audio", "data": bytes}`` and
    ``{"type": "WordBoundary", "text": str, "offset": int, "duration": int}``.
    """

    def factory():
        async def gen():
            for chunk in chunks:
                yield chunk

        return gen()

    return factory


class TestStripHtmlSpacing:
    """strip_html must insert a space at tag boundaries (FR-026)."""

    @pytest.fixture
    def service(self):
        from app.infrastructure.tts.edge_tts_service import EdgeTTSService

        return EdgeTTSService()

    def test_tag_boundary_becomes_space(self, service):
        """Adjacent words split by tags stay separate (no 'forxloop')."""
        assert service.strip_html("for<code>x</code>loop") == "for x loop"

    def test_collapses_whitespace(self, service):
        """Runs of whitespace (incl. tag-inserted spaces) collapse to one."""
        assert service.strip_html("<p>Hello   world</p>") == "Hello world"

    def test_plain_text_unchanged(self, service):
        """Plain text without tags is returned trimmed."""
        assert service.strip_html("  Hello world  ") == "Hello world"

    def test_decodes_html_entities(self, service):
        """Entities are decoded so they aren't spoken as literal names."""
        assert service.strip_html("Q &gt; 1 &amp; done") == "Q > 1 & done"

    def test_nbsp_entity_folds_to_space(self, service):
        """&nbsp; decodes to U+00A0, then collapses to a normal space."""
        assert service.strip_html("Helion&nbsp;has progressed") == "Helion has progressed"


class TestEdgeTTSTimingCapture:
    """EdgeTTSService.synthesize_with_timings streams WordBoundary events."""

    @pytest.fixture
    def service(self):
        from app.infrastructure.tts.edge_tts_service import EdgeTTSService

        return EdgeTTSService(voice_id="en-US-AriaNeural")

    @pytest.mark.asyncio
    async def test_maps_word_boundaries_to_ordered_timings(self, service, tmp_path):
        """WordBoundary chunks map to ordered WordTiming (ticks -> ms, source text)."""
        from app.domain.audio.value_objects.word_timing import WordTiming

        output_path = tmp_path / "out.mp3"
        chunks = [
            {"type": "audio", "data": b"\xff\xfb\x90\x00"},
            {"type": "WordBoundary", "text": "Hello", "offset": 1_200_000, "duration": 3_000_000},
            {"type": "audio", "data": b"\x11\x22"},
            {"type": "WordBoundary", "text": "world", "offset": 4_300_000, "duration": 2_800_000},
        ]
        mock_comm = MagicMock()
        mock_comm.stream = _fake_edge_stream(chunks)

        with patch("edge_tts.Communicate", return_value=mock_comm) as mock_communicate:
            timings = await service.synthesize_with_timings("Hello world", output_path)

        # Must request word-level boundaries (edge-tts defaults to SentenceBoundary).
        assert mock_communicate.call_args.kwargs.get("boundary") == "WordBoundary"

        # Audio chunks were written verbatim, in order.
        assert output_path.read_bytes() == b"\xff\xfb\x90\x00\x11\x22"
        # 100-ns ticks converted to ms via //10_000; text is the source token.
        assert timings == [
            WordTiming(text="Hello", start_ms=120, duration_ms=300),
            WordTiming(text="world", start_ms=430, duration_ms=280),
        ]

    @pytest.mark.asyncio
    async def test_zero_boundaries_returns_empty_list_with_audio(self, service, tmp_path):
        """No WordBoundary events -> empty list, but the MP3 is still written."""
        output_path = tmp_path / "out.mp3"
        chunks = [{"type": "audio", "data": b"\xff\xfb\x90\x00" + b"\x00" * 32}]
        mock_comm = MagicMock()
        mock_comm.stream = _fake_edge_stream(chunks)

        with patch("edge_tts.Communicate", return_value=mock_comm):
            timings = await service.synthesize_with_timings("Hello", output_path)

        assert timings == []
        assert output_path.exists() and output_path.stat().st_size > 0

    @pytest.mark.asyncio
    async def test_empty_text_raises(self, service, tmp_path):
        """Whitespace/markup-only text raises TTSError (unchanged guard)."""
        with pytest.raises(TTSError):
            await service.synthesize_with_timings("<p>   </p>", tmp_path / "x.mp3")

    @pytest.mark.asyncio
    async def test_no_audio_produced_raises(self, service, tmp_path):
        """A stream with boundaries but no audio bytes -> empty file -> TTSError."""
        output_path = tmp_path / "out.mp3"
        chunks = [
            {"type": "WordBoundary", "text": "Hi", "offset": 0, "duration": 1_000_000},
        ]
        mock_comm = MagicMock()
        mock_comm.stream = _fake_edge_stream(chunks)

        with patch("edge_tts.Communicate", return_value=mock_comm):
            with pytest.raises(TTSError):
                await service.synthesize_with_timings("Hi", output_path)

    @pytest.mark.asyncio
    async def test_missing_edge_tts_dependency_raises(self, service, tmp_path):
        """A missing edge-tts import surfaces as a friendly TTSError."""
        import sys

        # Setting the module to None in sys.modules makes `import edge_tts` raise.
        with patch.dict(sys.modules, {"edge_tts": None}):
            with pytest.raises(TTSError, match="edge-tts is not installed"):
                await service.synthesize_with_timings("Hello", tmp_path / "x.mp3")

    @pytest.mark.asyncio
    async def test_stream_failure_is_wrapped_as_tts_error(self, service, tmp_path):
        """An exception raised mid-stream is wrapped as TTSError, not leaked."""

        def failing_factory():
            async def gen():
                yield {"type": "audio", "data": b"\xff\xfb"}
                raise RuntimeError("stream exploded")

            return gen()

        mock_comm = MagicMock()
        mock_comm.stream = failing_factory
        with patch("edge_tts.Communicate", return_value=mock_comm):
            with pytest.raises(TTSError, match="edge-tts synthesis failed"):
                await service.synthesize_with_timings("Hello", tmp_path / "x.mp3")

    @pytest.mark.asyncio
    async def test_synthesize_still_writes_audio(self, service, tmp_path):
        """The legacy synthesize() delegates to the timing path, discarding timings."""
        output_path = tmp_path / "out.mp3"
        chunks = [
            {"type": "audio", "data": b"\xff\xfb\x90\x00" + b"\x00" * 16},
            {"type": "WordBoundary", "text": "Hi", "offset": 0, "duration": 1_000_000},
        ]
        mock_comm = MagicMock()
        mock_comm.stream = _fake_edge_stream(chunks)

        with patch("edge_tts.Communicate", return_value=mock_comm):
            result = await service.synthesize("Hi", output_path)

        assert result is None
        assert output_path.exists() and output_path.stat().st_size > 0


class TestMockTTSTimingCapture:
    """MockTTSService returns deterministic synthetic timings for tests."""

    @pytest.fixture
    def service(self):
        from app.infrastructure.tts.mock_tts import MockTTSService

        return MockTTSService()

    @pytest.mark.asyncio
    async def test_returns_ordered_non_overlapping_timings(self, service, tmp_path):
        """Cleaned tokens become ordered, non-overlapping timings; MP3 still written."""
        output_path = tmp_path / "m.mp3"
        timings = await service.synthesize_with_timings("<p>Hello world foo</p>", output_path)

        assert [t.text for t in timings] == ["Hello", "world", "foo"]
        assert output_path.exists() and output_path.stat().st_size > 0
        for prev, nxt in zip(timings, timings[1:]):
            assert prev.start_ms + prev.duration_ms <= nxt.start_ms
            assert nxt.start_ms >= 0 and nxt.duration_ms >= 0

    @pytest.mark.asyncio
    async def test_is_deterministic(self, service, tmp_path):
        """Same text yields identical timings across calls."""
        a = await service.synthesize_with_timings("Hello world", tmp_path / "a.mp3")
        b = await service.synthesize_with_timings("Hello world", tmp_path / "b.mp3")
        assert a == b

    @pytest.mark.asyncio
    async def test_empty_text_raises(self, service, tmp_path):
        """Whitespace-only text raises TTSError."""
        with pytest.raises(TTSError):
            await service.synthesize_with_timings("   ", tmp_path / "x.mp3")
