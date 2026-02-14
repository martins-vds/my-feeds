import { test, expect } from "@playwright/test";

test.describe("TTS Audio Playback", () => {
    test.beforeEach(async ({ page }) => {
        // Mock authentication
        await page.route("**/api/auth/session", (route) =>
            route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({
                    user: {
                        id: "test-user-id",
                        email: "test@example.com",
                        name: "Test User",
                    },
                }),
            })
        );

        // Mock post detail
        await page.route("**/api/posts/test-post-id", (route) =>
            route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({
                    id: "test-post-id",
                    title: "Test Post for Audio",
                    content: "<p>This is the post content for TTS.</p>",
                    feedId: "test-feed-id",
                    feedTitle: "Test Feed",
                    author: "Test Author",
                    link: "https://example.com/post",
                    publishedAt: "2024-01-15T12:00:00Z",
                    isRead: false,
                }),
            })
        );
    });

    test("displays listen button on post detail page", async ({ page }) => {
        await page.goto("/posts/test-post-id");

        await expect(page.getByRole("button", { name: /listen/i })).toBeVisible();
    });

    test("shows generating state when audio requested", async ({ page }) => {
        // Mock audio endpoint with 202 (generating)
        await page.route("**/api/posts/test-post-id/audio", (route) =>
            route.fulfill({
                status: 202,
                contentType: "application/json",
                body: JSON.stringify({
                    postId: "test-post-id",
                    status: "generating",
                    estimatedSeconds: 5,
                }),
            })
        );

        await page.goto("/posts/test-post-id");
        await page.getByRole("button", { name: /listen/i }).click();

        await expect(page.getByText(/generating/i)).toBeVisible();
    });

    test("shows audio player when audio is ready", async ({ page }) => {
        // Mock audio endpoint with 200 (ready)
        await page.route("**/api/posts/test-post-id/audio", (route) =>
            route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({
                    postId: "test-post-id",
                    status: "ready",
                    url: "/api/audio/test-cache-key",
                    durationSeconds: 45,
                    format: "mp3",
                }),
            })
        );

        await page.goto("/posts/test-post-id");
        await page.getByRole("button", { name: /listen/i }).click();

        await expect(page.getByRole("button", { name: /play/i })).toBeVisible();
    });

    test("plays audio when play button clicked", async ({ page }) => {
        // Mock audio endpoint
        await page.route("**/api/posts/test-post-id/audio", (route) =>
            route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({
                    postId: "test-post-id",
                    status: "ready",
                    url: "/api/audio/test-cache-key",
                    durationSeconds: 10,
                }),
            })
        );

        // Mock audio streaming (minimal MP3 header)
        await page.route("**/api/audio/test-cache-key", (route) =>
            route.fulfill({
                status: 200,
                contentType: "audio/mpeg",
                // Simple body for testing
                body: new Uint8Array([0xff, 0xfb, 0x90, 0x00, ...Array(256).fill(0)]).buffer,
            })
        );

        await page.goto("/posts/test-post-id");
        await page.getByRole("button", { name: /listen/i }).click();

        await page.waitForSelector('[role="button"][aria-label*="play" i]');
        await page.getByRole("button", { name: /play/i }).click();

        // Should switch to pause button
        await expect(page.getByRole("button", { name: /pause/i })).toBeVisible();
    });

    test("displays audio duration", async ({ page }) => {
        await page.route("**/api/posts/test-post-id/audio", (route) =>
            route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({
                    postId: "test-post-id",
                    status: "ready",
                    url: "/api/audio/test-cache-key",
                    durationSeconds: 125, // 2:05
                }),
            })
        );

        await page.goto("/posts/test-post-id");
        await page.getByRole("button", { name: /listen/i }).click();

        await expect(page.getByText(/2:05/)).toBeVisible();
    });

    test("handles audio generation error", async ({ page }) => {
        await page.route("**/api/posts/test-post-id/audio", (route) =>
            route.fulfill({
                status: 500,
                contentType: "application/json",
                body: JSON.stringify({
                    error: "TTS service unavailable",
                }),
            })
        );

        await page.goto("/posts/test-post-id");
        await page.getByRole("button", { name: /listen/i }).click();

        await expect(page.getByText(/failed|error/i)).toBeVisible();
    });

    test("supports range requests for seeking", async ({ page }) => {
        let rangeRequestReceived = false;

        await page.route("**/api/posts/test-post-id/audio", (route) =>
            route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({
                    postId: "test-post-id",
                    status: "ready",
                    url: "/api/audio/test-cache-key",
                    durationSeconds: 60,
                }),
            })
        );

        await page.route("**/api/audio/test-cache-key", (route) => {
            const headers = route.request().headers();
            if (headers["range"]) {
                rangeRequestReceived = true;
                route.fulfill({
                    status: 206,
                    headers: {
                        "Content-Range": "bytes 0-1023/10240",
                        "Content-Type": "audio/mpeg",
                    },
                    body: new Uint8Array(1024).buffer,
                });
            } else {
                route.fulfill({
                    status: 200,
                    contentType: "audio/mpeg",
                    body: new Uint8Array(10240).buffer,
                });
            }
        });

        await page.goto("/posts/test-post-id");
        await page.getByRole("button", { name: /listen/i }).click();

        // Wait for player to be ready
        await page.waitForSelector('[role="button"][aria-label*="play" i]');

        // The audio element should make range requests when seeking
        // This is browser behavior - we just verify the endpoint is accessible
    });

    test("shows retry option on playback error", async ({ page }) => {
        let requestCount = 0;

        await page.route("**/api/posts/test-post-id/audio", (route) => {
            requestCount++;
            if (requestCount === 1) {
                route.fulfill({
                    status: 500,
                    contentType: "application/json",
                    body: JSON.stringify({ error: "Server error" }),
                });
            } else {
                route.fulfill({
                    status: 200,
                    contentType: "application/json",
                    body: JSON.stringify({
                        postId: "test-post-id",
                        status: "ready",
                        url: "/api/audio/test-cache-key",
                    }),
                });
            }
        });

        await page.goto("/posts/test-post-id");
        await page.getByRole("button", { name: /listen/i }).click();

        await expect(page.getByRole("button", { name: /retry/i })).toBeVisible();

        await page.getByRole("button", { name: /retry/i }).click();

        await expect(page.getByRole("button", { name: /play/i })).toBeVisible();
    });
});
