"""Unit tests for the word-timings sidecar store on AudioCacheManager.

Timings are persisted as a JSON sidecar next to each MP3:
``audio_cache/<key[:2]>/<key>.json``. The store round-trips valid payloads,
treats any read failure (missing, invalid JSON, wrong shape) as "no timings"
(``None``), and reclaims orphan sidecars during cleanup.
"""

import json
import os
from datetime import datetime, timedelta

import pytest


@pytest.fixture
def cache_manager(tmp_path):
    from app.infrastructure.tts.cache_manager import AudioCacheManager

    return AudioCacheManager(cache_dir=tmp_path)


def _key(prefix: str) -> str:
    """Build a 64-hex cache key beginning with ``prefix``."""
    return (prefix + "0" * 64)[:64]


VALID_PAYLOAD = {
    "schemaVersion": 1,
    "voiceId": "en-US-AriaNeural",
    "words": [
        {"text": "Hello", "startMs": 120, "durationMs": 300},
        {"text": "world", "startMs": 430, "durationMs": 280},
    ],
}


class TestTimingsPath:
    def test_mirrors_mp3_path_with_json_suffix(self, cache_manager):
        key = _key("ab")
        mp3 = cache_manager.get_file_path(key)
        sidecar = cache_manager.get_timings_path(key)

        assert sidecar.parent == mp3.parent
        assert sidecar.name == f"{key}.json"
        assert sidecar == mp3.with_suffix(".json")


class TestTimingsRoundTrip:
    def test_save_load_exists_delete(self, cache_manager):
        key = _key("cd")

        assert cache_manager.exists_timings(key) is False
        assert cache_manager.load_timings(key) is None

        cache_manager.save_timings(key, VALID_PAYLOAD)

        assert cache_manager.exists_timings(key) is True
        assert cache_manager.load_timings(key) == VALID_PAYLOAD

        assert cache_manager.delete_timings(key) is True
        assert cache_manager.exists_timings(key) is False
        assert cache_manager.load_timings(key) is None

    def test_delete_missing_returns_false(self, cache_manager):
        assert cache_manager.delete_timings(_key("ee")) is False


class TestCorruptTimings:
    def test_invalid_json_returns_none(self, cache_manager):
        key = _key("ef")
        path = cache_manager.get_timings_path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("{ this is not valid json")

        assert cache_manager.load_timings(key) is None

    def test_wrong_shape_returns_none(self, cache_manager):
        key = _key("12")
        path = cache_manager.get_timings_path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        # Missing required "words"/"schemaVersion".
        path.write_text(json.dumps({"foo": "bar"}))

        assert cache_manager.load_timings(key) is None

    def test_words_not_a_list_returns_none(self, cache_manager):
        key = _key("13")
        path = cache_manager.get_timings_path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps({"schemaVersion": 1, "words": "nope"}))

        assert cache_manager.load_timings(key) is None


class TestOrphanReclamation:
    @pytest.mark.asyncio
    async def test_cleanup_removes_orphan_json(self, cache_manager):
        """A sidecar with no sibling MP3 is reclaimed by cleanup."""
        key = _key("34")
        path = cache_manager.get_timings_path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps({"schemaVersion": 1, "words": []}))

        await cache_manager.cleanup_old_files(retention_days=90)

        assert not path.exists()

    @pytest.mark.asyncio
    async def test_cleanup_keeps_sidecar_with_live_mp3(self, cache_manager):
        """A sidecar whose MP3 still exists (and is recent) is kept."""
        key = _key("56")
        mp3 = cache_manager.get_file_path(key)
        mp3.parent.mkdir(parents=True, exist_ok=True)
        mp3.write_bytes(b"\xff\xfb\x90\x00")
        sidecar = cache_manager.get_timings_path(key)
        sidecar.write_text(json.dumps(VALID_PAYLOAD))

        await cache_manager.cleanup_old_files(retention_days=90)

        assert mp3.exists()
        assert sidecar.exists()

    @pytest.mark.asyncio
    async def test_cleanup_removes_aged_mp3_and_its_sidecar_in_lockstep(self, cache_manager):
        """An aged MP3 and its sidecar are reclaimed together."""
        key = _key("78")
        mp3 = cache_manager.get_file_path(key)
        mp3.parent.mkdir(parents=True, exist_ok=True)
        mp3.write_bytes(b"\xff\xfb\x90\x00")
        sidecar = cache_manager.get_timings_path(key)
        sidecar.write_text(json.dumps(VALID_PAYLOAD))

        old = (datetime.now() - timedelta(days=91)).timestamp()
        os.utime(mp3, (old, old))

        await cache_manager.cleanup_old_files(retention_days=90)

        assert not mp3.exists()
        assert not sidecar.exists()  # removed in lockstep with the MP3
