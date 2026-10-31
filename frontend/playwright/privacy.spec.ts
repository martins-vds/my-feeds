import { test, expect } from "@playwright/test";
import { TEST_USER, makeFeed, makePost, makePostDetail } from "./fixtures";

test("publisher resources stay blocked until account consent, including list icons", async ({
  page,
}) => {
  const requested: string[] = [];
  const feed = makeFeed([], { id: "privacy-feed", iconUrl: "https://tracker.example/feed-icon" });
  const post = makePostDetail(feed.id, {
    id: "privacy-post",
    title: "Private article",
    feedIconUrl: feed.iconUrl,
    content: `<p style="background-image:url(https://tracker.example/css)">Private body</p>
      <img src="https://tracker.example/pixel" alt="Publisher illustration">
      <picture><source srcset="https://tracker.example/source"></picture>`,
  });
  await page.route("https://tracker.example/**", (route) => {
    requested.push(route.request().url());
    return route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg"/>',
    });
  });
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const body =
      path === "/api/auth/me"
        ? TEST_USER
        : path === "/api/posts/privacy-post"
          ? post
          : path === "/api/posts/unread-counts"
            ? { byFeed: {}, total: 1 }
            : path === "/api/feeds"
              ? [feed]
              : path === "/api/categories"
                ? []
                : { posts: [post], hasMore: false };
    return route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.goto("/posts");
  await expect(page.getByText("Private article")).toBeVisible();
  await page.goto("/posts/privacy-post");
  await expect(page.getByText("Private body")).toBeVisible();
  expect(requested).toEqual([]);
  await page.getByRole("checkbox", { name: /load publisher images/i }).check();
  await expect(page.getByRole("img", { name: "Publisher illustration" })).toHaveAttribute(
    "src",
    "https://tracker.example/pixel"
  );
  await expect.poll(() => requested.includes("https://tracker.example/pixel")).toBe(true);
  expect(requested).not.toContain("https://tracker.example/css");
  expect(requested).not.toContain("https://tracker.example/source");
  await page.getByRole("checkbox", { name: /load publisher images/i }).uncheck();
  await expect(page.getByTestId("post-content").locator("img")).not.toHaveAttribute("src");
  await expect(page.getByRole("img", { name: "Publisher illustration" })).toHaveCount(0);
});

test("logout clears another tab's reader and legacy private caches", async ({ context, page }) => {
  let authenticated = true;
  const post = makePost("private-feed", { title: "Alice private title" });
  await context.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
  await context.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/auth/logout") {
      authenticated = false;
      expect(route.request().headers()["x-requested-with"]).toBe("XMLHttpRequest");
      return route.fulfill({ status: 204 });
    }
    if (!authenticated) {
      return route.fulfill({
        status: 401,
        contentType: "application/json",
        body: '{"error":{"code":"UNAUTHORIZED"}}',
      });
    }
    const body =
      path === "/api/auth/me"
        ? TEST_USER
        : path === "/api/posts/unread-counts"
          ? { byFeed: {}, total: 1 }
          : path === "/api/categories" || path === "/api/feeds"
            ? []
            : { posts: [post], hasMore: false };
    return route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.goto("/posts");
  const other = await context.newPage();
  await other.goto("/posts");
  await expect(other.getByText("Alice private title")).toBeVisible();
  await page.evaluate(async () => {
    for (const name of ["api-cache-v1", "audio-cache-v1"]) {
      const cache = await caches.open(name);
      await cache.put("/api/private", new Response("Alice secret"));
    }
  });
  await page.getByTestId("user-avatar").click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/signin/);
  await expect(other).toHaveURL(/signin/);
  await expect(other.getByText("Alice private title")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => caches.keys())).not.toContain("api-cache-v1");
  await expect.poll(() => page.evaluate(() => caches.keys())).not.toContain("audio-cache-v1");
});

test("a completed account switch replaces private reader state in other open tabs", async ({
  context,
  page,
}) => {
  let owner = "Alice";
  await context.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
  await context.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    const body =
      path === "/api/auth/me"
        ? { ...TEST_USER, id: owner, name: owner }
        : path === "/api/posts/unread-counts"
          ? { byFeed: {}, total: 1 }
          : path === "/api/categories" || path === "/api/feeds"
            ? []
            : {
                posts: [makePost("private-feed", { title: `${owner} private title` })],
                hasMore: false,
              };
    return route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.goto("/posts");
  const other = await context.newPage();
  await other.goto("/posts");
  await expect(page.getByText("Alice private title")).toBeVisible();
  await expect(other.getByText("Alice private title")).toBeVisible();
  owner = "Bob";
  await page.goto("/auth/callback");
  await expect(page.getByText("Bob private title")).toBeVisible();
  await expect(other.getByText("Bob private title")).toBeVisible();
  await expect(other.getByText("Alice private title")).toHaveCount(0);
});

test("same-account visibility validation preserves article scroll position without refetching", async ({
  page,
}) => {
  let probePending = false;
  let detailCalls = 0;
  let confirm!: () => void;
  const post = makePostDetail("private-feed", {
    id: "position-post",
    title: "Position preservation",
    content: Array.from({ length: 120 }, (_, index) => `<p>Privacy paragraph ${index}</p>`).join(
      ""
    ),
  });
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/auth/me") {
      if (probePending)
        await new Promise<void>((done) => {
          confirm = done;
        });
      return route.fulfill({ contentType: "application/json", body: JSON.stringify(TEST_USER) });
    }
    if (path === "/api/posts/position-post") detailCalls += 1;
    return route.fulfill({ contentType: "application/json", body: JSON.stringify(post) });
  });
  await page.goto("/posts/position-post");
  await expect(page.getByText("Privacy paragraph 119", { exact: true })).toBeVisible();
  const initialDetailCalls = detailCalls;
  const position = await page.evaluate(() => {
    window.scrollTo(0, 1000);
    return window.scrollY;
  });
  expect(position).toBeGreaterThan(0);
  await page.getByTestId("user-avatar").click();
  await expect(page.getByRole("menu")).toBeVisible();
  probePending = true;
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect(page.getByRole("status", { name: "Checking your session" })).toBeVisible();
  await expect(page.getByTestId("post-content")).not.toBeVisible();
  await expect(page.getByRole("menu")).toHaveCount(0);
  expect(await page.evaluate(() => window.scrollY)).toBe(position);
  confirm();
  await expect(page.getByTestId("post-content")).toBeVisible();
  await expect(page.getByRole("menu")).toBeVisible();
  expect(await page.evaluate(() => window.scrollY)).toBe(position);
  expect(detailCalls).toBe(initialDetailCalls);
});
