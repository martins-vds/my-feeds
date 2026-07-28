# Loading Performance — Phase A (Skeletons) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the reader's loading spinners with content-shaped MUI `<Skeleton>` placeholders (posts, sidebar, post detail) so loading feels immediate and does not reflow when data arrives.

**Architecture:** Three small presentational skeleton components under `frontend/src/components/skeletons/`, each mirroring the real layout, wired into the three full-view loading states (`PostList`, `CategoryList`, `PostDetailPage`). Pure frontend; no API changes.

**Tech Stack:** React 18 + TypeScript (strict), MUI 5 (`Skeleton`), Vitest + @testing-library/react. pnpm. Tests run in Docker.

**Scope note:** This is Phase A of the three-phase "Loading Performance" design ([../specs/2026-07-28-loading-performance-design.md](../specs/2026-07-28-loading-performance-design.md)). Phase B (lazy fetching) and Phase C (response caching) get their own plans. `FeedRowsSkeleton` is intentionally **not** built here — it is only wired in Phase B, so it belongs to Phase B's plan (YAGNI).

## Global Constraints

- React 18, TypeScript strict, MUI 5. No new runtime dependencies (use MUI `<Skeleton>`).
- Every skeleton's root container MUST expose `role="status"`, `aria-busy="true"`, and a descriptive `aria-label`, and a stable `data-testid`.
- Skeletons MUST mirror the real content's layout closely enough that swapping in real data does not visibly reflow.
- Only full-view/list loading becomes skeletons. In-button spinners (Add Feed submit, Category form submit, audio "generating") stay as `CircularProgress`.
- Test commands (run in Docker from repo root):
  - Vitest (one file): `docker compose exec -T frontend pnpm exec vitest run <path>`
  - Typecheck: `docker compose exec -T frontend pnpm exec tsc --noEmit -p tsconfig.json`
- Assertions use plain DOM checks (`getAttribute`, `querySelectorAll(...).length`, `queryByTestId`) — do not assume `@testing-library/jest-dom` is configured.

---

## File Structure

- `frontend/src/components/skeletons/PostListSkeleton.tsx` — **new.** Post-card-shaped list placeholder.
- `frontend/src/components/skeletons/SidebarSkeleton.tsx` — **new.** Category-row placeholder.
- `frontend/src/components/skeletons/PostDetailSkeleton.tsx` — **new.** Article placeholder.
- `frontend/src/components/skeletons/__tests__/*.test.tsx` — **new.** One test file per component.
- `frontend/src/components/PostList.tsx` — **modify.** Swap the spinner for `PostListSkeleton`.
- `frontend/src/components/CategoryList.tsx` — **modify.** Swap the loading spinner for `SidebarSkeleton`.
- `frontend/src/pages/posts/PostDetailPage.tsx` — **modify.** Swap the loading spinner for `PostDetailSkeleton`.

---

## Task 1: `PostListSkeleton` + wire into `PostList`

**Files:**
- Create: `frontend/src/components/skeletons/PostListSkeleton.tsx`
- Create: `frontend/src/components/skeletons/__tests__/PostListSkeleton.test.tsx`
- Modify: `frontend/src/components/PostList.tsx`

**Interfaces:**
- Produces: `export function PostListSkeleton(props: { count?: number }): JSX.Element` (default `count = 6`), root `data-testid="posts-skeleton"`.

- [ ] **Step 1: Write the failing component test**

`frontend/src/components/skeletons/__tests__/PostListSkeleton.test.tsx`:
```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PostListSkeleton } from "../PostListSkeleton";

describe("PostListSkeleton", () => {
    it("renders `count` placeholder cards inside a status region", () => {
        render(<PostListSkeleton count={4} />);
        const region = screen.getByTestId("posts-skeleton");
        expect(region.getAttribute("role")).toBe("status");
        expect(region.getAttribute("aria-busy")).toBe("true");
        expect(region.querySelectorAll(".MuiCard-root")).toHaveLength(4);
    });

    it("defaults to 6 cards", () => {
        render(<PostListSkeleton />);
        expect(
            screen.getByTestId("posts-skeleton").querySelectorAll(".MuiCard-root")
        ).toHaveLength(6);
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `docker compose exec -T frontend pnpm exec vitest run src/components/skeletons/__tests__/PostListSkeleton.test.tsx`
Expected: FAIL — cannot resolve `../PostListSkeleton`.

- [ ] **Step 3: Create the component**

`frontend/src/components/skeletons/PostListSkeleton.tsx`:
```tsx
import { Box, Card, CardContent, Skeleton } from "@mui/material";

interface PostListSkeletonProps {
    /** Number of placeholder cards. */
    count?: number;
}

/**
 * Content-shaped placeholder for the post list while the first page loads.
 * Mirrors PostCard: a header row (feed icon + feed name + date), a title line,
 * and two summary lines.
 */
export function PostListSkeleton({ count = 6 }: PostListSkeletonProps) {
    return (
        <Box
            role="status"
            aria-busy="true"
            aria-label="Loading posts"
            data-testid="posts-skeleton"
        >
            {Array.from({ length: count }, (_, i) => (
                <Card key={i} sx={{ mb: 1 }}>
                    <CardContent sx={{ pb: 1 }}>
                        <Box
                            sx={{
                                display: "flex",
                                alignItems: "center",
                                gap: 1,
                                mb: 0.5,
                            }}
                        >
                            <Skeleton variant="circular" width={16} height={16} />
                            <Skeleton variant="text" width={120} />
                            <Box sx={{ flexGrow: 1 }} />
                            <Skeleton variant="text" width={48} />
                        </Box>
                        <Skeleton variant="text" width="80%" height={28} />
                        <Skeleton variant="text" width="95%" />
                        <Skeleton variant="text" width="60%" />
                    </CardContent>
                </Card>
            ))}
        </Box>
    );
}

export default PostListSkeleton;
```

- [ ] **Step 4: Run the component test to verify it passes**

Run: `docker compose exec -T frontend pnpm exec vitest run src/components/skeletons/__tests__/PostListSkeleton.test.tsx`
Expected: PASS.

- [ ] **Step 5: Write a failing wiring test in the existing PostList suite**

Append to `frontend/src/components/__tests__/PostList.test.tsx` (inside the top-level `describe`, reusing its existing imports/helpers):
```tsx
    it("shows the skeleton (not a spinner) while the first page loads", () => {
        render(
            <PostList
                posts={[]}
                loading
                loadingMore={false}
                hasMore={false}
                error={null}
            />
        );
        expect(screen.queryByTestId("posts-skeleton")).not.toBeNull();
    });
```
(If `screen` or `render` are not already imported in that file, import them from `@testing-library/react`.)

- [ ] **Step 6: Run it to verify it fails**

Run: `docker compose exec -T frontend pnpm exec vitest run src/components/__tests__/PostList.test.tsx`
Expected: FAIL — no `posts-skeleton` (the current `PostsSkeleton` renders a `CircularProgress`).

- [ ] **Step 7: Wire `PostListSkeleton` into `PostList`**

In `frontend/src/components/PostList.tsx`:
1. Add the import near the other imports:
```tsx
import { PostListSkeleton } from "./skeletons/PostListSkeleton";
```
2. Delete the local `PostsSkeleton` component (the `<CircularProgress />` one):
```tsx
/**
 * Loading skeleton for posts
 */
const PostsSkeleton: React.FC = () => (
    <Box sx={{ py: 4, display: "flex", justifyContent: "center" }}>
        <CircularProgress />
    </Box>
);
```
3. Change the initial-loading return:
```tsx
    // Initial loading state
    if (loading && posts.length === 0) {
        return <PostListSkeleton />;
    }
```
4. If `CircularProgress` is now unused in this file, remove it from the `@mui/material` import (verify by searching the file — the load-more indicator may still use it; keep it only if referenced).

- [ ] **Step 8: Run PostList tests + typecheck to verify green**

Run: `docker compose exec -T frontend pnpm exec vitest run src/components/__tests__/PostList.test.tsx src/components/skeletons/__tests__/PostListSkeleton.test.tsx`
Expected: PASS.
Run: `docker compose exec -T frontend pnpm exec tsc --noEmit -p tsconfig.json`
Expected: no errors (fails if `CircularProgress` was left imported-but-unused only when `noUnusedLocals` is on — remove it if so).

- [ ] **Step 9: Commit**

```bash
git add frontend/src/components/skeletons/PostListSkeleton.tsx frontend/src/components/skeletons/__tests__/PostListSkeleton.test.tsx frontend/src/components/PostList.tsx frontend/src/components/__tests__/PostList.test.tsx
git commit -m "feat(skeletons): post list skeleton replaces the loading spinner"
```

---

## Task 2: `SidebarSkeleton` + wire into `CategoryList`

**Files:**
- Create: `frontend/src/components/skeletons/SidebarSkeleton.tsx`
- Create: `frontend/src/components/skeletons/__tests__/SidebarSkeleton.test.tsx`
- Modify: `frontend/src/components/CategoryList.tsx`

**Interfaces:**
- Produces: `export function SidebarSkeleton(props: { count?: number }): JSX.Element` (default `count = 4`), root `data-testid="sidebar-skeleton"`.

- [ ] **Step 1: Write the failing component test**

`frontend/src/components/skeletons/__tests__/SidebarSkeleton.test.tsx`:
```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SidebarSkeleton } from "../SidebarSkeleton";

describe("SidebarSkeleton", () => {
    it("renders `count` placeholder rows inside a status region", () => {
        render(<SidebarSkeleton count={3} />);
        const region = screen.getByTestId("sidebar-skeleton");
        expect(region.getAttribute("role")).toBe("status");
        expect(region.getAttribute("aria-busy")).toBe("true");
        expect(region.querySelectorAll(".MuiListItem-root")).toHaveLength(3);
    });

    it("defaults to 4 rows", () => {
        render(<SidebarSkeleton />);
        expect(
            screen.getByTestId("sidebar-skeleton").querySelectorAll(".MuiListItem-root")
        ).toHaveLength(4);
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `docker compose exec -T frontend pnpm exec vitest run src/components/skeletons/__tests__/SidebarSkeleton.test.tsx`
Expected: FAIL — cannot resolve `../SidebarSkeleton`.

- [ ] **Step 3: Create the component**

`frontend/src/components/skeletons/SidebarSkeleton.tsx`:
```tsx
import {
    List,
    ListItem,
    ListItemIcon,
    ListItemText,
    Skeleton,
} from "@mui/material";

interface SidebarSkeletonProps {
    /** Number of placeholder category rows. */
    count?: number;
}

/**
 * Content-shaped placeholder for the sidebar category tree while it loads.
 * Mirrors a category row: a folder icon, a name line, and a "N feeds" line.
 */
export function SidebarSkeleton({ count = 4 }: SidebarSkeletonProps) {
    return (
        <List
            role="status"
            aria-busy="true"
            aria-label="Loading feeds"
            data-testid="sidebar-skeleton"
            sx={{ py: 0 }}
        >
            {Array.from({ length: count }, (_, i) => (
                <ListItem key={i} sx={{ py: 1 }}>
                    <ListItemIcon sx={{ minWidth: 36 }}>
                        <Skeleton variant="circular" width={24} height={24} />
                    </ListItemIcon>
                    <ListItemText
                        primary={<Skeleton variant="text" width="60%" />}
                        secondary={<Skeleton variant="text" width="30%" />}
                    />
                </ListItem>
            ))}
        </List>
    );
}

export default SidebarSkeleton;
```

- [ ] **Step 4: Run the component test to verify it passes**

Run: `docker compose exec -T frontend pnpm exec vitest run src/components/skeletons/__tests__/SidebarSkeleton.test.tsx`
Expected: PASS.

- [ ] **Step 5: Write a failing wiring test in the existing CategoryList suite**

Append to `frontend/src/components/__tests__/CategoryList.test.tsx` (inside the top-level `describe`; reuse its existing render helper/props — pass `loading`). If the suite has a helper that builds default props, spread it and override `loading: true`; otherwise render with the minimal props the component needs and `loading`:
```tsx
    it("shows the sidebar skeleton while categories load", () => {
        render(
            <CategoryList
                categories={[]}
                feeds={[]}
                loading
                error={null}
                selectedCategoryId={null}
                onSelectCategory={() => {}}
                onCreateCategory={async () => {}}
                onUpdateCategory={async () => {}}
                onDeleteCategory={async () => {}}
                onAddFeed={async () => {}}
                onDeleteFeed={async () => {}}
                onRefreshFeed={async () => {}}
                onSetFeedCategories={async () => {}}
                onSetFeedActive={async () => {}}
                unreadByFeed={{}}
                onSelectFeed={() => {}}
                onSelectUncategorized={() => {}}
                onMarkCategoryRead={() => {}}
                onMarkUncategorizedRead={() => {}}
                onMarkFeedRead={() => {}}
            />
        );
        expect(screen.queryByTestId("sidebar-skeleton")).not.toBeNull();
    });
```
(Adjust the prop set to match `CategoryListProps` exactly — read the component's prop type first; the point of the test is that `loading` renders `sidebar-skeleton`.)

- [ ] **Step 6: Run it to verify it fails**

Run: `docker compose exec -T frontend pnpm exec vitest run src/components/__tests__/CategoryList.test.tsx`
Expected: FAIL — the loading branch renders a `CircularProgress`, no `sidebar-skeleton`.

- [ ] **Step 7: Wire `SidebarSkeleton` into `CategoryList`**

In `frontend/src/components/CategoryList.tsx`:
1. Add the import:
```tsx
import { SidebarSkeleton } from "./skeletons/SidebarSkeleton";
```
2. Replace the loading branch:
```tsx
    // Loading state
    if (loading) {
        return (
            <Box
                sx={{
                    display: "flex",
                    justifyContent: "center",
                    alignItems: "center",
                    p: 4,
                }}
            >
                <CircularProgress />
            </Box>
        );
    }
```
with:
```tsx
    // Loading state
    if (loading) {
        return <SidebarSkeleton />;
    }
```
3. If `CircularProgress` is now unused in this file, remove it from the `@mui/material` import (verify by search — feed refresh spinners elsewhere in the file may still use it).

- [ ] **Step 8: Run CategoryList tests + typecheck to verify green**

Run: `docker compose exec -T frontend pnpm exec vitest run src/components/__tests__/CategoryList.test.tsx src/components/skeletons/__tests__/SidebarSkeleton.test.tsx`
Expected: PASS.
Run: `docker compose exec -T frontend pnpm exec tsc --noEmit -p tsconfig.json`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/components/skeletons/SidebarSkeleton.tsx frontend/src/components/skeletons/__tests__/SidebarSkeleton.test.tsx frontend/src/components/CategoryList.tsx frontend/src/components/__tests__/CategoryList.test.tsx
git commit -m "feat(skeletons): sidebar skeleton replaces the category loading spinner"
```

---

## Task 3: `PostDetailSkeleton` + wire into `PostDetailPage`

**Files:**
- Create: `frontend/src/components/skeletons/PostDetailSkeleton.tsx`
- Create: `frontend/src/components/skeletons/__tests__/PostDetailSkeleton.test.tsx`
- Modify: `frontend/src/pages/posts/PostDetailPage.tsx`

**Interfaces:**
- Produces: `export function PostDetailSkeleton(): JSX.Element`, root `data-testid="post-detail-skeleton"`.

- [ ] **Step 1: Write the failing component test**

`frontend/src/components/skeletons/__tests__/PostDetailSkeleton.test.tsx`:
```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PostDetailSkeleton } from "../PostDetailSkeleton";

describe("PostDetailSkeleton", () => {
    it("renders an accessible article placeholder", () => {
        render(<PostDetailSkeleton />);
        const region = screen.getByTestId("post-detail-skeleton");
        expect(region.getAttribute("role")).toBe("status");
        expect(region.getAttribute("aria-busy")).toBe("true");
        // Title + metadata + body lines → several skeletons.
        expect(
            region.querySelectorAll(".MuiSkeleton-root").length
        ).toBeGreaterThanOrEqual(8);
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `docker compose exec -T frontend pnpm exec vitest run src/components/skeletons/__tests__/PostDetailSkeleton.test.tsx`
Expected: FAIL — cannot resolve `../PostDetailSkeleton`.

- [ ] **Step 3: Create the component**

`frontend/src/components/skeletons/PostDetailSkeleton.tsx`:
```tsx
import { Box, Skeleton } from "@mui/material";

/**
 * Content-shaped placeholder for the Post Detail article while it loads.
 * Mirrors the article: a title, a metadata row, a lead media block, and body
 * paragraph lines.
 */
export function PostDetailSkeleton() {
    return (
        <Box
            role="status"
            aria-busy="true"
            aria-label="Loading article"
            data-testid="post-detail-skeleton"
        >
            <Skeleton variant="text" width="70%" height={48} sx={{ mb: 2 }} />
            <Box sx={{ display: "flex", flexWrap: "wrap", gap: 2, mb: 3 }}>
                <Skeleton variant="text" width={120} />
                <Skeleton variant="text" width={100} />
                <Skeleton variant="text" width={80} />
            </Box>
            <Skeleton variant="rectangular" height={180} sx={{ mb: 3, borderRadius: 1 }} />
            {Array.from({ length: 8 }, (_, i) => (
                <Skeleton key={i} variant="text" width={i % 4 === 3 ? "60%" : "100%"} />
            ))}
        </Box>
    );
}

export default PostDetailSkeleton;
```

- [ ] **Step 4: Run the component test to verify it passes**

Run: `docker compose exec -T frontend pnpm exec vitest run src/components/skeletons/__tests__/PostDetailSkeleton.test.tsx`
Expected: PASS.

- [ ] **Step 5: Wire `PostDetailSkeleton` into `PostDetailPage`**

In `frontend/src/pages/posts/PostDetailPage.tsx`:
1. Add the import:
```tsx
import { PostDetailSkeleton } from "../../components/skeletons/PostDetailSkeleton";
```
2. Replace the loading branch (currently a centered `CircularProgress`):
```tsx
    // Loading state
    if (loading) {
        return (
            <Container maxWidth="md" sx={{ py: 4 }}>
                <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
                    <CircularProgress />
                </Box>
            </Container>
        );
    }
```
with a skeleton wrapped in the same Container + Paper the loaded article uses, so there is no reflow:
```tsx
    // Loading state
    if (loading) {
        return (
            <Container maxWidth="md" sx={{ py: 3 }}>
                <Paper elevation={0} sx={{ p: { xs: 2, md: 4 } }}>
                    <PostDetailSkeleton />
                </Paper>
            </Container>
        );
    }
```
3. If `CircularProgress` is now unused in this file, remove it from the `@mui/material` import (verify by search).

- [ ] **Step 6: Add a failing page-level wiring test**

`frontend/src/pages/posts/__tests__/PostDetailPage.loading.test.tsx` (new):
```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { PostDetailPage } from "../PostDetailPage";
import api from "../../../services/api";

// Keep the fetch pending so the component stays in its initial loading state.
vi.mock("../../../services/api", () => ({
    default: { get: vi.fn(() => new Promise(() => {})), put: vi.fn() },
    ApiError: class ApiError extends Error {},
}));

describe("PostDetailPage loading", () => {
    beforeEach(() => vi.clearAllMocks());

    it("shows the article skeleton while the post loads", () => {
        render(
            <MemoryRouter initialEntries={["/posts/p1"]}>
                <Routes>
                    <Route path="/posts/:id" element={<PostDetailPage />} />
                </Routes>
            </MemoryRouter>
        );
        expect(api.get).toHaveBeenCalled();
        expect(screen.queryByTestId("post-detail-skeleton")).not.toBeNull();
    });
});
```
(Adjust the mock's default export shape to match how `PostDetailPage` imports `api` — read the top of `PostDetailPage.tsx` first; the goal is a never-resolving `api.get` so the initial `loading` state renders.)

- [ ] **Step 7: Run the page test + typecheck**

Run: `docker compose exec -T frontend pnpm exec vitest run src/pages/posts/__tests__/PostDetailPage.loading.test.tsx src/components/skeletons/__tests__/PostDetailSkeleton.test.tsx`
Expected: PASS.
Run: `docker compose exec -T frontend pnpm exec tsc --noEmit -p tsconfig.json`
Expected: no errors.

- [ ] **Step 8: Full frontend suite regression**

Run: `docker compose exec -T frontend pnpm test`
Expected: PASS (all suites, including the three new skeleton suites and the updated PostList/CategoryList suites).

- [ ] **Step 9: Commit**

```bash
git add frontend/src/components/skeletons/PostDetailSkeleton.tsx frontend/src/components/skeletons/__tests__/PostDetailSkeleton.test.tsx frontend/src/pages/posts/PostDetailPage.tsx frontend/src/pages/posts/__tests__/PostDetailPage.loading.test.tsx
git commit -m "feat(skeletons): article skeleton replaces the post detail loading spinner"
```

---

## Self-Review (completed by author)

- **Spec coverage:** Phase A of the design requires content-shaped skeletons for posts (Task 1), sidebar categories (Task 2), and post detail (Task 3), each with `role="status"`/`aria-busy`, replacing the spinners — all covered. `FeedRowsSkeleton` is deferred to Phase B per the design (only wired there). In-button spinners are left intact per the Global Constraints.
- **Placeholder scan:** none — every step has runnable code/commands. The two "read the prop type / import shape first" notes are verification instructions for pre-existing code the implementer must match exactly, not missing plan content.
- **Type consistency:** `PostListSkeleton({count})`, `SidebarSkeleton({count})`, `PostDetailSkeleton()` and the test ids (`posts-skeleton`, `sidebar-skeleton`, `post-detail-skeleton`) are used identically across creation, wiring, and tests.
