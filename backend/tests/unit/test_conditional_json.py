"""Unit tests for the ETag / conditional-GET helper."""

import pytest

from app.api.middleware.conditional import conditional_json


@pytest.mark.asyncio
async def test_returns_200_with_strong_etag_and_cache_control(app):
    async def build():
        return [{"id": "a", "n": 1}]

    async with app.test_request_context("/x", method="GET"):
        resp = await conditional_json(build)

    assert resp.status_code == 200
    etag = resp.headers.get("ETag")
    assert etag and etag.startswith('"') and etag.endswith('"')
    assert resp.headers.get("Cache-Control") == "private, no-cache"
    assert await resp.get_data() != b""


@pytest.mark.asyncio
async def test_returns_304_when_if_none_match_matches(app):
    async def build():
        return {"a": 1, "b": [1, 2, 3]}

    async with app.test_request_context("/x", method="GET"):
        first = await conditional_json(build)
        etag = first.headers["ETag"]

    async with app.test_request_context(
        "/x", method="GET", headers={"If-None-Match": etag}
    ):
        second = await conditional_json(build)

    assert second.status_code == 304
    assert second.headers["ETag"] == etag
    assert second.headers["Cache-Control"] == "private, no-cache"
    assert await second.get_data() == b""


@pytest.mark.asyncio
async def test_etag_is_stable_for_same_body_and_changes_with_body(app):
    async def build_a():
        return [{"id": "a"}]

    async def build_b():
        return [{"id": "b"}]

    async with app.test_request_context("/x", method="GET"):
        a1 = await conditional_json(build_a)
    async with app.test_request_context("/x", method="GET"):
        a2 = await conditional_json(build_a)
    async with app.test_request_context("/x", method="GET"):
        b1 = await conditional_json(build_b)

    assert a1.headers["ETag"] == a2.headers["ETag"]
    assert a1.headers["ETag"] != b1.headers["ETag"]


@pytest.mark.asyncio
async def test_etag_ignores_dict_key_order(app):
    async def build_1():
        return {"x": 1, "y": 2}

    async def build_2():
        return {"y": 2, "x": 1}

    async with app.test_request_context("/x", method="GET"):
        r1 = await conditional_json(build_1)
    async with app.test_request_context("/x", method="GET"):
        r2 = await conditional_json(build_2)

    assert r1.headers["ETag"] == r2.headers["ETag"]  # canonical (sorted keys)
