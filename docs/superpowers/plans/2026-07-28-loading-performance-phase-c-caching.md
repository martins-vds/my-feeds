# Loading Performance — Phase C (Response Caching) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the reader's read endpoints cheap to re-fetch — attach strong ETags so unchanged responses return `304 Not Modified` (no re-transfer), and add a small in-memory per-user output cache for the rarely-changing category/feed lists, invalidated on writes.

**Architecture:** A dependency-free API-layer helper `conditional_json(build_body)` serializes the JSON body, computes a strong `sha256` ETag, sets `Cache-Control: private, no-cache`, and returns `304` when the request's `If-None-Match` matches. A separate `cached_conditional_json(user_id, key, build_body)` additionally serves `(etag, body)` from an async-safe TTL `ResponseCache` (infrastructure) for `/categories`, `/categories/{id}/feeds`, and `/feeds?uncategorized=true`; writes call `invalidate_user`. No Redis, no new dependencies (stdlib `hashlib`, `json`, `asyncio`).

**Tech Stack:** Python 3.12, Quart, SQLAlchemy async, pytest.

## Recommended scope (read before executing)

The two increments are independently shippable:

- **Tasks 1–2 — ETag / conditional-GET (recommended core).** Highest value: every read endpoint returns a `304` (empty body) when unchanged, saving transfer + client parse on initial load, background polling, and multi-tab. No invalidation logic (the body-hash ETag changes automatically). Ship this first.
- **Tasks 3–4 — in-memory body cache (optional).** Saves the DB query + serialization on cache hits (≤60 s TTL) for the three category/feed endpoints. **Marginal for this deployment:** Phase B already caches `feedsByCategory` client-side, so intra-session refetches are largely gone; the body cache mainly helps cold reloads / multi-tab within the TTL window, and it adds per-user invalidation and a single-process constraint. Include it only if you want the server-side output cache from the design; otherwise stop after Task 2.

Each phase leaves the suite green. The controller may choose to execute Tasks 1–2 only.

## Global Constraints

- **Test-first (Constitution Principle III):** write the failing test, run it red, implement to green. Commit after each task.
- **DDD layering:** the cache is infrastructure (`app/infrastructure/http/`); the API helper (`app/api/middleware/`) may import it; the domain must not. No domain changes.
- **No new dependencies.** stdlib `hashlib`, `json`, `asyncio`, `time` + existing Quart.
- **Single-process assumption (documented):** the in-memory cache is per-process; a short TTL bounds staleness and writes invalidate promptly. Multi-worker would move this to Redis — out of scope, noted in the module docstring.
- **Backend tests:** `docker compose exec -T backend pytest -q -p no:warnings`
- **Single test file:** `docker compose exec -T backend pytest <path> -q -p no:warnings`
- **ETag format:** strong validator `'"' + sha256(canonical_json_bytes).hexdigest()[:16] + '"'`, where canonical bytes = `json.dumps(body, sort_keys=True, separators=(",", ":"), default=str).encode()`. `Cache-Control: private, no-cache` on every 200 and 304.

---

## File Structure

- Create: `backend/app/api/middleware/conditional.py` — `conditional_json` (Task 1) + `cached_conditional_json` (Task 4) + private helpers.
- Create: `backend/app/infrastructure/http/__init__.py`, `backend/app/infrastructure/http/response_cache.py` — `ResponseCache`, `get_response_cache`, `reset_response_cache` (Task 3).
- Modify (Task 2): `backend/app/api/routes/categories.py` (`list_categories`), `backend/app/api/routes/feeds.py` (`list_all_feeds`, `list_feeds_in_category`), `backend/app/api/routes/posts.py` (`list_posts`, `unread_counts`).
- Modify (Task 4): the three category/feed read routes (swap to `cached_conditional_json`) + write sites in `categories.py` and `feeds.py` (invalidation) + `backend/tests/contract/conftest.py` (reset fixture).
- Tests: `backend/tests/unit/test_conditional_json.py` (Task 1), `backend/tests/contract/test_caching.py` (Tasks 2 & 4), `backend/tests/unit/test_response_cache.py` (Task 3).

---

## Task 1: ETag helper `conditional_json`

**Files:**
- Create: `backend/app/api/middleware/conditional.py`
- Test: `backend/tests/unit/test_conditional_json.py`

**Interfaces:**
- Produces: `async conditional_json(build_body: Callable[[], Awaitable[Any]]) -> quart.Response` — awaits `build_body()` to get a JSON-serializable object, attaches a strong ETag + `Cache-Control: private, no-cache`, returns `200` with the canonical JSON body or `304` (empty) when `If-None-Match` matches. Also exports private `_strong_etag`, `_canonical`, `_not_modified`, and constant `CACHE_CONTROL` (used by Task 4).

- [ ] **Step 1: Write the failing unit tests**

Create `backend/tests/unit/test_conditional_json.py`:

```python
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `docker compose exec -T backend pytest tests/unit/test_conditional_json.py -q -p no:warnings`
Expected: FAIL with `ModuleNotFoundError: app.api.middleware.conditional`.

- [ ] **Step 3: Implement the helper**

Create `backend/app/api/middleware/conditional.py`:

```python
"""Conditional-GET (ETag) helpers for JSON read endpoints.

`conditional_json` attaches a strong ETag to a freshly-built JSON body and
returns 304 Not Modified when the caller's If-None-Match already matches, so
unchanged responses are not re-transferred. `Cache-Control: private, no-cache`
means the browser stores the representation but always revalidates.
"""

import hashlib
import json
from typing import Any, Awaitable, Callable

from quart import Response, request

CACHE_CONTROL = "private, no-cache"


def _canonical(body: Any) -> bytes:
    """Deterministic JSON bytes (sorted keys, compact) for stable hashing."""
    return json.dumps(body, sort_keys=True, separators=(",", ":"), default=str).encode()


def _strong_etag(payload: bytes) -> str:
    return '"' + hashlib.sha256(payload).hexdigest()[:16] + '"'


def _json_response(payload: bytes, etag: str) -> Response:
    resp = Response(payload, status=200, content_type="application/json")
    resp.headers["ETag"] = etag
    resp.headers["Cache-Control"] = CACHE_CONTROL
    return resp


def _not_modified(etag: str) -> Response:
    resp = Response(b"", status=304)
    resp.headers["ETag"] = etag
    resp.headers["Cache-Control"] = CACHE_CONTROL
    return resp


async def conditional_json(build_body: Callable[[], Awaitable[Any]]) -> Response:
    """Build a JSON body, attach a strong ETag, and 304 when If-None-Match matches.

    Args:
        build_body: async callable returning a JSON-serializable object.

    Returns:
        A 200 response with the canonical JSON body + ETag, or a 304 with an
        empty body when the request's If-None-Match equals the current ETag.
    """
    body = await build_body()
    payload = _canonical(body)
    etag = _strong_etag(payload)
    if request.headers.get("If-None-Match") == etag:
        return _not_modified(etag)
    return _json_response(payload, etag)
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `docker compose exec -T backend pytest tests/unit/test_conditional_json.py -q -p no:warnings`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/app/api/middleware/conditional.py backend/tests/unit/test_conditional_json.py
git commit -m "feat(cache): add conditional_json ETag/304 helper"
```

---

## Task 2: Wire ETag into the five read endpoints

**Files:**
- Modify: `backend/app/api/routes/categories.py` (`list_categories`)
- Modify: `backend/app/api/routes/feeds.py` (`list_all_feeds`, `list_feeds_in_category`)
- Modify: `backend/app/api/routes/posts.py` (`list_posts`, `unread_counts`)
- Test: `backend/tests/contract/test_caching.py` (new)

**Interfaces:**
- Consumes: `conditional_json` (Task 1). Each route builds its body inside an inner `async def build()` and returns `await conditional_json(build)`; existing error branches (404s) are preserved by keeping the `try/except` around the call.

- [ ] **Step 1: Write the failing contract tests**

Create `backend/tests/contract/test_caching.py`:

```python
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `docker compose exec -T backend pytest tests/contract/test_caching.py -q -p no:warnings`
Expected: FAIL (no `ETag` header yet).

- [ ] **Step 3: Wire `list_categories`**

In `backend/app/api/routes/categories.py`, add the import near the top:

```python
from app.api.middleware.conditional import conditional_json
```

Replace the `list_categories` body:

```python
@bp.route("", methods=["GET"])
async def list_categories():
    """List all categories for the authenticated user.

    GET /api/categories

    Returns:
        JSON array of categories ordered by position
    """
    user_id = get_current_user_id()
    container = get_request_container()

    async def build():
        categories = await container.category_service.list_categories(user_id)
        return [cat.to_dict() for cat in categories]

    return await conditional_json(build)
```

- [ ] **Step 4: Wire `list_all_feeds` and `list_feeds_in_category`**

In `backend/app/api/routes/feeds.py`, add near the top:

```python
from app.api.middleware.conditional import conditional_json
```

Replace `list_all_feeds`:

```python
@bp.route("/feeds", methods=["GET"])
async def list_all_feeds():
    """List the current user's feeds, each with its categories.

    GET /api/feeds
    GET /api/feeds?uncategorized=true  -> only feeds that have no category
    """
    user_id = get_current_user_id()
    container = get_request_container()
    uncategorized = request.args.get("uncategorized") == "true"

    async def build():
        if uncategorized:
            feeds = await container.feed_service.list_uncategorized_feeds(user_id)
        else:
            feeds = await container.feed_service.list_all_feeds(user_id)
        return [feed.to_dict() for feed in feeds]

    return await conditional_json(build)
```

Replace `list_feeds_in_category` (keep the 404 branches by wrapping the call):

```python
@bp.route("/categories/<uuid:category_id>/feeds", methods=["GET"])
async def list_feeds_in_category(category_id: UUID):
    """List all feeds in a category.

    GET /api/categories/{categoryId}/feeds
    """
    user_id = get_current_user_id()
    container = get_request_container()

    async def build():
        feeds = await container.feed_service.list_feeds_in_category(user_id, category_id)
        return [feed.to_dict() for feed in feeds]

    try:
        return await conditional_json(build)
    except CategoryNotFoundError:
        return jsonify({"error": "not_found", "message": "Category not found"}), 404
    except FeedPermissionError:
        return jsonify({"error": "not_found", "message": "Category not found"}), 404
```

- [ ] **Step 5: Wire `list_posts` and `unread_counts`**

In `backend/app/api/routes/posts.py`, add near the top:

```python
from app.api.middleware.conditional import conditional_json
```

In `list_posts`, replace the final `return jsonify({...})` (the block that builds `posts`/`hasMore`/`nextCursor`) with a `conditional_json` wrapper. The parameter parsing above it is unchanged; only the result construction changes:

```python
    async def build():
        result = await container.post_service.list_posts(
            user_id=user_id,
            category_id=category_id,
            feed_id=feed_id,
            read_state=read_state,  # type: ignore
            before=before,
            limit=limit,
            uncategorized=uncategorized,
        )
        return {
            "posts": [post.to_summary_dict() for post in result.posts],
            "hasMore": result.has_more,
            "nextCursor": result.next_cursor,
        }

    return await conditional_json(build)
```

Replace `unread_counts`:

```python
@bp.route("/unread-counts", methods=["GET"])
async def unread_counts():
    """Return unread post counts per feed, per category, uncategorized, and total.

    GET /api/posts/unread-counts
    """
    user_id = get_current_user_id()
    container = get_request_container()

    async def build():
        counts = await container.post_service.get_unread_counts(user_id)
        return {
            "byFeed": {str(fid): c for fid, c in counts.by_feed.items()},
            "byCategory": {str(cid): c for cid, c in counts.by_category.items()},
            "uncategorized": counts.uncategorized,
            "total": counts.total,
        }

    return await conditional_json(build)
```

- [ ] **Step 6: Run the contract tests + the full backend suite**

Run: `docker compose exec -T backend pytest tests/contract/test_caching.py -q -p no:warnings`
Expected: PASS.

Run: `docker compose exec -T backend pytest -q -p no:warnings`
Expected: PASS (existing tests still pass — they read bodies via `get_json`, which is unaffected by the canonical serialization; 200 responses are unchanged JSON semantically).

- [ ] **Step 7: Commit**

```bash
git add backend/app/api/routes/categories.py backend/app/api/routes/feeds.py \
        backend/app/api/routes/posts.py backend/tests/contract/test_caching.py
git commit -m "feat(cache): ETag + 304 on category/feed/post read endpoints"
```

> **Stopping point:** Tasks 1–2 deliver the recommended ETag core. If you are not adding the in-memory body cache, stop here — the suite is green and the feature is complete.

---

## Task 3: `ResponseCache` infrastructure (in-memory TTL store)

**Files:**
- Create: `backend/app/infrastructure/http/__init__.py` (empty package marker)
- Create: `backend/app/infrastructure/http/response_cache.py`
- Test: `backend/tests/unit/test_response_cache.py`

**Interfaces:**
- Produces: `ResponseCache(ttl_seconds: float = 60.0)` with `async get(user_id, key) -> tuple[str, bytes] | None`, `async set(user_id, key, etag, body)`, `async invalidate_user(user_id)`; module singleton `get_response_cache() -> ResponseCache` and `reset_response_cache() -> None` (test isolation).

- [ ] **Step 1: Write the failing unit tests**

Create `backend/tests/unit/test_response_cache.py`:

```python
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `docker compose exec -T backend pytest tests/unit/test_response_cache.py -q -p no:warnings`
Expected: FAIL with `ModuleNotFoundError: app.infrastructure.http.response_cache`.

- [ ] **Step 3: Create the package + implement the cache**

Create `backend/app/infrastructure/http/__init__.py`:

```python
"""HTTP infrastructure (response caching)."""
```

Create `backend/app/infrastructure/http/response_cache.py`:

```python
"""In-memory, per-user TTL cache for rarely-changing JSON responses.

Single-process only: entries live in this worker's memory. A short TTL bounds
staleness from any missed invalidation, and writes call ``invalidate_user`` for
promptness. A multi-worker / multi-instance deployment would replace this with
a shared store (e.g. Redis) — out of scope here.
"""

import asyncio
import time
from dataclasses import dataclass
from uuid import UUID


@dataclass
class _Entry:
    etag: str
    body: bytes
    expires_at: float


class ResponseCache:
    """Async-safe per-user store of ``(etag, serialized body)`` with a TTL."""

    def __init__(self, ttl_seconds: float = 60.0) -> None:
        self._ttl = ttl_seconds
        self._store: dict[UUID, dict[str, _Entry]] = {}
        self._lock = asyncio.Lock()

    async def get(self, user_id: UUID, key: str) -> tuple[str, bytes] | None:
        """Return ``(etag, body)`` for a live entry, else None (evicting if expired)."""
        async with self._lock:
            entries = self._store.get(user_id)
            if not entries:
                return None
            entry = entries.get(key)
            if entry is None:
                return None
            if entry.expires_at <= time.monotonic():
                del entries[key]
                return None
            return entry.etag, entry.body

    async def set(self, user_id: UUID, key: str, etag: str, body: bytes) -> None:
        """Store ``(etag, body)`` for ``(user_id, key)`` with a fresh TTL."""
        async with self._lock:
            self._store.setdefault(user_id, {})[key] = _Entry(
                etag=etag, body=body, expires_at=time.monotonic() + self._ttl
            )

    async def invalidate_user(self, user_id: UUID) -> None:
        """Drop every cached entry for a user (called on that user's writes)."""
        async with self._lock:
            self._store.pop(user_id, None)


_cache: ResponseCache | None = None


def get_response_cache() -> ResponseCache:
    """Return the process-wide ResponseCache singleton."""
    global _cache
    if _cache is None:
        _cache = ResponseCache()
    return _cache


def reset_response_cache() -> None:
    """Discard the singleton (used for test isolation)."""
    global _cache
    _cache = None
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `docker compose exec -T backend pytest tests/unit/test_response_cache.py -q -p no:warnings`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/app/infrastructure/http/ backend/tests/unit/test_response_cache.py
git commit -m "feat(cache): add in-memory per-user TTL ResponseCache"
```

---

## Task 4: Body-cache the category/feed reads + invalidate on writes

**Files:**
- Modify: `backend/app/api/middleware/conditional.py` (add `cached_conditional_json`)
- Modify: `backend/app/api/routes/categories.py` (`list_categories` → cached; invalidate in `create_category`, `update_category`, `delete_category`)
- Modify: `backend/app/api/routes/feeds.py` (`list_feeds_in_category` + `list_all_feeds` uncategorized branch → cached; invalidate in `add_feed`, `create_feed`, `update_feed`, `delete_feed`)
- Modify: `backend/tests/contract/conftest.py` (autouse cache-reset fixture)
- Test: `backend/tests/contract/test_caching.py` (add invalidation tests)

**Interfaces:**
- Consumes: `ResponseCache`/`get_response_cache` (Task 3); `_canonical`/`_strong_etag`/`_json_response`/`_not_modified`/`CACHE_CONTROL` (Task 1).
- Produces: `async cached_conditional_json(user_id: UUID, cache_key: str, build_body) -> Response` — serves `(etag, body)` from the per-user cache on hit, else builds + stores, then applies the same 304 logic. Cache keys: `"categories"`, `f"category-feeds:{category_id}"`, `"feeds:uncategorized"`.

- [ ] **Step 1: Write the failing invalidation contract tests**

Append to `backend/tests/contract/test_caching.py`:

```python
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
```

- [ ] **Step 2: Add the autouse cache-reset fixture (test isolation)**

In `backend/tests/contract/conftest.py`, add near the other autouse fixtures:

```python
@pytest.fixture(autouse=True)
async def _reset_response_cache():
    """Clear the process-wide response cache between contract tests so a body
    cached in one test can't leak into the next."""
    from app.infrastructure.http.response_cache import reset_response_cache

    reset_response_cache()
    yield
    reset_response_cache()
```

- [ ] **Step 3: Run the new tests to verify they fail**

Run: `docker compose exec -T backend pytest tests/contract/test_caching.py::TestBodyCacheInvalidation -q -p no:warnings`
Expected: FAIL — without invalidation the create wouldn't be reflected in a still-cached body / the etag wouldn't change. (If it happens to pass because caching isn't wired yet, that's fine; Step 4-6 wire the cache and the test then guards invalidation.)

- [ ] **Step 4: Add `cached_conditional_json`**

In `backend/app/api/middleware/conditional.py`, add the import and the function:

```python
from uuid import UUID

from app.infrastructure.http.response_cache import get_response_cache
```

```python
async def cached_conditional_json(
    user_id: UUID, cache_key: str, build_body: Callable[[], Awaitable[Any]]
) -> Response:
    """Like conditional_json, but serve (etag, body) from a per-user TTL cache.

    On a hit the stored bytes are returned without rebuilding; on a miss the
    body is built, serialized, hashed, and stored. The 304 logic is identical.
    """
    cache = get_response_cache()
    cached = await cache.get(user_id, cache_key)
    if cached is not None:
        etag, payload = cached
    else:
        body = await build_body()
        payload = _canonical(body)
        etag = _strong_etag(payload)
        await cache.set(user_id, cache_key, etag, payload)

    if request.headers.get("If-None-Match") == etag:
        return _not_modified(etag)
    return _json_response(payload, etag)
```

- [ ] **Step 5: Switch the three category/feed reads to the cached helper**

In `backend/app/api/routes/categories.py`, change the import and `list_categories`:

```python
from app.api.middleware.conditional import cached_conditional_json
```

```python
    return await cached_conditional_json(user_id, "categories", build)
```

In `backend/app/api/routes/feeds.py`, change the import to include both helpers:

```python
from app.api.middleware.conditional import cached_conditional_json, conditional_json
```

In `list_feeds_in_category`, use the cached helper (still inside the try):

```python
    try:
        return await cached_conditional_json(user_id, f"category-feeds:{category_id}", build)
    except CategoryNotFoundError:
        return jsonify({"error": "not_found", "message": "Category not found"}), 404
    except FeedPermissionError:
        return jsonify({"error": "not_found", "message": "Category not found"}), 404
```

In `list_all_feeds`, body-cache only the uncategorized variant (ETag-only for the full list):

```python
    if uncategorized:
        return await cached_conditional_json(user_id, "feeds:uncategorized", build)
    return await conditional_json(build)
```

- [ ] **Step 6: Invalidate on writes**

In `backend/app/api/routes/categories.py`, add the import:

```python
from app.infrastructure.http.response_cache import get_response_cache
```

After each successful mutation, invalidate that user before returning:

- In `create_category`, after `category = await container.category_service.create_category(...)`:
  ```python
        await get_response_cache().invalidate_user(user_id)
        return jsonify(category.to_dict()), 201
  ```
- In `update_category`, after the successful `category = await container.category_service.update_category(...)`:
  ```python
        await get_response_cache().invalidate_user(user_id)
        return jsonify(category.to_dict())
  ```
- In `delete_category`, after `await container.category_service.delete_category(...)`:
  ```python
        await get_response_cache().invalidate_user(user_id)
        return "", 204
  ```

In `backend/app/api/routes/feeds.py`, add the import:

```python
from app.infrastructure.http.response_cache import get_response_cache
```

Invalidate after each successful feed mutation (the routes that change the feed list or its metadata): `add_feed` (after `await container.session.commit()`), `create_feed` (after its `commit()`), `update_feed` (after the `set_feed_categories`/`set_feed_active` call, before returning), and `delete_feed` (after `await container.feed_service.delete_feed(...)`). In each, insert:

```python
        await get_response_cache().invalidate_user(user_id)
```

(For `add_feed`/`create_feed`, place it immediately after the existing `await container.session.commit()` and before `current_app.add_background_task(...)`. For `update_feed`, immediately before `return jsonify(feed.to_dict())`. For `delete_feed`, immediately before `return "", 204`.)

> **Ordering note (documented):** invalidation runs after the service mutation within the write request; for the routes that don't explicitly commit, the teardown commit lands just after. In a single-process, single-user deployment requests are effectively sequential, so a concurrent read re-caching pre-commit data is not reachable; the 60 s TTL is the backstop for any edge case. This matches the design's "TTL as a safety net plus explicit invalidation on writes."

- [ ] **Step 7: Run the caching tests + full backend suite**

Run: `docker compose exec -T backend pytest tests/contract/test_caching.py tests/unit/test_response_cache.py tests/unit/test_conditional_json.py -q -p no:warnings`
Expected: PASS.

Run: `docker compose exec -T backend pytest -q -p no:warnings`
Expected: PASS (the autouse reset fixture keeps cached bodies from leaking across contract tests).

- [ ] **Step 8: Commit**

```bash
git add backend/app/api/middleware/conditional.py \
        backend/app/api/routes/categories.py backend/app/api/routes/feeds.py \
        backend/tests/contract/conftest.py backend/tests/contract/test_caching.py
git commit -m "feat(cache): per-user body cache for category/feed reads with write invalidation"
```

---

## Self-Review

**1. Spec coverage (design Phase C):**
- HTTP conditional caching (ETag) on `/categories`, `/categories/{id}/feeds`, `/feeds?uncategorized=true`, `/posts`, `/posts/unread-counts` → Tasks 1–2. ✔
- `conditional_json(build_body)` API-layer helper → Task 1. ✔
- Strong `sha256` ETag + `Cache-Control: private, no-cache` + `If-None-Match`→304 → Task 1. ✔
- In-memory `ResponseCache` (async-safe TTL, `dict` keyed per user, `asyncio.Lock`, ~60 s) for categories + per-category/uncategorized feeds only → Tasks 3–4. ✔
- Posts + unread-counts are ETag-only (not body-cached) → Task 2 uses `conditional_json` for those; Task 4 only body-caches the three feed/category reads. ✔
- Invalidation on category/feed writes → Task 4. ✔ (per-user flush — simpler and strictly safe vs. the design's targeted invalidation; documented.)
- No new deps, stdlib only, infrastructure layer, documented single-process assumption → Global Constraints + Task 3 docstring. ✔

**2. Placeholder scan:** every step has literal code; no TODO/"handle edge cases"/"similar to". ✔

**3. Type consistency:** `conditional_json(build_body)` and `cached_conditional_json(user_id, cache_key, build_body)` signatures match between Task 1/4 definitions and the route call sites. `_canonical`/`_strong_etag`/`_json_response`/`_not_modified`/`CACHE_CONTROL` are defined in Task 1 and reused by Task 4. `ResponseCache.get/set/invalidate_user` and `get_response_cache`/`reset_response_cache` match between Task 3 and Task 4's usage + the conftest fixture. Cache keys (`"categories"`, `f"category-feeds:{category_id}"`, `"feeds:uncategorized"`) are the only three body-cached keys and align with the per-user flush invalidation. ✔

**Deliberate deviation from the design:** invalidation is a per-user flush (`invalidate_user`) rather than targeted per-key eviction — it is simpler, cannot under-invalidate, and the re-cache cost on the next read is trivial. Recorded here so a reviewer expecting targeted eviction understands the choice.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-07-28-loading-performance-phase-c-caching.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?** (And: **all four tasks**, or the **ETag core only, Tasks 1–2**?)
