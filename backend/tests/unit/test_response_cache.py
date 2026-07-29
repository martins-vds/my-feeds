"""Unit tests for the in-memory per-user TTL ResponseCache."""

from uuid import uuid4

import pytest

from app.infrastructure.http.response_cache import (
    ResponseCache,
    get_response_cache,
    reset_response_cache,
)


@pytest.mark.asyncio
async def test_hit_returns_stored_etag_and_body():
    cache = ResponseCache(ttl_seconds=60.0)
    uid = uuid4()
    await cache.set(uid, "categories", '"e1"', b'[{"id":"a"}]')
    assert await cache.get(uid, "categories") == ('"e1"', b'[{"id":"a"}]')


@pytest.mark.asyncio
async def test_miss_returns_none():
    cache = ResponseCache(ttl_seconds=60.0)
    assert await cache.get(uuid4(), "nope") is None


@pytest.mark.asyncio
async def test_expired_entry_is_evicted():
    cache = ResponseCache(ttl_seconds=-1.0)  # already expired on set
    uid = uuid4()
    await cache.set(uid, "k", '"e"', b"body")
    assert await cache.get(uid, "k") is None


@pytest.mark.asyncio
async def test_invalidate_user_clears_only_that_user():
    cache = ResponseCache(ttl_seconds=60.0)
    uid, other = uuid4(), uuid4()
    await cache.set(uid, "a", '"1"', b"a")
    await cache.set(uid, "b", '"2"', b"b")
    await cache.set(other, "a", '"3"', b"c")

    await cache.invalidate_user(uid)

    assert await cache.get(uid, "a") is None
    assert await cache.get(uid, "b") is None
    assert await cache.get(other, "a") == ('"3"', b"c")


@pytest.mark.asyncio
async def test_singleton_and_reset():
    reset_response_cache()
    c1 = get_response_cache()
    c2 = get_response_cache()
    assert c1 is c2
    reset_response_cache()
    assert get_response_cache() is not c1
