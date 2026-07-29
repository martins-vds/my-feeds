"""In-memory, per-user TTL cache for rarely-changing JSON responses.

Single-process only: entries live in this worker's memory. A short TTL bounds
staleness from any missed invalidation, and writes call ``invalidate_user`` for
promptness. A multi-worker / multi-instance deployment would replace this with
a shared store (e.g. Redis) — out of scope here.
"""

import asyncio
import time
from dataclasses import dataclass
from uuid import UUID


@dataclass
class _Entry:
    etag: str
    body: bytes
    expires_at: float


class ResponseCache:
    """Async-safe per-user store of ``(etag, serialized body)`` with a TTL."""

    def __init__(self, ttl_seconds: float = 60.0) -> None:
        self._ttl = ttl_seconds
        self._store: dict[UUID, dict[str, _Entry]] = {}
        self._lock = asyncio.Lock()

    async def get(self, user_id: UUID, key: str) -> tuple[str, bytes] | None:
        """Return ``(etag, body)`` for a live entry, else None (evicting if expired)."""
        async with self._lock:
            entries = self._store.get(user_id)
            if not entries:
                return None
            entry = entries.get(key)
            if entry is None:
                return None
            if entry.expires_at <= time.monotonic():
                del entries[key]
                return None
            return entry.etag, entry.body

    async def set(self, user_id: UUID, key: str, etag: str, body: bytes) -> None:
        """Store ``(etag, body)`` for ``(user_id, key)`` with a fresh TTL."""
        async with self._lock:
            self._store.setdefault(user_id, {})[key] = _Entry(
                etag=etag, body=body, expires_at=time.monotonic() + self._ttl
            )

    async def invalidate_user(self, user_id: UUID) -> None:
        """Drop every cached entry for a user (called on that user's writes)."""
        async with self._lock:
            self._store.pop(user_id, None)


_cache: ResponseCache | None = None


def get_response_cache() -> ResponseCache:
    """Return the process-wide ResponseCache singleton."""
    global _cache
    if _cache is None:
        _cache = ResponseCache()
    return _cache


def reset_response_cache() -> None:
    """Discard the singleton (used for test isolation)."""
    global _cache
    _cache = None
