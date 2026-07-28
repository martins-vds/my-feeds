"""Audio domain entity."""

from dataclasses import dataclass
from datetime import datetime
from typing import Optional
from uuid import UUID, uuid4


@dataclass
class Audio:
    """Domain entity representing cached TTS audio for a post.

    Attributes:
        id: Unique identifier
        post_id: Associated post ID
        cache_key: SHA256 hash for cache lookup
        file_path: Relative path to audio file
        format: Audio format (mp3, ogg, wav)
        voice_id: TTS voice identifier used
        duration_seconds: Audio duration
        file_size_bytes: File size
        created_at: Generation timestamp
        last_accessed_at: Last playback request
        access_count: Number of playback requests
        has_timings: True once the clip has been generated at the current cache
            version (its word-timing sidecar has been written; the sidecar may
            hold zero words). Drives idempotent backfill selection.
    """

    post_id: UUID
    cache_key: str
    file_path: str
    id: UUID = None  # type: ignore
    format: str = "mp3"
    voice_id: str = "en-US-JennyNeural"
    duration_seconds: Optional[float] = None
    file_size_bytes: Optional[int] = None
    created_at: Optional[datetime] = None
    last_accessed_at: Optional[datetime] = None
    access_count: int = 0
    has_timings: bool = False

    def __post_init__(self) -> None:
        """Initialize defaults after dataclass init."""
        if self.id is None:
            self.id = uuid4()
        if self.created_at is None:
            self.created_at = datetime.utcnow()
        if self.last_accessed_at is None:
            self.last_accessed_at = self.created_at

    def record_access(self) -> None:
        """Record an access to this audio file."""
        self.last_accessed_at = datetime.utcnow()
        self.access_count += 1

    @property
    def is_valid(self) -> bool:
        """Check if audio has required fields."""
        return bool(
            self.post_id and self.cache_key and self.file_path and len(self.cache_key) == 64
        )
