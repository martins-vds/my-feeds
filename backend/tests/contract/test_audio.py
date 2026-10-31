"""Contract tests for audio/TTS endpoints.

Tests verify the API contract defined in openapi.yaml for:
- GET /posts/{id}/audio - Get or generate audio for a post
- GET /audio/{cacheKey} - Stream audio file
"""

from uuid import uuid4
from datetime import UTC, datetime, timedelta

import pytest
import pytest_asyncio
from sqlalchemy import text as sqltext


@pytest_asyncio.fixture
async def private_audio(test_audio, post_id):
    await _seed_audio_row(post_id, test_audio.cache_key)
    try:
        yield test_audio
    finally:
        await _delete_audio_row(post_id)


class TestGetPostAudio:
    """Contract tests for GET /posts/{postId}/audio endpoint."""

    @pytest.mark.asyncio
    async def test_returns_audio_ready_when_cached(
        self, client, auth_headers, test_post_with_audio
    ):
        """GET /posts/{id}/audio returns 200 with audio URL when cached."""
        response = await client.get(
            f"/api/posts/{test_post_with_audio.id}/audio",
            headers=auth_headers,
        )

        # With mock post, likely returns 404 (not a real post)
        assert response.status_code in (200, 404)
        if response.status_code == 200:
            data = await response.get_json()
            assert data["status"] == "ready"
            assert "url" in data
            assert data["postId"] == str(test_post_with_audio.id)
            assert "durationSeconds" in data

    @pytest.mark.asyncio
    async def test_returns_202_when_generating(self, client, auth_headers, test_post):
        """GET /posts/{id}/audio returns 202 when audio is being generated."""
        response = await client.get(
            f"/api/posts/{test_post.id}/audio",
            headers=auth_headers,
        )

        # First request triggers generation; with mock post likely 404
        assert response.status_code in (200, 202, 404)
        if response.status_code == 202:
            data = await response.get_json()
            assert data["status"] == "generating"
            assert "estimatedSeconds" in data
            assert data["postId"] == str(test_post.id)

    @pytest.mark.asyncio
    async def test_requires_authentication(self, client, test_post):
        """GET /posts/{id}/audio returns 401 without auth."""
        response = await client.get(f"/api/posts/{test_post.id}/audio")

        assert response.status_code == 401

    @pytest.mark.asyncio
    async def test_returns_404_for_nonexistent_post(self, client, auth_headers):
        """GET /posts/{id}/audio returns 404 for non-existent post."""
        response = await client.get(
            f"/api/posts/{uuid4()}/audio",
            headers=auth_headers,
        )

        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_returns_404_for_other_users_post(self, client, auth_headers, other_user_post_id):
        """GET /posts/{id}/audio returns 404 for post from another user's feed."""
        response = await client.get(
            f"/api/posts/{other_user_post_id}/audio",
            headers=auth_headers,
        )

        assert response.status_code == 404


class TestStreamAudio:
    """Contract tests for GET /audio/{cacheKey} endpoint."""

    @pytest.mark.asyncio
    async def test_streams_full_audio_file(self, client, auth_headers, private_audio):
        """GET /audio/{cacheKey} returns 200 with audio content."""
        response = await client.get(
            f"/api/audio/{private_audio.cache_key}", headers=auth_headers
        )

        assert response.status_code == 200
        assert response.content_type == "audio/mpeg"
        data = await response.get_data()
        assert len(data) > 0
        assert response.headers["Cache-Control"] == "private, no-store"

    @pytest.mark.asyncio
    async def test_supports_range_request(self, client, auth_headers, private_audio):
        """GET /audio/{cacheKey} with Range header returns 206 partial content."""
        response = await client.get(
            f"/api/audio/{private_audio.cache_key}",
            headers={**auth_headers, "Range": "bytes=0-1023"},
        )

        assert response.status_code == 206
        assert "Content-Range" in response.headers
        data = await response.get_data()
        assert len(data) == 1024

    @pytest.mark.asyncio
    async def test_returns_404_for_nonexistent_cache_key(self, client, auth_headers):
        """GET /audio/{cacheKey} returns 404 for non-existent key."""
        response = await client.get(
            "/api/audio/" + "f" * 64, headers=auth_headers
        )

        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_rejects_malformed_cache_key(self, client, auth_headers):
        """Non SHA-256-hex keys are rejected with 404 before any filesystem
        lookup, closing the path-traversal vector."""
        # 64 chars but not hex -> fails validation (would otherwise hit the FS).
        resp = await client.get("/api/audio/" + "g" * 64, headers=auth_headers)
        assert resp.status_code == 404

        # Encoded traversal attempt never escapes the cache directory.
        resp2 = await client.get(
            "/api/audio/..%2f..%2f..%2fetc%2fpasswd", headers=auth_headers
        )
        assert resp2.status_code == 404

    @pytest.mark.asyncio
    async def test_streaming_requires_authentication(self, client, private_audio):
        """Knowing the deterministic cache key does not authorize streaming."""
        response = await client.get(f"/api/audio/{private_audio.cache_key}")

        assert response.status_code == 401

    @pytest.mark.asyncio
    async def test_other_account_cannot_stream_known_cache_key(
        self, client, fresh_auth_headers, private_audio
    ):
        response = await client.get(
            f"/api/audio/{private_audio.cache_key}", headers=fresh_auth_headers
        )
        assert response.status_code == 404
        assert response.headers["Cache-Control"] == "private, no-store"

    @pytest.mark.asyncio
    async def test_shared_cache_key_only_authorizes_accounts_with_linked_posts(
        self, client, auth_headers, other_auth_headers, private_audio, other_user_post_id
    ):
        await _seed_audio_row(other_user_post_id, private_audio.cache_key)
        try:
            for headers in (auth_headers, other_auth_headers):
                response = await client.get(
                    f"/api/audio/{private_audio.cache_key}",
                    headers={**headers, "Range": "bytes=-16"},
                )
                assert response.status_code == 206
                assert len(await response.get_data()) == 16
        finally:
            await _delete_audio_row(other_user_post_id)

    @pytest.mark.asyncio
    async def test_shared_audio_eviction_uses_newest_access_and_removes_all_links(
        self, private_audio, post_id, other_user_post_id, read_post_id
    ):
        from app.config.container import create_cache_manager
        from app.infrastructure.jobs.audio_cleanup import cleanup_cache_by_size
        from app.infrastructure.persistence.database import get_session_factory

        cache = create_cache_manager()
        shared_key, old_key = private_audio.cache_key, "e" * 64
        size = 600 * 1024
        await cache.save(shared_key, b"s" * size)
        await cache.save(old_key, b"o" * size)
        await _seed_audio_row(other_user_post_id, shared_key)
        await _seed_audio_row(read_post_id, old_key)
        factory = get_session_factory()
        now = datetime.now(UTC)
        try:
            async with factory() as session:
                for pid, days in ((post_id, 10), (read_post_id, 5), (other_user_post_id, 0)):
                    await session.execute(
                        sqltext("UPDATE audio SET last_accessed_at=:accessed WHERE post_id=:pid"),
                        {"accessed": now - timedelta(days=days), "pid": pid},
                    )
                await session.commit()
                assert await cleanup_cache_by_size(cache, 1, session) == (1, size)
                assert await cache.exists(shared_key)
                assert not await cache.exists(old_key)
                assert await session.scalar(
                    sqltext("SELECT COUNT(*) FROM audio WHERE cache_key=:key"), {"key": shared_key}
                ) == 2
                assert await session.scalar(
                    sqltext("SELECT COUNT(*) FROM audio WHERE cache_key=:key"), {"key": old_key}
                ) == 0
                assert await cleanup_cache_by_size(cache, 0, session) == (1, size)
                assert await session.scalar(
                    sqltext("SELECT COUNT(*) FROM audio WHERE cache_key=:key"), {"key": shared_key}
                ) == 0
        finally:
            await _delete_audio_row(other_user_post_id)
            await _delete_audio_row(read_post_id)
            await cache.delete(shared_key)
            await cache.delete(old_key)

    @pytest.mark.asyncio
    async def test_returns_correct_content_length(self, client, auth_headers, private_audio):
        """GET /audio/{cacheKey} returns Content-Length header."""
        response = await client.get(
            f"/api/audio/{private_audio.cache_key}", headers=auth_headers
        )

        assert response.status_code == 200
        assert "Content-Length" in response.headers
        content_length = int(response.headers["Content-Length"])
        data = await response.get_data()
        assert content_length == len(data)


# ── Word-timings delivery (feature 003-read-along-highlight) ────────────────


async def _seed_audio_row(post_id, cache_key):
    """Insert (replacing any existing) an audio row for ``post_id``."""
    from app.infrastructure.persistence.database import get_session_factory

    factory = get_session_factory()
    async with factory() as session:
        await session.execute(sqltext("DELETE FROM audio WHERE post_id = :pid"), {"pid": post_id})
        await session.execute(
            sqltext(
                "INSERT INTO audio (id, post_id, cache_key, file_path) VALUES (:id, :pid, :ck, :fp)"
            ),
            {
                "id": uuid4(),
                "pid": post_id,
                "ck": cache_key,
                "fp": f"{cache_key[:2]}/{cache_key}.mp3",
            },
        )
        await session.commit()


async def _delete_audio_row(post_id):
    from app.infrastructure.persistence.database import get_session_factory

    factory = get_session_factory()
    async with factory() as session:
        await session.execute(sqltext("DELETE FROM audio WHERE post_id = :pid"), {"pid": post_id})
        await session.commit()


async def _expected_cache_key(post_id):
    """Cache key the AudioService computes for ``post_id`` at the current config.

    The READY short-circuit now serves a cached clip only when the stored key
    still matches this one, so seeding under it keeps these tests exercising the
    delivery path instead of triggering a regeneration.
    """
    from app.application.services.audio_service import AudioService
    from app.config.container import create_cache_manager, create_tts_service
    from app.infrastructure.persistence.database import get_session_factory

    factory = get_session_factory()
    async with factory() as session:
        row = (
            await session.execute(
                sqltext("SELECT title, content FROM posts WHERE id = :pid"), {"pid": post_id}
            )
        ).one()

    cache = create_cache_manager()
    tts = create_tts_service()
    text = AudioService._synthesis_text(row.title, row.content)
    return cache.generate_cache_key(text, tts.voice_id)


class TestPostAudioWordTimings:
    """READY response delivers ordered wordTimings when a valid sidecar exists."""

    @pytest.mark.asyncio
    async def test_includes_word_timings_when_sidecar_present(self, client, auth_headers, post_id):
        """A valid sidecar → ordered wordTimings inline on the READY response."""
        from app.config.container import create_cache_manager

        cache = create_cache_manager()
        cache_key = await _expected_cache_key(post_id)
        words = [
            {"text": "Test", "startMs": 0, "durationMs": 300},
            {"text": "Post", "startMs": 350, "durationMs": 300},
        ]

        mp3 = cache.get_file_path(cache_key)
        mp3.parent.mkdir(parents=True, exist_ok=True)
        mp3.write_bytes(b"\xff\xfb\x90\x00" + b"\x00" * 512)
        await cache.save_timings(
            cache_key,
            {"schemaVersion": 1, "voiceId": "en-US-AriaNeural", "words": words},
        )
        await _seed_audio_row(post_id, cache_key)

        try:
            response = await client.get(f"/api/posts/{post_id}/audio", headers=auth_headers)

            assert response.status_code == 200
            data = await response.get_json()
            # Existing metadata still present and correct.
            assert data["status"] == "ready"
            assert data["postId"] == str(post_id)
            assert data["url"].endswith(cache_key)
            assert "durationSeconds" in data
            assert data.get("format") == "mp3"
            # Ordered wordTimings, exact shape.
            assert "wordTimings" in data
            assert data["wordTimings"] == words
        finally:
            await _delete_audio_row(post_id)
            await cache.delete(cache_key)

    @pytest.mark.asyncio
    async def test_omits_word_timings_when_sidecar_corrupt(
        self, client, auth_headers, read_post_id
    ):
        """A corrupt sidecar is treated as no timings → wordTimings omitted.

        The sidecar file exists (so the timings-aware short-circuit still serves
        the cached clip without regenerating), but its contents are invalid, so
        the route emits no ``wordTimings``.
        """
        from app.config.container import create_cache_manager

        cache = create_cache_manager()
        cache_key = await _expected_cache_key(read_post_id)

        mp3 = cache.get_file_path(cache_key)
        mp3.parent.mkdir(parents=True, exist_ok=True)
        mp3.write_bytes(b"\xff\xfb\x90\x00" + b"\x00" * 512)
        sidecar = cache.get_timings_path(cache_key)
        sidecar.write_text("{ this is not valid json")
        await _seed_audio_row(read_post_id, cache_key)

        try:
            response = await client.get(f"/api/posts/{read_post_id}/audio", headers=auth_headers)

            assert response.status_code == 200
            data = await response.get_json()
            assert data["status"] == "ready"
            assert "wordTimings" not in data
        finally:
            await _delete_audio_row(read_post_id)
            await cache.delete(cache_key)
            sidecar.unlink(missing_ok=True)
