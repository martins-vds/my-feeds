"""Contract tests for ETag / conditional-GET on read endpoints."""

import pytest


READ_ENDPOINTS = [
    "/api/categories",
    "/api/feeds",
    "/api/feeds?uncategorized=true",
    "/api/posts",
    "/api/posts/unread-counts",
]


class TestETagOnReads:
    @pytest.mark.asyncio
    @pytest.mark.parametrize("path", READ_ENDPOINTS)
    async def test_get_returns_strong_etag_and_cache_control(self, client, auth_headers, path):
        resp = await client.get(path, headers=auth_headers)
        assert resp.status_code == 200
        etag = resp.headers.get("ETag")
        assert etag and etag.startswith('"') and etag.endswith('"')
        assert resp.headers.get("Cache-Control") == "private, no-store"

    @pytest.mark.asyncio
    @pytest.mark.parametrize("path", READ_ENDPOINTS)
    async def test_matching_if_none_match_returns_304(self, client, auth_headers, path):
        first = await client.get(path, headers=auth_headers)
        etag = first.headers["ETag"]

        second = await client.get(
            path, headers={**auth_headers, "If-None-Match": etag}
        )
        assert second.status_code == 304
        assert second.headers["ETag"] == etag
        assert (await second.get_data()) == b""

    @pytest.mark.asyncio
    async def test_category_feeds_endpoint_has_etag(self, client, auth_headers, feed_id, category_id):
        resp = await client.get(f"/api/categories/{category_id}/feeds", headers=auth_headers)
        assert resp.status_code == 200
        assert resp.headers.get("ETag")
        second = await client.get(
            f"/api/categories/{category_id}/feeds",
            headers={**auth_headers, "If-None-Match": resp.headers["ETag"]},
        )
        assert second.status_code == 304


class TestBodyCacheInvalidation:
    @pytest.mark.asyncio
    async def test_creating_a_category_changes_the_categories_etag(self, client, auth_headers):
        first = await client.get("/api/categories", headers=auth_headers)
        etag1 = first.headers["ETag"]

        created = await client.post(
            "/api/categories", headers=auth_headers, json={"name": "Cache Test Cat"}
        )
        assert created.status_code == 201

        second = await client.get("/api/categories", headers=auth_headers)
        # A conditional GET with the OLD etag must NOT 304 (cache was invalidated
        # and the list changed).
        revalidate = await client.get(
            "/api/categories", headers={**auth_headers, "If-None-Match": etag1}
        )
        assert revalidate.status_code == 200
        assert second.headers["ETag"] != etag1
        names = [c["name"] for c in await second.get_json()]
        assert "Cache Test Cat" in names

    @pytest.mark.asyncio
    async def test_unchanged_categories_still_304(self, client, auth_headers):
        first = await client.get("/api/categories", headers=auth_headers)
        etag = first.headers["ETag"]
        again = await client.get(
            "/api/categories", headers={**auth_headers, "If-None-Match": etag}
        )
        assert again.status_code == 304


class TestUpdateFeedAtomicValidation:
    @pytest.mark.asyncio
    async def test_bad_isactive_with_valid_categories_does_not_mutate(
        self, client, auth_headers, feed_id, category_id
    ):
        """A combined PATCH with valid categoryIds + a non-bool isActive must 400
        WITHOUT applying the category change — no partial mutation, so the
        category-feeds cache cannot be left stale."""
        resp = await client.patch(
            f"/api/feeds/{feed_id}",
            headers=auth_headers,
            json={"categoryIds": [], "isActive": "not-a-bool"},
        )
        assert resp.status_code == 400

        after = await client.get(f"/api/feeds/{feed_id}", headers=auth_headers)
        body = await after.get_json()
        assert body["categoryIds"] == [str(category_id)]  # unchanged
