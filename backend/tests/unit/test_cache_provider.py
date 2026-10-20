"""Tests for selecting the configured audio cache provider."""

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from app.config.settings import Settings


def _azure_cache(container):
    from app.infrastructure.tts.cache_provider import AzureBlobCacheProvider

    return AzureBlobCacheProvider(
        service_url="https://example.blob.core.windows.net",
        container_name="audio-cache",
        container_client=container,
    )


class FakeBlob:
    def __init__(self, container, name):
        self.container = container
        self.name = name

    async def exists(self):
        return self.name in self.container.blobs

    async def upload_blob(self, data, overwrite):
        assert overwrite
        self.container.blobs[self.name] = bytes(data)
        self.container.timestamps[self.name] = datetime.now(timezone.utc)

    async def download_blob(self):
        async def readall():
            return self.container.blobs[self.name]

        return SimpleNamespace(readall=readall)

    async def get_blob_properties(self):
        return SimpleNamespace(
            size=len(self.container.blobs[self.name]),
            last_modified=self.container.timestamps[self.name],
        )

    async def delete_blob(self, **kwargs):
        self.container.blobs.pop(self.name, None)
        self.container.timestamps.pop(self.name, None)


class FakeContainer:
    def __init__(self):
        self.blobs = {}
        self.timestamps = {}

    def get_blob_client(self, name):
        return FakeBlob(self, name)

    async def list_blobs(self, name_starts_with):
        for name in self.blobs:
            if name.startswith(name_starts_with):
                yield SimpleNamespace(
                    name=name,
                    size=len(self.blobs[name]),
                    last_modified=self.timestamps[name],
                )


def test_local_cache_provider_is_the_default(tmp_path):
    settings = Settings(audio_cache_dir=str(tmp_path))

    assert settings.audio_cache_provider == "local"


def test_unknown_cache_provider_is_rejected():
    with pytest.raises(ValidationError):
        Settings(audio_cache_provider="unknown")


def test_blob_provider_requires_service_url():
    with pytest.raises(ValidationError):
        Settings(audio_cache_provider="azure_blob")


@pytest.mark.asyncio
async def test_blob_provider_uploads_audio_and_timings_under_shared_prefix():
    container = FakeContainer()
    cache = _azure_cache(container)
    key = "ab" + "0" * 62

    await cache.save(key, b"audio")
    await cache.save_timings(key, {"schemaVersion": 1, "words": []})

    assert await cache.load(key) == b"audio"
    assert await cache.load_timings(key) == {"schemaVersion": 1, "words": []}
    assert set(container.blobs) == {f"ab/{key}.mp3", f"ab/{key}.json"}


@pytest.mark.asyncio
async def test_blob_provider_deletes_audio_and_timings_together():
    container = FakeContainer()
    cache = _azure_cache(container)
    key = "cd" + "0" * 62
    await cache.save(key, b"audio")
    await cache.save_timings(key, {"schemaVersion": 1, "words": []})

    assert await cache.delete(key) is True
    assert container.blobs == {}
