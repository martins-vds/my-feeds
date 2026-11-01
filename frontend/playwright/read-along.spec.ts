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

async function setup(page: Page, opts: {
  timings?: typeof WORD_TIMINGS | null; content?: string; duration?: number;
} = {}) {
  const timings = opts.timings === undefined ? WORD_TIMINGS : opts.timings;
  const duration = opts.duration ?? 2.2;
  await mockApi(page, `**/api/posts/${post.id}`, { ...post, content: opts.content ?? post.content });
  await mockApi(page, "**/api/categories", { categories: [] });
  await page.route(`**/api/posts/${post.id}/audio`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        postId: post.id,
        status: "ready",
        url: "/api/audio/read-along-key",
        durationSeconds: duration,
        format: "mp3",
        ...(timings ? { wordTimings: timings } : {}),
      }),
    })
  );
  const wav = makeWav(duration);
  await mockWav(page, wav);
}

async function mockWav(page: Page, wav: Buffer) {
  await page.route("**/api/audio/**", (route) => {
    const range = route.request().headers().range?.match(/^bytes=(\d+)-(\d*)$/);
    const start = range ? Number(range[1]) : 0;
    const end = range?.[2] ? Math.min(Number(range[2]), wav.length - 1) : wav.length - 1;
    if (start > end) return route.fulfill({ status: 416, headers: { "content-range": `bytes */${wav.length}` } });
    return route.fulfill({
      status: range ? 206 : 200, contentType: "audio/wav",
      headers: {
        "accept-ranges": "bytes",
        ...(range ? { "content-range": `bytes ${start}-${end}/${wav.length}` } : {}),
      },
      body: wav.subarray(start, end + 1),
    });
  });
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

async function completedText(page: Page) {
  return page.evaluate(() => [...CSS.highlights.get("read-along-completed") ?? []]
    .map((range) => range instanceof Range ? range.toString() : ""));
}

async function seekFraction(page: Page, fraction: number) {
  const waveform = page.getByRole("progressbar", { name: "Audio progress" });
  const box = await waveform.boundingBox();
  if (!box) throw new Error("Audio progress control is not visible");
  await waveform.click({ position: { x: box.width * fraction, y: box.height / 2 } });
}

test.describe("Continuous highlighting", () => {
  test("muted media drives a smooth sweep within one word before advancing", async ({ authedPage: page }) => {
    await setup(page, {
      timings: WORD_TIMINGS.map((timing, index) => ({ ...timing, startMs: index * 2000, durationMs: 2000 })),
      duration: 16,
    });
    await page.goto(`/posts/${post.id}`);
    await page.getByRole("button", { name: "Continuous", exact: true }).click();
    await page.getByTestId("listen-button").click();
    await page.getByRole("button", { name: "Mute audio", exact: true }).click();
    await page.getByTestId("play-pause-button").click();
    const progress = () => page.locator(".ra-progress").evaluate((span) =>
      Number.parseFloat((span as HTMLElement).style.getPropertyValue("--ra-progress")));
    await expect(page.locator(".ra-progress")).toHaveText("Read");
    await expect.poll(progress).toBeGreaterThan(10);
    const earlier = await progress();
    await expect.poll(progress).toBeGreaterThan(earlier + 10);
    await expect(page.locator(".ra-progress")).toHaveText("Read");
    await expect(page.getByTestId("play-pause-button")).toHaveAttribute("aria-label", "Pause");
    await expect(page.getByRole("button", { name: "Unmute audio", exact: true })).toBeVisible();
    await expect(page.locator(".ra-progress")).toHaveText("Along");
    await expect.poll(() => completedText(page)).toEqual(["Read ", ""]);
  });

  for (const width of [320, 1280]) {
    test(`connected strokes, paused seeks, completion, and preference at ${width}px`, async ({ authedPage: page }, testInfo) => {
      await page.setViewportSize({ width, height: 800 });
      const words = ["Read", "Along", "Test", "Continuous", "highlighting", "connects",
        "words", "and", "spaces", "across", "lines", "A", "new", "paragraph", "stays", "separate"];
      await setup(page, {
        timings: words.map((text, index) => ({ text, startMs: index * 750, durationMs: 750 })),
        content: "<p>Continuous highlighting <em>connects</em> words and spaces across lines</p><p>A new paragraph stays separate</p>",
        duration: 12,
      });
      await page.goto(`/posts/${post.id}`);
      await expect(page.getByRole("button", { name: "Word by word", exact: true })).toHaveAttribute("aria-pressed", "true");
      await page.getByRole("switch", { name: "Auto-scroll while playing" }).click();
      await page.getByTestId("listen-button").click();
      const geometry = () => page.locator(".ra-word").evaluateAll((spans) => spans.map((span) => {
        const { x, y, width, height } = span.getBoundingClientRect();
        return { x, y, width, height };
      }));
      const before = await geometry();
      const continuous = page.getByRole("button", { name: "Continuous", exact: true });
      await continuous.focus();
      await continuous.press("Space");
      await expect(continuous).toHaveAttribute("aria-pressed", "true");
      await page.getByTestId("play-pause-button").click();
      await expect(page.locator(".ra-progress")).toHaveCount(1);
      await page.getByTestId("play-pause-button").click();
      await seekFraction(page, 4.125 / 12);
      await expect(page.locator(".ra-progress")).toHaveText("connects");
      await expect.poll(() => completedText(page)).toEqual(["Read Along Test", "Continuous highlighting "]);
      const progress = () => page.locator(".ra-progress").evaluate((span) =>
        Number.parseFloat((span as HTMLElement).style.getPropertyValue("--ra-progress")));
      expect(await progress()).toBeGreaterThan(40);
      expect(await progress()).toBeLessThan(60);
      const frozen = await progress();
      await page.waitForTimeout(200);
      expect(await progress()).toBe(frozen);
      expect(await geometry()).toEqual(before);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      await page.screenshot({ path: testInfo.outputPath(`continuous-partial-${width}.png`), fullPage: true });

      await seekFraction(page, 8 / 12);
      await expect.poll(() => completedText(page)).toEqual([
        "Read Along Test", "Continuous highlighting connects words and spaces across ",
      ]);
      await page.screenshot({ path: testInfo.outputPath(`continuous-lines-${width}.png`), fullPage: true });
      await seekFraction(page, 1.125 / 12);
      await expect.poll(() => completedText(page)).toEqual(["Read ", ""]);
      await expect(page.locator(".ra-progress")).toHaveText("Along");
      await seekFraction(page, 0.99);
      await page.getByTestId("play-pause-button").click();
      await expect.poll(() => completedText(page)).toEqual([
        "Read Along Test", "Continuous highlighting connects words and spaces across linesA new paragraph stays separate",
      ]);
      await expect(page.locator(".ra-progress")).toHaveCount(0);
      await page.screenshot({ path: testInfo.outputPath(`continuous-finished-${width}.png`), fullPage: true });
      await page.waitForTimeout(200);
      expect(await completedText(page)).toHaveLength(2);
      await page.reload();
      await expect(continuous).toHaveAttribute("aria-pressed", "true");
    });
  }

  test("explains unavailable continuous mode and preserves word highlighting on older browsers", async ({ authedPage: page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, "Highlight", { value: undefined, configurable: true });
    });
    await setup(page);
    await startPlayback(page);
    await expect(page.getByRole("button", { name: "Continuous", exact: true })).toBeDisabled();
    await expect(page.getByText("Continuous highlighting needs a newer browser. Using word by word.")).toBeVisible();
    await expect(page.locator(".ra-active")).toHaveCount(1);
  });
});

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
    await expect.poll(() => activeIndex(page), { timeout: 6000 }).toBeGreaterThanOrEqual(3);

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

  test("clears the highlight when playback finishes", async ({ authedPage: page }) => {
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

async function setupLong(page: Page, wordMs = 40) {
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
        durationSeconds: Math.max(6, (LONG_TIMINGS.length * wordMs) / 1000),
        format: "mp3",
        wordTimings: LONG_TIMINGS.map((timing, i) => ({
          ...timing, startMs: i * wordMs, durationMs: wordMs,
        })),
      }),
    })
  );
  // A long clip so playback stays active for the whole test (no accidental
  // restart when the pause test clicks the control).
  const wav = makeWav(Math.max(6, (LONG_TIMINGS.length * wordMs) / 1000));
  await mockWav(page, wav);
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
  test("mobile inline speed menu stays anchored while audio is playing", async ({ authedPage: page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await setupLong(page, 400);
    await page.goto(`/posts/${longPost.id}`);
    await page.getByTestId("listen-button").click();
    await page.getByTestId("play-pause-button").click();
    await page.getByTestId("speed-button").click();
    await expect(page.getByRole("menu")).toBeVisible();
    const before = await titleY(page);
    const wordBefore = await activeIndex(page);
    await expect.poll(() => activeIndex(page), { timeout: 10000 }).toBeGreaterThan(wordBefore + 12);
    const after = await titleY(page);
    await page.screenshot({ path: "test-results/mobile-playing-speed-menu.png" });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
    expect(Math.abs(after! - before!)).toBeLessThan(3);
    await page.getByRole("menuitem", { name: "2x", exact: true }).click();
    await expect(page.getByTestId("speed-button")).toHaveText("2x");
    await expect.poll(() => titleY(page)).toBeLessThan(after! - 50);
  });

  test("mobile floating speed options suspend auto-scroll until dismissed", async ({ authedPage: page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await setupLong(page, 400);
    await startLongPlayback(page);
    await expect.poll(() => titleY(page), { timeout: 10000 }).toBeLessThan(-500);
    await page.getByTestId("floating-speed-button").click();
    await expect(page.getByTestId("floating-speed-options")).toBeVisible();
    const before = await titleY(page);
    const wordBefore = await activeIndex(page);
    await expect.poll(() => activeIndex(page), { timeout: 10000 }).toBeGreaterThan(wordBefore + 5);
    expect(await titleY(page)).toBe(before);
    await page.getByTestId("floating-speed-button").press("Escape");
    await expect(page.getByTestId("floating-speed-options")).toBeHidden();
    await expect.poll(async () => Math.abs((await titleY(page))! - before!)).toBeGreaterThan(50);
  });

  test("mobile inline speed menu also releases auto-scroll after Escape and an outside tap", async ({ authedPage: page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await setupLong(page, 400);
    await startLongPlayback(page);
    for (const dismissal of ["Escape", "outside"]) {
      await page.getByTestId("speed-button").click();
      const before = await titleY(page);
      const wordBefore = await activeIndex(page);
      await expect.poll(() => activeIndex(page), { timeout: 10000 }).toBeGreaterThan(wordBefore + 3);
      expect(await titleY(page)).toBe(before);
      if (dismissal === "Escape") await page.getByRole("menu").press("Escape");
      else await page.mouse.click(10, 100);
      await expect(page.getByRole("menu")).toBeHidden();
      await expect.poll(async () => Math.abs((await titleY(page))! - before!)).toBeGreaterThan(50);
    }
  });

  test("mobile paused playback keeps its layout when changing speed", async ({ authedPage: page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await setupLong(page, 400);
    await startLongPlayback(page);
    await page.getByTestId("play-pause-button").click();
    await expect(page.getByTestId("play-pause-button")).toHaveAttribute("aria-label", "Play");
    const before = await titleY(page);
    await page.getByTestId("speed-button").click();
    await page.getByRole("menuitem", { name: "2.5x", exact: true }).click();
    await expect(page.getByTestId("speed-button")).toHaveText("2.5x");
    expect(await titleY(page)).toBe(before);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  });

  test("muted playback keeps highlights and auto-scroll active with synchronized mobile controls", async ({
    authedPage: page,
  }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await setupLong(page);
    await page.goto(`/posts/${longPost.id}`);
    await page.getByTestId("listen-button").click();
    const volume = page.getByRole("slider", { name: "Audio volume" });
    await volume.focus();
    await volume.press("Home");
    await expect(volume).toHaveValue("0");
    await page.getByRole("button", { name: "Unmute audio" }).click();
    await expect(volume).toHaveValue("100");
    await volume.focus();
    await volume.press("End");
    await volume.press("ArrowLeft");
    await expect(volume).toHaveValue("99");
    expect(await page.evaluate(() => document.documentElement.scrollWidth))
      .toBeLessThanOrEqual(320);
    await page.screenshot({ path: "test-results/audio-volume-mobile.png" });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.screenshot({ path: "test-results/audio-volume-desktop.png" });
    await page.setViewportSize({ width: 320, height: 700 });
    await page.getByRole("button", { name: "Mute audio" }).click();
    await page.getByTestId("play-pause-button").click();
    await expect.poll(() => activeIndex(page)).toBeGreaterThan(3);
    await expect.poll(() => titleY(page)).toBeLessThan(0);
    const floatingMute = page.getByTestId("floating-mute-button");
    await expect(floatingMute).toHaveAttribute("aria-label", "Unmute audio");
    await page.screenshot({ path: "test-results/audio-volume-floating.png" });
    await floatingMute.click();
    await expect(floatingMute).toHaveAttribute("aria-label", "Mute audio");
    await expect(page.getByRole("button", { name: "Mute audio" })).toHaveCount(2);
    await expect(volume).toHaveValue("99");
  });

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

    const highlight = page.getByRole("switch", { name: "Highlight while playing" });
    await expect(highlight).toBeChecked(); // default on
    await highlight.click();
    await expect(highlight).not.toBeChecked();

    await page.reload();
    await expect(page.getByRole("switch", { name: "Highlight while playing" })).not.toBeChecked();
  });

  test("highlight off disables highlighting entirely", async ({ authedPage: page }) => {
    await setup(page);
    await page.goto(`/posts/${post.id}`);
    await page.getByRole("switch", { name: "Highlight while playing" }).click(); // off

    await page.getByTestId("listen-button").click();
    await page.getByTestId("play-pause-button").click();

    await page.waitForTimeout(1500);
    await expect(page.locator(".ra-active")).toHaveCount(0);
    await expect(page.locator(".ra-word")).toHaveCount(0);
  });

  test("auto-scroll off keeps highlighting but stops scrolling", async ({ authedPage: page }) => {
    await setupLong(page);
    await page.goto(`/posts/${longPost.id}`);
    await page.getByRole("switch", { name: "Auto-scroll while playing" }).click(); // off

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

  test("toggles are keyboard-operable with state exposed", async ({ authedPage: page }) => {
    await setup(page);
    await page.goto(`/posts/${post.id}`);

    const highlight = page.getByRole("switch", { name: "Highlight while playing" });
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
    const highlight = page.getByRole("switch", { name: "Highlight while playing" });
    await highlight.focus();
    await page.keyboard.press("Space");
    await expect(highlight).not.toBeChecked();

    expect(errors).toEqual([]);
  });
});

// ── Floating audio controls ─────────────────────────────────────────────
const floatingBody =
  "<p>one two three four five</p>" +
  Array.from(
    { length: 40 },
    (_, i) =>
      `<p>Filler paragraph ${i} with enough text to push the inline audio player well above the viewport so the floating controls take over.</p>`
  ).join("");

const floatingPost = makePostDetail("feed-1", {
  id: "floating-post",
  title: "Floating Controls Test",
  content: floatingBody,
  feedTitle: "Read Along Feed",
  isRead: true,
  hasAudio: false,
});

async function setupFloating(page: Page) {
  await mockApi(page, `**/api/posts/${floatingPost.id}`, floatingPost);
  await mockApi(page, "**/api/categories", { categories: [] });
  await page.route(`**/api/posts/${floatingPost.id}/audio`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        postId: floatingPost.id,
        status: "ready",
        url: "/api/audio/floating-key",
        durationSeconds: 2.2,
        format: "mp3",
        wordTimings: WORD_TIMINGS,
      }),
    })
  );
  const wav = makeWav(2.2);
  await page.route("**/api/audio/**", (route) =>
    route.fulfill({ status: 200, contentType: "audio/wav", body: wav })
  );
}

test.describe("Floating audio controls", () => {
  test("appear off-screen and drive play/pause + speed", async ({ authedPage: page }) => {
    await setupFloating(page);
    await page.goto(`/posts/${floatingPost.id}`);
    await page.getByTestId("listen-button").click();
    await page.getByTestId("play-pause-button").click();

    // Hidden while the inline player is on-screen.
    await expect(page.getByTestId("floating-audio-controls")).toBeHidden();

    // Scroll the inline player out of view (past its bottom edge, staying
    // above the footer) using its actual position rather than a magic offset.
    const playerBox = await page.getByTestId("play-pause-button").boundingBox();
    await page.evaluate(
      (y) => window.scrollTo(0, y),
      (playerBox?.y ?? 0) + (playerBox?.height ?? 0) + 100
    );
    await expect(page.getByTestId("floating-audio-controls")).toBeVisible();

    // Pause from the floating control → the button flips to Play.
    await page.getByTestId("floating-play-button").click();
    await expect(page.getByTestId("floating-play-button")).toHaveAttribute("aria-label", "Play");

    // Change speed to 2x from the floating control.
    await page.getByTestId("floating-speed-button").click();
    await expect(page.getByTestId("floating-speed-options")).toBeVisible();
    await page.getByRole("button", { name: "Set speed 2x" }).click();
    await expect(page.getByTestId("floating-speed-button")).toHaveText("2x");

    // Scroll back to the top → controls hide.
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(page.getByTestId("floating-audio-controls")).toBeHidden();
  });
});
