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

    // Per-test override: registered AFTER setupReaderApi so it wins (LIFO).
    let categoryFeedsRequested = 0;
    await page.route("**/api/categories/*/feeds", async (route) => {
      categoryFeedsRequested += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([techFeed]),
      });
    });

    await page.goto("/posts");

    // Collapsed category shows its backend-sourced unread badge.
    await expect(page.getByText("Technology")).toBeVisible();
    await expect(page.getByText("4").first()).toBeVisible();
    // No per-category API call yet (nothing expanded).
    expect(categoryFeedsRequested).toBe(0);
    // Categorized feed is NOT in the DOM yet.
    await expect(page.getByText("Hacker News")).toHaveCount(0);

    // Uncategorized section is present — feeds were loaded eagerly on mount.
    // Expanding it does NOT trigger a per-category API call.
    await expect(page.getByText("Uncategorized")).toBeVisible();
    await page.getByText("Uncategorized").click();
    await expect(page.getByText("Bare Blog")).toBeVisible();
    expect(categoryFeedsRequested).toBe(0);

    // Expand the Technology category → its feeds are fetched and rendered.
    await page.getByText("Technology").click();
    await expect(page.getByText("Hacker News")).toBeVisible();
    expect(categoryFeedsRequested).toBe(1);
  });
});
