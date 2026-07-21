"""Contract tests for the feed <-> category many-to-many behavior.

These run authenticated against the seeded fixtures and exercise the new
user-owned, many-to-many API surface (feeds carry a ``categoryIds`` list).
"""

from uuid import uuid4

import pytest


class TestFeedResponsesIncludeCategories:
    """Feed responses expose the many-to-many ``categoryIds`` list."""

    @pytest.mark.asyncio
    async def test_list_all_feeds_requires_auth(self, client):
        response = await client.get("/api/feeds")
        assert response.status_code == 401

    @pytest.mark.asyncio
    async def test_list_all_feeds_includes_category_ids(
        self, client, auth_headers, feed_id, category_id
    ):
        response = await client.get("/api/feeds", headers=auth_headers)
        assert response.status_code == 200
        feeds = await response.get_json()
        assert isinstance(feeds, list)
        feed = next((f for f in feeds if f["id"] == str(feed_id)), None)
        assert feed is not None, "seeded feed should be in the user's feed list"
        assert isinstance(feed["categoryIds"], list)
        assert str(category_id) in feed["categoryIds"]

    @pytest.mark.asyncio
    async def test_get_feed_includes_category_ids(self, client, auth_headers, feed_id, category_id):
        response = await client.get(f"/api/feeds/{feed_id}", headers=auth_headers)
        assert response.status_code == 200
        body = await response.get_json()
        assert str(category_id) in body["categoryIds"]

    @pytest.mark.asyncio
    async def test_list_feeds_in_category_includes_feed(
        self, client, auth_headers, category_id, feed_id
    ):
        response = await client.get(f"/api/categories/{category_id}/feeds", headers=auth_headers)
        assert response.status_code == 200
        feeds = await response.get_json()
        assert any(f["id"] == str(feed_id) for f in feeds)


class TestSetFeedCategoriesAuthenticated:
    """PATCH /api/feeds/{feedId} sets the categories assigned to a feed."""

    @pytest.mark.asyncio
    async def test_missing_category_ids_returns_400(self, client, auth_headers, feed_id):
        response = await client.patch(
            f"/api/feeds/{feed_id}", json={"nope": 1}, headers=auth_headers
        )
        assert response.status_code == 400

    @pytest.mark.asyncio
    async def test_set_categories_updates_feed(self, client, auth_headers, feed_id, category_id):
        # Idempotent: re-assign the seeded association so sibling tests are
        # unaffected by ordering.
        response = await client.patch(
            f"/api/feeds/{feed_id}",
            json={"categoryIds": [str(category_id)]},
            headers=auth_headers,
        )
        assert response.status_code == 200
        body = await response.get_json()
        assert body["categoryIds"] == [str(category_id)]

    @pytest.mark.asyncio
    async def test_set_categories_rejects_foreign_category(self, client, auth_headers, feed_id):
        """Assigning a category the user doesn't own should 404 (no mutation)."""
        response = await client.patch(
            f"/api/feeds/{feed_id}",
            json={"categoryIds": [str(uuid4())]},
            headers=auth_headers,
        )
        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_set_categories_feed_not_found(self, client, auth_headers):
        response = await client.patch(
            f"/api/feeds/{uuid4()}",
            json={"categoryIds": []},
            headers=auth_headers,
        )
        assert response.status_code == 404


class TestSetFeedActiveAuthenticated:
    """PATCH /api/feeds/{feedId} pauses/resumes scheduled ingestion."""

    @pytest.mark.asyncio
    async def test_pause_then_resume_feed(self, client, auth_headers, feed_id):
        # Pausing keeps the feed but flips isActive to false.
        paused = await client.patch(
            f"/api/feeds/{feed_id}",
            json={"isActive": False},
            headers=auth_headers,
        )
        assert paused.status_code == 200
        assert (await paused.get_json())["isActive"] is False

        # Restore to active so sibling tests see the seeded state.
        resumed = await client.patch(
            f"/api/feeds/{feed_id}",
            json={"isActive": True},
            headers=auth_headers,
        )
        assert resumed.status_code == 200
        assert (await resumed.get_json())["isActive"] is True

    @pytest.mark.asyncio
    async def test_is_active_must_be_boolean(self, client, auth_headers, feed_id):
        response = await client.patch(
            f"/api/feeds/{feed_id}",
            json={"isActive": "yes"},
            headers=auth_headers,
        )
        assert response.status_code == 400

    @pytest.mark.asyncio
    async def test_refresh_blocked_while_paused(self, client, auth_headers, feed_id):
        # Pausing a feed blocks manual refresh until it is resumed.
        paused = await client.patch(
            f"/api/feeds/{feed_id}",
            json={"isActive": False},
            headers=auth_headers,
        )
        assert paused.status_code == 200

        refresh = await client.post(f"/api/feeds/{feed_id}/refresh", headers=auth_headers)
        assert refresh.status_code == 409
        assert (await refresh.get_json())["error"] == "feed_paused"

        # Restore to active so sibling tests see the seeded state.
        resumed = await client.patch(
            f"/api/feeds/{feed_id}",
            json={"isActive": True},
            headers=auth_headers,
        )
        assert resumed.status_code == 200

    @pytest.mark.asyncio
    async def test_set_active_feed_not_found(self, client, auth_headers):
        response = await client.patch(
            f"/api/feeds/{uuid4()}",
            json={"isActive": False},
            headers=auth_headers,
        )
        assert response.status_code == 404
