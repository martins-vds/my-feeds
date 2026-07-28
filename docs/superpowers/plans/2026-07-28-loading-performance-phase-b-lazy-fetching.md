# Loading Performance — Phase B (Lazy Hierarchical Fetching) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop fetching every feed on reader load — fetch categories (shallow) plus uncategorized feeds on mount, and load a category's feeds only when it is expanded, with a skeleton while they load and unread badges sourced from the backend.

**Architecture:** The backend gains a per-category/uncategorized unread aggregate on `GET /posts/unread-counts` and an `?uncategorized=true` filter on `GET /feeds`. The frontend `useFeedsData` hook changes from eager (all categories + all feeds) to lazy: categories + uncategorized feeds on mount, and each category's feeds via the existing `GET /api/categories/{id}/feeds` on first expand, cached in a `feedsByCategory` map. The sidebar renders a `FeedRowsSkeleton` while a category's feeds load and takes collapsed-category unread badges from `unread.byCategory`.

**Tech Stack:** Backend — Python 3.12, Quart, SQLAlchemy async, pytest. Frontend — React 18, TypeScript (strict), MUI 5, Vitest + Testing Library, Playwright.

## Global Constraints

- **Test-first (Constitution Principle III):** for every task, write the failing test, run it to confirm it fails, then implement to green. Commit after each task.
- **DDD layering:** repository *interfaces* live in `app/domain/**/repositories/`; *implementations* in `app/infrastructure/persistence/repositories/`. The domain must not import infrastructure.
- **No new dependencies.** Backend uses stdlib + existing SQLAlchemy. Frontend uses existing React/MUI.
- **Backend tests:** `docker compose exec -T backend pytest -q -p no:warnings`
- **Frontend unit tests:** `docker compose exec -T frontend pnpm test`
- **Frontend typecheck:** `docker compose exec -T frontend pnpm exec tsc --noEmit -p tsconfig.json`
- **Single Vitest file:** `docker compose exec -T frontend pnpm exec vitest run <path>`
- **E2E:** `docker compose exec -T frontend sh -lc 'npx playwright test <spec> --reporter=line'`
- **Frontend test conventions:** `src/test/setup.ts` loads `@testing-library/jest-dom/vitest`, so `toBeInTheDocument()` etc. are available. New skeleton components follow the Phase A pattern: a container with `role="status"`, `aria-busy="true"`, `aria-label`, and a `data-testid`; skeleton tests assert via plain DOM (`getAttribute`, `querySelectorAll(...).length` / `toHaveLength`).
- **Design deviation (intentional, applies to Tasks 3, 6, 8):** uncategorized feeds are fetched **once on mount** (via `GET /feeds?uncategorized=true`), not lazily on expand. This keeps the sidebar's empty-state and the "Uncategorized" feed-count correct without adding a new count endpoint. Category feeds — the bulk — remain truly lazy, which is the actual performance win (the old code fetched *all* feeds across *all* categories on mount).

---

## File Structure

**Backend**
- `app/domain/feed_management/repositories/post_repository.py` — add abstract `get_unread_counts_by_category` (Task 1).
- `app/infrastructure/persistence/repositories/post_repository.py` — implement it (Task 1).
- `app/application/services/post_service.py` — `UnreadCounts` dataclass + reshape `get_unread_counts` (Task 2).
- `app/api/routes/posts.py` — emit `byCategory` + `uncategorized` (Task 2).
- `app/domain/feed_management/repositories/feed_repository.py` — add abstract `get_uncategorized` (Task 3).
- `app/infrastructure/persistence/repositories/feed_repository.py` — implement it (Task 3).
- `app/application/services/feed_service.py` — `list_uncategorized_feeds` (Task 3).
- `app/api/routes/feeds.py` — `?uncategorized=true` filter (Task 3).

**Frontend**
- `src/types/index.ts` — extend `UnreadCounts` (Task 4).
- `src/hooks/useUnreadCounts.ts` — map new fields (Task 4).
- `src/components/skeletons/FeedRowsSkeleton.tsx` — new (Task 5).
- `src/hooks/useFeedsData.ts` — lazy refactor + export `UNCATEGORIZED_KEY` (Task 6).
- `src/components/CategoryList.tsx`, `src/components/FeedSidebar.tsx`, `src/pages/posts/ReaderPage.tsx` — cutover to lazy props (Task 7).
- `playwright/fixtures.ts` + a new `playwright/lazy-feeds.spec.ts` — E2E (Task 8).

---

## Task 1: Backend — per-category unread counts (repository)

**Files:**
- Modify: `backend/app/domain/feed_management/repositories/post_repository.py` (add abstract method after `get_unread_counts_by_feed`, ~line 169)
- Modify: `backend/app/infrastructure/persistence/repositories/post_repository.py` (add method after `get_unread_counts_by_feed`, ~line 243)
- Test: `backend/tests/integration/test_unread_counts_by_category.py` (new)

**Interfaces:**
- Produces: `PostRepository.get_unread_counts_by_category(user_id: UUID) -> tuple[dict[UUID, int], int]` returning `(by_category, uncategorized)`. A feed in multiple categories contributes its unread count to each; `uncategorized` is the unread total across feeds with no category.

- [ ] **Step 1: Write the failing integration test**

Create `backend/tests/integration/test_unread_counts_by_category.py`:

```python
"""Integration tests for per-category unread counts (repository layer)."""

from datetime import datetime, timezone
from uuid import uuid4

import pytest
from sqlalchemy import text

from app.domain.feed_management.entities.category import Category
from app.domain.feed_management.entities.feed import Feed
from app.domain.feed_management.entities.post import Post
from app.infrastructure.persistence.database import get_session_factory
from app.infrastructure.persistence.repositories.category_repository import (
    SQLAlchemyCategoryRepository,
)
from app.infrastructure.persistence.repositories.feed_repository import (
    SQLAlchemyFeedRepository,
)
from app.infrastructure.persistence.repositories.post_repository import (
    SQLAlchemyPostRepository,
)


@pytest.fixture
async def user_id():
    """Create an isolated user; deleting it cascades to feeds/posts/categories."""
    uid = uuid4()
    factory = get_session_factory()
    async with factory() as session:
        await session.execute(
            text(
                "INSERT INTO users (id, provider, provider_id, email, name, "
                "timezone, notifications_enabled) "
                "VALUES (:id, 'github', :pid, :email, 'Unread Tester', 'UTC', false)"
            ),
            {"id": uid, "pid": f"unread-{uid}", "email": f"{uid}@example.com"},
        )
        await session.commit()
    yield uid
    async with factory() as session:
        await session.execute(text("DELETE FROM users WHERE id = :id"), {"id": uid})
        await session.commit()


def _post(feed_id, guid):
    return Post.create(
        feed_id=feed_id,
        guid=guid,
        title=f"Post {guid}",
        link=f"https://example.com/{guid}",
        published_at=datetime.now(timezone.utc),
    )


class TestUnreadCountsByCategory:
    @pytest.mark.asyncio
    async def test_counts_group_by_category_and_uncategorized(self, user_id):
        factory = get_session_factory()
        async with factory() as session:
            cats = SQLAlchemyCategoryRepository(session)
            feeds = SQLAlchemyFeedRepository(session)
            posts = SQLAlchemyPostRepository(session)

            c1 = await cats.save(Category.create(user_id=user_id, name="Tech", position=1))
            c2 = await cats.save(Category.create(user_id=user_id, name="News", position=2))
            await session.commit()

            # f1 in c1 & c2 (shared), f2 in c1 only, f3 uncategorized
            f1 = await feeds.save(
                Feed.create(user_id=user_id, url="https://a/f", category_ids=[c1.id, c2.id])
            )
            f2 = await feeds.save(
                Feed.create(user_id=user_id, url="https://b/f", category_ids=[c1.id])
            )
            f3 = await feeds.save(Feed.create(user_id=user_id, url="https://c/f"))
            await session.commit()

            # f1: 2 posts (1 later marked read → unread 1); f2: 1 unread; f3: 3 unread
            await posts.save(_post(f1.id, "f1a"))
            p1b = await posts.save(_post(f1.id, "f1b"))
            await posts.save(_post(f2.id, "f2a"))
            await posts.save(_post(f3.id, "f3a"))
            await posts.save(_post(f3.id, "f3b"))
            await posts.save(_post(f3.id, "f3c"))
            await session.commit()

            await posts.mark_as_read(user_id, p1b.id, True)
            await session.commit()

            by_category, uncategorized = await posts.get_unread_counts_by_category(user_id)

            assert by_category[c1.id] == 2   # f1(1) + f2(1)
            assert by_category[c2.id] == 1   # f1(1)
            assert uncategorized == 3        # f3(3)
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `docker compose exec -T backend pytest tests/integration/test_unread_counts_by_category.py -q -p no:warnings`
Expected: FAIL with `AttributeError: ... has no attribute 'get_unread_counts_by_category'`.

- [ ] **Step 3: Add the abstract method to the domain interface**

In `backend/app/domain/feed_management/repositories/post_repository.py`, immediately after the abstract `get_unread_counts_by_feed` (near line 169), add:

```python
    @abstractmethod
    async def get_unread_counts_by_category(
        self, user_id: UUID
    ) -> tuple[dict[UUID, int], int]:
        """Get unread post counts grouped by category, plus an uncategorized total.

        A feed in several categories contributes its unread count to each of
        them. The second tuple element is the unread count across feeds that
        have no category at all.

        Returns:
            Tuple of (mapping category_id -> unread count, uncategorized count).
        """
        ...
```

- [ ] **Step 4: Implement it in the SQLAlchemy repository**

In `backend/app/infrastructure/persistence/repositories/post_repository.py`, after the `get_unread_counts_by_feed` method (which ends near line 243), add. (`select`, `func`, `exists`, `FeedModel`, `UserPostModel`, `PostModel`, and `feed_categories` are already imported at the top of this file.)

```python
    async def get_unread_counts_by_category(
        self, user_id: UUID
    ) -> tuple[dict[UUID, int], int]:
        """Get unread post counts grouped by category, plus an uncategorized total."""
        # Per-category: posts -> feeds -> feed_categories, count unread per category.
        by_cat_stmt = (
            select(feed_categories.c.category_id, func.count(PostModel.id))
            .select_from(PostModel)
            .join(FeedModel, PostModel.feed_id == FeedModel.id)
            .join(feed_categories, feed_categories.c.feed_id == FeedModel.id)
            .outerjoin(
                UserPostModel,
                (UserPostModel.post_id == PostModel.id) & (UserPostModel.user_id == user_id),
            )
            .where(
                FeedModel.user_id == user_id,
                (UserPostModel.id.is_(None)) | (UserPostModel.is_read.is_(False)),
            )
            .group_by(feed_categories.c.category_id)
        )
        by_cat_result = await self._session.execute(by_cat_stmt)
        by_category = {row[0]: row[1] for row in by_cat_result.all()}

        # Uncategorized: unread posts from feeds with no category rows.
        uncat_stmt = (
            select(func.count(PostModel.id))
            .select_from(PostModel)
            .join(FeedModel, PostModel.feed_id == FeedModel.id)
            .outerjoin(
                UserPostModel,
                (UserPostModel.post_id == PostModel.id) & (UserPostModel.user_id == user_id),
            )
            .where(
                FeedModel.user_id == user_id,
                ~exists().where(feed_categories.c.feed_id == FeedModel.id),
                (UserPostModel.id.is_(None)) | (UserPostModel.is_read.is_(False)),
            )
        )
        uncat_result = await self._session.execute(uncat_stmt)
        uncategorized = uncat_result.scalar_one() or 0
        return by_category, uncategorized
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `docker compose exec -T backend pytest tests/integration/test_unread_counts_by_category.py -q -p no:warnings`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/app/domain/feed_management/repositories/post_repository.py \
        backend/app/infrastructure/persistence/repositories/post_repository.py \
        backend/tests/integration/test_unread_counts_by_category.py
git commit -m "feat(unread): repository per-category + uncategorized unread counts"
```

---

## Task 2: Backend — reshape `GET /posts/unread-counts`

**Files:**
- Modify: `backend/app/application/services/post_service.py` (add `UnreadCounts` dataclass; reshape `get_unread_counts`, ~line 189)
- Modify: `backend/app/api/routes/posts.py` (`unread_counts` handler, ~line 118-133)
- Test: `backend/tests/unit/test_post_service.py` (update `TestPostServiceUnreadCounts`, ~line 407-447)
- Test: `backend/tests/contract/test_posts.py` (update `test_unread_counts_shape`, ~line 316)

**Interfaces:**
- Consumes: `PostRepository.get_unread_counts_by_category` (Task 1).
- Produces: `post_service.UnreadCounts` dataclass with fields `by_feed: dict[UUID, int]`, `by_category: dict[UUID, int]`, `uncategorized: int`, `total: int`; `PostService.get_unread_counts(user_id) -> UnreadCounts`. Route JSON: `{ "byFeed": {...}, "byCategory": {...}, "uncategorized": int, "total": int }`.

- [ ] **Step 1: Update the unit + contract tests (they now assert the new shape → fail)**

In `backend/tests/unit/test_post_service.py`, replace the two tests in `TestPostServiceUnreadCounts`:

```python
    @pytest.mark.asyncio
    async def test_get_unread_counts_sums_total(self):
        """Returns per-feed / per-category maps, uncategorized, and summed total."""
        from app.application.services.post_service import PostService

        f1, f2, c1 = uuid4(), uuid4(), uuid4()
        post_repo = AsyncMock()
        post_repo.get_unread_counts_by_feed.return_value = {f1: 2, f2: 3}
        post_repo.get_unread_counts_by_category.return_value = ({c1: 4}, 1)

        service = PostService(
            post_repository=post_repo,
            category_repository=AsyncMock(),
            feed_repository=AsyncMock(),
        )

        counts = await service.get_unread_counts(uuid4())

        assert counts.by_feed == {f1: 2, f2: 3}
        assert counts.by_category == {c1: 4}
        assert counts.uncategorized == 1
        assert counts.total == 5

    @pytest.mark.asyncio
    async def test_get_unread_counts_empty(self):
        """With no unread posts every field is empty/zero."""
        from app.application.services.post_service import PostService

        post_repo = AsyncMock()
        post_repo.get_unread_counts_by_feed.return_value = {}
        post_repo.get_unread_counts_by_category.return_value = ({}, 0)

        service = PostService(
            post_repository=post_repo,
            category_repository=AsyncMock(),
            feed_repository=AsyncMock(),
        )

        counts = await service.get_unread_counts(uuid4())

        assert counts.by_feed == {}
        assert counts.by_category == {}
        assert counts.uncategorized == 0
        assert counts.total == 0
```

In `backend/tests/contract/test_posts.py`, replace the body of `test_unread_counts_shape`:

```python
    @pytest.mark.asyncio
    async def test_unread_counts_shape(self, client, auth_headers):
        """Returns byFeed/byCategory maps, an uncategorized int, and a summed total."""
        response = await client.get("/api/posts/unread-counts", headers=auth_headers)

        assert response.status_code == 200
        data = await response.get_json()
        assert isinstance(data["byFeed"], dict)
        assert isinstance(data["byCategory"], dict)
        assert isinstance(data["uncategorized"], int)
        assert isinstance(data["total"], int)
        assert data["total"] == sum(data["byFeed"].values())
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `docker compose exec -T backend pytest tests/unit/test_post_service.py::TestPostServiceUnreadCounts tests/contract/test_posts.py::TestUnreadCounts::test_unread_counts_shape -q -p no:warnings`
Expected: FAIL (`get_unread_counts` returns a 2-tuple / response has no `byCategory`).

- [ ] **Step 3: Add the `UnreadCounts` dataclass and reshape the service method**

In `backend/app/application/services/post_service.py`, the file already imports `from dataclasses import dataclass`. Add this dataclass next to `PostListResult` (after its definition, ~line 36):

```python
@dataclass
class UnreadCounts:
    """Unread post counts for a user, grouped for the sidebar."""

    by_feed: dict[UUID, int]
    by_category: dict[UUID, int]
    uncategorized: int
    total: int
```

Replace the existing `get_unread_counts` method (~line 189):

```python
    async def get_unread_counts(self, user_id: UUID) -> UnreadCounts:
        """Get unread post counts (per feed, per category, uncategorized, total).

        Args:
            user_id: User UUID

        Returns:
            UnreadCounts with by_feed / by_category maps, an uncategorized count,
            and the overall total (the sum of the per-feed counts).
        """
        by_feed = await self._post_repository.get_unread_counts_by_feed(user_id)
        by_category, uncategorized = await self._post_repository.get_unread_counts_by_category(
            user_id
        )
        total = sum(by_feed.values())
        return UnreadCounts(
            by_feed=by_feed,
            by_category=by_category,
            uncategorized=uncategorized,
            total=total,
        )
```

- [ ] **Step 4: Reshape the route handler**

In `backend/app/api/routes/posts.py`, replace the body of `unread_counts` (~line 118-133):

```python
@bp.route("/unread-counts", methods=["GET"])
async def unread_counts():
    """Return unread post counts per feed, per category, uncategorized, and total.

    GET /api/posts/unread-counts

    Returns:
        JSON: {
            "byFeed": { "<feedId>": <count> },
            "byCategory": { "<categoryId>": <count> },
            "uncategorized": <count>,
            "total": <count>
        }
    """
    user_id = get_current_user_id()
    container = get_request_container()

    counts = await container.post_service.get_unread_counts(user_id)

    return jsonify(
        {
            "byFeed": {str(fid): c for fid, c in counts.by_feed.items()},
            "byCategory": {str(cid): c for cid, c in counts.by_category.items()},
            "uncategorized": counts.uncategorized,
            "total": counts.total,
        }
    )
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `docker compose exec -T backend pytest tests/unit/test_post_service.py::TestPostServiceUnreadCounts tests/contract/test_posts.py::TestUnreadCounts -q -p no:warnings`
Expected: PASS.

- [ ] **Step 6: Run the full backend suite (guard against other callers)**

Run: `docker compose exec -T backend pytest -q -p no:warnings`
Expected: PASS (only the route consumed the old tuple).

- [ ] **Step 7: Commit**

```bash
git add backend/app/application/services/post_service.py \
        backend/app/api/routes/posts.py \
        backend/tests/unit/test_post_service.py \
        backend/tests/contract/test_posts.py
git commit -m "feat(unread): return byCategory + uncategorized from unread-counts endpoint"
```

---

## Task 3: Backend — `GET /feeds?uncategorized=true`

**Files:**
- Modify: `backend/app/domain/feed_management/repositories/feed_repository.py` (add abstract `get_uncategorized` after `get_by_user`)
- Modify: `backend/app/infrastructure/persistence/repositories/feed_repository.py` (import `exists`; implement `get_uncategorized` after `get_by_user`, ~line 55)
- Modify: `backend/app/application/services/feed_service.py` (add `list_uncategorized_feeds` after `list_all_feeds`, ~line 100)
- Modify: `backend/app/api/routes/feeds.py` (`list_all_feeds` handler, ~line 117-126)
- Test: `backend/tests/integration/test_feed_categories.py` (add a test to `TestFeedCategoryManyToMany`)
- Test: `backend/tests/contract/test_feeds.py` (add a `GET /feeds` filter test)

**Interfaces:**
- Produces: `FeedRepository.get_uncategorized(user_id: UUID) -> list[Feed]`; `FeedService.list_uncategorized_feeds(user_id: UUID) -> list[Feed]`; `GET /api/feeds?uncategorized=true` returns only feeds with no category (JSON array, same item shape as `GET /api/feeds`).

- [ ] **Step 1: Write the failing repository integration test**

In `backend/tests/integration/test_feed_categories.py`, add to `class TestFeedCategoryManyToMany`:

```python
    @pytest.mark.asyncio
    async def test_get_uncategorized_returns_only_feeds_without_categories(self, user_id):
        factory = get_session_factory()
        async with factory() as session:
            cats = SQLAlchemyCategoryRepository(session)
            feeds = SQLAlchemyFeedRepository(session)

            c1 = await cats.save(Category.create(user_id=user_id, name="Tech", position=1))
            await session.commit()

            categorized = await feeds.save(
                Feed.create(user_id=user_id, url="https://cat.example/feed", category_ids=[c1.id])
            )
            bare = await feeds.save(Feed.create(user_id=user_id, url="https://bare.example/feed"))
            await session.commit()

            uncategorized = await feeds.get_uncategorized(user_id)
            ids = {f.id for f in uncategorized}
            assert bare.id in ids
            assert categorized.id not in ids
```

- [ ] **Step 2: Write the failing contract test**

In `backend/tests/contract/test_feeds.py`, add a class (the `feed_id` fixture seeds a *categorized* feed for the test user, so it must be excluded by the filter):

```python
class TestListAllFeedsUncategorizedFilter:
    """Tests for GET /api/feeds?uncategorized=true."""

    @pytest.mark.asyncio
    async def test_uncategorized_filter_excludes_categorized_feeds(
        self, client, auth_headers, feed_id
    ):
        """The seeded feed is categorized, so it appears unfiltered but not when filtered."""
        all_resp = await client.get("/api/feeds", headers=auth_headers)
        assert all_resp.status_code == 200
        all_ids = {f["id"] for f in await all_resp.get_json()}
        assert str(feed_id) in all_ids

        uncat_resp = await client.get("/api/feeds?uncategorized=true", headers=auth_headers)
        assert uncat_resp.status_code == 200
        uncat = await uncat_resp.get_json()
        assert isinstance(uncat, list)
        assert str(feed_id) not in {f["id"] for f in uncat}

    @pytest.mark.asyncio
    async def test_uncategorized_filter_requires_authentication(self, client):
        response = await client.get("/api/feeds?uncategorized=true")
        assert response.status_code == 401
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `docker compose exec -T backend pytest tests/integration/test_feed_categories.py::TestFeedCategoryManyToMany::test_get_uncategorized_returns_only_feeds_without_categories "tests/contract/test_feeds.py::TestListAllFeedsUncategorizedFilter" -q -p no:warnings`
Expected: FAIL (`get_uncategorized` missing; filtered response still includes the categorized feed).

- [ ] **Step 4: Add the abstract method**

In `backend/app/domain/feed_management/repositories/feed_repository.py`, after the abstract `get_by_user`, add:

```python
    @abstractmethod
    async def get_uncategorized(self, user_id: UUID) -> list[Feed]:
        """Get all feeds owned by a user that have no category labels.

        Args:
            user_id: The user's UUID

        Returns:
            List of the user's feeds that are not in any category
        """
        ...
```

- [ ] **Step 5: Implement it (add the `exists` import)**

In `backend/app/infrastructure/persistence/repositories/feed_repository.py`, change the SQLAlchemy import line to include `exists`:

```python
from sqlalchemy import delete, exists, func, insert, select
```

Then add after `get_by_user` (~line 55):

```python
    async def get_uncategorized(self, user_id: UUID) -> list[Feed]:
        """Get all feeds owned by a user that have no category labels."""
        result = await self._session.execute(
            select(FeedModel)
            .where(
                FeedModel.user_id == user_id,
                ~exists().where(feed_categories.c.feed_id == FeedModel.id),
            )
            .options(selectinload(FeedModel.categories))
            .order_by(FeedModel.created_at)
        )
        models = result.scalars().all()
        return [self._to_entity(model) for model in models]
```

- [ ] **Step 6: Add the service method**

In `backend/app/application/services/feed_service.py`, after `list_all_feeds` (~line 100):

```python
    async def list_uncategorized_feeds(self, user_id: UUID) -> list[Feed]:
        """Get all of the user's feeds that have no category.

        Args:
            user_id: The user's UUID

        Returns:
            List of the user's uncategorized feeds
        """
        return await self._feed_repository.get_uncategorized(user_id)
```

- [ ] **Step 7: Add the route filter**

In `backend/app/api/routes/feeds.py`, replace the `list_all_feeds` handler (~line 117-126):

```python
@bp.route("/feeds", methods=["GET"])
async def list_all_feeds():
    """List the current user's feeds, each with its categories.

    GET /api/feeds
    GET /api/feeds?uncategorized=true  -> only feeds that have no category
    """
    user_id = get_current_user_id()
    container = get_request_container()
    if request.args.get("uncategorized") == "true":
        feeds = await container.feed_service.list_uncategorized_feeds(user_id)
    else:
        feeds = await container.feed_service.list_all_feeds(user_id)
    return jsonify([feed.to_dict() for feed in feeds])
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `docker compose exec -T backend pytest tests/integration/test_feed_categories.py "tests/contract/test_feeds.py::TestListAllFeedsUncategorizedFilter" -q -p no:warnings`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add backend/app/domain/feed_management/repositories/feed_repository.py \
        backend/app/infrastructure/persistence/repositories/feed_repository.py \
        backend/app/application/services/feed_service.py \
        backend/app/api/routes/feeds.py \
        backend/tests/integration/test_feed_categories.py \
        backend/tests/contract/test_feeds.py
git commit -m "feat(feeds): add ?uncategorized=true filter to GET /feeds"
```

---

## Task 4: Frontend — extend `UnreadCounts` type + `useUnreadCounts`

**Files:**
- Modify: `frontend/src/types/index.ts` (`UnreadCounts`, ~line 76-79)
- Modify: `frontend/src/hooks/useUnreadCounts.ts` (whole file)
- Test: `frontend/src/hooks/__tests__/useUnreadCounts.test.ts` (new)

**Interfaces:**
- Produces: `UnreadCounts = { byFeed: Record<string, number>; byCategory: Record<string, number>; uncategorized: number; total: number }`. The hook's returned `unread` always has all four fields populated (empty defaults on error).

- [ ] **Step 1: Write the failing hook test**

Create `frontend/src/hooks/__tests__/useUnreadCounts.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

vi.mock("../../services/api", () => ({
  default: { get: vi.fn() },
}));

import api from "../../services/api";
import { useUnreadCounts } from "../useUnreadCounts";

describe("useUnreadCounts", () => {
  beforeEach(() => vi.clearAllMocks());

  it("exposes byFeed, byCategory, uncategorized and total from the API", async () => {
    vi.mocked(api.get).mockResolvedValue({
      byFeed: { "feed-1": 3 },
      byCategory: { "cat-1": 5 },
      uncategorized: 2,
      total: 3,
    });

    const { result } = renderHook(() => useUnreadCounts());

    await waitFor(() => {
      expect(result.current.unread.total).toBe(3);
    });
    expect(result.current.unread.byFeed).toEqual({ "feed-1": 3 });
    expect(result.current.unread.byCategory).toEqual({ "cat-1": 5 });
    expect(result.current.unread.uncategorized).toBe(2);
  });

  it("falls back to empty counts on error", async () => {
    vi.mocked(api.get).mockRejectedValue(new Error("boom"));

    const { result } = renderHook(() => useUnreadCounts());

    await waitFor(() => {
      expect(api.get).toHaveBeenCalled();
    });
    expect(result.current.unread).toEqual({
      byFeed: {},
      byCategory: {},
      uncategorized: 0,
      total: 0,
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `docker compose exec -T frontend pnpm exec vitest run src/hooks/__tests__/useUnreadCounts.test.ts`
Expected: FAIL (`byCategory`/`uncategorized` undefined).

- [ ] **Step 3: Extend the type**

In `frontend/src/types/index.ts`, replace the `UnreadCounts` interface:

```typescript
/**
 * Unread post counts per feed and per category, an uncategorized total,
 * plus the overall total.
 */
export interface UnreadCounts {
    byFeed: Record<string, number>;
    byCategory: Record<string, number>;
    uncategorized: number;
    total: number;
}
```

- [ ] **Step 4: Update the hook**

Replace `frontend/src/hooks/useUnreadCounts.ts` in full:

```typescript
/**
 * Hook for fetching unread post counts (per feed, per category, uncategorized,
 * and total).
 *
 * Used by the sidebar to render unread badges — including badges for collapsed
 * categories, whose feeds are not loaded, from the per-category totals. Counts
 * are refetched on demand (after a refresh, opening a post, or marking read).
 */

import { useState, useCallback, useEffect } from "react";
import api from "../services/api";
import type { UnreadCounts } from "../types";

const EMPTY: UnreadCounts = { byFeed: {}, byCategory: {}, uncategorized: 0, total: 0 };

export function useUnreadCounts() {
    const [unread, setUnread] = useState<UnreadCounts>(EMPTY);

    const refetchUnread = useCallback(async () => {
        try {
            const data = await api.get<UnreadCounts>("/posts/unread-counts");
            setUnread({
                byFeed: data.byFeed ?? {},
                byCategory: data.byCategory ?? {},
                uncategorized: data.uncategorized ?? 0,
                total: data.total ?? 0,
            });
        } catch {
            // Non-fatal: keep the previous counts rather than clearing badges.
        }
    }, []);

    useEffect(() => {
        refetchUnread();
    }, [refetchUnread]);

    return { unread, refetchUnread };
}

export default useUnreadCounts;
```

- [ ] **Step 5: Run the test + typecheck to verify green**

Run: `docker compose exec -T frontend pnpm exec vitest run src/hooks/__tests__/useUnreadCounts.test.ts && docker compose exec -T frontend pnpm exec tsc --noEmit -p tsconfig.json`
Expected: test PASS; tsc clean.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/types/index.ts frontend/src/hooks/useUnreadCounts.ts \
        frontend/src/hooks/__tests__/useUnreadCounts.test.ts
git commit -m "feat(unread): byCategory + uncategorized in UnreadCounts and hook"
```

---

## Task 5: Frontend — `FeedRowsSkeleton` component

**Files:**
- Create: `frontend/src/components/skeletons/FeedRowsSkeleton.tsx`
- Test: `frontend/src/components/skeletons/__tests__/FeedRowsSkeleton.test.tsx`

**Interfaces:**
- Produces: `FeedRowsSkeleton({ count?: number })` — renders `count` (default 3) feed-row placeholders inside a `role="status"` container with `data-testid="feed-rows-skeleton"`. Rendered under an expanding category while its feeds load (Task 7).

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/skeletons/__tests__/FeedRowsSkeleton.test.tsx`:

```typescript
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { FeedRowsSkeleton } from "../FeedRowsSkeleton";

describe("FeedRowsSkeleton", () => {
    it("renders `count` feed-row placeholders inside a status region", () => {
        render(<FeedRowsSkeleton count={5} />);
        const region = screen.getByTestId("feed-rows-skeleton");
        expect(region.getAttribute("role")).toBe("status");
        expect(region.getAttribute("aria-busy")).toBe("true");
        expect(region.getAttribute("aria-label")).toBe("Loading feeds");
        expect(region.querySelectorAll(".MuiListItem-root")).toHaveLength(5);
    });

    it("defaults to 3 rows", () => {
        render(<FeedRowsSkeleton />);
        expect(
            screen.getByTestId("feed-rows-skeleton").querySelectorAll(".MuiListItem-root")
        ).toHaveLength(3);
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `docker compose exec -T frontend pnpm exec vitest run src/components/skeletons/__tests__/FeedRowsSkeleton.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the component**

Create `frontend/src/components/skeletons/FeedRowsSkeleton.tsx`:

```typescript
import { Box, List, ListItem, ListItemIcon, ListItemText, Skeleton } from "@mui/material";

interface FeedRowsSkeletonProps {
    /** Number of placeholder feed rows. */
    count?: number;
}

/**
 * Content-shaped placeholder rendered beneath a category while its feeds load.
 * Mirrors a FeedList row: a small feed icon and a feed-title line, indented to
 * match the real nested rows.
 */
export function FeedRowsSkeleton({ count = 3 }: FeedRowsSkeletonProps) {
    return (
        <Box
            role="status"
            aria-busy="true"
            aria-label="Loading feeds"
            data-testid="feed-rows-skeleton"
        >
            <List disablePadding sx={{ pl: 4 }}>
                {Array.from({ length: count }, (_, i) => (
                    <ListItem key={i} sx={{ py: 0.5 }}>
                        <ListItemIcon sx={{ minWidth: 36 }}>
                            <Skeleton variant="circular" width={20} height={20} />
                        </ListItemIcon>
                        <ListItemText primary={<Skeleton variant="text" width="70%" />} />
                    </ListItem>
                ))}
            </List>
        </Box>
    );
}

export default FeedRowsSkeleton;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `docker compose exec -T frontend pnpm exec vitest run src/components/skeletons/__tests__/FeedRowsSkeleton.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/skeletons/FeedRowsSkeleton.tsx \
        frontend/src/components/skeletons/__tests__/FeedRowsSkeleton.test.tsx
git commit -m "feat(skeletons): add FeedRowsSkeleton for lazy category feed loading"
```

---

## Task 6: Frontend — lazy `useFeedsData`

**Files:**
- Modify: `frontend/src/hooks/useFeedsData.ts` (whole file)
- Test: `frontend/src/hooks/__tests__/useFeedsData.test.tsx` (rewrite)

**Interfaces:**
- Consumes: `GET /categories`, `GET /feeds?uncategorized=true` (Task 3), `GET /categories/{id}/feeds`.
- Produces (used by Task 7):
  - `UNCATEGORIZED_KEY: string` — exported sentinel (`"__uncategorized__"`).
  - State: `categories: Category[]`, `feedsByCategory: Record<string, Feed[]>` (keyed by category id **and** `UNCATEGORIZED_KEY`), `loadingFeeds: Set<string>`, `loading: boolean` (initial categories load), `error: string | null`.
  - `loadFeedsForCategory(key: string): Promise<void>` — idempotent; fetches a category's feeds (or the uncategorized set) once and caches them. A key is "loaded" iff `key in feedsByCategory`.
  - Actions (unchanged signatures): `createCategory`, `updateCategory`, `deleteCategory`, `addFeed(categoryId, url)`, `setFeedCategories(feedId, categoryIds)`, `setFeedActive(feedId, isActive)`, `deleteFeed(feedId)`, `refreshFeed(feedId)`, `refresh()`.

- [ ] **Step 1: Rewrite the hook test**

Replace `frontend/src/hooks/__tests__/useFeedsData.test.tsx` in full:

```typescript
/**
 * Unit tests for the lazy useFeedsData hook.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

vi.mock("../../services/api", () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
  ApiError: class ApiError extends Error {
    constructor(
      public status: number,
      public code: string,
      message: string
    ) {
      super(message);
    }
  },
}));

import api from "../../services/api";
import { useFeedsData, UNCATEGORIZED_KEY } from "../useFeedsData";

const mockCategories = [{ id: "cat-1", name: "Tech", feedCount: 1, position: 0 }];
const mockUncategorized = [
  { id: "feed-u", title: "Bare Feed", url: "https://bare/feed", categoryIds: [] },
];
const mockCat1Feeds = [
  { id: "feed-1", title: "TechCrunch", url: "https://tc/feed", categoryIds: ["cat-1"] },
];

function mockRoutes() {
  vi.mocked(api.get).mockImplementation(async (url: string) => {
    if (url === "/categories") return mockCategories as never;
    if (url === "/feeds?uncategorized=true") return mockUncategorized as never;
    if (url === "/categories/cat-1/feeds") return mockCat1Feeds as never;
    return [] as never;
  });
}

describe("useFeedsData (lazy)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("fetches categories + uncategorized on mount, but not category feeds", async () => {
    mockRoutes();
    const { result } = renderHook(() => useFeedsData());

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.categories).toEqual(mockCategories);
    expect(result.current.feedsByCategory[UNCATEGORIZED_KEY]).toEqual(mockUncategorized);
    // Category feeds are NOT eagerly loaded.
    expect("cat-1" in result.current.feedsByCategory).toBe(false);
    expect(vi.mocked(api.get)).not.toHaveBeenCalledWith("/categories/cat-1/feeds");
  });

  it("loads a category's feeds on first expand and caches them", async () => {
    mockRoutes();
    const { result } = renderHook(() => useFeedsData());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.loadFeedsForCategory("cat-1");
    });

    expect(result.current.feedsByCategory["cat-1"]).toEqual(mockCat1Feeds);
    const callsAfterFirst = vi.mocked(api.get).mock.calls.filter(
      (c) => c[0] === "/categories/cat-1/feeds"
    ).length;
    expect(callsAfterFirst).toBe(1);

    // Second call is a no-op (already cached).
    await act(async () => {
      await result.current.loadFeedsForCategory("cat-1");
    });
    const callsAfterSecond = vi.mocked(api.get).mock.calls.filter(
      (c) => c[0] === "/categories/cat-1/feeds"
    ).length;
    expect(callsAfterSecond).toBe(1);
  });

  it("sets an error message when the initial load fails", async () => {
    vi.mocked(api.get).mockRejectedValue(new Error("network"));
    const { result } = renderHook(() => useFeedsData());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `docker compose exec -T frontend pnpm exec vitest run src/hooks/__tests__/useFeedsData.test.tsx`
Expected: FAIL (`UNCATEGORIZED_KEY` / `feedsByCategory` / `loadFeedsForCategory` do not exist).

- [ ] **Step 3: Rewrite the hook**

Replace `frontend/src/hooks/useFeedsData.ts` in full:

```typescript
/**
 * Custom hook for managing categories and feeds data — lazily.
 *
 * On mount it fetches only the shallow category list plus the uncategorized
 * feeds. A category's feeds are fetched on first expand via
 * loadFeedsForCategory and cached in feedsByCategory. This avoids pulling every
 * feed across every category up front.
 */

import { useState, useCallback, useEffect } from "react";
import api, { ApiError } from "../services/api";
import type { Category, Feed } from "../types";

/** Sentinel key for the pseudo-group holding feeds with no category. */
export const UNCATEGORIZED_KEY = "__uncategorized__";

interface CategoryResponse {
  category: Category;
}

interface UseFeedsDataState {
  categories: Category[];
  feedsByCategory: Record<string, Feed[]>;
  loadingFeeds: Set<string>;
  loading: boolean;
  error: string | null;
}

interface UseFeedsDataActions {
  createCategory: (name: string) => Promise<Category>;
  updateCategory: (id: string, name: string) => Promise<Category>;
  deleteCategory: (id: string) => Promise<void>;
  addFeed: (categoryId: string | null, url: string) => Promise<Feed>;
  setFeedCategories: (feedId: string, categoryIds: string[]) => Promise<Feed>;
  setFeedActive: (feedId: string, isActive: boolean) => Promise<Feed>;
  deleteFeed: (feedId: string) => Promise<void>;
  refreshFeed: (feedId: string) => Promise<Feed>;
  loadFeedsForCategory: (key: string) => Promise<void>;
  refresh: () => Promise<void>;
}

export type UseFeedsDataReturn = UseFeedsDataState & UseFeedsDataActions;

export function useFeedsData(): UseFeedsDataReturn {
  const [state, setState] = useState<UseFeedsDataState>({
    categories: [],
    feedsByCategory: {},
    loadingFeeds: new Set(),
    loading: true,
    error: null,
  });

  const fetchCategories = useCallback(
    async (): Promise<Category[]> => api.get<Category[]>("/categories"),
    []
  );

  const fetchUncategorized = useCallback(
    async (): Promise<Feed[]> => api.get<Feed[]>("/feeds?uncategorized=true"),
    []
  );

  /**
   * Initial (and full-refresh) load: shallow categories + uncategorized feeds.
   * Category feed caches are dropped so expanded groups reload lazily.
   */
  const refresh = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const [categories, uncategorized] = await Promise.all([
        fetchCategories(),
        fetchUncategorized(),
      ]);
      setState((prev) => ({
        ...prev,
        categories,
        feedsByCategory: { [UNCATEGORIZED_KEY]: uncategorized },
        loadingFeeds: new Set(),
        loading: false,
      }));
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Failed to load data";
      setState((prev) => ({ ...prev, loading: false, error: message }));
    }
  }, [fetchCategories, fetchUncategorized]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  /**
   * Lazily load a category's feeds (or the uncategorized set). Idempotent:
   * skips when the key is already loaded or in flight.
   */
  const loadFeedsForCategory = useCallback(async (key: string) => {
    let shouldFetch = false;
    setState((prev) => {
      if (key in prev.feedsByCategory || prev.loadingFeeds.has(key)) return prev;
      shouldFetch = true;
      const loadingFeeds = new Set(prev.loadingFeeds);
      loadingFeeds.add(key);
      return { ...prev, loadingFeeds };
    });
    if (!shouldFetch) return;

    try {
      const feeds =
        key === UNCATEGORIZED_KEY
          ? await api.get<Feed[]>("/feeds?uncategorized=true")
          : await api.get<Feed[]>(`/categories/${key}/feeds`);
      setState((prev) => {
        const loadingFeeds = new Set(prev.loadingFeeds);
        loadingFeeds.delete(key);
        return {
          ...prev,
          feedsByCategory: { ...prev.feedsByCategory, [key]: feeds },
          loadingFeeds,
        };
      });
    } catch {
      setState((prev) => {
        const loadingFeeds = new Set(prev.loadingFeeds);
        loadingFeeds.delete(key);
        return { ...prev, loadingFeeds };
      });
    }
  }, []);

  const createCategory = useCallback(
    async (name: string): Promise<Category> => {
      const response = await api.post<CategoryResponse>("/categories", { name });
      await refresh();
      return response.category;
    },
    [refresh]
  );

  const updateCategory = useCallback(
    async (id: string, name: string): Promise<Category> => {
      const response = await api.patch<CategoryResponse>(`/categories/${id}`, { name });
      setState((prev) => ({
        ...prev,
        categories: prev.categories.map((cat) => (cat.id === id ? response.category : cat)),
      }));
      return response.category;
    },
    []
  );

  const deleteCategory = useCallback(async (id: string): Promise<void> => {
    await api.delete(`/categories/${id}`);
    // A deleted category's feeds become uncategorized; reload the shallow data.
    await refreshRef.current();
  }, []);

  const addFeed = useCallback(
    async (categoryId: string | null, url: string): Promise<Feed> => {
      const feed = await api.post<Feed>("/feeds", {
        url,
        categoryIds: categoryId ? [categoryId] : [],
      });
      await refresh();
      return feed;
    },
    [refresh]
  );

  const setFeedCategories = useCallback(
    async (feedId: string, categoryIds: string[]): Promise<Feed> => {
      const feed = await api.patch<Feed>(`/feeds/${feedId}`, { categoryIds });
      await refresh();
      return feed;
    },
    [refresh]
  );

  const deleteFeed = useCallback(async (feedId: string): Promise<void> => {
    await api.delete(`/feeds/${feedId}`);
    setState((prev) => {
      const affected = new Set<string>();
      const feedsByCategory: Record<string, Feed[]> = {};
      for (const [key, feeds] of Object.entries(prev.feedsByCategory)) {
        if (key !== UNCATEGORIZED_KEY && feeds.some((f) => f.id === feedId)) {
          affected.add(key);
        }
        feedsByCategory[key] = feeds.filter((f) => f.id !== feedId);
      }
      return {
        ...prev,
        feedsByCategory,
        categories: prev.categories.map((cat) =>
          affected.has(cat.id)
            ? { ...cat, feedCount: Math.max(0, cat.feedCount - 1) }
            : cat
        ),
      };
    });
  }, []);

  const replaceFeedInGroups = useCallback((updated: Feed) => {
    setState((prev) => {
      const feedsByCategory: Record<string, Feed[]> = {};
      for (const [key, feeds] of Object.entries(prev.feedsByCategory)) {
        feedsByCategory[key] = feeds.map((f) => (f.id === updated.id ? updated : f));
      }
      return { ...prev, feedsByCategory };
    });
  }, []);

  const refreshFeed = useCallback(
    async (feedId: string): Promise<Feed> => {
      const updated = await api.post<Feed>(`/feeds/${feedId}/refresh`);
      replaceFeedInGroups(updated);
      return updated;
    },
    [replaceFeedInGroups]
  );

  const setFeedActive = useCallback(
    async (feedId: string, isActive: boolean): Promise<Feed> => {
      const updated = await api.patch<Feed>(`/feeds/${feedId}`, { isActive });
      replaceFeedInGroups(updated);
      return updated;
    },
    [replaceFeedInGroups]
  );

  return {
    categories: state.categories,
    feedsByCategory: state.feedsByCategory,
    loadingFeeds: state.loadingFeeds,
    loading: state.loading,
    error: state.error,
    createCategory,
    updateCategory,
    deleteCategory,
    addFeed,
    setFeedCategories,
    setFeedActive,
    deleteFeed,
    refreshFeed,
    loadFeedsForCategory,
    refresh,
  };
}

export default useFeedsData;
```

> **Note on `deleteCategory`:** the code above references `refreshRef.current()` to avoid an ordering dependency on `refresh`. Implement it simply by using `refresh` directly instead — replace the `deleteCategory` body with:
>
> ```typescript
>   const deleteCategory = useCallback(async (id: string): Promise<void> => {
>     await api.delete(`/categories/${id}`);
>     await refresh();
>   }, [refresh]);
> ```
>
> (There is no `refreshRef`; use `refresh` and include it in the dependency array. The note exists only to make the intent explicit — a deleted category's feeds fall back to uncategorized, so a shallow reload is the correct, simplest invalidation.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `docker compose exec -T frontend pnpm exec vitest run src/hooks/__tests__/useFeedsData.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit** (do not run `tsc` yet — `ReaderPage`/sidebar still reference the old `feeds` prop; that is fixed in Task 7)

```bash
git add frontend/src/hooks/useFeedsData.ts frontend/src/hooks/__tests__/useFeedsData.test.tsx
git commit -m "feat(feeds): lazy useFeedsData (categories + uncategorized on mount, feeds on expand)"
```

---

## Task 7: Frontend — sidebar lazy props + ReaderPage cutover

This is the cutover task: it changes `CategoryList` and `FeedSidebar` from a flat `feeds` prop to the lazy `feedsByCategory` / `loadingFeeds` / `onExpandCategory` model, renders `FeedRowsSkeleton` while a category loads, sources collapsed-category badges from `unread.byCategory`, and rewires `ReaderPage`. After this task the whole app compiles and all tests pass.

**Files:**
- Modify: `frontend/src/components/CategoryList.tsx`
- Modify: `frontend/src/components/FeedSidebar.tsx`
- Modify: `frontend/src/pages/posts/ReaderPage.tsx`
- Test: `frontend/src/components/__tests__/CategoryList.test.tsx` (update `defaultProps` + add two lazy tests)

**Interfaces:**
- Consumes: `useFeedsData` lazy shape + `UNCATEGORIZED_KEY` (Task 6); `FeedRowsSkeleton` (Task 5); `unread.byCategory` / `unread.uncategorized` (Task 4).

- [ ] **Step 1: Update `CategoryList` props + rendering**

In `frontend/src/components/CategoryList.tsx`:

1. Add imports (and drop the local sentinel):

```typescript
import { FeedRowsSkeleton } from "./skeletons/FeedRowsSkeleton";
import { UNCATEGORIZED_KEY } from "../hooks/useFeedsData";
```

Remove the line `const UNCATEGORIZED_KEY = "__uncategorized__";`.

2. Replace the `feeds` prop in `CategoryListProps` and add the new props:

```typescript
    // was: feeds: Feed[];
    feedsByCategory: Record<string, Feed[]>;
    loadingFeeds: Set<string>;
    onExpandCategory: (key: string) => void;
    unreadByCategory?: Record<string, number>;
    uncategorizedUnread?: number;
```

3. Update the destructured params to match (replace `feeds,` with `feedsByCategory, loadingFeeds, onExpandCategory,` and add `unreadByCategory, uncategorizedUnread = 0,` alongside the other optional props).

4. Add a loader effect near the top of the component body (after the `useState` hooks), so any expanded-but-uncached category (including after invalidation) fetches its feeds:

```typescript
    useEffect(() => {
        for (const id of expandedCategories) {
            if (id === UNCATEGORIZED_KEY) continue; // uncategorized loads on mount
            if (!(id in feedsByCategory) && !loadingFeeds.has(id)) {
                onExpandCategory(id);
            }
        }
    }, [expandedCategories, feedsByCategory, loadingFeeds, onExpandCategory]);
```

Add `useEffect` to the React import (`import { useState, useCallback, useEffect } from "react";`).

5. Replace `getFeedsForCategory` and the uncategorized derivations:

```typescript
    // Get a category's loaded feeds (empty until expanded/loaded).
    const getFeedsForCategory = useCallback(
        (categoryId: string): Feed[] => feedsByCategory[categoryId] ?? [],
        [feedsByCategory]
    );

    const uncategorizedFeeds = feedsByCategory[UNCATEGORIZED_KEY] ?? [];
```

Remove the old `uncategorizedUnread` local (the reduce over `unreadByFeed`) — it is now a prop.

6. In the category map, source the badge from the per-category total and render the skeleton while loading. Replace the `categoryUnread` computation:

```typescript
                    const isExpanded = expandedCategories.has(category.id);
                    const isSelected = selectedCategoryId === category.id;
                    const categoryFeeds = getFeedsForCategory(category.id);
                    const categoryUnread = unreadByCategory?.[category.id] ?? 0;
                    const feedsLoading =
                        loadingFeeds.has(category.id) && !(category.id in feedsByCategory);
```

And replace the nested `<Collapse>` body:

```typescript
                            <Collapse in={isExpanded} timeout="auto" unmountOnExit>
                                {feedsLoading ? (
                                    <FeedRowsSkeleton />
                                ) : (
                                    <FeedList
                                        feeds={categoryFeeds}
                                        categories={categories}
                                        onDeleteFeed={onDeleteFeed}
                                        onRefreshFeed={onRefreshFeed}
                                        onSetFeedCategories={onSetFeedCategories}
                                        onSetFeedActive={onSetFeedActive}
                                        activeFeedId={activeFeedId}
                                        unreadByFeed={unreadByFeed}
                                        onSelectFeed={onSelectFeed}
                                        onMarkFeedRead={onMarkFeedRead}
                                        onAddFeed={() => {
                                            setAddFeedCategoryId(category.id);
                                            setShowAddFeedDialog(true);
                                        }}
                                    />
                                )}
                            </Collapse>
```

7. Uncategorized group: it is eagerly loaded, so it needs no skeleton. Keep the existing markup but its badge now comes from the `uncategorizedUnread` prop (already renamed above; the `{uncategorizedUnread > 0 && <Chip .../>}` block is unchanged since the local was replaced by the prop).

8. `isEmpty` is already `categories.length === 0 && uncategorizedFeeds.length === 0` — with `uncategorizedFeeds` now sourced from `feedsByCategory[UNCATEGORIZED_KEY]`, no change is needed.

- [ ] **Step 2: Update `FeedSidebar` to pass the lazy props through**

In `frontend/src/components/FeedSidebar.tsx`:

1. In `FeedSidebarProps`, replace `feeds: Feed[];` with:

```typescript
    feedsByCategory: Record<string, Feed[]>;
    loadingFeeds: Set<string>;
    onExpandCategory: (key: string) => void;
```

and add to the "Unread counts" group:

```typescript
    unreadByCategory: Record<string, number>;
    uncategorizedUnread: number;
```

2. Update the destructured params accordingly (replace `feeds,` and add `feedsByCategory, loadingFeeds, onExpandCategory, unreadByCategory, uncategorizedUnread,`).

3. In the `<CategoryList ... />` usage, replace `feeds={feeds}` with:

```typescript
                    feedsByCategory={feedsByCategory}
                    loadingFeeds={loadingFeeds}
                    onExpandCategory={onExpandCategory}
                    unreadByCategory={unreadByCategory}
                    uncategorizedUnread={uncategorizedUnread}
```

- [ ] **Step 3: Rewire `ReaderPage`**

In `frontend/src/pages/posts/ReaderPage.tsx`:

1. Replace the `useFeedsData` destructuring:

```typescript
    // Feeds & categories (lazy)
    const {
        categories,
        feedsByCategory,
        loadingFeeds,
        loadFeedsForCategory,
        loading: feedsLoading,
        error: feedsError,
        createCategory,
        updateCategory,
        deleteCategory,
        addFeed,
        setFeedCategories,
        setFeedActive,
        deleteFeed,
        refreshFeed,
        refresh: refreshFeeds,
    } = useFeedsData();
```

2. Update `scopeTitle`'s feed branch (there is no global `feeds` array now) — prefer a loaded feed, else the post's `feedTitle`:

```typescript
    const scopeTitle = useMemo(() => {
        if (feedId) {
            const loaded = Object.values(feedsByCategory)
                .flat()
                .find((f) => f.id === feedId);
            const fromPost = posts.find((p) => p.feedId === feedId)?.feedTitle;
            return loaded?.title || loaded?.url || fromPost || "Feed";
        }
        if (isUncategorized) return "Uncategorized";
        if (categoryId) {
            const category = categories.find((c) => c.id === categoryId);
            return category?.name || "Category";
        }
        return "All items";
    }, [feedId, categoryId, isUncategorized, feedsByCategory, categories, posts]);
```

3. Update the `<FeedSidebar>` props — replace `feeds={feeds}` and `loading={loadingFeeds}` with:

```typescript
            feedsByCategory={feedsByCategory}
            loadingFeeds={loadingFeeds}
            onExpandCategory={loadFeedsForCategory}
            loading={feedsLoading}
```

and add the new unread props next to `unreadByFeed={unread.byFeed}`:

```typescript
            unreadByCategory={unread.byCategory}
            uncategorizedUnread={unread.uncategorized}
```

- [ ] **Step 4: Update the `CategoryList` test props + add lazy tests**

In `frontend/src/components/__tests__/CategoryList.test.tsx`, replace the `feeds` entry in `defaultProps` with the lazy props:

```typescript
const defaultProps = {
  categories: [] as Category[],
  feedsByCategory: {} as Record<string, Feed[]>,
  loadingFeeds: new Set<string>(),
  onExpandCategory: vi.fn(),
  unreadByCategory: {} as Record<string, number>,
  uncategorizedUnread: 0,
  loading: false,
  error: null as string | null,
  selectedCategoryId: null as string | null,
  onSelectCategory: vi.fn(),
  onCreateCategory: vi.fn().mockResolvedValue(makeCategory()),
  onUpdateCategory: vi.fn().mockResolvedValue(makeCategory()),
  onDeleteCategory: vi.fn().mockResolvedValue(undefined),
  onAddFeed: vi.fn().mockResolvedValue(makeFeed()),
  onDeleteFeed: vi.fn().mockResolvedValue(undefined),
  onRefreshFeed: vi.fn().mockResolvedValue(makeFeed()),
  onSetFeedCategories: vi.fn().mockResolvedValue(makeFeed()),
  onSetFeedActive: vi.fn().mockResolvedValue(makeFeed()),
};
```

Then add a `describe` block for the lazy behavior (place it before the final closing `});`):

```typescript
  describe("lazy feed loading", () => {
    it("requests a category's feeds when it is expanded", async () => {
      const onExpandCategory = vi.fn();
      const cats = [makeCategory({ id: "c1", name: "Expandable" })];
      render(
        <CategoryList
          {...defaultProps}
          categories={cats}
          onExpandCategory={onExpandCategory}
        />
      );

      await userEvent.click(screen.getByText("Expandable"));
      await waitFor(() => expect(onExpandCategory).toHaveBeenCalledWith("c1"));
    });

    it("shows the feed-rows skeleton while an expanded category's feeds load", async () => {
      const cats = [makeCategory({ id: "c1", name: "Loading Cat" })];
      const { container } = render(
        <CategoryList
          {...defaultProps}
          categories={cats}
          loadingFeeds={new Set(["c1"])}
        />
      );
      // Expand the category; its feeds are not cached and loadingFeeds has c1,
      // so the FeedRowsSkeleton renders inside the open Collapse.
      await userEvent.click(screen.getByText("Loading Cat"));
      await waitFor(() => {
        expect(
          container.querySelector('[data-testid="feed-rows-skeleton"]')
        ).not.toBeNull();
      });
    });

    it("badges a collapsed category from unreadByCategory", () => {
      const cats = [makeCategory({ id: "c1", name: "Badged" })];
      render(
        <CategoryList
          {...defaultProps}
          categories={cats}
          unreadByCategory={{ c1: 7 }}
        />
      );
      expect(screen.getByText("7")).toBeInTheDocument();
    });
  });
```

- [ ] **Step 5: Typecheck + run the affected tests**

Run: `docker compose exec -T frontend pnpm exec tsc --noEmit -p tsconfig.json`
Expected: clean (all `feeds`-prop references are gone).

Run: `docker compose exec -T frontend pnpm exec vitest run src/components/__tests__/CategoryList.test.tsx`
Expected: PASS.

- [ ] **Step 6: Run the full frontend unit suite**

Run: `docker compose exec -T frontend pnpm test`
Expected: all files pass (Phase A's 175 baseline plus the Phase B additions).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/CategoryList.tsx \
        frontend/src/components/FeedSidebar.tsx \
        frontend/src/pages/posts/ReaderPage.tsx \
        frontend/src/components/__tests__/CategoryList.test.tsx
git commit -m "feat(sidebar): lazy category feeds with skeleton + backend-sourced badges"
```

---

## Task 8: E2E — lazy fetching

The shared E2E fixture mocks `GET /api/feeds` (all feeds). Lazy loading instead calls `GET /api/feeds?uncategorized=true` (mount) and `GET /api/categories/{id}/feeds` (on expand). Update the fixture to serve those, extend the `unread` shape, then add a spec that proves the lazy flow and run the full E2E suite.

**Files:**
- Modify: `frontend/playwright/fixtures.ts` (`setupReaderApi`)
- Create: `frontend/playwright/lazy-feeds.spec.ts`

**Interfaces:**
- Consumes: the lazy frontend (Tasks 6-7) and backend endpoints (Tasks 2-3).

- [ ] **Step 1: Update `setupReaderApi`**

In `frontend/playwright/fixtures.ts`, replace the `unread` type + defaults and the feed route mocks. Change the `opts` type's `unread` field:

```typescript
    unread?: {
      byFeed: Record<string, number>;
      byCategory?: Record<string, number>;
      uncategorized?: number;
      total: number;
    };
```

Replace the destructuring default:

```typescript
    unread = { byFeed: {}, byCategory: {}, uncategorized: 0, total: 0 },
```

Replace the feed mock lines. Delete:

```typescript
  await mockApi(page, "**/api/feeds", feeds, { method: "GET" });
```

and insert, after the `**/api/categories` mock, routes that serve per-category and uncategorized feeds from the seeded `feeds` array (feeds are `{ id, categoryIds, ... }`):

```typescript
  // Uncategorized feeds load on mount: GET /api/feeds?uncategorized=true.
  // (Any GET /api/feeds in the lazy app is the uncategorized request.)
  await page.route("**/api/feeds**", (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    const uncategorized = (feeds as Array<{ categoryIds: string[] }>).filter(
      (f) => f.categoryIds.length === 0
    );
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(uncategorized),
    });
  });

  // A category's feeds load on expand: GET /api/categories/{id}/feeds.
  await page.route("**/api/categories/*/feeds", (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    const url = new URL(route.request().url());
    const match = url.pathname.match(/\/categories\/([^/]+)\/feeds$/);
    const catId = match?.[1];
    const inCategory = (feeds as Array<{ categoryIds: string[] }>).filter((f) =>
      catId ? f.categoryIds.includes(catId) : false
    );
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(inCategory),
    });
  });
```

> Route order matters in Playwright (last registered wins). Register `**/api/categories/*/feeds` **after** `**/api/categories` so the per-category feed request is not swallowed by the category-list mock. The `**/api/feeds**` GET mock only handles the uncategorized request; POST/PATCH/DELETE fall through to per-test handlers.

- [ ] **Step 2: Add the lazy-behavior spec**

Create `frontend/playwright/lazy-feeds.spec.ts`:

```typescript
/**
 * E2E: the reader loads categories + uncategorized feeds on mount and fetches a
 * category's feeds only when it is expanded, showing a skeleton while they load.
 */

import { test, expect, setupReaderApi, makeCategory, makeFeed } from "./fixtures";

const catTech = makeCategory({ id: "cat-tech", name: "Technology", feedCount: 1 });
const techFeed = makeFeed(["cat-tech"], { id: "feed-tech", title: "Hacker News" });
const bareFeed = makeFeed([], { id: "feed-bare", title: "Bare Blog" });

test.describe("Reader — lazy feed loading", () => {
  test("loads a category's feeds only on expand, and badges collapsed categories", async ({
    authedPage: page,
  }) => {
    let categoryFeedsRequested = 0;
    await page.route("**/api/categories/*/feeds", async (route) => {
      categoryFeedsRequested += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([techFeed]),
      });
    });

    await setupReaderApi(page, {
      categories: [catTech],
      feeds: [techFeed, bareFeed],
      posts: [],
      unread: {
        byFeed: { "feed-tech": 4 },
        byCategory: { "cat-tech": 4 },
        uncategorized: 0,
        total: 4,
      },
    });

    await page.goto("/posts");

    // Uncategorized feed is present on mount (loaded eagerly).
    await expect(page.getByText("Bare Blog")).toBeVisible();
    // Collapsed category shows its backend-sourced unread badge…
    await expect(page.getByText("Technology")).toBeVisible();
    await expect(page.getByText("4")).toBeVisible();
    // …but its feed has NOT been fetched yet.
    expect(categoryFeedsRequested).toBe(0);
    await expect(page.getByText("Hacker News")).toHaveCount(0);

    // Expand the category → its feeds are fetched and rendered.
    await page.getByText("Technology").click();
    await expect(page.getByText("Hacker News")).toBeVisible();
    expect(categoryFeedsRequested).toBe(1);
  });
});
```

> The custom `**/api/categories/*/feeds` route registered inside the test is added **after** `setupReaderApi`, so it wins and lets the test count requests. Because it returns before the fixture's copy, the counter is accurate.

- [ ] **Step 3: Run the new spec**

Run: `docker compose exec -T frontend sh -lc 'npx playwright test lazy-feeds.spec.ts --reporter=line'`
Expected: PASS.

- [ ] **Step 4: Run the full E2E suite and fix any fixture-driven regressions**

Run: `docker compose exec -T frontend sh -lc 'npx playwright test --reporter=line'`
Expected: PASS. Existing specs that relied on categorized feeds being visible without expanding must now expand the category first (or assert on the uncategorized/`posts` data they seed). Fix such assertions in the affected spec(s) — do not weaken the lazy contract.

- [ ] **Step 5: Commit**

```bash
git add frontend/playwright/fixtures.ts frontend/playwright/lazy-feeds.spec.ts
# plus any existing spec files adjusted for lazy loading
git commit -m "test(e2e): lazy feed loading — per-category fetch on expand"
```

---

## Self-Review

**1. Spec coverage (design Phase B):**
- Backend `byCategory` + `uncategorized` on `/posts/unread-counts` → Tasks 1-2. ✔
- `GET /feeds?uncategorized=true` filter → Task 3. ✔
- `useFeedsData` lazy: categories on mount, per-category feeds on first expand via `GET /api/categories/{id}/feeds`, `feedsByCategory` map + per-category loading → Task 6 (+ skeleton wiring in Task 7). ✔
- Uncategorized feeds via `GET /feeds?uncategorized=true` → Task 6 (fetched on mount, per the documented intentional deviation). ✔
- Unread badges: collapsed category → `unread.byCategory`; per-feed → `unread.byFeed`; uncategorized → `unread.uncategorized` → Tasks 4, 7. ✔
- Deep links: scope-header feed title from the posts response (`feedTitle`) → Task 7 `scopeTitle`. ✔
- Invalidation on feed/category mutations → Task 6 (`addFeed`/`setFeedCategories`/`deleteCategory` reload shallow data; `deleteFeed` prunes the cache; `refreshFeed`/`setFeedActive` replace in place). ✔
- Sidebar prop changes (`feedsByCategory`, `loadingFeeds`, `onExpandCategory`, unread props) → Task 7. ✔
- `FeedRowsSkeleton` (introduced in Phase A design, built here) → Task 5, wired in Task 7. ✔
- Testing per design (hook lazy-fetch + cache-hit + invalidation; contract `byCategory`/`uncategorized`; E2E expand→skeleton→feeds, collapsed badge) → Tasks 1-8. ✔

**2. Placeholder scan:** No `TODO`/"handle edge cases"/"similar to Task N"; every code step has literal content. The one prose note (Task 6 `deleteCategory`) resolves to explicit code. ✔

**3. Type consistency:** `UnreadCounts` (backend dataclass: `by_feed`/`by_category`/`uncategorized`/`total`; frontend type: `byFeed`/`byCategory`/`uncategorized`/`total`) is consistent across Tasks 1-2 (backend), 4 (frontend), 7 (usage). `feedsByCategory: Record<string, Feed[]>`, `loadingFeeds: Set<string>`, `onExpandCategory(key)`, `loadFeedsForCategory(key)`, and `UNCATEGORIZED_KEY` are defined identically in Task 6 and consumed with the same names/types in Task 7. `get_unread_counts_by_category -> tuple[dict[UUID,int], int]` matches between the ABC/impl (Task 1) and the service (Task 2). `get_uncategorized -> list[Feed]` matches between ABC/impl (Task 3) and the service/route. ✔

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-07-28-loading-performance-phase-b-lazy-fetching.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
