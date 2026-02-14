"""Contract tests for audio/TTS endpoints.

Tests verify the API contract defined in openapi.yaml for:
- GET /posts/{id}/audio - Get or generate audio for a post
- GET /audio/{cacheKey} - Stream audio file
"""

import pytest
from uuid import uuid4


class TestGetPostAudio:
    """Contract tests for GET /posts/{postId}/audio endpoint."""

    @pytest.mark.asyncio
    async def test_returns_audio_ready_when_cached(
        self, client, authenticated_session, test_post_with_audio
    ):
        """GET /posts/{id}/audio returns 200 with audio URL when cached."""
        async with client.session_transaction() as sess:
            sess.update(authenticated_session)

        response = await client.get(f"/api/posts/{test_post_with_audio.id}/audio")
        
        assert response.status_code == 200
        data = await response.get_json()
        assert data["status"] == "ready"
        assert "url" in data
        assert data["postId"] == str(test_post_with_audio.id)
        assert "durationSeconds" in data

    @pytest.mark.asyncio
    async def test_returns_202_when_generating(
        self, client, authenticated_session, test_post
    ):
        """GET /posts/{id}/audio returns 202 when audio is being generated."""
        async with client.session_transaction() as sess:
            sess.update(authenticated_session)

        response = await client.get(f"/api/posts/{test_post.id}/audio")
        
        # First request triggers generation
        assert response.status_code in (200, 202)
        data = await response.get_json()
        
        if response.status_code == 202:
            assert data["status"] == "generating"
            assert "estimatedSeconds" in data
            assert data["postId"] == str(test_post.id)

    @pytest.mark.asyncio
    async def test_requires_authentication(self, client, test_post):
        """GET /posts/{id}/audio returns 401 without auth."""
        response = await client.get(f"/api/posts/{test_post.id}/audio")
        
        assert response.status_code == 401

    @pytest.mark.asyncio
    async def test_returns_404_for_nonexistent_post(
        self, client, authenticated_session
    ):
        """GET /posts/{id}/audio returns 404 for non-existent post."""
        async with client.session_transaction() as sess:
            sess.update(authenticated_session)

        response = await client.get(f"/api/posts/{uuid4()}/audio")
        
        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_returns_404_for_other_users_post(
        self, client, authenticated_session, other_user_post
    ):
        """GET /posts/{id}/audio returns 404 for post from another user's feed."""
        async with client.session_transaction() as sess:
            sess.update(authenticated_session)

        response = await client.get(f"/api/posts/{other_user_post.id}/audio")
        
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
            f"/api/audio/{test_audio.cache_key}",
            headers={"Range": "bytes=0-1023"}
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
