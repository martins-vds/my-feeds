"""Provider-neutral audio cache manager."""

import hashlib
from pathlib import Path

from app.infrastructure.tts.cache_provider import (
    AudioCacheProvider,
    CachedAudioFile,
    LocalFileCacheProvider,
)


class AudioCacheManager:
    """Generate cache keys and delegate storage operations to a provider."""

    def __init__(
        self,
        cache_dir: Path | None = None,
        max_size_mb: int = 1000,
        cache_version: str = "v1",
        provider: AudioCacheProvider | None = None,
    ):
        self._provider = provider or LocalFileCacheProvider(cache_dir or Path("audio_cache"))
        self._cache_version = cache_version
        self._max_size_mb = max_size_mb

    @property
    def provider(self) -> AudioCacheProvider:
        return self._provider

    async def initialize(self) -> None:
        await self._provider.initialize()

    async def close(self) -> None:
        await self._provider.close()

    def generate_cache_key(self, text: str, voice_id: str) -> str:
        content = f"{text}:{voice_id}:mp3:{self._cache_version}"
        return hashlib.sha256(content.encode()).hexdigest()

    def get_storage_path(self, cache_key: str) -> str:
        """Return the portable relative object name used by all providers."""
        return f"{cache_key[:2]}/{cache_key}.mp3"

    def get_file_path(self, cache_key: str) -> Path:
        """Return a local filesystem path for local-provider tests and utilities."""
        if not isinstance(self._provider, LocalFileCacheProvider):
            raise RuntimeError("Filesystem paths are only available for the local cache provider")
        return self._provider.get_file_path(cache_key)

    def get_timings_path(self, cache_key: str) -> Path:
        """Return a local timing-sidecar path."""
        if not isinstance(self._provider, LocalFileCacheProvider):
            raise RuntimeError("Filesystem paths are only available for the local cache provider")
        return self._provider.get_timings_path(cache_key)

    async def exists(self, cache_key: str) -> bool:
        return await self._provider.exists(cache_key)

    async def save(self, cache_key: str, data: bytes) -> None:
        await self._provider.save(cache_key, data)

    async def load(self, cache_key: str) -> bytes | None:
        return await self._provider.load(cache_key)

    async def load_range(self, cache_key: str, offset: int, length: int | None) -> bytes | None:
        return await self._provider.load_range(cache_key, offset, length)

    async def delete(self, cache_key: str) -> bool:
        return await self._provider.delete(cache_key)

    async def get_file_size(self, cache_key: str) -> int | None:
        return await self._provider.get_file_size(cache_key)

    async def exists_timings(self, cache_key: str) -> bool:
        return await self._provider.exists_timings(cache_key)

    async def save_timings(self, cache_key: str, payload: dict) -> None:
        await self._provider.save_timings(cache_key, payload)

    async def load_timings(self, cache_key: str) -> dict | None:
        return await self._provider.load_timings(cache_key)

    async def delete_timings(self, cache_key: str) -> bool:
        return await self._provider.delete_timings(cache_key)

    async def list_audio_files(self) -> list[CachedAudioFile]:
        return await self._provider.list_audio_files()

    async def cleanup_old_files(self, retention_days: int = 90) -> int:
        return await self._provider.cleanup_old_files(retention_days)

    async def get_total_size_mb(self) -> float:
        return await self._provider.get_total_size_mb()
