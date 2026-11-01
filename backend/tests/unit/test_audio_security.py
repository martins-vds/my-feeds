"""Regression tests for private audio and bounded processing."""

import asyncio
import threading
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest

from app.api.routes.audio import _handle_range_request
from app.application.services.audio_service import AudioService
from app.config.settings import Settings
from app.domain.audio.services.tts_service import TTSError
from app.infrastructure.tts.cache_manager import AudioCacheManager
from app.infrastructure.tts.cache_provider import LocalFileCacheProvider
from app.infrastructure.tts.mock_tts import MockTTSService


@pytest.mark.asyncio
async def test_other_users_post_cannot_be_converted_to_audio(tmp_path):
    post_id = uuid4()
    posts = SimpleNamespace(
        get_by_id=AsyncMock(
            return_value=SimpleNamespace(id=post_id, title="Private", content="Text")
        ),
        get_by_id_for_user=AsyncMock(return_value=None),
    )
    audio = AsyncMock()
    audio.get_by_post_id.return_value = None
    audio.create.side_effect = lambda record: record
    tts = AsyncMock()
    tts.voice_id = "test-voice"

    async def synthesize(_text, path):
        path.write_bytes(b"speech")
        return []

    tts.synthesize_with_timings.side_effect = synthesize
    service = AudioService(audio, posts, tts, AudioCacheManager(tmp_path))
    with pytest.raises(ValueError, match="not found"):
        await service.get_or_generate_audio(post_id, uuid4())


@pytest.mark.asyncio
async def test_stream_requires_an_audio_record_owned_by_user(tmp_path):
    key = "a" * 64
    cache = AudioCacheManager(tmp_path)
    await cache.save(key, b"private speech")
    records = SimpleNamespace(
        get_by_cache_key=AsyncMock(return_value=SimpleNamespace(id=uuid4())),
        get_by_cache_key_for_user=AsyncMock(return_value=None),
        record_access=AsyncMock(),
    )
    service = AudioService(records, AsyncMock(), AsyncMock(), cache)
    assert await service.get_audio_stream_data(key, user_id=uuid4()) is None


@pytest.mark.asyncio
@pytest.mark.parametrize("size", [11_039_040, 20_971_520])
async def test_long_audio_can_be_sized_and_streamed_without_regeneration(tmp_path, size):
    key = "a" * 64
    cache = AudioCacheManager(tmp_path)
    path = cache.get_file_path(key)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("wb") as stream:
        stream.seek(size - 5)
        stream.write(b"audio")
    records = SimpleNamespace(
        get_by_cache_key_for_user=AsyncMock(return_value=SimpleNamespace(id=uuid4())),
        record_access=AsyncMock(),
    )
    service = AudioService(records, AsyncMock(), AsyncMock(), cache)
    user_id = uuid4()

    assert await service.get_audio_stream_size(key, user_id) == size
    assert await service.get_audio_stream_data(key, user_id, size - 5, 5) == b"audio"


@pytest.mark.asyncio
async def test_long_audio_above_twenty_mib_is_rejected_before_streaming(tmp_path):
    key = "a" * 64
    cache = AudioCacheManager(tmp_path)
    path = cache.get_file_path(key)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("wb") as stream:
        stream.truncate(20_971_521)
    records = SimpleNamespace(
        get_by_cache_key_for_user=AsyncMock(return_value=SimpleNamespace(id=uuid4())),
        record_access=AsyncMock(),
    )
    service = AudioService(records, AsyncMock(), AsyncMock(), cache)
    user_id = uuid4()

    with pytest.raises(ValueError, match="byte limit"):
        await service.get_audio_stream_size(key, user_id)
    with pytest.raises(ValueError, match="byte limit"):
        await service.get_audio_stream_data(key, user_id, 0, 5)


@pytest.mark.asyncio
@pytest.mark.parametrize("size", [11_039_040, 20_971_520, 20_971_521])
async def test_synthesis_output_keeps_the_twenty_mib_boundary(tmp_path, size):
    tts = AsyncMock()
    tts.voice_id = "test-voice"

    async def synthesize(_text, path):
        with path.open("wb") as stream:
            stream.truncate(size)
        return []

    tts.synthesize_with_timings.side_effect = synthesize
    records = AsyncMock()
    records.create.side_effect = lambda record: record
    cache = AudioCacheManager(tmp_path)
    service = AudioService(records, AsyncMock(), tts, cache, external_synthesis_enabled=True)
    if size > 20_971_520:
        with pytest.raises(TTSError, match="byte limit"):
            await service._generate_audio(uuid4(), "Body", "Title")
        assert await cache.list_audio_files() == []
    else:
        audio = await service._generate_audio(uuid4(), "Body", "Title")
        assert audio.file_size_bytes == size
        assert await cache.get_file_size(audio.cache_key) == size
        assert await cache.exists_timings(audio.cache_key)


@pytest.mark.asyncio
async def test_direct_stream_read_rejects_oversized_cached_audio_before_loading():
    cache = SimpleNamespace(
        get_file_size=AsyncMock(return_value=AudioService.MAX_AUDIO_BYTES + 1),
        load_range=AsyncMock(return_value=b"audio"),
    )
    records = SimpleNamespace(
        get_by_cache_key_for_user=AsyncMock(return_value=SimpleNamespace(id=uuid4())),
        record_access=AsyncMock(),
    )
    service = AudioService(records, AsyncMock(), AsyncMock(), cache)
    with pytest.raises(ValueError, match="byte limit"):
        await service.get_audio_stream_data("a" * 64, uuid4())
    cache.load_range.assert_not_awaited()


@pytest.mark.asyncio
async def test_direct_stream_read_bounds_the_provider_read_to_validated_size():
    cache = SimpleNamespace(
        get_file_size=AsyncMock(return_value=10),
        load_range=AsyncMock(return_value=b"audio"),
    )
    records = SimpleNamespace(
        get_by_cache_key_for_user=AsyncMock(return_value=SimpleNamespace(id=uuid4())),
        record_access=AsyncMock(),
    )
    service = AudioService(records, AsyncMock(), AsyncMock(), cache)
    assert await service.get_audio_stream_data("a" * 64, uuid4(), offset=3) == b"audio"
    cache.load_range.assert_awaited_once_with("a" * 64, 3, 7)


@pytest.mark.asyncio
async def test_deleting_one_audio_link_preserves_another_owners_shared_file():
    key = "a" * 64
    post_id, audio_id = uuid4(), uuid4()
    records = SimpleNamespace(
        get_by_post_id=AsyncMock(return_value=SimpleNamespace(id=audio_id, cache_key=key)),
        get_by_cache_key=AsyncMock(return_value=SimpleNamespace(id=uuid4(), cache_key=key)),
        delete=AsyncMock(return_value=True),
    )
    cache = SimpleNamespace(delete=AsyncMock())
    service = AudioService(records, AsyncMock(), AsyncMock(), cache)
    assert await service.delete_audio(post_id)
    records.get_by_post_id.assert_awaited_once_with(post_id)
    records.delete.assert_awaited_once_with(audio_id)
    records.get_by_cache_key.assert_awaited_once_with(key)
    cache.delete.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize("exists, deleted", [(True, True), (True, False), (False, False)])
async def test_last_audio_link_deletion_requires_successful_metadata_deletion(exists, deleted):
    key, post_id, audio_id = "a" * 64, uuid4(), uuid4()
    records = SimpleNamespace(
        get_by_post_id=AsyncMock(
            return_value=SimpleNamespace(id=audio_id, cache_key=key) if exists else None
        ),
        get_by_cache_key=AsyncMock(return_value=None),
        delete=AsyncMock(return_value=deleted),
    )
    cache = SimpleNamespace(delete=AsyncMock())
    service = AudioService(records, AsyncMock(), AsyncMock(), cache)
    assert await service.delete_audio(post_id) is deleted
    records.get_by_post_id.assert_awaited_once_with(post_id)
    if exists:
        records.delete.assert_awaited_once_with(audio_id)
    else:
        records.delete.assert_not_awaited()
    if deleted:
        records.get_by_cache_key.assert_awaited_once_with(key)
        cache.delete.assert_awaited_once_with(key)
    else:
        records.get_by_cache_key.assert_not_awaited()
        cache.delete.assert_not_awaited()


@pytest.mark.asyncio
async def test_lru_evicts_a_shared_object_once_using_its_newest_reference(tmp_path, monkeypatch):
    from datetime import UTC, datetime, timedelta

    from sqlalchemy import func, select
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from app.infrastructure.jobs.audio_cleanup import cleanup_cache_by_size
    from app.infrastructure.persistence.database import Base
    from app.infrastructure.persistence.models.audio import AudioModel

    engine = create_async_engine("sqlite+aiosqlite://")
    cache = AudioCacheManager(tmp_path)
    shared, old = "a" * 64, "b" * 64
    size = 600 * 1024
    await cache.save(shared, b"s" * size)
    await cache.save(old, b"o" * size)
    try:
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        async with async_sessionmaker(engine)() as session:
            now = datetime.now(UTC)
            session.add_all(
                [
                    AudioModel(
                        post_id=uuid4(),
                        cache_key=key,
                        file_path=f"{key}.mp3",
                        last_accessed_at=now - timedelta(days=days),
                    )
                    for key, days in ((shared, 10), (old, 5), (shared, 0))
                ]
            )
            await session.commit()
            assert await cleanup_cache_by_size(cache, 1, session) == (1, size)
            assert await cache.exists(shared) and not await cache.exists(old)
            assert await session.scalar(select(func.count()).select_from(AudioModel)) == 2
            assert await cleanup_cache_by_size(cache, 0, session) == (1, size)
            assert await session.scalar(select(func.count()).select_from(AudioModel)) == 0
            boundary_size = 1024 * 1024 + 1
            await cache.save(shared, b"s" * boundary_size)
            session.add(
                AudioModel(
                    post_id=uuid4(),
                    cache_key=shared,
                    file_path=f"{shared}.mp3",
                    last_accessed_at=now,
                )
            )
            await session.commit()
            assert await cleanup_cache_by_size(cache, 1, session) == (1, boundary_size)
            await cache.save(shared, b"s" * size)
            session.add(
                AudioModel(
                    post_id=uuid4(),
                    cache_key=shared,
                    file_path=f"{shared}.mp3",
                    last_accessed_at=now,
                )
            )
            await session.commit()
            monkeypatch.setattr(cache, "delete", AsyncMock(return_value=False))
            assert await cleanup_cache_by_size(cache, 0, session) == (0, 0)
            assert await session.scalar(select(func.count()).select_from(AudioModel)) == 1
            assert await cache.exists(shared)
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_suffix_range_returns_only_the_last_bytes():
    response = _handle_range_request(b"0123456789", "bytes=-3")
    assert await response.get_data() == b"789"
    assert response.headers["Content-Range"] == "bytes 7-9/10"


@pytest.mark.parametrize(
    "value", ["bytes=-0", "bytes=8-2", "bytes=-1-2", "items=0-1", "bytes=0-1,2-3"]
)
def test_invalid_audio_range_is_rejected(value):
    response = _handle_range_request(b"0123456789", value)
    assert response.status_code == 416


@pytest.mark.asyncio
async def test_local_audio_range_read_does_not_load_the_entire_file(tmp_path):
    cache = LocalFileCacheProvider(tmp_path)
    key = "a" * 64
    await cache.save(key, b"0123456789")
    assert await cache.load_range(key, 3, 4) == b"3456"


def test_external_tts_requires_explicit_operator_opt_in():
    settings = Settings(_env_file=None, external_tts_enabled=True)
    assert settings.model_dump().get("external_tts_enabled") is True
    assert Settings(_env_file=None).model_dump().get("external_tts_enabled") is False


@pytest.mark.parametrize(
    "overrides",
    [
        {"secret_key": "change_me_in_production", "debug": False},
        {"secret_key": "a" * 64, "debug": True},
    ],
)
def test_production_rejects_unsafe_security_settings(overrides):
    with pytest.raises(ValueError):
        Settings(_env_file=None, environment="production", **overrides)


@pytest.mark.asyncio
async def test_synthesis_is_disabled_without_explicit_permission(tmp_path):
    service = AudioService(AsyncMock(), AsyncMock(), MockTTSService(), AudioCacheManager(tmp_path))
    with pytest.raises(PermissionError, match="disabled"):
        await service._generate_audio(uuid4(), "Private text", "Title")


@pytest.mark.asyncio
async def test_synthesis_rejects_oversized_text_before_external_processing(tmp_path):
    service = AudioService(
        AsyncMock(),
        AsyncMock(),
        AsyncMock(),
        AudioCacheManager(tmp_path),
        external_synthesis_enabled=True,
    )
    with pytest.raises(TTSError, match="limit"):
        await service._generate_audio(uuid4(), "x" * 20001, "Title")


@pytest.mark.asyncio
async def test_duplicate_synthesis_is_not_queued(tmp_path):
    entered = asyncio.Event()
    release = asyncio.Event()
    tts = AsyncMock()
    tts.voice_id = "test-voice"

    async def synthesize(_text, path):
        entered.set()
        await release.wait()
        path.write_bytes(b"speech")
        return []

    tts.synthesize_with_timings.side_effect = synthesize
    repo = AsyncMock()
    repo.create.side_effect = lambda record: record
    service = AudioService(
        repo, AsyncMock(), tts, AudioCacheManager(tmp_path), external_synthesis_enabled=True
    )
    post_id = uuid4()
    task = asyncio.create_task(service._generate_audio(post_id, "Body", "Title"))
    await entered.wait()
    try:
        with pytest.raises(RuntimeError, match="progress"):
            await service._generate_audio(post_id, "Body", "Title")
    finally:
        release.set()
        await task


@pytest.mark.asyncio
async def test_synthesis_capacity_is_shared_across_service_instances(tmp_path):
    release = asyncio.Event()
    entered = asyncio.Queue()
    tts = AsyncMock()
    tts.voice_id = "voice"

    async def synthesize(_text, path):
        await entered.put(True)
        await release.wait()
        path.write_bytes(b"audio")
        return []

    tts.synthesize_with_timings.side_effect = synthesize
    records = AsyncMock()
    records.create.side_effect = lambda record: record
    services = [
        AudioService(
            records,
            AsyncMock(),
            tts,
            AudioCacheManager(tmp_path),
            external_synthesis_enabled=True,
        )
        for _ in range(3)
    ]
    tasks = [
        asyncio.create_task(service._generate_audio(uuid4(), "Body", str(index)))
        for index, service in enumerate(services[:2])
    ]
    try:
        await entered.get()
        await entered.get()
        with pytest.raises(RuntimeError, match="capacity"):
            await services[2]._generate_audio(uuid4(), "Body", "Third")
        assert tts.synthesize_with_timings.await_count == 2
    finally:
        release.set()
        await asyncio.gather(*tasks)
    assert not AudioService._generating


@pytest.mark.asyncio
async def test_synthesis_timeout_releases_capacity_and_staging_files(tmp_path, monkeypatch):
    tts = AsyncMock()
    tts.voice_id = "voice"
    paths = []

    async def synthesize(_text, path):
        paths.append(path)
        await asyncio.Event().wait()

    tts.synthesize_with_timings.side_effect = synthesize
    service = AudioService(
        AsyncMock(),
        AsyncMock(),
        tts,
        AudioCacheManager(tmp_path),
        external_synthesis_enabled=True,
    )
    monkeypatch.setattr(service, "SYNTHESIS_TIMEOUT_SECONDS", 0.01)
    with pytest.raises(TTSError, match="time limit"):
        await service._generate_audio(uuid4(), "Body", "Title")
    assert paths and not paths[0].parent.exists()
    assert not AudioService._generating


@pytest.mark.asyncio
async def test_cancelled_azure_synthesis_stops_and_drains_sdk_worker(tmp_path):
    from app.infrastructure.tts.azure_tts import AzureTTSService

    started, stopped, finished = threading.Event(), threading.Event(), threading.Event()

    def synthesize():
        started.set()
        stopped.wait(timeout=5)
        finished.set()
        return SimpleNamespace(reason=SimpleNamespace(name="SynthesizingAudioCompleted"))

    engine = MagicMock()
    engine.speak_text_async.return_value.get.side_effect = synthesize
    engine.stop_speaking_async.return_value.get.side_effect = stopped.set
    with patch("azure.cognitiveservices.speech.SpeechSynthesizer", return_value=engine):
        task = asyncio.create_task(
            AzureTTSService("https://example.invalid").synthesize("Test", tmp_path / "audio.mp3")
        )
        try:
            assert await asyncio.to_thread(started.wait, 2)
            task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await task
            assert stopped.is_set()
            assert finished.is_set()
        finally:
            stopped.set()
            await asyncio.to_thread(finished.wait, 2)
