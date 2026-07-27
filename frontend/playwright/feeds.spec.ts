/**
 * E2E tests for feed & category management in the reader sidebar (/posts).
 */

import { test, expect, setupReaderApi, makeCategory, makeFeed } from "./fixtures";

// ── Seed data ──────────────────────────────────────────────────────────

const catTech = makeCategory({ id: "cat-tech", name: "Technology", feedCount: 1 });
const techFeed = makeFeed(["cat-tech"], {
    id: "feed-tech",
    title: "Hacker News",
    url: "https://news.ycombinator.com/rss",
});

function baseReader() {
    return {
        categories: [catTech],
        feeds: [techFeed],
        posts: [],
        unread: { byFeed: {}, total: 0 },
    };
}

// ── Categories ─────────────────────────────────────────────────────────

test.describe("Sidebar — categories", () => {
    test("creates a category", async ({ authedPage: page }) => {
        await setupReaderApi(page, { categories: [], feeds: [] });

        const newCat = makeCategory({ id: "cat-new", name: "Entertainment" });
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

        await page.goto("/posts");

        await page.getByTestId("feed-sidebar").getByRole("button", { name: "add category" }).click();
        await expect(page.getByRole("heading", { name: "New Category" })).toBeVisible();

        await page.getByLabel("Category Name").fill("Entertainment");
        await page.getByRole("dialog").getByRole("button", { name: "Create" }).click();

        await expect(page.getByRole("heading", { name: "New Category" })).not.toBeVisible({
            timeout: 3000,
        });
    });

    test("edits a category", async ({ authedPage: page }) => {
        await setupReaderApi(page, baseReader());

        await page.route("**/api/categories/cat-tech", (route) => {
            if (route.request().method() === "PATCH") {
                return route.fulfill({
                    status: 200,
                    contentType: "application/json",
                    body: JSON.stringify({ category: { ...catTech, name: "Tech Renamed" } }),
                });
            }
            return route.fallback();
        });

        await page.goto("/posts");

        await page.getByTestId("feed-sidebar").getByLabel("category options").first().click();
        await page.getByText("Edit Category").click();

        await expect(page.getByRole("heading", { name: "Edit Category" })).toBeVisible();
        await expect(page.getByLabel("Category Name")).toHaveValue("Technology");

        await page.getByLabel("Category Name").fill("Tech Renamed");
        await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();

        await expect(page.getByRole("heading", { name: "Edit Category" })).not.toBeVisible({
            timeout: 3000,
        });
    });

    test("deletes a category", async ({ authedPage: page }) => {
        await setupReaderApi(page, baseReader());

        await page.route("**/api/categories/cat-tech", (route) => {
            if (route.request().method() === "DELETE") {
                return route.fulfill({ status: 204, body: "" });
            }
            return route.fallback();
        });

        await page.goto("/posts");

        await page.getByTestId("feed-sidebar").getByLabel("category options").first().click();
        await page.getByText("Delete Category").click();

        await expect(page.getByText("Delete Category?")).toBeVisible();
        await page.getByRole("dialog").getByRole("button", { name: "Delete", exact: true }).click();

        await expect(page.getByText("Delete Category?")).not.toBeVisible({ timeout: 3000 });
    });
});

// ── Feeds ──────────────────────────────────────────────────────────────

test.describe("Sidebar — feeds", () => {
    test("adds a feed", async ({ authedPage: page }) => {
        await setupReaderApi(page, { categories: [], feeds: [] });

        const created = makeFeed([], {
            id: "feed-new",
            title: "New Feed",
            url: "https://example.com/new.xml",
        });
        await page.route("**/api/feeds", (route) => {
            if (route.request().method() === "POST") {
                return route.fulfill({
                    status: 201,
                    contentType: "application/json",
                    body: JSON.stringify(created),
                });
            }
            return route.fallback();
        });

        await page.goto("/posts");

        await page.getByTestId("feed-sidebar").getByLabel("add feed").click();
        await expect(page.getByRole("heading", { name: "Add Feed" })).toBeVisible();

        await page.getByLabel("Feed URL").fill("https://example.com/new.xml");
        await page.getByRole("dialog").getByRole("button", { name: "Add Feed" }).click();

        await expect(page.getByRole("heading", { name: "Add Feed" })).not.toBeVisible({
            timeout: 5000,
        });
    });

    test("pauses a feed", async ({ authedPage: page }) => {
        await setupReaderApi(page, baseReader());

        await page.route("**/api/feeds/feed-tech", (route) => {
            if (route.request().method() === "PATCH") {
                return route.fulfill({
                    status: 200,
                    contentType: "application/json",
                    body: JSON.stringify({ ...techFeed, isActive: false }),
                });
            }
            return route.fallback();
        });

        await page.goto("/posts");

        const sidebar = page.getByTestId("feed-sidebar");
        // Expand the category to reveal its feeds.
        await sidebar.getByRole("button", { name: /Technology/ }).click();
        await sidebar.getByLabel("feed options").first().click();
        await page.getByRole("menuitem", { name: "Pause" }).click();

        await expect(sidebar.getByText("Paused")).toBeVisible();
    });
});

// ── Mark all read/unread ───────────────────────────────────────────────

const looseFeed = makeFeed([], { id: "feed-loose", title: "Loose Feed" });

function markReader() {
    return {
        categories: [catTech],
        feeds: [techFeed, looseFeed],
        posts: [],
        unread: { byFeed: { "feed-tech": 3, "feed-loose": 2 }, total: 5 },
    };
}

async function stubBulkReadState(page: import("@playwright/test").Page) {
    await page.route("**/api/posts/read-state", (route) => {
        if (route.request().method() === "PUT") {
            return route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({ updated: 3 }),
            });
        }
        return route.fallback();
    });
}

test.describe("Sidebar — mark all read", () => {
    test("marks a whole category read", async ({ authedPage: page }) => {
        await setupReaderApi(page, markReader());
        await stubBulkReadState(page);
        await page.goto("/posts");

        await page.getByTestId("feed-sidebar").getByLabel("category options").first().click();
        const [request] = await Promise.all([
            page.waitForRequest(
                (r) => r.url().includes("/api/posts/read-state") && r.method() === "PUT"
            ),
            page.getByRole("menuitem", { name: "Mark all as read" }).click(),
        ]);
        expect(request.postDataJSON()).toMatchObject({ isRead: true, categoryId: "cat-tech" });
    });

    test("marks a single feed unread", async ({ authedPage: page }) => {
        await setupReaderApi(page, markReader());
        await stubBulkReadState(page);
        await page.goto("/posts");

        const sidebar = page.getByTestId("feed-sidebar");
        await sidebar.getByRole("button", { name: /Technology/ }).click();
        await sidebar.getByLabel("feed options").first().click();
        const [request] = await Promise.all([
            page.waitForRequest(
                (r) => r.url().includes("/api/posts/read-state") && r.method() === "PUT"
            ),
            page.getByRole("menuitem", { name: "Mark all as unread" }).click(),
        ]);
        expect(request.postDataJSON()).toMatchObject({ isRead: false, feedId: "feed-tech" });
    });

    test("marks the uncategorized group read", async ({ authedPage: page }) => {
        await setupReaderApi(page, markReader());
        await stubBulkReadState(page);
        await page.goto("/posts");

        await page.getByTestId("feed-sidebar").getByLabel("uncategorized options").click();
        const [request] = await Promise.all([
            page.waitForRequest(
                (r) => r.url().includes("/api/posts/read-state") && r.method() === "PUT"
            ),
            page.getByRole("menuitem", { name: "Mark all as read" }).click(),
        ]);
        expect(request.postDataJSON()).toMatchObject({ isRead: true, uncategorized: true });
    });
});
