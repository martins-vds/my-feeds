"""Unit tests for AudioCacheManager.

Tests verify audio file caching and retrieval functionality.
"""

import pytest
from pathlib import Path
from uuid import uuid4
from unittest.mock import MagicMock, AsyncMock, patch


class TestAudioCacheManager:
    """Tests for AudioCacheManager file operations."""

    @pytest.fixture
    def cache_manager(self, tmp_path):
        """Create AudioCacheManager with temp directory."""
        from app.infrastructure.tts.cache_manager import AudioCacheManager

        return AudioCacheManager(cache_dir=tmp_path)

    def test_generates_cache_key(self, cache_manager):
        """generate_cache_key creates SHA256 hash of content."""
        text = "Test content for hashing"
        voice_id = "en-US-JennyNeural"

        cache_key = cache_manager.generate_cache_key(text, voice_id)

        assert len(cache_key) == 64  # SHA256 hex string
        assert cache_key.isalnum()

    def test_cache_key_is_deterministic(self, cache_manager):
        """Same inputs produce same cache key."""
        text = "Test content"
        voice_id = "en-US-JennyNeural"

        key1 = cache_manager.generate_cache_key(text, voice_id)
        key2 = cache_manager.generate_cache_key(text, voice_id)

        assert key1 == key2

    def test_cache_key_differs_for_different_text(self, cache_manager):
        """Different text produces different cache key."""
        voice_id = "en-US-JennyNeural"

        key1 = cache_manager.generate_cache_key("Text 1", voice_id)
        key2 = cache_manager.generate_cache_key("Text 2", voice_id)

        assert key1 != key2

    def test_cache_key_differs_for_different_voice(self, cache_manager):
        """Different voice produces different cache key."""
        text = "Same text"

        key1 = cache_manager.generate_cache_key(text, "en-US-JennyNeural")
        key2 = cache_manager.generate_cache_key(text, "en-US-GuyNeural")

        assert key1 != key2

    def test_cache_version_changes_key_deterministically(self, tmp_path):
        """Bumping the cache version rotates the deterministic key (backfill trigger)."""
        from app.infrastructure.tts.cache_manager import AudioCacheManager

        v1 = AudioCacheManager(cache_dir=tmp_path, cache_version="v1")
        v2 = AudioCacheManager(cache_dir=tmp_path, cache_version="v2")

        key_v1 = v1.generate_cache_key("Same text", "voice-x")
        key_v2 = v2.generate_cache_key("Same text", "voice-x")

        assert key_v1 != key_v2
        # Deterministic within a version.
        assert v2.generate_cache_key("Same text", "voice-x") == key_v2

    def test_get_file_path_returns_correct_structure(self, cache_manager):
        """get_file_path returns path with prefix directory."""
        cache_key = "a1b2c3d4e5f6" + "0" * 52  # 64 chars

        path = cache_manager.get_file_path(cache_key)

        # Should use first 2 chars as prefix directory
        assert "a1" in str(path)
        assert path.name == f"{cache_key}.mp3"

    def test_exists_returns_false_for_missing_file(self, cache_manager):
        """exists returns False when file doesn't exist."""
        cache_key = "nonexistent" + "0" * 53

        assert cache_manager.exists(cache_key) is False

    def test_exists_returns_true_for_existing_file(self, cache_manager, tmp_path):
        """exists returns True when file exists."""
        cache_key = "a1b2c3d4" + "0" * 56

        # Create the file
        file_path = cache_manager.get_file_path(cache_key)
        file_path.parent.mkdir(parents=True, exist_ok=True)
        file_path.write_bytes(b"fake audio data")

        assert cache_manager.exists(cache_key) is True

    @pytest.mark.asyncio
    async def test_save_creates_file(self, cache_manager):
        """save stores audio data to cache."""
        cache_key = "b2c3d4e5" + "0" * 56
        audio_data = b"fake mp3 audio data"

        await cache_manager.save(cache_key, audio_data)

        file_path = cache_manager.get_file_path(cache_key)
        assert file_path.exists()
        assert file_path.read_bytes() == audio_data

    @pytest.mark.asyncio
    async def test_load_returns_file_contents(self, cache_manager):
        """load returns audio data from cache."""
        cache_key = "c3d4e5f6" + "0" * 56
        expected_data = b"fake mp3 audio data"

        # Create file first
        file_path = cache_manager.get_file_path(cache_key)
        file_path.parent.mkdir(parents=True, exist_ok=True)
        file_path.write_bytes(expected_data)

        data = await cache_manager.load(cache_key)

        assert data == expected_data

    @pytest.mark.asyncio
    async def test_load_returns_none_for_missing_file(self, cache_manager):
        """load returns None when file doesn't exist."""
        cache_key = "d4e5f6a7" + "0" * 56

        data = await cache_manager.load(cache_key)

        assert data is None

    @pytest.mark.asyncio
    async def test_delete_removes_file(self, cache_manager):
        """delete removes file from cache."""
        cache_key = "e5f6a7b8" + "0" * 56

        # Create file first
        file_path = cache_manager.get_file_path(cache_key)
        file_path.parent.mkdir(parents=True, exist_ok=True)
        file_path.write_bytes(b"data")

        await cache_manager.delete(cache_key)

        assert not file_path.exists()

    def test_get_file_size_returns_bytes(self, cache_manager):
        """get_file_size returns file size in bytes."""
        cache_key = "f6a7b8c9" + "0" * 56
        data = b"x" * 1024  # 1KB

        file_path = cache_manager.get_file_path(cache_key)
        file_path.parent.mkdir(parents=True, exist_ok=True)
        file_path.write_bytes(data)

        size = cache_manager.get_file_size(cache_key)

        assert size == 1024

    def test_get_file_size_returns_none_for_missing(self, cache_manager):
        """get_file_size returns None for missing file."""
        cache_key = "a7b8c9d0" + "0" * 56

        size = cache_manager.get_file_size(cache_key)

        assert size is None


class TestAudioCacheCleanup:
    """Tests for cache cleanup/eviction functionality."""

    @pytest.fixture
    def cache_manager(self, tmp_path):
        """Create AudioCacheManager with temp directory."""
        from app.infrastructure.tts.cache_manager import AudioCacheManager

        return AudioCacheManager(cache_dir=tmp_path, max_size_mb=1)

    @pytest.mark.asyncio
    async def test_cleanup_removes_old_files(self, cache_manager, tmp_path):
        """cleanup_old_files removes files older than retention period."""
        from datetime import datetime, timedelta
        import os

        # Create old file
        cache_key = "oldfile12" + "0" * 56
        file_path = cache_manager.get_file_path(cache_key)
        file_path.parent.mkdir(parents=True, exist_ok=True)
        file_path.write_bytes(b"old data")

        # Set old modification time (91 days ago)
        old_time = (datetime.now() - timedelta(days=91)).timestamp()
        os.utime(file_path, (old_time, old_time))

        await cache_manager.cleanup_old_files(retention_days=90)

        assert not file_path.exists()

    @pytest.mark.asyncio
    async def test_cleanup_preserves_recent_files(self, cache_manager, tmp_path):
        """cleanup_old_files keeps files within retention period."""
        cache_key = "newfile12" + "0" * 56
        file_path = cache_manager.get_file_path(cache_key)
        file_path.parent.mkdir(parents=True, exist_ok=True)
        file_path.write_bytes(b"recent data")

        await cache_manager.cleanup_old_files(retention_days=90)

        assert file_path.exists()
