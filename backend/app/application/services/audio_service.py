"""Audio application service for TTS operations."""

from dataclasses import dataclass
from enum import Enum
from pathlib import Path
from typing import Optional
from uuid import UUID

from app.domain.audio.entities.audio import Audio
from app.domain.audio.repositories.audio_repository import AudioRepository
from app.domain.audio.services.tts_service import TTSError, TTSService
from app.domain.feed_management.repositories.post_repository import PostRepository
from app.infrastructure.tts.cache_manager import AudioCacheManager


class AudioStatus(str, Enum):
    """Status of audio generation."""

    READY = "ready"
    GENERATING = "generating"
    ERROR = "error"


@dataclass
class AudioResult:
    """Result of audio retrieval or generation.

    Attributes:
        status: Current status (ready, generating, error)
        post_id: Associated post ID
        url: Audio streaming URL (when ready)
        cache_key: Cache key (when ready)
        duration_seconds: Audio duration (when available)
        estimated_seconds: Estimated generation time (when generating)
        error: Error message (when error)
    """

    status: AudioStatus
    post_id: UUID
    url: Optional[str] = None
    cache_key: Optional[str] = None
    duration_seconds: Optional[float] = None
    estimated_seconds: Optional[int] = None
    error: Optional[str] = None
    word_timings: Optional[list[dict]] = None


class AudioService:
    """Application service for text-to-speech operations.

    Coordinates TTS generation, caching, and retrieval.
    """

    def __init__(
        self,
        audio_repository: AudioRepository,
        post_repository: PostRepository,
        tts_service: TTSService,
        cache_manager: AudioCacheManager,
    ):
        """Initialize audio service.

        Args:
            audio_repository: Repository for audio metadata
            post_repository: Repository for posts
            tts_service: TTS implementation
            cache_manager: File cache manager
        """
        self._audio_repo = audio_repository
        self._post_repo = post_repository
        self._tts = tts_service
        self._cache = cache_manager

    async def get_or_generate_audio(
        self,
        post_id: UUID,
        user_id: UUID,
    ) -> AudioResult:
        """Get existing audio or generate new one.

        This implements lazy generation - audio is only created on first request.

        Args:
            post_id: Post to generate audio for
            user_id: User requesting audio (for permission check)

        Returns:
            AudioResult with status and URL if ready

        Raises:
            PermissionError: If user doesn't have access to post
            ValueError: If post doesn't exist
        """
        # Verify post exists and user has access
        post = await self._post_repo.get_by_id(post_id)
        if not post:
            raise ValueError(f"Post {post_id} not found")

        # Check if audio already exists. Only short-circuit when BOTH the MP3
        # and a timings sidecar are present; otherwise fall through and
        # regenerate so pre-feature (timing-less) clips are backfilled.
        existing_audio = await self._audio_repo.get_by_post_id(post_id)
        if (
            existing_audio
            and self._cache.exists(existing_audio.cache_key)
            and self._cache.exists_timings(existing_audio.cache_key)
        ):
            # Record access for LRU tracking
            await self._audio_repo.record_access(existing_audio.id)

            return AudioResult(
                status=AudioStatus.READY,
                post_id=post_id,
                url=f"/api/audio/{existing_audio.cache_key}",
                cache_key=existing_audio.cache_key,
                duration_seconds=existing_audio.duration_seconds,
                word_timings=self._load_word_timings(existing_audio.cache_key),
            )

        # Generate new audio
        try:
            audio = await self._generate_audio(post_id, post.content, post.title)
            return AudioResult(
                status=AudioStatus.READY,
                post_id=post_id,
                url=f"/api/audio/{audio.cache_key}",
                cache_key=audio.cache_key,
                duration_seconds=audio.duration_seconds,
                word_timings=self._load_word_timings(audio.cache_key),
            )
        except TTSError as e:
            return AudioResult(
                status=AudioStatus.ERROR,
                post_id=post_id,
                error=str(e),
            )

    async def generate_for_post(self, post_id: UUID) -> AudioResult:
        """Generate audio for a post as a system operation (no user check).

        Intended for background jobs. If audio already exists and is cached,
        it is returned as-is rather than regenerated.

        Args:
            post_id: Post to generate audio for.

        Returns:
            AudioResult (READY on success, ERROR on TTS failure).

        Raises:
            ValueError: If the post doesn't exist.
        """
        post = await self._post_repo.get_by_id(post_id)
        if not post:
            raise ValueError(f"Post {post_id} not found")

        existing_audio = await self._audio_repo.get_by_post_id(post_id)
        if (
            existing_audio
            and self._cache.exists(existing_audio.cache_key)
            and self._cache.exists_timings(existing_audio.cache_key)
        ):
            return AudioResult(
                status=AudioStatus.READY,
                post_id=post_id,
                url=f"/api/audio/{existing_audio.cache_key}",
                cache_key=existing_audio.cache_key,
                duration_seconds=existing_audio.duration_seconds,
                word_timings=self._load_word_timings(existing_audio.cache_key),
            )

        try:
            audio = await self._generate_audio(post_id, post.content, post.title)
            return AudioResult(
                status=AudioStatus.READY,
                post_id=post_id,
                url=f"/api/audio/{audio.cache_key}",
                cache_key=audio.cache_key,
                duration_seconds=audio.duration_seconds,
                word_timings=self._load_word_timings(audio.cache_key),
            )
        except TTSError as e:
            return AudioResult(
                status=AudioStatus.ERROR,
                post_id=post_id,
                error=str(e),
            )

    async def _generate_audio(
        self,
        post_id: UUID,
        content: str | None,
        title: str,
    ) -> Audio:
        """Generate audio for content.

        Args:
            post_id: Post ID
            content: Post content (may contain HTML)
            title: Post title

        Returns:
            Created Audio entity
        """
        # Prepare text for synthesis
        text_to_synthesize = f"{title}. {content or ''}".strip()

        # Generate cache key
        cache_key = self._cache.generate_cache_key(
            text_to_synthesize,
            self._tts.voice_id,
        )

        # Get output path
        output_path = self._cache.get_file_path(cache_key)

        # Synthesize audio and capture per-word timings
        timings = await self._tts.synthesize_with_timings(text_to_synthesize, output_path)

        # Persist timings as a sidecar when the engine produced any, and record
        # the queryable marker on the row. Missing/empty timings -> no sidecar.
        words = [
            {"text": t.text, "startMs": t.start_ms, "durationMs": t.duration_ms} for t in timings
        ]
        has_timings = bool(words)
        if has_timings:
            self._cache.save_timings(
                cache_key,
                {
                    "schemaVersion": 1,
                    "voiceId": self._tts.voice_id,
                    "words": words,
                },
            )

        # Get file size
        file_size = self._cache.get_file_size(cache_key)

        # Estimate duration (64kbps MP3 = 8KB/sec)
        duration_seconds = file_size / 8000 if file_size else None

        # Create audio record
        audio = Audio(
            post_id=post_id,
            cache_key=cache_key,
            file_path=str(output_path.relative_to(self._cache._cache_dir)),
            voice_id=self._tts.voice_id,
            duration_seconds=duration_seconds,
            file_size_bytes=file_size,
            has_timings=has_timings,
        )

        # Remove existing audio for this post if any
        await self._audio_repo.delete_by_post_id(post_id)

        # Save new audio record
        return await self._audio_repo.create(audio)

    def _load_word_timings(self, cache_key: str) -> Optional[list[dict]]:
        """Load ordered word timings for a clip, or None when unusable.

        Returns the ordered ``words`` array from the sidecar when a valid,
        non-empty timing set exists; returns ``None`` for missing, empty,
        corrupt, or non-conforming sidecars so the API omits the field.

        Args:
            cache_key: Audio cache key

        Returns:
            Ordered ``[{text, startMs, durationMs}]`` or None
        """
        payload = self._cache.load_timings(cache_key)
        if not payload:
            return None
        words = payload.get("words")
        if not isinstance(words, list) or not words:
            return None
        return words

    async def get_audio_stream_path(self, cache_key: str) -> Optional[Path]:
        """Get file path for streaming audio.

        Args:
            cache_key: Audio cache key

        Returns:
            Path to audio file, None if not found
        """
        file_path = self._cache.get_file_path(cache_key)
        if file_path.exists():
            # Record access
            audio = await self._audio_repo.get_by_cache_key(cache_key)
            if audio:
                await self._audio_repo.record_access(audio.id)
            return file_path
        return None

    async def delete_audio(self, post_id: UUID) -> bool:
        """Delete audio for a post.

        Args:
            post_id: Post ID

        Returns:
            True if deleted
        """
        audio = await self._audio_repo.get_by_post_id(post_id)
        if not audio:
            return False

        # Delete file
        await self._cache.delete(audio.cache_key)

        # Delete record
        return await self._audio_repo.delete(audio.id)
