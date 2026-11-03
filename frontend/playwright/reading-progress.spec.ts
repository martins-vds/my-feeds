/**
 * E2E tests for reading progress: opening an article is not reading it.
 *
 * The posts API is stateful here and mirrors the server: opening a post marks
 * it seen, a progress report only ever raises `readProgress`, and 95% completes
 * the post. The silent pacer runs at its fastest pace (400 wpm) so a whole read
 * takes a few seconds.
 */

import type { Page, Route } from "@playwright/test";
import { test, expect, setupReaderApi, makePost, makeFeed } from "./fixtures";

// ── Seed data ──────────────────────────────────────────────────────────

const feed = makeFeed([], { id: "feed-progress", title: "Progress Feed" });

const READ_COMPLETION_THRESHOLD = 0.95;

const CONTENT =
  "<p>Opening an article is not the same as reading it. This one is long enough for the " +
  "silent pacer to need several seconds, so a reader can stop part of the way through, " +
  "leave, come back and then finish it.</p>";

interface PostState {
  id: string;
  title: string;
  isRead: boolean;
  readProgress: number;
  isSeen: boolean;
}

// ── Helpers ────────────────────────────────────────────────────────────

/** A stateful stand-in for the posts API. `reports` records every progress PUT. */
async function setupProgressApi(
  page: Page,
  seeds: Array<Pick<PostState, "id" | "title"> & Partial<PostState>>
) {
  const states = new Map<string, PostState>(
    seeds.map((seed) => [seed.id, { isRead: false, readProgress: 0, isSeen: false, ...seed }])
  );
  const reports: Array<{ id: string; progress: number }> = [];

  const summary = (state: PostState) => makePost(feed.id, { ...state, feedTitle: feed.title });
  const json = (route: Route, body: unknown) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

  await setupReaderApi(page, { feeds: [feed] });
  // Registered after setupReaderApi, so it sees post requests first and hands
  // anything it does not own (the unread counts) back to the static mocks.
  await page.route("**/api/posts**", (route) => {
    const request = route.request();
    const method = request.method();
    const { pathname, searchParams } = new URL(request.url());
    const path = pathname.replace(/^.*\/api\/posts/, "");

    if (method === "GET" && path === "") {
      const filter = searchParams.get("readState");
      const listed = [...states.values()].filter((state) => {
        if (filter === "unread") return !state.isRead;
        if (filter === "in_progress") return !state.isRead && state.readProgress > 0;
        if (filter === "read") return state.isRead;
        return true;
      });
      return json(route, { posts: listed.map(summary), hasMore: false, nextCursor: null });
    }

    const state = states.get(path.split("/")[1]);
    if (!state) return route.fallback();

    if (method === "GET" && path === `/${state.id}`) {
      state.isSeen = true;
      return json(route, { ...summary(state), content: CONTENT });
    }

    if (method === "PUT" && path === `/${state.id}/progress`) {
      const { progress } = request.postDataJSON() as { progress: number };
      reports.push({ id: state.id, progress });
      if (!state.isRead) {
        state.readProgress = Math.max(state.readProgress, progress);
        if (state.readProgress >= READ_COMPLETION_THRESHOLD) {
          state.isRead = true;
          state.readProgress = 1;
        }
      }
      return json(route, {
        postId: state.id,
        isRead: state.isRead,
        readProgress: state.readProgress,
        readAt: state.isRead ? new Date().toISOString() : null,
      });
    }

    return route.fallback();
  });

  return { reports };
}

async function readAtFastestPace(page: Page) {
  await page.addInitScript(() => localStorage.setItem("readAlong.wpm", "400"));
}

/** The reading position the pacer shows, as a whole percent. */
async function pacerPercent(page: Page) {
  const text = await page.getByTestId("pacer-percent").textContent();
  return Number.parseInt(text ?? "0", 10);
}

/** The whole percent in the detail page's "In progress · N%" chip. */
async function chipPercent(page: Page) {
  const text = await page.getByTestId("read-state-chip").textContent();
  return Number(/(\d+)%/.exec(text ?? "")?.[1] ?? 0);
}

// ── Tests ──────────────────────────────────────────────────────────────

test.describe("Reading progress", () => {
  test("opening an article marks it opened, not read", async ({ authedPage: page }) => {
    const { reports } = await setupProgressApi(page, [{ id: "fresh", title: "Fresh Article" }]);
    await page.goto("/posts");

    const card = page.getByTestId("post-card-fresh");
    await expect(card.getByText("Opened", { exact: true })).toHaveCount(0);

    await card.click();
    await expect(page.getByTestId("read-state-chip")).toHaveText("Unread");
    await page.getByTestId("back-button").first().click();

    await expect(card.getByText("Opened", { exact: true })).toBeVisible();
    await expect(card.getByRole("button", { name: "Mark as read", exact: true })).toBeVisible();
    expect(reports).toEqual([]);
  });

  test("a silent read moves an article from unread to in progress to read", async ({
    authedPage: page,
  }) => {
    await readAtFastestPace(page);
    await setupProgressApi(page, [{ id: "silent", title: "Silent Article" }]);
    await page.goto("/posts");

    const card = page.getByTestId("post-card-silent");
    await card.click();

    // Read part of the way, then stop.
    await page.getByTestId("start-reading-button").click();
    await expect.poll(() => pacerPercent(page), { timeout: 15_000 }).toBeGreaterThanOrEqual(30);
    await page.getByTestId("pacer-stop-button").click();

    // The chip shows what the server was told: started, but not finished.
    await expect(page.getByTestId("read-state-chip")).toHaveText(/^In progress · \d+%$/);
    await expect.poll(() => chipPercent(page)).toBeGreaterThanOrEqual(30);
    const reached = await chipPercent(page);
    expect(reached).toBeLessThan(95);

    // The list shows the same progress.
    await page.getByTestId("back-button").first().click();
    await expect(card.getByText(`${reached}%`, { exact: true })).toBeVisible();
    await expect(card.getByRole("progressbar", { name: "Reading progress" })).toBeVisible();

    // Reopening offers to continue, and does so from the saved position.
    await card.click();
    const start = page.getByTestId("start-reading-button");
    await expect(start).toHaveText(`Continue reading · ${reached}%`);
    await start.click();
    await expect.poll(() => pacerPercent(page)).toBeGreaterThanOrEqual(reached);

    // Finishing the article completes it.
    await expect(page.getByTestId("read-state-chip")).toHaveText("Read", { timeout: 20_000 });
    await page.getByTestId("back-button").first().click();
    await expect(card.getByRole("button", { name: "Mark as unread", exact: true })).toBeVisible();
    await expect(card.getByRole("progressbar")).toHaveCount(0);
  });

  test("the In progress filter lists only articles that were started", async ({
    authedPage: page,
  }) => {
    await setupProgressApi(page, [
      { id: "fresh", title: "Fresh Article" },
      { id: "half", title: "Half Read Article", readProgress: 0.4 },
      { id: "done", title: "Finished Article", isRead: true, readProgress: 1 },
    ]);
    await page.goto("/posts");

    const sidebar = page.getByTestId("feed-sidebar");
    await sidebar.getByRole("button", { name: "In progress", exact: true }).click();

    await expect(page).toHaveURL(/read=in_progress/);
    await expect(page.getByTestId("post-card-half")).toBeVisible();
    await expect(page.getByTestId("post-card-fresh")).toHaveCount(0);
    await expect(page.getByTestId("post-card-done")).toHaveCount(0);
    await expect(
      page.getByTestId("post-card-half").getByText("40%", { exact: true })
    ).toBeVisible();

    // An article being read is still unread, so the Unread filter keeps it.
    await sidebar.getByRole("button", { name: "Unread", exact: true }).click();
    await expect(page).toHaveURL(/read=unread/);
    await expect(page.getByTestId("post-card-half")).toBeVisible();
    await expect(page.getByTestId("post-card-fresh")).toBeVisible();
    await expect(page.getByTestId("post-card-done")).toHaveCount(0);
  });

  test("the In progress filter explains when nothing was started", async ({ authedPage: page }) => {
    await setupProgressApi(page, [{ id: "fresh", title: "Fresh Article" }]);
    await page.goto("/posts?read=in_progress");

    await expect(page.getByTestId("posts-empty")).toContainText("Nothing in progress yet");
  });

  test("the In progress filter is still applied after opening an article and coming back", async ({
    authedPage: page,
  }) => {
    await setupProgressApi(page, [
      { id: "fresh", title: "Fresh Article" },
      { id: "half", title: "Half Read Article", readProgress: 0.4 },
    ]);
    await page.goto("/posts");

    const sidebar = page.getByTestId("feed-sidebar");
    await sidebar.getByRole("button", { name: "In progress", exact: true }).click();
    await expect(page.getByTestId("post-card-half")).toBeVisible();

    await page.getByTestId("post-card-half").click();
    await expect(page.getByTestId("read-state-chip")).toHaveText(/^In progress/);
    await page.getByTestId("back-button").first().click();

    await expect(page).toHaveURL(/read=in_progress/);
    await expect(page.getByTestId("post-card-half")).toBeVisible();
    await expect(page.getByTestId("post-card-fresh")).toHaveCount(0);
  });

  test("the four read-state filters share one row of the sidebar", async ({ authedPage: page }) => {
    await setupProgressApi(page, []);
    await page.goto("/posts");

    const sidebar = page.getByTestId("feed-sidebar");
    const filters = sidebar.getByRole("group", { name: "read state filter" });
    const boxes = await Promise.all(
      ["All", "Unread", "In progress", "Read"].map((name) =>
        filters.getByRole("button", { name, exact: true }).boundingBox()
      )
    );
    const sidebarBox = await sidebar.boundingBox();

    expect(new Set(boxes.map((box) => Math.round(box!.y))).size).toBe(1);
    expect(new Set(boxes.map((box) => Math.round(box!.height))).size).toBe(1);
    for (const box of boxes) {
      expect(box!.x + box!.width).toBeLessThanOrEqual(sidebarBox!.x + sidebarBox!.width);
    }
  });

  test("the pacer controls fit a phone-sized viewport", async ({ authedPage: page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await setupProgressApi(page, [{ id: "narrow", title: "Narrow Article" }]);
    await page.goto("/posts/narrow");

    await page.getByTestId("start-reading-button").click();
    await expect(page.getByTestId("pacer-controls")).toBeVisible();

    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      320
    );
    for (const testId of [
      "pacer-controls",
      "pacer-play-button",
      "pacer-speed-button",
      "pacer-stop-button",
    ]) {
      const box = await page.getByTestId(testId).boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(320);
    }
  });
});
