/**
 * E2E tests for read-along word highlighting on the post detail page (US1).
 *
 * A timing-backed post is mocked: the audio endpoint returns wordTimings and
 * the stream returns a real (silent) WAV so the audio element actually plays
 * and the highlighter advances from media time.
 */

import { test, expect, mockApi, makePostDetail } from "./fixtures";
import type { Page } from "@playwright/test";

// These tests drive a real (silent) audio element and depend on its media
// clock advancing in real time. Under heavy parallelism the shared CPU can
// briefly stall that clock, so allow a couple of retries for resilience.
test.describe.configure({ retries: 2 });

// ── Seed data ──────────────────────────────────────────────────────────

const post = makePostDetail("feed-1", {
    id: "read-along-post",
    title: "Read Along Test",
    content: "<p>one two three four five</p>",
    feedTitle: "Read Along Feed",
    isRead: true,
    hasAudio: false,
});

// Title words (Read/Along/Test = indices 0..2) then body words
// (one/two/three/four/five = indices 3..7). Spaced ~250ms apart (200ms each,
// with the highlight held across the small gaps) so a word stays active for
// ~1.85s — long enough to reliably observe play/pause/advance in a browser.
const WORD_TIMINGS = [
    { text: "Read", startMs: 0, durationMs: 200 },
    { text: "Along", startMs: 250, durationMs: 200 },
    { text: "Test", startMs: 500, durationMs: 200 },
    { text: "one", startMs: 750, durationMs: 200 },
    { text: "two", startMs: 1000, durationMs: 200 },
    { text: "three", startMs: 1250, durationMs: 200 },
    { text: "four", startMs: 1500, durationMs: 200 },
    { text: "five", startMs: 1750, durationMs: 200 },
];

// ── Helpers ────────────────────────────────────────────────────────────

/** Build a valid silent 8-bit mono PCM WAV of the given duration. */
function makeWav(seconds = 1.4, sampleRate = 8000): Buffer {
    const numSamples = Math.floor(seconds * sampleRate);
    const buffer = Buffer.alloc(44 + numSamples);
    buffer.write("RIFF", 0);
    buffer.writeUInt32LE(36 + numSamples, 4);
    buffer.write("WAVE", 8);
    buffer.write("fmt ", 12);
    buffer.writeUInt32LE(16, 16); // PCM fmt chunk size
    buffer.writeUInt16LE(1, 20); // PCM
    buffer.writeUInt16LE(1, 22); // mono
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(sampleRate, 28); // byte rate
    buffer.writeUInt16LE(1, 32); // block align
    buffer.writeUInt16LE(8, 34); // bits per sample
    buffer.write("data", 36);
    buffer.writeUInt32LE(numSamples, 40);
    buffer.fill(0x80, 44); // 8-bit silence
    return buffer;
}

async function setup(
    page: Page,
    opts: { timings?: typeof WORD_TIMINGS | null } = {}
) {
    const timings = opts.timings === undefined ? WORD_TIMINGS : opts.timings;
    await mockApi(page, `**/api/posts/${post.id}`, post);
    await mockApi(page, "**/api/categories", { categories: [] });
    await page.route(`**/api/posts/${post.id}/audio`, (route) =>
        route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
                postId: post.id,
                status: "ready",
                url: "/api/audio/read-along-key",
                durationSeconds: 2.2,
                format: "mp3",
                ...(timings ? { wordTimings: timings } : {}),
            }),
        })
    );
    const wav = makeWav(2.2);
    await page.route("**/api/audio/**", (route) =>
        route.fulfill({ status: 200, contentType: "audio/wav", body: wav })
    );
}

/** The data-ra-index of the currently active word, or -1 if none. */
function activeIndex(page: Page): Promise<number> {
    return page.evaluate(() => {
        const el = document.querySelector(".ra-active");
        return el ? Number(el.getAttribute("data-ra-index")) : -1;
    });
}

async function startPlayback(page: Page) {
    await page.goto(`/posts/${post.id}`);
    await page.getByTestId("listen-button").click();
    await page.getByTestId("play-pause-button").click();
}

// ── Tests ──────────────────────────────────────────────────────────────

test.describe("Read-along highlighting", () => {
    test("highlights a single word that advances from title into body", async ({
        authedPage: page,
    }) => {
        await setup(page);
        await startPlayback(page);

        // A single word highlights.
        await expect(page.locator(".ra-active")).toHaveCount(1, { timeout: 6000 });

        // It advances past the title (indices 0..2) into the body (>= 3).
        await expect
            .poll(() => activeIndex(page), { timeout: 6000 })
            .toBeGreaterThanOrEqual(3);

        // Never more than one active word at a time.
        expect(await page.locator(".ra-active").count()).toBeLessThanOrEqual(1);
    });

    test("pause holds the current word", async ({ authedPage: page }) => {
        await setup(page);
        await startPlayback(page);

        await expect(page.locator(".ra-active")).toHaveCount(1, { timeout: 6000 });
        // Pause (second click on the play/pause control).
        await page.getByTestId("play-pause-button").click();
        const held = await activeIndex(page);
        expect(held).toBeGreaterThanOrEqual(0);

        // Frozen: same word still highlighted a moment later.
        await page.waitForTimeout(400);
        await expect(page.locator(".ra-active")).toHaveCount(1);
        expect(await activeIndex(page)).toBe(held);
    });

    test("clears the highlight when playback finishes", async ({
        authedPage: page,
    }) => {
        await setup(page);
        await startPlayback(page);

        // First a word highlights, then it clears once the last word has ended.
        await expect(page.locator(".ra-active")).toHaveCount(1, { timeout: 6000 });
        await expect(page.locator(".ra-active")).toHaveCount(0, { timeout: 8000 });
    });
});

// ── Auto-scroll (US2) ───────────────────────────────────────────────────

// A tall post (one word per paragraph) so later words fall well below the fold.
const LONG_WORDS = Array.from({ length: 120 }, (_, i) => `w${i}`);
const longPost = makePostDetail("feed-1", {
    id: "read-along-long",
    title: "Read Along Test",
    content: LONG_WORDS.map((w) => `<p>${w}</p>`).join(""),
    feedTitle: "Read Along Feed",
    isRead: true,
    hasAudio: false,
});

const LONG_TIMINGS = ["Read", "Along", "Test", ...LONG_WORDS].map((text, i) => ({
    text,
    startMs: i * 40,
    durationMs: 40,
}));

async function setupLong(page: Page) {
    await mockApi(page, `**/api/posts/${longPost.id}`, longPost);
    await mockApi(page, "**/api/categories", { categories: [] });
    await page.route(`**/api/posts/${longPost.id}/audio`, (route) =>
        route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
                postId: longPost.id,
                status: "ready",
                url: "/api/audio/read-along-long-key",
                durationSeconds: 6,
                format: "mp3",
                wordTimings: LONG_TIMINGS,
            }),
        })
    );
    // A long clip so playback stays active for the whole test (no accidental
    // restart when the pause test clicks the control).
    const wav = makeWav(6);
    await page.route("**/api/audio/**", (route) =>
        route.fulfill({ status: 200, contentType: "audio/wav", body: wav })
    );
}

async function startLongPlayback(page: Page) {
    await page.goto(`/posts/${longPost.id}`);
    await page.getByTestId("listen-button").click();
    await page.getByTestId("play-pause-button").click();
}

/**
 * The title's viewport y once the page has scrolled down (title moves above the
 * fold → negative y). Container-agnostic and uses a stable element, so it never
 * races with the rapidly-changing active word.
 */
function titleY(page: Page): Promise<number | null> {
    return page
        .getByTestId("post-title")
        .boundingBox()
        .then((box) => (box ? box.y : null));
}

test.describe("Read-along auto-scroll", () => {
    test("scrolls the page down to follow the active word on a long post", async ({
        authedPage: page,
    }) => {
        await setupLong(page);
        await startLongPlayback(page);

        // As the active word advances down the tall post, auto-scroll pushes the
        // title above the fold (negative viewport y).
        await expect.poll(() => titleY(page), { timeout: 12000 }).toBeLessThan(0);
    });

    test("does not auto-scroll while paused", async ({ authedPage: page }) => {
        await setupLong(page);
        await startLongPlayback(page);

        await expect.poll(() => titleY(page), { timeout: 12000 }).toBeLessThan(0);
        await page.getByTestId("play-pause-button").click(); // pause
        await page.waitForTimeout(1500); // let any in-flight smooth scroll finish
        const before = await titleY(page);
        await page.waitForTimeout(700);
        const after = await titleY(page);
        expect(before).not.toBeNull();
        expect(after).not.toBeNull();
        // Frozen: no further scrolling once paused.
        expect(Math.abs((after as number) - (before as number))).toBeLessThan(2);
    });

    test("scrolls under reduced motion (instant)", async ({ authedPage: page }) => {
        await page.emulateMedia({ reducedMotion: "reduce" });
        await setupLong(page);
        await startLongPlayback(page);

        await expect.poll(() => titleY(page), { timeout: 12000 }).toBeLessThan(0);
    });
});

// ── Persisted toggles (US3) ─────────────────────────────────────────────

test.describe("Read-along toggles", () => {
    test("persist across a reload", async ({ authedPage: page }) => {
        await setup(page);
        await page.goto(`/posts/${post.id}`);

        const highlight = page.getByRole("checkbox", { name: "Highlight while playing" });
        await expect(highlight).toBeChecked(); // default on
        await highlight.click();
        await expect(highlight).not.toBeChecked();

        await page.reload();
        await expect(
            page.getByRole("checkbox", { name: "Highlight while playing" })
        ).not.toBeChecked();
    });

    test("highlight off disables highlighting entirely", async ({ authedPage: page }) => {
        await setup(page);
        await page.goto(`/posts/${post.id}`);
        await page.getByRole("checkbox", { name: "Highlight while playing" }).click(); // off

        await page.getByTestId("listen-button").click();
        await page.getByTestId("play-pause-button").click();

        await page.waitForTimeout(1500);
        await expect(page.locator(".ra-active")).toHaveCount(0);
        await expect(page.locator(".ra-word")).toHaveCount(0);
    });

    test("auto-scroll off keeps highlighting but stops scrolling", async ({
        authedPage: page,
    }) => {
        await setupLong(page);
        await page.goto(`/posts/${longPost.id}`);
        await page.getByRole("checkbox", { name: "Auto-scroll while playing" }).click(); // off

        await page.getByTestId("listen-button").click();
        await page.getByTestId("play-pause-button").click();

        // Highlighting still works.
        await expect(page.locator(".ra-active")).toHaveCount(1, { timeout: 6000 });
        // ...but the page never scrolls (title stays in place, not above the fold).
        await page.waitForTimeout(1500);
        const y = await titleY(page);
        expect(y).not.toBeNull();
        expect(y as number).toBeGreaterThanOrEqual(0);
    });

    test("toggles are keyboard-operable with state exposed", async ({
        authedPage: page,
    }) => {
        await setup(page);
        await page.goto(`/posts/${post.id}`);

        const highlight = page.getByRole("checkbox", { name: "Highlight while playing" });
        await highlight.focus();
        await expect(highlight).toBeChecked();
        await page.keyboard.press("Space");
        await expect(highlight).not.toBeChecked();
        await page.keyboard.press("Space");
        await expect(highlight).toBeChecked();
    });
});

// ── Graceful fallback (US4) ─────────────────────────────────────────────

test.describe("Read-along fallback", () => {
    test("a post without timings plays normally with no highlighting or error", async ({
        authedPage: page,
    }) => {
        await setup(page, { timings: null }); // READY omits wordTimings
        await page.goto(`/posts/${post.id}`);

        // No console errors while exercising playback.
        const errors: string[] = [];
        page.on("pageerror", (e) => errors.push(String(e)));

        await page.getByTestId("listen-button").click();
        await page.getByTestId("play-pause-button").click();
        await page.waitForTimeout(1200);

        // Never any highlighting for a timing-less post.
        await expect(page.locator(".ra-active")).toHaveCount(0);
        await expect(page.locator(".ra-word")).toHaveCount(0);
        // Player controls still behave.
        await expect(page.getByTestId("play-pause-button")).toBeVisible();
        await expect(page.getByTestId("speed-button")).toBeVisible();
        // Toggles remain keyboard-operable.
        const highlight = page.getByRole("checkbox", { name: "Highlight while playing" });
        await highlight.focus();
        await page.keyboard.press("Space");
        await expect(highlight).not.toBeChecked();

        expect(errors).toEqual([]);
    });
});
