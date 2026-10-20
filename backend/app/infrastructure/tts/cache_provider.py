"""Storage providers for generated audio and its timing metadata."""

import json
from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

from azure.core.exceptions import ResourceNotFoundError


@dataclass(frozen=True)
class CachedAudioFile:
    """Metadata for one cached MP3."""

    cache_key: str
    size: int
    last_modified: datetime


class AudioCacheProvider(ABC):
    """Provider-neutral asynchronous audio cache interface."""

    @abstractmethod
    async def initialize(self) -> None:
        """Initialize provider resources."""

    @abstractmethod
    async def close(self) -> None:
        """Release provider resources."""

    @abstractmethod
    async def exists(self, cache_key: str) -> bool:
        """Return whether audio is cached."""

    @abstractmethod
    async def save(self, cache_key: str, data: bytes) -> None:
        """Store audio bytes."""

    @abstractmethod
    async def load(self, cache_key: str) -> Optional[bytes]:
        """Read audio bytes, or None if absent."""

    @abstractmethod
    async def delete(self, cache_key: str) -> bool:
        """Delete audio and timing metadata."""

    @abstractmethod
    async def get_file_size(self, cache_key: str) -> Optional[int]:
        """Return audio size in bytes."""

    @abstractmethod
    async def exists_timings(self, cache_key: str) -> bool:
        """Return whether the timing sidecar exists."""

    @abstractmethod
    async def save_timings(self, cache_key: str, payload: dict) -> None:
        """Store the timing sidecar."""

    @abstractmethod
    async def load_timings(self, cache_key: str) -> Optional[dict]:
        """Read a valid timing sidecar, or None."""

    @abstractmethod
    async def delete_timings(self, cache_key: str) -> bool:
        """Delete the timing sidecar."""

    @abstractmethod
    async def list_audio_files(self) -> list[CachedAudioFile]:
        """List cached MP3s with their size and modification time."""

    @abstractmethod
    async def cleanup_old_files(self, retention_days: int = 90) -> int:
        """Delete expired audio and orphaned sidecars."""

    @abstractmethod
    async def get_total_size_mb(self) -> float:
        """Return the total size of cached audio in MiB."""


class LocalFileCacheProvider(AudioCacheProvider):
    """Store cached audio and sidecars in a local directory."""

    def __init__(self, cache_dir: Path):
        self.cache_dir = Path(cache_dir)
        self.cache_dir.mkdir(parents=True, exist_ok=True)

    async def initialize(self) -> None:
        self.cache_dir.mkdir(parents=True, exist_ok=True)

    async def close(self) -> None:
        return None

    def get_file_path(self, cache_key: str) -> Path:
        return self.cache_dir / cache_key[:2] / f"{cache_key}.mp3"

    def get_timings_path(self, cache_key: str) -> Path:
        return self.get_file_path(cache_key).with_suffix(".json")

    async def exists(self, cache_key: str) -> bool:
        return self.get_file_path(cache_key).is_file()

    async def save(self, cache_key: str, data: bytes) -> None:
        path = self.get_file_path(cache_key)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)

    async def load(self, cache_key: str) -> Optional[bytes]:
        path = self.get_file_path(cache_key)
        return path.read_bytes() if path.is_file() else None

    async def delete(self, cache_key: str) -> bool:
        path = self.get_file_path(cache_key)
        existed = path.is_file()
        if existed:
            path.unlink()
        await self.delete_timings(cache_key)
        return existed

    async def get_file_size(self, cache_key: str) -> Optional[int]:
        path = self.get_file_path(cache_key)
        return path.stat().st_size if path.is_file() else None

    async def exists_timings(self, cache_key: str) -> bool:
        return self.get_timings_path(cache_key).is_file()

    async def save_timings(self, cache_key: str, payload: dict) -> None:
        path = self.get_timings_path(cache_key)
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp_path = path.with_name(f"{path.name}.tmp")
        tmp_path.write_text(json.dumps(payload), encoding="utf-8")
        tmp_path.replace(path)

    async def load_timings(self, cache_key: str) -> Optional[dict]:
        path = self.get_timings_path(cache_key)
        if not path.is_file():
            return None
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (ValueError, OSError):
            return None
        if not isinstance(data, dict) or "schemaVersion" not in data:
            return None
        if not isinstance(data.get("words"), list):
            return None
        return data

    async def delete_timings(self, cache_key: str) -> bool:
        path = self.get_timings_path(cache_key)
        existed = path.is_file()
        if existed:
            path.unlink()
        return existed

    async def list_audio_files(self) -> list[CachedAudioFile]:
        files = []
        for path in self.cache_dir.glob("*/*.mp3"):
            stat = path.stat()
            files.append(
                CachedAudioFile(
                    cache_key=path.stem,
                    size=stat.st_size,
                    last_modified=datetime.fromtimestamp(stat.st_mtime, timezone.utc),
                )
            )
        return files

    async def cleanup_old_files(self, retention_days: int = 90) -> int:
        cutoff = datetime.now(timezone.utc) - timedelta(days=retention_days)
        deleted = 0
        for entry in await self.list_audio_files():
            if entry.last_modified < cutoff and await self.delete(entry.cache_key):
                deleted += 1
        for path in self.cache_dir.glob("*/*.json"):
            if not path.with_suffix(".mp3").exists():
                path.unlink()
        for path in self.cache_dir.iterdir():
            if path.is_dir() and not any(path.iterdir()):
                path.rmdir()
        return deleted

    async def get_total_size_mb(self) -> float:
        files = await self.list_audio_files()
        return sum(entry.size for entry in files) / (1024 * 1024)


class AzureBlobCacheProvider(AudioCacheProvider):
    """Store cached audio in Azure Blob Storage using managed identity."""

    def __init__(
        self,
        service_url: str,
        container_name: str,
        *,
        container_client=None,
    ):
        if not service_url:
            raise ValueError("Azure Blob service URL is required")
        self._service_url = service_url
        self._container_name = container_name
        self._container = container_client
        self._credential = None
        self._service_client = None

    @staticmethod
    def _blob_name(cache_key: str, extension: str = ".mp3") -> str:
        return f"{cache_key[:2]}/{cache_key}{extension}"

    async def initialize(self) -> None:
        if self._container is None:
            from azure.identity.aio import DefaultAzureCredential
            from azure.storage.blob.aio import BlobServiceClient

            self._credential = DefaultAzureCredential()
            self._service_client = BlobServiceClient(
                self._service_url,
                credential=self._credential,
            )
            self._container = self._service_client.get_container_client(self._container_name)
        try:
            await self._container.create_container()
        except Exception as exc:
            from azure.core.exceptions import ResourceExistsError

            if not isinstance(exc, ResourceExistsError):
                raise

    async def close(self) -> None:
        if self._service_client is not None:
            await self._service_client.close()
            self._service_client = None
        if self._credential is not None:
            await self._credential.close()
            self._credential = None

    def _blob(self, cache_key: str, extension: str = ".mp3"):
        if self._container is None:
            raise RuntimeError("Azure Blob cache provider has not been initialized")
        return self._container.get_blob_client(self._blob_name(cache_key, extension))

    async def exists(self, cache_key: str) -> bool:
        return await self._blob(cache_key).exists()

    async def save(self, cache_key: str, data: bytes) -> None:
        await self._blob(cache_key).upload_blob(data, overwrite=True)

    async def load(self, cache_key: str) -> Optional[bytes]:
        blob = self._blob(cache_key)
        if not await blob.exists():
            return None
        return await (await blob.download_blob()).readall()

    async def delete(self, cache_key: str) -> bool:
        blob = self._blob(cache_key)
        existed = await blob.exists()
        if existed:
            await blob.delete_blob(delete_snapshots="include")
        await self.delete_timings(cache_key)
        return existed

    async def get_file_size(self, cache_key: str) -> Optional[int]:
        blob = self._blob(cache_key)
        try:
            properties = await blob.get_blob_properties()
        except ResourceNotFoundError:
            return None
        return properties.size

    async def exists_timings(self, cache_key: str) -> bool:
        return await self._blob(cache_key, ".json").exists()

    async def save_timings(self, cache_key: str, payload: dict) -> None:
        data = json.dumps(payload).encode("utf-8")
        await self._blob(cache_key, ".json").upload_blob(data, overwrite=True)

    async def load_timings(self, cache_key: str) -> Optional[dict]:
        blob = self._blob(cache_key, ".json")
        if not await blob.exists():
            return None
        try:
            data = json.loads((await (await blob.download_blob()).readall()).decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            return None
        if not isinstance(data, dict) or "schemaVersion" not in data:
            return None
        if not isinstance(data.get("words"), list):
            return None
        return data

    async def delete_timings(self, cache_key: str) -> bool:
        blob = self._blob(cache_key, ".json")
        existed = await blob.exists()
        if existed:
            await blob.delete_blob(delete_snapshots="include")
        return existed

    async def list_audio_files(self) -> list[CachedAudioFile]:
        if self._container is None:
            raise RuntimeError("Azure Blob cache provider has not been initialized")
        entries = []
        async for blob in self._container.list_blobs():
            if blob.name.endswith(".mp3"):
                key = Path(blob.name).stem
                entries.append(
                    CachedAudioFile(
                        cache_key=key,
                        size=blob.size,
                        last_modified=blob.last_modified,
                    )
                )
        return entries

    async def cleanup_old_files(self, retention_days: int = 90) -> int:
        if self._container is None:
            raise RuntimeError("Azure Blob cache provider has not been initialized")
        cutoff = datetime.now(timezone.utc) - timedelta(days=retention_days)
        blobs = []
        async for blob in self._container.list_blobs():
            blobs.append(blob)
        names = {blob.name for blob in blobs}
        deleted_keys = set()
        for blob in blobs:
            if blob.name.endswith(".mp3") and blob.last_modified < cutoff:
                key = Path(blob.name).stem
                await self.delete(key)
                deleted_keys.add(key)
        for blob in blobs:
            if blob.name.endswith(".json"):
                audio_name = f"{Path(blob.name).parent}/{Path(blob.name).stem}.mp3"
                if audio_name not in names and Path(blob.name).stem not in deleted_keys:
                    await self._container.delete_blob(blob.name, delete_snapshots="include")
        return len(deleted_keys)

    async def get_total_size_mb(self) -> float:
        files = await self.list_audio_files()
        return sum(entry.size for entry in files) / (1024 * 1024)
