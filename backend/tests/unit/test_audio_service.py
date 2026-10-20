"""Unit tests for AudioService timings error/edge paths (feature 003 read-along).

Covers the synthesis-failure path (TTS raising ``TTSError`` -> ``ERROR`` result
with no sidecar written and no audio row created) and the corrupt/empty sidecar
handling in ``_load_word_timings`` (missing, empty, or malformed timings are all
indistinguishable to callers -> ``None``). Repositories, TTS, and the cache are
mocked so no real synthesis or disk I/O occurs.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest

from app.application.services.audio_service import AudioService, AudioStatus
from app.domain.audio.services.tts_service import TTSError


def _make_service(*, tts=None, cache=None, audio_repo=None, post_repo=None) -> AudioService:
    return AudioService(
        audio_repository=audio_repo or AsyncMock(),
        post_repository=post_repo or AsyncMock(),
        tts_service=tts or MagicMock(),
        cache_manager=cache or MagicMock(),
    )


class TestGenerationFailurePath:
    """When synthesis raises TTSError, callers get an ERROR result cleanly."""

    @pytest.mark.asyncio
    async def test_get_or_generate_returns_error_on_tts_failure(self, tmp_path):
        post_id, user_id = uuid4(), uuid4()
        tts = MagicMock()
        tts.voice_id = "en-US-AriaNeural"
        tts.synthesize_with_timings = AsyncMock(side_effect=TTSError("engine down"))
        cache = MagicMock()
        cache.generate_cache_key.return_value = "a" * 64
        cache.get_file_path.return_value = tmp_path / "x.mp3"
        post_repo = AsyncMock()
        post_repo.get_by_id.return_value = SimpleNamespace(
            id=post_id, content="body", title="Title"
        )
        audio_repo = AsyncMock()
        audio_repo.get_by_post_id.return_value = None

        service = _make_service(tts=tts, cache=cache, audio_repo=audio_repo, post_repo=post_repo)
        result = await service.get_or_generate_audio(post_id, user_id)

        assert result.status == AudioStatus.ERROR
        assert result.error == "engine down"
        # No sidecar written and no audio row created on failure.
        cache.save_timings.assert_not_called()
        audio_repo.create.assert_not_called()

    @pytest.mark.asyncio
    async def test_generate_for_post_returns_error_on_tts_failure(self, tmp_path):
        post_id = uuid4()
        tts = MagicMock()
        tts.voice_id = "en-US-AriaNeural"
        tts.synthesize_with_timings = AsyncMock(side_effect=TTSError("engine down"))
        cache = MagicMock()
        cache.generate_cache_key.return_value = "b" * 64
        cache.get_file_path.return_value = tmp_path / "y.mp3"
        post_repo = AsyncMock()
        post_repo.get_by_id.return_value = SimpleNamespace(
            id=post_id, content="body", title="Title"
        )
        audio_repo = AsyncMock()
        audio_repo.get_by_post_id.return_value = None

        service = _make_service(tts=tts, cache=cache, audio_repo=audio_repo, post_repo=post_repo)
        result = await service.generate_for_post(post_id)

        assert result.status == AudioStatus.ERROR
        assert result.error == "engine down"
        cache.save_timings.assert_not_called()
        audio_repo.create.assert_not_called()


class TestGenerateForPostBranches:
    """generate_for_post's not-found guard and idempotent cache short-circuit."""

    @pytest.mark.asyncio
    async def test_raises_value_error_when_post_missing(self):
        post_repo = AsyncMock()
        post_repo.get_by_id.return_value = None
        service = _make_service(post_repo=post_repo)

        with pytest.raises(ValueError, match="not found"):
            await service.generate_for_post(uuid4())

    @pytest.mark.asyncio
    async def test_returns_cached_without_regenerating_when_timings_present(self):
        """A clip that already has both an MP3 and a timings sidecar is served
        as-is (idempotent skip - FR-021 / SC-011), never re-synthesized."""
        post_id = uuid4()
        existing = SimpleNamespace(cache_key="c" * 64, duration_seconds=12.0)
        post_repo = AsyncMock()
        post_repo.get_by_id.return_value = SimpleNamespace(
            id=post_id, content="body", title="Title"
        )
        audio_repo = AsyncMock()
        audio_repo.get_by_post_id.return_value = existing
        cache = MagicMock()
        # Freshness check: the stored key still matches the current one, so the
        # clip is served as-is rather than regenerated.
        cache.generate_cache_key.return_value = "c" * 64
        cache.exists = AsyncMock(return_value=True)
        cache.exists_timings = AsyncMock(return_value=True)
        cache.load_timings = AsyncMock(return_value={
            "schemaVersion": 1,
            "words": [{"text": "Hi", "startMs": 0, "durationMs": 10}],
        })
        tts = MagicMock()
        tts.synthesize_with_timings = AsyncMock()

        service = _make_service(tts=tts, cache=cache, audio_repo=audio_repo, post_repo=post_repo)
        result = await service.generate_for_post(post_id)

        assert result.status == AudioStatus.READY
        assert result.cache_key == "c" * 64
        assert result.word_timings == [{"text": "Hi", "startMs": 0, "durationMs": 10}]
        # Idempotent: an already-timed clip is not re-synthesized.
        tts.synthesize_with_timings.assert_not_called()

    @pytest.mark.asyncio
    async def test_regenerates_when_stored_key_is_stale(self, tmp_path):
        """A clip whose stored key no longer matches the current one (cache
        version bumped or post edited) is regenerated, not served stale."""
        from app.domain.audio.value_objects.word_timing import WordTiming

        post_id = uuid4()
        # Stored under an old cache version; on-disk files still exist.
        existing = SimpleNamespace(cache_key="c" * 64, duration_seconds=12.0)
        post_repo = AsyncMock()
        post_repo.get_by_id.return_value = SimpleNamespace(
            id=post_id, content="body", title="Title"
        )
        audio_repo = AsyncMock()
        audio_repo.get_by_post_id.return_value = existing
        audio_repo.create.side_effect = lambda audio: audio

        tts = MagicMock()
        tts.voice_id = "en-US-AriaNeural"
        async def synthesize(_text, path):
            path.write_bytes(b"audio")
            return [WordTiming(text="Title", start_ms=0, duration_ms=100)]

        tts.synthesize_with_timings = AsyncMock(side_effect=synthesize)
        cache = MagicMock()
        # Current key differs from the stored "c"*64 -> stale -> regenerate.
        cache.generate_cache_key.return_value = "e" * 64
        cache.save = AsyncMock()
        cache.get_file_size = AsyncMock(return_value=8000)
        cache.get_storage_path.return_value = "ee/" + "e" * 64 + ".mp3"
        cache.exists = AsyncMock(return_value=True)
        cache.exists_timings = AsyncMock(return_value=True)
        cache.save_timings = AsyncMock()
        cache.load_timings = AsyncMock(return_value={
            "schemaVersion": 1,
            "words": [{"text": "Title", "startMs": 0, "durationMs": 100}],
        })

        service = _make_service(tts=tts, cache=cache, audio_repo=audio_repo, post_repo=post_repo)
        result = await service.generate_for_post(post_id)

        assert result.status == AudioStatus.READY
        assert result.cache_key == "e" * 64
        # Stale key forced a real re-synthesis despite files existing on disk.
        tts.synthesize_with_timings.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_fresh_generation_writes_sidecar_and_returns_timings(self, tmp_path):
        """A post with no cached clip is synthesized: timings are captured, the
        sidecar is written, has_timings is set on the row, and READY carries the
        ordered words (the capture -> persist -> serve happy path)."""
        from app.domain.audio.value_objects.word_timing import WordTiming

        post_id = uuid4()
        post_repo = AsyncMock()
        post_repo.get_by_id.return_value = SimpleNamespace(
            id=post_id, content="Body text", title="Title"
        )
        audio_repo = AsyncMock()
        audio_repo.get_by_post_id.return_value = None
        audio_repo.create.side_effect = lambda audio: audio  # echo the entity

        tts = MagicMock()
        tts.voice_id = "en-US-AriaNeural"
        async def synthesize(_text, path):
            path.write_bytes(b"audio")
            return [WordTiming(text="Title", start_ms=0, duration_ms=100)]

        tts.synthesize_with_timings = AsyncMock(side_effect=synthesize)
        cache = MagicMock()
        cache.generate_cache_key.return_value = "d" * 64
        cache.save = AsyncMock()
        cache.get_file_size = AsyncMock(return_value=8000)
        cache.get_storage_path.return_value = "dd/" + "d" * 64 + ".mp3"
        cache.save_timings = AsyncMock()
        cache.load_timings = AsyncMock(return_value={
            "schemaVersion": 1,
            "words": [{"text": "Title", "startMs": 0, "durationMs": 100}],
        })

        service = _make_service(tts=tts, cache=cache, audio_repo=audio_repo, post_repo=post_repo)
        result = await service.generate_for_post(post_id)

        assert result.status == AudioStatus.READY
        assert result.cache_key == "d" * 64
        assert result.word_timings == [{"text": "Title", "startMs": 0, "durationMs": 100}]
        # Sidecar persisted and the queryable marker set on the row.
        cache.save_timings.assert_called_once()
        created = audio_repo.create.call_args[0][0]
        assert created.has_timings is True


class TestLoadWordTimings:
    """Missing, empty, and malformed sidecars are all treated as no timings."""

    @pytest.mark.parametrize(
        "payload",
        [
            None,  # missing sidecar
            {},  # no words key
            {"schemaVersion": 1, "words": []},  # empty words
            {"schemaVersion": 1, "words": "nope"},  # words not a list
        ],
    )
    @pytest.mark.asyncio
    async def test_returns_none_for_unusable_payload(self, payload):
        cache = MagicMock()
        cache.load_timings = AsyncMock(return_value=payload)
        service = _make_service(cache=cache)

        assert await service._load_word_timings("k" * 64) is None

    @pytest.mark.asyncio
    async def test_returns_words_for_valid_payload(self):
        words = [{"text": "Hi", "startMs": 0, "durationMs": 10}]
        cache = MagicMock()
        cache.load_timings = AsyncMock(return_value={"schemaVersion": 1, "words": words})
        service = _make_service(cache=cache)

        assert await service._load_word_timings("k" * 64) == words


class TestZeroBoundaryProcessing:
    """A clip the engine produced no word boundaries for is still marked
    processed (sidecar written, has_timings True) so it is neither re-synthesized
    on demand nor re-selected forever by the backfill job (regression for I1).
    Uses a real AudioCacheManager so exists/exists_timings reflect actual I/O."""

    @pytest.mark.asyncio
    async def test_zero_boundary_clip_is_processed_once(self, tmp_path):
        from app.infrastructure.tts.cache_manager import AudioCacheManager

        post_id = uuid4()
        cache = AudioCacheManager(cache_dir=tmp_path)

        async def _synth(_text, path):
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(b"\xff\xfb\x90\x00")  # real audio bytes...
            return []  # ...but the engine emits no word boundaries

        tts = MagicMock()
        tts.voice_id = "en-US-AriaNeural"
        tts.synthesize_with_timings = AsyncMock(side_effect=_synth)

        store: dict = {}
        audio_repo = AsyncMock()
        audio_repo.get_by_post_id.side_effect = lambda pid: store.get(pid)
        audio_repo.delete_by_post_id = AsyncMock()

        async def _create(audio):
            store[audio.post_id] = audio
            return audio

        audio_repo.create.side_effect = _create
        post_repo = AsyncMock()
        post_repo.get_by_id.return_value = SimpleNamespace(
            id=post_id, content="body", title="Title"
        )

        service = _make_service(tts=tts, cache=cache, audio_repo=audio_repo, post_repo=post_repo)

        first = await service.generate_for_post(post_id)
        assert first.status == AudioStatus.READY
        created = store[post_id]
        # Sidecar written despite zero boundaries, and the row marked processed.
        assert await cache.exists_timings(created.cache_key) is True
        assert created.has_timings is True
        # Empty timings -> the API omits wordTimings (highlighting disabled).
        assert first.word_timings is None

        # A second request short-circuits on the sidecar - no re-synthesis.
        second = await service.generate_for_post(post_id)
        assert second.status == AudioStatus.READY
        assert tts.synthesize_with_timings.await_count == 1
