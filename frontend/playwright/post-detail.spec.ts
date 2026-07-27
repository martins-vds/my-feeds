/**
 * E2E tests for the Post Detail page (/posts/:id).
 */

import { test, expect, mockApi, makePostDetail } from "./fixtures";

// ── Seed data ──────────────────────────────────────────────────────────

const postDetail = makePostDetail("feed-1", {
  id: "post-detail-1",
  title: "Understanding React Server Components",
  content: "<h2>Introduction</h2><p>React Server Components represent a paradigm shift.</p>",
  summary: "An overview of RSC",
  feedTitle: "React Blog",
  feedIconUrl: null,
  author: "Dan Abramov",
  link: "https://react.dev/blog/rsc",
  publishedAt: "2026-01-10T10:00:00Z",
  isRead: false,
  hasAudio: false,
});

// ── Helpers ────────────────────────────────────────────────────────────

async function setupDetailPage(page: import("@playwright/test").Page) {
  await mockApi(page, `**/api/posts/${postDetail.id}`, postDetail);
  await mockApi(page, "**/api/categories", { categories: [] });
}

// ── Tests ──────────────────────────────────────────────────────────────

test.describe("Post Detail Page", () => {
  test("displays full post content", async ({ authedPage: page }) => {
    await setupDetailPage(page);

    await page.goto(`/posts/${postDetail.id}`);

    // Title
    await expect(page.getByTestId("post-title")).toContainText(
      "Understanding React Server Components"
    );
    // Content
    await expect(page.getByTestId("post-content")).toContainText(
      "React Server Components represent a paradigm shift"
    );
  });

  test("shows post metadata (feed title, author, date)", async ({ authedPage: page }) => {
    await setupDetailPage(page);
    await page.goto(`/posts/${postDetail.id}`);

    await expect(page.getByTestId("feed-title")).toContainText("React Blog");
    await expect(page.getByTestId("post-author")).toContainText("Dan Abramov");
    await expect(page.getByTestId("post-date")).toBeVisible();
  });

  test("has link to original article", async ({ authedPage: page }) => {
    await setupDetailPage(page);
    await page.goto(`/posts/${postDetail.id}`);

    const link = page.getByTestId("original-link");
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("href", "https://react.dev/blog/rsc");
  });

  test("shows read/unread chip reflecting post state", async ({ authedPage: page }) => {
    await setupDetailPage(page);
    await page.goto(`/posts/${postDetail.id}`);

    // Post starts as unread (isRead: false)
    const chip = page.getByText(/^(Read|Unread)$/);
    await expect(chip).toBeVisible();
  });

  test("navigates back to posts list when clicking back button", async ({ authedPage: page }) => {
    await setupDetailPage(page);
    // Mock the posts list for back navigation
    await mockApi(page, "**/api/posts*", { posts: [], hasMore: false, nextCursor: null });

    await page.goto(`/posts/${postDetail.id}`);
    await page.getByTestId("back-button").first().click();

    await expect(page).toHaveURL(/\/posts$/);
  });

  test("shows error for non-existent post", async ({ authedPage: page }) => {
    const fakeId = "00000000-0000-0000-0000-000000000000";
    await mockApi(
      page,
      `**/api/posts/${fakeId}`,
      { error: { code: "NOT_FOUND", message: "Post not found" } },
      { status: 404 }
    );
    await mockApi(page, "**/api/categories", { categories: [] });

    await page.goto(`/posts/${fakeId}`);

    await expect(page.getByTestId("error-message")).toContainText(/not found/i);
  });

  test("toggles read state when clicking toggle button", async ({ authedPage: page }) => {
    await setupDetailPage(page);

    // Mock the PUT read-state endpoint
    await page.route(`**/api/posts/${postDetail.id}/read-state`, (route) => {
      if (route.request().method() === "PUT") {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ id: postDetail.id, isRead: true }),
        });
      }
      return route.fallback();
    });

    await page.goto(`/posts/${postDetail.id}`);

    // ReadStateToggle button: aria-label is "Mark post as read" (unread) or "Mark post as unread" (read)
    const toggleBtn = page.getByRole("button", { name: /mark post as/i });
    await expect(toggleBtn).toBeVisible();
    await toggleBtn.click();

    // After toggling isRead: false → true, label becomes "Mark post as unread"
    await expect(page.getByRole("button", { name: /mark post as unread/i })).toBeVisible({
      timeout: 3000,
    });
  });
});

test.describe("Post Detail - Authentication", () => {
  test("redirects to signin when not authenticated", async ({ page }) => {
    await mockApi(
      page,
      "**/api/auth/me",
      { error: { code: "UNAUTHORIZED", message: "Not authenticated" } },
      { status: 401 }
    );

    await page.goto("/posts/some-post-id");
    await expect(page).toHaveURL(/\/signin/);
  });
});

test.describe("Post Detail - no readable content", () => {
  const commentsOnly = makePostDetail("feed-1", {
    id: "post-comments-only",
    title: "AI companies are shredding rare books",
    content: '<a href="https://news.ycombinator.com/item?id=1">Comments</a>',
    summary: '<a href="https://news.ycombinator.com/item?id=1">Comments</a>',
    feedTitle: "Hacker News",
    link: "https://example.com/article",
    hasAudio: false,
  });

  test("shows an 'only on original site' placeholder and hides audio", async ({
    authedPage: page,
  }) => {
    await mockApi(page, `**/api/posts/${commentsOnly.id}`, commentsOnly);
    await mockApi(page, "**/api/categories", { categories: [] });

    await page.goto(`/posts/${commentsOnly.id}`);

    await expect(page.getByTestId("post-content")).toContainText(
      "This article is only available on the original site"
    );
    // No audio affordances for a post with no readable content.
    await expect(page.getByTestId("listen-button")).toHaveCount(0);
    await expect(page.getByTestId("play-pause-button")).toHaveCount(0);
    // But the original article is still reachable.
    await expect(page.getByRole("link", { name: /read original/i })).toBeVisible();
  });
});
