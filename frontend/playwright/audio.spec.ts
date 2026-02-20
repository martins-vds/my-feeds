/**
 * E2E tests for TTS audio playback on the post detail page.
 *
 * These tests mock the post detail API and audio endpoints to exercise
 * the full AudioPlayer component lifecycle.
 *
 * AudioPlayer starts in idle state (no auto-fetch) and only calls the
 * audio API when the user clicks "Listen".
 */

import { test, expect, mockApi, makePostDetail } from "./fixtures";

// ── Seed data ──────────────────────────────────────────────────────────

const postWithAudio = makePostDetail("feed-1", {
  id: "audio-post-1",
  title: "Post With Audio",
  content: "<p>Content for audio testing.</p>",
  feedTitle: "Audio Feed",
  author: "Narrator",
  link: "https://example.com/audio-post",
  publishedAt: "2026-01-12T08:00:00Z",
  isRead: true,
  hasAudio: false, // will generate on demand
});

// ── Helpers ────────────────────────────────────────────────────────────

async function setupAudioPage(page: import("@playwright/test").Page) {
  await mockApi(page, `**/api/posts/${postWithAudio.id}`, postWithAudio);
  await mockApi(page, "**/api/categories", { categories: [] });
}

// ── Tests ──────────────────────────────────────────────────────────────

test.describe("TTS Audio Playback", () => {
  test("displays listen button on post detail page", async ({ authedPage: page }) => {
    await setupAudioPage(page);
    // AudioPlayer starts in idle state → shows listen button immediately (no API call)

    await page.goto(`/posts/${postWithAudio.id}`);
    await expect(page.getByTestId("listen-button")).toBeVisible();
  });

  test("shows generating state when audio is requested", async ({ authedPage: page }) => {
    await setupAudioPage(page);

    // After clicking Listen, the hook calls GET /posts/{id}/audio.
    // Return 202 "generating" for all calls (including any polls).
    await page.route(`**/api/posts/${postWithAudio.id}/audio`, (route) => {
      return route.fulfill({
        status: 202,
        contentType: "application/json",
        body: JSON.stringify({
          postId: postWithAudio.id,
          status: "generating",
          estimatedSeconds: 5,
        }),
      });
    });

    await page.goto(`/posts/${postWithAudio.id}`);
    await page.getByTestId("listen-button").click();

    await expect(page.getByText(/generating/i)).toBeVisible({ timeout: 5000 });
  });

  test("shows audio player when audio is ready", async ({ authedPage: page }) => {
    await setupAudioPage(page);

    // Return "ready" immediately on click
    await page.route(`**/api/posts/${postWithAudio.id}/audio`, (route) => {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          postId: postWithAudio.id,
          status: "ready",
          url: "/api/audio/test-cache-key",
          durationSeconds: 45,
          format: "mp3",
        }),
      });
    });

    // Mock the audio stream URL so the Audio element doesn't error
    await page.route("**/api/audio/**", (route) => {
      // Return a minimal valid WAV header (44 bytes, 0 samples)
      const wav = Buffer.from([
        0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45, 0x66, 0x6d, 0x74,
        0x20, 0x10, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x44, 0xac, 0x00, 0x00, 0x44, 0xac,
        0x00, 0x00, 0x01, 0x00, 0x08, 0x00, 0x64, 0x61, 0x74, 0x61, 0x00, 0x00, 0x00, 0x00,
      ]);
      return route.fulfill({
        status: 200,
        contentType: "audio/wav",
        body: wav,
      });
    });

    await page.goto(`/posts/${postWithAudio.id}`);
    await page.getByTestId("listen-button").click();

    await expect(page.getByTestId("play-pause-button")).toBeVisible({ timeout: 5000 });
  });

  test("displays audio duration when ready", async ({ authedPage: page }) => {
    await setupAudioPage(page);

    await page.route(`**/api/posts/${postWithAudio.id}/audio`, (route) => {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          postId: postWithAudio.id,
          status: "ready",
          url: "/api/audio/test-cache-key",
          durationSeconds: 125, // 2:05
        }),
      });
    });

    // Mock audio stream
    await page.route("**/api/audio/**", (route) => {
      const wav = Buffer.from([
        0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45, 0x66, 0x6d, 0x74,
        0x20, 0x10, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x44, 0xac, 0x00, 0x00, 0x44, 0xac,
        0x00, 0x00, 0x01, 0x00, 0x08, 0x00, 0x64, 0x61, 0x74, 0x61, 0x00, 0x00, 0x00, 0x00,
      ]);
      return route.fulfill({
        status: 200,
        contentType: "audio/wav",
        body: wav,
      });
    });

    await page.goto(`/posts/${postWithAudio.id}`);
    await page.getByTestId("listen-button").click();

    // Should show duration formatted as 2:05
    await expect(page.getByText(/2:05/)).toBeVisible({ timeout: 5000 });
  });

  test("handles audio generation error with retry button", async ({ authedPage: page }) => {
    await setupAudioPage(page);

    let callCount = 0;
    await page.route(`**/api/posts/${postWithAudio.id}/audio`, (route) => {
      callCount++;
      if (callCount === 1) {
        // First click: error
        return route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({
            error: { code: "TTS_ERROR", message: "TTS service unavailable" },
          }),
        });
      }
      // Retry click: ready
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          postId: postWithAudio.id,
          status: "ready",
          url: "/api/audio/test-cache-key",
          durationSeconds: 30,
        }),
      });
    });

    // Mock audio stream for retry
    await page.route("**/api/audio/**", (route) => {
      const wav = Buffer.from([
        0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45, 0x66, 0x6d, 0x74,
        0x20, 0x10, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x44, 0xac, 0x00, 0x00, 0x44, 0xac,
        0x00, 0x00, 0x01, 0x00, 0x08, 0x00, 0x64, 0x61, 0x74, 0x61, 0x00, 0x00, 0x00, 0x00,
      ]);
      return route.fulfill({
        status: 200,
        contentType: "audio/wav",
        body: wav,
      });
    });

    await page.goto(`/posts/${postWithAudio.id}`);
    await page.getByTestId("listen-button").click();

    // Should show error state with retry button
    await expect(page.getByText(/failed|error/i)).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole("button", { name: /retry/i })).toBeVisible();

    // Retry
    await page.getByRole("button", { name: /retry/i }).click();

    // Should show player after retry
    await expect(page.getByTestId("play-pause-button")).toBeVisible({ timeout: 5000 });
  });
});
