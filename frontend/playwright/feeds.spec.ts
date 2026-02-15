/**
 * E2E tests for category and feed management on the /feeds page.
 */

import { test, expect, mockApi, makeCategory, makeFeed } from "./fixtures";

// ── Seed data ──────────────────────────────────────────────────────────

const techCategory = makeCategory({
  id: "cat-tech",
  name: "Technology",
  position: 0,
  feedCount: 1,
});
const newsCategory = makeCategory({ id: "cat-news", name: "News", position: 1, feedCount: 0 });
const techFeed = makeFeed("cat-tech", {
  id: "feed-tech-1",
  title: "Hacker News",
  url: "https://news.ycombinator.com/rss",
  siteUrl: "https://news.ycombinator.com",
});

// ── Helpers ────────────────────────────────────────────────────────────

async function setupFeedsPage(page: import("@playwright/test").Page) {
  // Categories list (wrapped in { categories: [...] })
  await mockApi(page, "**/api/categories", { categories: [techCategory, newsCategory] });

  // Feeds per category (wrapped in { feeds: [...] })
  await page.route("**/api/categories/cat-tech/feeds", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ feeds: [techFeed] }),
    })
  );
  await page.route("**/api/categories/cat-news/feeds", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ feeds: [] }),
    })
  );
}

// ── Category list ──────────────────────────────────────────────────────

test.describe("Category List", () => {
  test("displays feeds page heading", async ({ authedPage: page }) => {
    await setupFeedsPage(page);
    await page.goto("/feeds");

    await expect(page.getByRole("heading", { name: /my feeds/i })).toBeVisible();
  });

  test("shows empty state for user with no categories", async ({ authedPage: page }) => {
    await mockApi(page, "**/api/categories", { categories: [] });
    await page.goto("/feeds");

    await expect(page.getByText(/no categories/i)).toBeVisible();
  });

  test("displays categories with names", async ({ authedPage: page }) => {
    await setupFeedsPage(page);
    await page.goto("/feeds");

    await expect(page.getByText("Technology")).toBeVisible();
    await expect(page.getByText("News")).toBeVisible();
  });
});

// ── Create category ────────────────────────────────────────────────────

test.describe("Create Category", () => {
  test("opens dialog, creates category, and closes", async ({ authedPage: page }) => {
    await mockApi(page, "**/api/categories", { categories: [] });

    // POST returns wrapped response; after creation, a refresh also calls GET
    const newCat = makeCategory({
      id: "cat-new",
      name: "Entertainment",
      position: 0,
      feedCount: 0,
    });
    await page.route("**/api/categories", (route) => {
      if (route.request().method() === "POST") {
        return route.fulfill({
          status: 201,
          contentType: "application/json",
          body: JSON.stringify({ category: newCat }),
        });
      }
      return route.fallback();
    });

    await page.goto("/feeds");

    // Empty state shows a regular "Add Category" button
    await page.getByRole("button", { name: /add category/i }).click();

    // Dialog should open
    await expect(page.getByText(/new category/i)).toBeVisible();

    // Fill name and submit
    await page.getByLabel("Category Name").fill("Entertainment");
    await page.getByRole("button", { name: "Create" }).click();

    // Dialog should close
    await expect(page.getByText(/new category/i)).not.toBeVisible({ timeout: 3000 });
  });

  test("shows Create button disabled for empty name", async ({ authedPage: page }) => {
    await mockApi(page, "**/api/categories", { categories: [] });

    await page.goto("/feeds");
    await page.getByRole("button", { name: /add category/i }).click();

    const createBtn = page.getByRole("button", { name: "Create" });
    await expect(createBtn).toBeDisabled();
  });
});

// ── Edit category ──────────────────────────────────────────────────────

test.describe("Edit Category", () => {
  test("opens edit dialog with existing name", async ({ authedPage: page }) => {
    await setupFeedsPage(page);
    await page.goto("/feeds");

    // Open context menu for first category
    await page.getByLabel("category options").first().click();
    await page.getByText("Edit Category").click();

    // Should show edit dialog with pre-filled name
    await expect(page.getByRole("heading", { name: "Edit Category" })).toBeVisible();
    await expect(page.getByLabel("Category Name")).toHaveValue("Technology");
  });

  test("renames category on save", async ({ authedPage: page }) => {
    await setupFeedsPage(page);

    // Mock the PATCH endpoint (return wrapped response)
    await page.route("**/api/categories/cat-tech", (route) => {
      if (route.request().method() === "PATCH") {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ category: { ...techCategory, name: "Tech Renamed" } }),
        });
      }
      return route.fallback();
    });

    await page.goto("/feeds");
    await page.getByLabel("category options").first().click();
    await page.getByText("Edit Category").click();

    await page.getByLabel("Category Name").clear();
    await page.getByLabel("Category Name").fill("Tech Renamed");
    await page.getByRole("button", { name: "Save" }).click();

    // Dialog should close
    await expect(page.getByRole("heading", { name: "Edit Category" })).not.toBeVisible({
      timeout: 3000,
    });
  });
});

// ── Delete category ────────────────────────────────────────────────────

test.describe("Delete Category", () => {
  test("shows confirmation dialog and deletes on confirm", async ({ authedPage: page }) => {
    await setupFeedsPage(page);

    // Mock DELETE
    await page.route("**/api/categories/cat-tech", (route) => {
      if (route.request().method() === "DELETE") {
        return route.fulfill({ status: 204, body: "" });
      }
      return route.fallback();
    });

    await page.goto("/feeds");

    // Open context menu → delete
    await page.getByLabel("category options").first().click();
    await page.getByText("Delete Category").click();

    // Confirmation dialog
    await expect(page.getByText("Delete Category?")).toBeVisible();
    await expect(page.getByText(/are you sure/i)).toBeVisible();

    // Confirm
    await page.getByRole("button", { name: "Delete" }).click();

    // Dialog should close
    await expect(page.getByText("Delete Category?")).not.toBeVisible({ timeout: 3000 });
  });

  test("cancels deletion on Cancel", async ({ authedPage: page }) => {
    await setupFeedsPage(page);
    await page.goto("/feeds");

    await page.getByLabel("category options").first().click();
    await page.getByText("Delete Category").click();
    await expect(page.getByText("Delete Category?")).toBeVisible();

    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByText("Delete Category?")).not.toBeVisible({ timeout: 3000 });
  });
});

// ── Add feed ───────────────────────────────────────────────────────────

test.describe("Add Feed", () => {
  test("opens add-feed dialog from category menu", async ({ authedPage: page }) => {
    await setupFeedsPage(page);
    await page.goto("/feeds");

    // Open context menu → add feed
    await page.getByLabel("category options").first().click();
    await page.getByText("Add Feed").click();

    // Dialog should open — use the dialog's heading for specificity
    await expect(page.getByRole("heading", { name: /add feed/i })).toBeVisible();
  });
});
