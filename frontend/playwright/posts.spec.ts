/**
 * E2E tests for the unified reader (/posts): post list + sidebar navigation.
 */

import {
    test,
    expect,
    setupReaderApi,
    makePost,
    makeCategory,
    makeFeed,
} from "./fixtures";

// ── Seed data ──────────────────────────────────────────────────────────

const catTech = makeCategory({ id: "cat-tech", name: "Technology", feedCount: 1 });
const catNews = makeCategory({ id: "cat-news", name: "News", feedCount: 1 });
const techFeed = makeFeed(["cat-tech"], { id: "feed-tech", title: "Tech Blog" });
const newsFeed = makeFeed(["cat-news"], { id: "feed-news", title: "News Daily" });
const blogFeed = makeFeed([], { id: "feed-blog", title: "Personal Blog" });

function makePosts(count: number) {
    return Array.from({ length: count }, (_, i) =>
        makePost("feed-tech", {
            id: `post-${i + 1}`,
            title: `Post Title ${i + 1}`,
            feedTitle: "Tech Blog",
            publishedAt: new Date(2026, 0, 15 - i, 12, 0, 0).toISOString(),
            isRead: i >= 3,
            hasAudio: i === 0,
        })
    );
}

const posts = makePosts(5);

const READER = {
    categories: [catTech, catNews],
    feeds: [techFeed, newsFeed, blogFeed],
    posts,
    unread: { byFeed: { "feed-tech": 3, "feed-news": 5, "feed-blog": 2 }, total: 10 },
};

// ── Post list ──────────────────────────────────────────────────────────

test.describe("Reader — post list", () => {
    test("displays the post list under the All items scope", async ({ authedPage: page }) => {
        await setupReaderApi(page, READER);
        await page.goto("/posts");

        await expect(page.getByRole("heading", { name: "All items" })).toBeVisible();
        for (const p of posts.slice(0, 3)) {
            await expect(page.getByText(p.title as string)).toBeVisible();
        }
    });

    test("shows the feed title on post cards", async ({ authedPage: page }) => {
        await setupReaderApi(page, READER);
        await page.goto("/posts");

        await expect(page.getByText("Tech Blog").first()).toBeVisible();
    });

    test("shows an audio chip for posts with audio", async ({ authedPage: page }) => {
        await setupReaderApi(page, READER);
        await page.goto("/posts");

        await expect(page.getByText("Audio").first()).toBeVisible();
    });

    test("hides the summary and audio chip for posts with no readable content", async ({
        authedPage: page,
    }) => {
        const commentsOnly = makePost("feed-tech", {
            id: "post-comments",
            title: "AI companies are shredding rare books",
            summary: "Comments",
            hasAudio: true,
            hasContent: false,
        });
        await setupReaderApi(page, { ...READER, posts: [commentsOnly] });
        await page.goto("/posts");

        await expect(
            page.getByText("AI companies are shredding rare books")
        ).toBeVisible();
        // The "Comments" excerpt and the Audio chip are both hidden.
        await expect(page.getByText("Comments", { exact: true })).toHaveCount(0);
        await expect(page.getByText("Audio")).toHaveCount(0);
    });

    test("shows an empty state when there are no posts", async ({ authedPage: page }) => {
        await setupReaderApi(page, { ...READER, posts: [] });
        await page.goto("/posts");

        await expect(page.getByText(/no posts/i)).toBeVisible();
    });

    test("shows Load More when there are more posts", async ({ authedPage: page }) => {
        await setupReaderApi(page, {
            ...READER,
            posts: posts.slice(0, 3),
            hasMore: true,
            nextCursor: "cursor-1",
        });
        await page.goto("/posts");

        await expect(page.getByRole("button", { name: /load more/i })).toBeVisible();
    });
});

// ── Sidebar navigation ─────────────────────────────────────────────────

test.describe("Reader — sidebar navigation", () => {
    test("shows categories, uncategorized, and unread badges", async ({ authedPage: page }) => {
        await setupReaderApi(page, READER);
        await page.goto("/posts");

        const sidebar = page.getByTestId("feed-sidebar");
        await expect(sidebar.getByRole("button", { name: /All items/ })).toBeVisible();
        await expect(sidebar.getByRole("button", { name: /Technology/ })).toBeVisible();
        await expect(sidebar.getByRole("button", { name: /News/ })).toBeVisible();
        await expect(sidebar.getByRole("button", { name: /Uncategorized/ })).toBeVisible();
        // Total unread badge (3 + 5 + 2).
        await expect(sidebar.getByText("10")).toBeVisible();
    });

    test("filters by category and reflects it in the URL", async ({ authedPage: page }) => {
        await setupReaderApi(page, READER);
        await page.goto("/posts");

        await page.getByTestId("feed-sidebar").getByRole("button", { name: /Technology/ }).click();

        await expect(page).toHaveURL(/category=cat-tech/);
        await expect(page.getByRole("heading", { name: "Technology" })).toBeVisible();
    });

    test("filters by an individual feed", async ({ authedPage: page }) => {
        await setupReaderApi(page, READER);
        await page.goto("/posts");

        const sidebar = page.getByTestId("feed-sidebar");
        // Selecting the category also expands it, revealing its feeds.
        await sidebar.getByRole("button", { name: /Technology/ }).click();
        await sidebar.getByRole("button", { name: /Tech Blog/ }).click();

        await expect(page).toHaveURL(/feed=feed-tech/);
        await expect(page.getByRole("heading", { name: "Tech Blog" })).toBeVisible();
    });

    test("filters by uncategorized", async ({ authedPage: page }) => {
        await setupReaderApi(page, READER);
        await page.goto("/posts");

        await page.getByTestId("feed-sidebar").getByRole("button", { name: /Uncategorized/ }).click();

        await expect(page).toHaveURL(/category=none/);
        await expect(page.getByRole("heading", { name: "Uncategorized" })).toBeVisible();
    });

    test("read-state toggle updates the URL", async ({ authedPage: page }) => {
        await setupReaderApi(page, READER);
        await page.goto("/posts");

        await page.getByRole("button", { name: "Unread", exact: true }).click();

        await expect(page).toHaveURL(/read=unread/);
    });
});
