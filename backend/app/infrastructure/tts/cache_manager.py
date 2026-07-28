"""Audio cache manager for file-based caching."""

import hashlib
import json
import os
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional


class AudioCacheManager:
    """Manages audio file caching on the filesystem.

    Uses SHA256-based cache keys and organizes files in prefix directories
    for better filesystem performance.
    """

    def __init__(
        self,
        cache_dir: Path,
        max_size_mb: int = 1000,
        cache_version: str = "v1",
    ):
        """Initialize cache manager.

        Args:
            cache_dir: Base directory for audio cache
            max_size_mb: Maximum cache size in megabytes
            cache_version: Version string for cache invalidation
        """
        self._cache_dir = Path(cache_dir)
        self._max_size_mb = max_size_mb
        self._cache_version = cache_version

        # Ensure cache directory exists
        self._cache_dir.mkdir(parents=True, exist_ok=True)

    def generate_cache_key(self, text: str, voice_id: str) -> str:
        """Generate SHA256 cache key from content and config.

        Args:
            text: Source text content
            voice_id: TTS voice identifier

        Returns:
            64-character hexadecimal hash
        """
        content = f"{text}:{voice_id}:mp3:{self._cache_version}"
        return hashlib.sha256(content.encode()).hexdigest()

    def get_file_path(self, cache_key: str) -> Path:
        """Get file path for a cache key.

        Uses first 2 characters as prefix directory for organization.

        Args:
            cache_key: SHA256 cache key

        Returns:
            Full path to cache file
        """
        prefix = cache_key[:2]
        return self._cache_dir / prefix / f"{cache_key}.mp3"

    def exists(self, cache_key: str) -> bool:
        """Check if cache file exists.

        Args:
            cache_key: SHA256 cache key

        Returns:
            True if file exists
        """
        return self.get_file_path(cache_key).exists()

    async def save(self, cache_key: str, data: bytes) -> None:
        """Save audio data to cache.

        Args:
            cache_key: SHA256 cache key
            data: Audio file bytes
        """
        file_path = self.get_file_path(cache_key)
        file_path.parent.mkdir(parents=True, exist_ok=True)
        file_path.write_bytes(data)

    async def load(self, cache_key: str) -> Optional[bytes]:
        """Load audio data from cache.

        Args:
            cache_key: SHA256 cache key

        Returns:
            Audio bytes if found, None otherwise
        """
        file_path = self.get_file_path(cache_key)
        if not file_path.exists():
            return None
        return file_path.read_bytes()

    async def delete(self, cache_key: str) -> bool:
        """Delete cache file.

        Args:
            cache_key: SHA256 cache key

        Returns:
            True if deleted, False if not found
        """
        file_path = self.get_file_path(cache_key)
        if file_path.exists():
            file_path.unlink()
            return True
        return False

    def get_file_size(self, cache_key: str) -> Optional[int]:
        """Get file size in bytes.

        Args:
            cache_key: SHA256 cache key

        Returns:
            File size in bytes, None if not found
        """
        file_path = self.get_file_path(cache_key)
        if not file_path.exists():
            return None
        return file_path.stat().st_size

    # ------------------------------------------------------------------
    # Word-timings sidecar (<key>.json next to <key>.mp3)
    # ------------------------------------------------------------------

    def get_timings_path(self, cache_key: str) -> Path:
        """Get the sidecar path for a cache key.

        Mirrors the MP3 path with a ``.json`` extension.

        Args:
            cache_key: SHA256 cache key

        Returns:
            Full path to the timings sidecar file
        """
        return self.get_file_path(cache_key).with_suffix(".json")

    def exists_timings(self, cache_key: str) -> bool:
        """Check whether a timings sidecar file exists.

        Note: existence only — the file may still be corrupt/invalid. Use
        :meth:`load_timings` to obtain validated data.

        Args:
            cache_key: SHA256 cache key

        Returns:
            True if the sidecar file exists
        """
        return self.get_timings_path(cache_key).exists()

    def save_timings(self, cache_key: str, payload: dict) -> None:
        """Persist a timings sidecar atomically (write temp + rename).

        Args:
            cache_key: SHA256 cache key
            payload: Sidecar body (``{schemaVersion, voiceId?, words}``)
        """
        path = self.get_timings_path(cache_key)
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp_path = path.with_name(f"{path.name}.tmp")
        tmp_path.write_text(json.dumps(payload), encoding="utf-8")
        tmp_path.replace(path)

    def load_timings(self, cache_key: str) -> Optional[dict]:
        """Load and validate a timings sidecar.

        Any read failure (missing file, invalid JSON, or a non-conforming
        shape) yields ``None`` so callers treat it uniformly as "no timings".

        Args:
            cache_key: SHA256 cache key

        Returns:
            The sidecar dict when valid, else None
        """
        path = self.get_timings_path(cache_key)
        if not path.exists():
            return None
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (ValueError, OSError):
            return None
        if not isinstance(data, dict):
            return None
        if "schemaVersion" not in data or not isinstance(data.get("words"), list):
            return None
        return data

    def delete_timings(self, cache_key: str) -> bool:
        """Delete a timings sidecar.

        Args:
            cache_key: SHA256 cache key

        Returns:
            True if deleted, False if not found
        """
        path = self.get_timings_path(cache_key)
        if path.exists():
            path.unlink()
            return True
        return False

    async def cleanup_old_files(self, retention_days: int = 90) -> int:
        """Remove files older than retention period.

        Removes aged ``.mp3`` files together with their ``.json`` sidecar (in
        lockstep) and reclaims orphan ``.json`` sidecars whose ``.mp3`` no
        longer exists (e.g. superseded keys after a cache-version bump).

        Args:
            retention_days: Number of days to retain files

        Returns:
            Number of MP3 files deleted
        """
        cutoff = datetime.now() - timedelta(days=retention_days)
        deleted_count = 0

        for prefix_dir in self._cache_dir.iterdir():
            if not prefix_dir.is_dir():
                continue

            for cache_file in prefix_dir.glob("*.mp3"):
                mtime = datetime.fromtimestamp(cache_file.stat().st_mtime)
                if mtime < cutoff:
                    cache_file.unlink()
                    deleted_count += 1
                    # Remove the sidecar in lockstep with its MP3.
                    sidecar = cache_file.with_suffix(".json")
                    if sidecar.exists():
                        sidecar.unlink()

            # Reclaim orphan sidecars whose MP3 no longer exists.
            for sidecar in prefix_dir.glob("*.json"):
                if not sidecar.with_suffix(".mp3").exists():
                    sidecar.unlink()

            # Remove empty prefix directories
            if not any(prefix_dir.iterdir()):
                prefix_dir.rmdir()

        return deleted_count

    def get_total_size_mb(self) -> float:
        """Get total cache size in megabytes.

        Returns:
            Total size in MB
        """
        total_bytes = 0
        for prefix_dir in self._cache_dir.iterdir():
            if not prefix_dir.is_dir():
                continue
            for cache_file in prefix_dir.glob("*.mp3"):
                total_bytes += cache_file.stat().st_size

        return total_bytes / (1024 * 1024)
