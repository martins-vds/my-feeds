"""Integration test for timings-aware audio backfill (US5).

Exercises AudioService against an in-memory repo, a real filesystem cache, and
the deterministic MockTTSService to verify the timings-aware short-circuit,
idempotent regeneration, and non-disruption of working clips.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest

from app.application.services.audio_service import AudioService, AudioStatus
from app.infrastructure.tts.cache_manager import AudioCacheManager
from app.infrastructure.tts.mock_tts import MockTTSService


def _make_service(tmp_path):
    post_id = uuid4()
    user_id = uuid4()
    post = SimpleNamespace(id=post_id, title="Backfill Title", content="Hello world foo bar")

    store: dict = {}

    async def get_by_post_id(pid):
        return store.get(pid)

    async def create(audio):
        store[audio.post_id] = audio
        return audio

    async def delete_by_post_id(pid):
        store.pop(pid, None)
        return True

    async def get_by_cache_key(cache_key):
        for audio in store.values():
            if audio.cache_key == cache_key:
                return audio
        return None

    async def get_by_cache_key_for_user(cache_key, owner):
        return await get_by_cache_key(cache_key) if owner == user_id else None

    audio_repo = AsyncMock()
    audio_repo.get_by_post_id.side_effect = get_by_post_id
    audio_repo.create.side_effect = create
    audio_repo.delete_by_post_id.side_effect = delete_by_post_id
    audio_repo.get_by_cache_key.side_effect = get_by_cache_key
    audio_repo.get_by_cache_key_for_user.side_effect = get_by_cache_key_for_user
    audio_repo.record_access = AsyncMock()

    post_repo = AsyncMock()
    post_repo.get_by_id.return_value = post
    post_repo.get_by_id_for_user.side_effect = lambda pid, owner: (
        post if pid == post_id and owner == user_id else None
    )

    tts = MockTTSService()
    cache = AudioCacheManager(cache_dir=tmp_path, cache_version="v2")
    service = AudioService(audio_repo, post_repo, tts, cache, external_synthesis_enabled=True)
    return service, tts, cache, post_id, store, user_id


@pytest.mark.asyncio
async def test_short_circuit_returns_cached_when_mp3_and_sidecar_exist(tmp_path):
    service, tts, cache, post_id, store, user_id = _make_service(tmp_path)

    first = await service.get_or_generate_audio(post_id, user_id)
    assert first.status == AudioStatus.READY
    assert len(tts.calls) == 1
    assert await cache.exists_timings(first.cache_key)
    assert store[post_id].has_timings is True

    # Both MP3 and sidecar present → short-circuit, no regeneration.
    second = await service.get_or_generate_audio(post_id, user_id)
    assert second.status == AudioStatus.READY
    assert second.cache_key == first.cache_key
    assert len(tts.calls) == 1


@pytest.mark.asyncio
async def test_regenerates_when_sidecar_missing(tmp_path):
    service, tts, cache, post_id, store, user_id = _make_service(tmp_path)

    first = await service.get_or_generate_audio(post_id, user_id)
    key = first.cache_key

    # Simulate a pre-feature clip: MP3 present, sidecar absent.
    await cache.delete_timings(key)
    assert await cache.exists(key)
    assert not await cache.exists_timings(key)

    # Must regenerate rather than short-circuit on the MP3 alone.
    second = await service.get_or_generate_audio(post_id, user_id)
    assert second.status == AudioStatus.READY
    assert len(tts.calls) == 2
    assert await cache.exists_timings(second.cache_key)
    assert store[post_id].has_timings is True


@pytest.mark.asyncio
async def test_backfill_is_idempotent_same_key_single_row(tmp_path):
    service, tts, cache, post_id, store, user_id = _make_service(tmp_path)

    first = await service.get_or_generate_audio(post_id, user_id)
    await cache.delete_timings(first.cache_key)
    second = await service.get_or_generate_audio(post_id, user_id)

    # Same deterministic v2 key; a single row (no duplicates).
    assert second.cache_key == first.cache_key
    assert len(store) == 1


@pytest.mark.asyncio
async def test_does_not_disrupt_a_working_clip(tmp_path):
    service, tts, cache, post_id, store, user_id = _make_service(tmp_path)

    first = await service.get_or_generate_audio(post_id, user_id)
    # A fully-cached clip streams without regeneration.
    audio_data = await service.get_audio_stream_data(first.cache_key, user_id)
    assert audio_data is not None and len(audio_data) > 0
    assert len(tts.calls) == 1
