/**
 * E2E tests for the Posts browsing page (/posts).
 */

import { test, expect, mockApi, makePost, makeCategory, makeFeed } from "./fixtures";

// ── Seed data ──────────────────────────────────────────────────────────

const category = makeCategory({ id: "cat-1", name: "Tech", feedCount: 1 });
const feed = makeFeed("cat-1", { id: "feed-1", title: "Tech Blog" });

function makePosts(count: number) {
  return Array.from({ length: count }, (_, i) =>
    makePost("feed-1", {
      id: `post-${i + 1}`,
      title: `Post Title ${i + 1}`,
      feedTitle: "Tech Blog",
      publishedAt: new Date(2026, 0, 15 - i, 12, 0, 0).toISOString(),
      isRead: i >= 3, // first 3 unread, rest read
      hasAudio: i === 0,
    })
  );
}

const posts = makePosts(5);

// ── Helpers ────────────────────────────────────────────────────────────

async function setupPostsPage(page: import("@playwright/test").Page) {
  await mockApi(page, "**/api/categories", { categories: [category] });
  await page.route("**/api/categories/cat-1/feeds", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ feeds: [feed] }),
    })
  );
  await mockApi(page, "**/api/posts*", {
    posts,
    hasMore: false,
    nextCursor: null,
  });
}

// ── Tests ──────────────────────────────────────────────────────────────

test.describe("Posts Page", () => {
  test("displays posts list", async ({ authedPage: page }) => {
    await setupPostsPage(page);
    await page.goto("/posts");

    // Should show posts heading
    await expect(page.getByRole("heading", { name: "Posts" })).toBeVisible();

    // Should show post cards
    for (const post of posts.slice(0, 3)) {
      await expect(page.getByText(post.title as string)).toBeVisible();
    }
  });

  test("displays feed title on each post card", async ({ authedPage: page }) => {
    await setupPostsPage(page);
    await page.goto("/posts");

    // Each post shows its feed title
    const feedLabels = page.getByText("Tech Blog");
    await expect(feedLabels.first()).toBeVisible();
  });

  test("shows audio chip for posts with audio", async ({ authedPage: page }) => {
    await setupPostsPage(page);
    await page.goto("/posts");

    // Post 1 has hasAudio=true, the PostCard shows an Audio chip
    await expect(page.getByText("Audio").first()).toBeVisible();
  });

  test("shows empty state when no posts", async ({ authedPage: page }) => {
    await mockApi(page, "**/api/categories", { categories: [] });
    await mockApi(page, "**/api/posts*", {
      posts: [],
      hasMore: false,
      nextCursor: null,
    });

    await page.goto("/posts");

    await expect(page.getByText(/no posts/i)).toBeVisible();
  });

  test("shows Load More button when hasMore is true", async ({ authedPage: page }) => {
    await mockApi(page, "**/api/categories", { categories: [category] });
    await page.route("**/api/categories/cat-1/feeds", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ feeds: [feed] }),
      })
    );
    await mockApi(page, "**/api/posts*", {
      posts: posts.slice(0, 3),
      hasMore: true,
      nextCursor: "cursor-abc",
    });

    await page.goto("/posts");
    await expect(page.getByRole("button", { name: /load more/i })).toBeVisible();
  });

  test("hides Load More button when hasMore is false", async ({ authedPage: page }) => {
    await setupPostsPage(page);
    await page.goto("/posts");

    await expect(page.getByRole("button", { name: /load more/i })).not.toBeVisible();
  });
});

test.describe("Posts Page - Filter controls", () => {
  test("shows read-state filter buttons", async ({ authedPage: page }) => {
    await setupPostsPage(page);
    await page.goto("/posts");

    // ToggleButtons have aria-labels: "All posts", "Unread posts", "Read posts"
    await expect(page.getByRole("button", { name: "All posts" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Unread posts" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Read posts", exact: true })).toBeVisible();
  });

  test("filters by unread when clicking Unread button", async ({ authedPage: page }) => {
    await setupPostsPage(page);

    // Override posts mock to handle readState param
    await page.route("**/api/posts*", (route) => {
      const url = new URL(route.request().url());
      if (url.searchParams.get("readState") === "unread") {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            posts: posts.filter((p) => !p.isRead),
            hasMore: false,
            nextCursor: null,
          }),
        });
      }
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ posts, hasMore: false, nextCursor: null }),
      });
    });

    await page.goto("/posts");
    await page.getByRole("button", { name: /unread posts/i }).click();

    // The Unread button should now be selected (pressed)
    await expect(page.getByRole("button", { name: /unread posts/i })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
  });
});

test.describe("Posts Page - Authentication", () => {
  test("redirects to signin when not authenticated", async ({ page }) => {
    await mockApi(
      page,
      "**/api/auth/me",
      { error: { code: "UNAUTHORIZED", message: "Not authenticated" } },
      { status: 401 }
    );

    await page.goto("/posts");
    await expect(page).toHaveURL(/\/signin/);
  });
});
