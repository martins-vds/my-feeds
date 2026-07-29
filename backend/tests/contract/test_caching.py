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
        assert resp.headers.get("Cache-Control") == "private, no-cache"

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
