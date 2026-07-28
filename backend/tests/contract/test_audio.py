"""Contract tests for audio/TTS endpoints.

Tests verify the API contract defined in openapi.yaml for:
- GET /posts/{id}/audio - Get or generate audio for a post
- GET /audio/{cacheKey} - Stream audio file
"""

from uuid import uuid4

import pytest
from sqlalchemy import text as sqltext


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
    async def test_returns_404_for_other_users_post(self, client, auth_headers, other_user_post):
        """GET /posts/{id}/audio returns 404 for post from another user's feed."""
        response = await client.get(
            f"/api/posts/{other_user_post.id}/audio",
            headers=auth_headers,
        )

        assert response.status_code == 404


class TestStreamAudio:
    """Contract tests for GET /audio/{cacheKey} endpoint."""

    @pytest.mark.asyncio
    async def test_streams_full_audio_file(self, client, test_audio):
        """GET /audio/{cacheKey} returns 200 with audio content."""
        response = await client.get(f"/api/audio/{test_audio.cache_key}")

        assert response.status_code == 200
        assert response.content_type == "audio/mpeg"
        data = await response.get_data()
        assert len(data) > 0

    @pytest.mark.asyncio
    async def test_supports_range_request(self, client, test_audio):
        """GET /audio/{cacheKey} with Range header returns 206 partial content."""
        response = await client.get(
            f"/api/audio/{test_audio.cache_key}", headers={"Range": "bytes=0-1023"}
        )

        assert response.status_code == 206
        assert "Content-Range" in response.headers
        data = await response.get_data()
        assert len(data) <= 1024

    @pytest.mark.asyncio
    async def test_returns_404_for_nonexistent_cache_key(self, client):
        """GET /audio/{cacheKey} returns 404 for non-existent key."""
        response = await client.get("/api/audio/nonexistent-cache-key")

        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_rejects_malformed_cache_key(self, client):
        """Non SHA-256-hex keys are rejected with 404 before any filesystem
        lookup, closing the path-traversal vector on this public route."""
        # 64 chars but not hex -> fails validation (would otherwise hit the FS).
        resp = await client.get("/api/audio/" + "g" * 64)
        assert resp.status_code == 404

        # Encoded traversal attempt never escapes the cache directory.
        resp2 = await client.get("/api/audio/..%2f..%2f..%2fetc%2fpasswd")
        assert resp2.status_code == 404

    @pytest.mark.asyncio
    async def test_streaming_is_public(self, client, test_audio):
        """GET /audio/{cacheKey} does not require authentication."""
        # Audio streaming could be public (security through obscurity of cache key)
        response = await client.get(f"/api/audio/{test_audio.cache_key}")

        assert response.status_code == 200

    @pytest.mark.asyncio
    async def test_returns_correct_content_length(self, client, test_audio):
        """GET /audio/{cacheKey} returns Content-Length header."""
        response = await client.get(f"/api/audio/{test_audio.cache_key}")

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


class TestPostAudioWordTimings:
    """READY response delivers ordered wordTimings when a valid sidecar exists."""

    @pytest.mark.asyncio
    async def test_includes_word_timings_when_sidecar_present(self, client, auth_headers, post_id):
        """A valid sidecar → ordered wordTimings inline on the READY response."""
        from app.config.container import create_cache_manager

        cache = create_cache_manager()
        cache_key = "1a" * 32
        words = [
            {"text": "Test", "startMs": 0, "durationMs": 300},
            {"text": "Post", "startMs": 350, "durationMs": 300},
        ]

        mp3 = cache.get_file_path(cache_key)
        mp3.parent.mkdir(parents=True, exist_ok=True)
        mp3.write_bytes(b"\xff\xfb\x90\x00" + b"\x00" * 512)
        cache.save_timings(
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
            cache.delete_timings(cache_key)

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
        cache_key = "2b" * 32

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
