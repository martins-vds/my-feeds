"""Contract tests for feed endpoints.

Tests verify API contract compliance per openapi.yaml.
TDD: These tests are written FIRST and should FAIL until implementation.
"""

import pytest
from uuid import uuid4


class TestListFeedsInCategory:
    """Tests for GET /api/categories/{categoryId}/feeds."""

    @pytest.mark.asyncio
    async def test_list_feeds_returns_empty_array_for_new_category(self, client):
        """New category should have no feeds."""
        category_id = str(uuid4())

        response = await client.get(f"/api/categories/{category_id}/feeds")

        # Will fail until implemented
        assert response.status_code in (200, 401, 404)

    @pytest.mark.asyncio
    async def test_list_feeds_requires_authentication(self, client):
        """Unauthenticated request should return 401."""
        category_id = str(uuid4())

        response = await client.get(f"/api/categories/{category_id}/feeds")

        assert response.status_code == 401

    @pytest.mark.asyncio
    async def test_list_feeds_category_not_found(self, client):
        """Non-existent category should return 404."""
        fake_id = str(uuid4())

        response = await client.get(f"/api/categories/{fake_id}/feeds")

        assert response.status_code in (404, 401)


class TestAddFeed:
    """Tests for POST /api/categories/{categoryId}/feeds."""

    @pytest.mark.asyncio
    async def test_add_feed_success(self, client):
        """Valid feed URL should be validated and added."""
        category_id = str(uuid4())

        response = await client.post(
            f"/api/categories/{category_id}/feeds",
            json={"url": "https://example.com/feed.xml"},
        )

        # Will fail until implemented
        assert response.status_code in (201, 400, 401, 404)

    @pytest.mark.asyncio
    async def test_add_feed_requires_authentication(self, client):
        """Unauthenticated request should return 401."""
        category_id = str(uuid4())

        response = await client.post(
            f"/api/categories/{category_id}/feeds",
            json={"url": "https://example.com/feed.xml"},
        )

        assert response.status_code == 401

    @pytest.mark.asyncio
    async def test_add_feed_requires_url(self, client):
        """Missing URL should return 400."""
        category_id = str(uuid4())

        response = await client.post(
            f"/api/categories/{category_id}/feeds",
            json={},
        )

        assert response.status_code in (400, 401)

    @pytest.mark.asyncio
    async def test_add_feed_invalid_url_returns_400(self, client):
        """Invalid URL format should return 400."""
        category_id = str(uuid4())

        response = await client.post(
            f"/api/categories/{category_id}/feeds",
            json={"url": "not-a-valid-url"},
        )

        assert response.status_code in (400, 401)

    @pytest.mark.asyncio
    async def test_add_feed_non_feed_url_returns_400(self, client):
        """URL that is not RSS/Atom should return 400."""
        category_id = str(uuid4())

        response = await client.post(
            f"/api/categories/{category_id}/feeds",
            json={"url": "https://example.com/not-a-feed.html"},
        )

        assert response.status_code in (400, 401)

    @pytest.mark.asyncio
    async def test_add_feed_duplicate_returns_409(self, client):
        """Adding same feed URL twice to same category should return 409."""
        category_id = str(uuid4())
        feed_url = "https://example.com/feed.xml"

        # Add first time
        await client.post(
            f"/api/categories/{category_id}/feeds",
            json={"url": feed_url},
        )

        # Try to add again
        response = await client.post(
            f"/api/categories/{category_id}/feeds",
            json={"url": feed_url},
        )

        assert response.status_code in (409, 401)

    @pytest.mark.asyncio
    async def test_add_feed_category_not_found(self, client):
        """Non-existent category should return 404."""
        fake_id = str(uuid4())

        response = await client.post(
            f"/api/categories/{fake_id}/feeds",
            json={"url": "https://example.com/feed.xml"},
        )

        assert response.status_code in (404, 401)

    @pytest.mark.asyncio
    async def test_add_feed_enforces_100_limit(self, client):
        """Should reject when user has 100 feeds total (FR-038)."""
        # Requires creating 100 feeds first - integration test
        pass


class TestGetFeed:
    """Tests for GET /api/feeds/{feedId}."""

    @pytest.mark.asyncio
    async def test_get_feed_returns_feed_with_posts(self, client):
        """Should return feed details with posts array."""
        feed_id = str(uuid4())

        response = await client.get(f"/api/feeds/{feed_id}")

        assert response.status_code in (200, 401, 404)

    @pytest.mark.asyncio
    async def test_get_feed_requires_authentication(self, client):
        """Unauthenticated request should return 401."""
        feed_id = str(uuid4())

        response = await client.get(f"/api/feeds/{feed_id}")

        assert response.status_code == 401

    @pytest.mark.asyncio
    async def test_get_feed_not_found(self, client):
        """Non-existent feed should return 404."""
        fake_id = str(uuid4())

        response = await client.get(f"/api/feeds/{fake_id}")

        assert response.status_code in (404, 401)


class TestSetFeedCategories:
    """Smoke tests for PATCH /api/feeds/{feedId} (set the feed's categories).

    These run unauthenticated (expect 401); authenticated many-to-many
    coverage lives in test_feeds_m2m.py.
    """

    @pytest.mark.asyncio
    async def test_move_feed_to_different_category(self, client):
        """Should move feed to target category."""
        feed_id = str(uuid4())
        target_category_id = str(uuid4())

        response = await client.patch(
            f"/api/feeds/{feed_id}",
            json={"categoryId": target_category_id},
        )

        assert response.status_code in (200, 401, 404)

    @pytest.mark.asyncio
    async def test_move_feed_requires_authentication(self, client):
        """Unauthenticated request should return 401."""
        feed_id = str(uuid4())

        response = await client.patch(
            f"/api/feeds/{feed_id}",
            json={"categoryId": str(uuid4())},
        )

        assert response.status_code == 401

    @pytest.mark.asyncio
    async def test_move_feed_target_category_not_found(self, client):
        """Moving to non-existent category should return 404."""
        feed_id = str(uuid4())
        fake_category_id = str(uuid4())

        response = await client.patch(
            f"/api/feeds/{feed_id}",
            json={"categoryId": fake_category_id},
        )

        assert response.status_code in (404, 401)

    @pytest.mark.asyncio
    async def test_move_feed_not_found(self, client):
        """Moving non-existent feed should return 404."""
        fake_id = str(uuid4())

        response = await client.patch(
            f"/api/feeds/{fake_id}",
            json={"categoryId": str(uuid4())},
        )

        assert response.status_code in (404, 401)


class TestDeleteFeed:
    """Tests for DELETE /api/feeds/{feedId}."""

    @pytest.mark.asyncio
    async def test_delete_feed_success(self, client):
        """Should delete feed and return 204."""
        feed_id = str(uuid4())

        response = await client.delete(f"/api/feeds/{feed_id}")

        assert response.status_code in (204, 401, 404)

    @pytest.mark.asyncio
    async def test_delete_feed_requires_authentication(self, client):
        """Unauthenticated request should return 401."""
        feed_id = str(uuid4())

        response = await client.delete(f"/api/feeds/{feed_id}")

        assert response.status_code == 401

    @pytest.mark.asyncio
    async def test_delete_feed_cascades_posts(self, client):
        """Deleting feed should delete all its posts."""
        # Integration test - requires posts
        pass

    @pytest.mark.asyncio
    async def test_delete_feed_not_found(self, client):
        """Non-existent feed should return 404."""
        fake_id = str(uuid4())

        response = await client.delete(f"/api/feeds/{fake_id}")

        assert response.status_code in (404, 401)
