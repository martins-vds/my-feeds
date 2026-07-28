# Loading Performance — Design

**Date:** 2026-07-28
**Status:** Approved (design)
**Area:** Reader loading UX (frontend) + response caching (backend)

## Problem

The reader feels slow and "stuck" while loading:

- Every loading state renders a `CircularProgress` **spinner**. `PostList`'s
  `PostsSkeleton` is a spinner in disguise (a `<CircularProgress>`), and there
  are **no** real `<Skeleton>` placeholders anywhere — so the app gives no sense
  that content is arriving.
- `useFeedsData` eagerly fetches **all** categories **and all feeds** on mount
  (sequentially) before the sidebar renders, even though the user may only look
  at one category. Categories are already shallow (`GET /categories` → id, name,
  position, `feedCount`); the eager `GET /feeds` is the expensive part.
- No response/output caching exists (no `Cache-Control`/`ETag`, no server-side
  cache). Every read recomputes and re-transfers in full.

## Goals

1. **Perceived performance** — replace spinners with content-shaped skeletons so
   loading feels immediate and does not reflow when data arrives.
2. **Real performance** — load the feed tree lazily: categories first, a
   category's feeds only when it is expanded, posts per selected scope.
3. **Response caching** — add dependency-free HTTP conditional caching (ETag) on
   reads plus a small in-memory server output cache for rarely-changing data,
   invalidated on writes.

## Non-Goals

- No new infrastructure (no Redis) — caching is in-memory + HTTP ETag. A
  single-instance deployment is assumed; multi-worker → Redis is a future step.
- No change to the posts fetch/pagination model or the new-post polling.
- No redesign of the sidebar's visual tree — it is already a collapsible
  category → feed tree; only *when* feeds are fetched changes.
- No service-worker changes (ETag flows through the existing SW transparently).

## Key Decisions (from brainstorming)

- One cohesive design, three independently-shippable phases: **A** skeletons →
  **B** lazy fetching → **C** caching.
- Collapsed categories keep an unread badge, sourced from a new per-category
  total on the backend (see Phase B), not from summing loaded feeds.
- Caching is dependency-free: ETag/conditional-GET on reads + a small in-memory
  output cache for `categories`/per-category `feeds` only; posts and
  unread-counts are ETag-only (they mutate often and are polled). No Redis.

---

## Phase A — Skeletons (perceived performance)

New content-shaped skeleton components using MUI `<Skeleton>`, each mirroring the
real layout so content swaps in without reflow. Each skeleton container carries
`role="status"`, `aria-busy="true"`, and `aria-label="Loading…"`.

- `PostListSkeleton` — ~6 `PostCard`-shaped rows (title line, meta line, two
  summary lines, a thumbnail block). Replaces the `PostsSkeleton`
  `CircularProgress` in [PostList.tsx](../../frontend/src/components/PostList.tsx).
- `SidebarSkeleton` — ~4 category rows (folder icon + name + "N feeds" +
  chip) for the initial sidebar load. Replaces the `CircularProgress` in
  [CategoryList.tsx](../../frontend/src/components/CategoryList.tsx).
- `FeedRowsSkeleton` — ~3 feed-row skeletons rendered *under* a category while
  its feeds load (Phase B).
- `PostDetailSkeleton` — title + meta + several paragraph lines. Replaces the
  spinner in [PostDetailPage.tsx](../../frontend/src/pages/posts/PostDetailPage.tsx).

Small in-button spinners (Add Feed, Category form submit) stay as `CircularProgress`
— those communicate an in-place action, not a page load.

**Files:** new `frontend/src/components/skeletons/` (the four components + an
index); edits to `PostList.tsx`, `CategoryList.tsx`, `PostDetailPage.tsx`, and
(Phase B) the feed-loading spot.

---

## Phase B — Lazy hierarchical fetching (real performance)

### Backend (small addition)

Extend `GET /posts/unread-counts` to also return per-category totals:

```jsonc
{ "byFeed": { "<feedId>": 3 }, "byCategory": { "<categoryId>": 7 }, "uncategorized": 2, "total": 12 }
```

So a *collapsed* category shows its unread badge without its feeds loaded. This
is a service + route change (aggregate unread grouped by category via the
feed→category mapping) plus the `UnreadCounts` type on the client.

### Frontend — refactor `useFeedsData` from eager to lazy

- **On mount:** fetch only categories (`GET /categories`, already shallow). Do
  **not** fetch all feeds.
- **Per-category feeds:** loaded on the category's **first expand** via the
  existing `GET /api/categories/{id}/feeds`
  ([feeds.py](../../backend/app/api/routes/feeds.py) `list_feeds_in_category`),
  stored in `feedsByCategory: Record<categoryId, Feed[]>` with a per-category
  `loadingFeeds: Set<categoryId>`. While pending → `FeedRowsSkeleton`.
  Re-expanding uses the cached array (no refetch).
- **Uncategorized:** its feeds load on expand of the "Uncategorized" node via a
  new `GET /feeds?uncategorized=true` filter on the existing `GET /feeds` route
  (returns only feeds that have no category).
- **Unread badges:** collapsed category → `unread.byCategory[id]` (new);
  expanded per-feed → `unread.byFeed[id]` (existing); uncategorized →
  `unread.uncategorized`.
- **Deep links** (`?feed=X` whose category is collapsed): the scope-header feed
  title comes from the posts response — `PostSummary.feedTitle` already exists —
  so all feeds need not be eagerly loaded.
- **Invalidation:** feed/category mutations (add/delete/move feed, delete
  category) drop the affected category's cached feeds and refetch if it is
  currently expanded; they also trigger `refetchUnread()`.

### Sidebar prop changes

`FeedSidebar`/`CategoryList` move from a flat `feeds: Feed[]` prop to:
`feedsByCategory: Record<string, Feed[]>`, `loadingFeeds: Set<string>`,
`onExpandCategory(categoryId)`, `uncategorizedFeeds: Feed[]`, and the existing
unread props. `getFeedsForCategory` reads from `feedsByCategory` instead of
filtering a global list.

**Net:** first paint fetches categories + first page of posts + unread-counts
(feeds load on demand) instead of also pulling every feed. Selecting a
category/feed shows `PostListSkeleton` while its posts load.

---

## Phase C — Response caching (dependency-free)

### 1. HTTP conditional caching (ETag) — *ResponseCaching* analog

On `GET /categories`, `GET /categories/{id}/feeds`,
`GET /feeds?uncategorized=true`, `GET /posts`, and `GET /posts/unread-counts`:

- Serialize the JSON body, compute `etag = '"' + sha256(body).hexdigest()[:16] + '"'`.
- Respond with headers `ETag: <etag>` and `Cache-Control: private, no-cache`
  (per-user; store but always revalidate).
- If the request's `If-None-Match` equals the current `etag` → `304 Not
  Modified` with an empty body (and the `ETag`). Otherwise `200` + body + `ETag`.

A reusable API-layer helper keeps handlers clean:

```python
async def conditional_json(build_body: Callable[[], Awaitable[Any]]) -> Response:
    """Build the JSON body, attach a strong ETag, and return 304 when the
    caller's If-None-Match already matches."""
```

### 2. In-memory server output cache — *OutputCaching* analog

Only for the rarely-changing, more expensive responses: `GET /categories`,
`GET /categories/{id}/feeds`, and `GET /feeds?uncategorized=true`, per user.
Posts and unread-counts are **not** body-cached (they change often and are
polled) — the body-hash ETag already gives cheap `304`s there without storing a
body.

- `ResponseCache` (infrastructure): an async-safe TTL store,
  `dict[(user_id, route, params)] → (etag, body: bytes, expires_at)`, guarded by
  an `asyncio.Lock`. Short TTL (~60s) as a safety net **plus** explicit
  invalidation on writes.
- **Invalidation:** category/feed create/update/delete/move clears that user's
  `/categories` entry and the affected `/categories/{id}/feeds` entries. Post
  read-state changes need no explicit invalidation — the body-hash ETag changes
  automatically.

### Layering & dependencies

The cache is an infrastructure concern; the API layer calls it; invalidation
calls sit at the write sites (route or application service). No domain changes.
No new dependencies — stdlib `hashlib`, a dict, and `asyncio.Lock`. The
single-instance assumption is documented; multi-worker would move this to Redis.
ETag/conditional-GET flows through the existing PWA service worker unchanged.

**Files:** new `backend/app/infrastructure/http/response_cache.py` (TTL store) and
an API helper (e.g. `backend/app/api/middleware/conditional.py`); edits to
`routes/categories.py`, `routes/feeds.py`, `routes/posts.py`, and the write sites
for invalidation.

---

## Testing (test-first, per constitution Principle III)

- **A (Vitest + Playwright):** each skeleton renders while `loading` and is
  replaced by content; container exposes `role="status"`. E2E: skeletons appear,
  then real posts/categories.
- **B:** hook tests — lazy fetch on first expand, cache-hit (no refetch) on
  re-expand, invalidation on mutation; contract test — `byCategory`/`uncategorized`
  in `/posts/unread-counts`; E2E — expand a category → `FeedRowsSkeleton` → feeds;
  a collapsed category shows a badge from `byCategory`.
- **C:** contract tests — first GET returns an `ETag`; a second GET with
  `If-None-Match` → `304`; a mutating write changes the ETag / invalidates the
  cache entry. Unit tests — the ETag helper (200 vs 304) and the TTL cache
  (hit / expiry / explicit invalidate).

## Sequencing

Each phase ships independently:

1. **Phase A** — pure UI, no API changes; immediate perceived-perf win.
2. **Phase B** — builds on A's `FeedRowsSkeleton`/`PostListSkeleton`; one small
   backend addition (`byCategory`).
3. **Phase C** — backend-only; complements B by making the extra per-category
   fetches cheap on revisit. Independent of A/B (could run in parallel).

## Assumptions

- Single-instance backend (in-memory cache is per-process). Documented as a
  deviation to revisit (Redis) only if multi-worker/multi-instance is adopted.
- `GET /api/categories/{id}/feeds` already returns a category's feeds; the only
  new read shape is the `?uncategorized=true` filter on `GET /feeds`.
- The posts response already carries `feedTitle`, covering deep-linked feed
  scope titles without eager feed loading.
