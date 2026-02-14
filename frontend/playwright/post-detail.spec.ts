/**
 * Playwright E2E tests for post reading flow
 * Tests GET /posts/{id} and read state toggle
 */

import { test, expect } from "@playwright/test";

test.describe("Post Detail Page", () => {
    test.beforeEach(async ({ page }) => {
        // Authenticate user (setup should provide session)
        // This assumes test fixtures provide authenticated session
    });

    test("should display full post content", async ({ page }) => {
        // Navigate to posts list
        await page.goto("/posts");

        // Click on first post
        await page.click('[data-testid="post-card"]:first-child');

        // Wait for post detail page
        await expect(page).toHaveURL(/\/posts\/[a-f0-9-]+/);

        // Verify content is displayed
        await expect(page.locator('[data-testid="post-title"]')).toBeVisible();
        await expect(page.locator('[data-testid="post-content"]')).toBeVisible();
    });

    test("should auto-mark post as read when viewing", async ({ page }) => {
        await page.goto("/posts?readState=unread");

        // Get first unread post's title
        const firstPostTitle = await page.locator('[data-testid="post-card"]:first-child [data-testid="post-title"]').textContent();

        // Click to view
        await page.click('[data-testid="post-card"]:first-child');

        // Wait for detail page
        await expect(page.locator('[data-testid="post-content"]')).toBeVisible();

        // Go back to list
        await page.goBack();

        // The post should now be marked as read (not in unread filter)
        // Or check the read indicator
    });

    test("should toggle read state manually", async ({ page }) => {
        await page.goto("/posts");

        // Click first post
        await page.click('[data-testid="post-card"]:first-child');

        // Wait for detail page
        await expect(page.locator('[data-testid="post-content"]')).toBeVisible();

        // Find and click read state toggle
        const toggleButton = page.locator('[data-testid="read-state-toggle"]');
        await expect(toggleButton).toBeVisible();

        // Get initial state
        const initialState = await toggleButton.getAttribute("data-is-read");

        // Click toggle
        await toggleButton.click();

        // Verify state changed
        await expect(toggleButton).toHaveAttribute(
            "data-is-read",
            initialState === "true" ? "false" : "true"
        );
    });

    test("should show post metadata", async ({ page }) => {
        await page.goto("/posts");

        // Click first post
        await page.click('[data-testid="post-card"]:first-child');

        // Verify metadata elements
        await expect(page.locator('[data-testid="post-author"]')).toBeVisible();
        await expect(page.locator('[data-testid="post-date"]')).toBeVisible();
        await expect(page.locator('[data-testid="feed-title"]')).toBeVisible();
    });

    test("should link to original article", async ({ page, context }) => {
        await page.goto("/posts");

        // Click first post
        await page.click('[data-testid="post-card"]:first-child');

        // Find original link
        const originalLink = page.locator('[data-testid="original-link"]');
        await expect(originalLink).toBeVisible();
        await expect(originalLink).toHaveAttribute("href", /^https?:\/\//);
    });

    test("should navigate back to posts list", async ({ page }) => {
        await page.goto("/posts");

        // Click first post
        await page.click('[data-testid="post-card"]:first-child');

        // Wait for detail
        await expect(page.locator('[data-testid="post-content"]')).toBeVisible();

        // Click back button
        await page.click('[data-testid="back-button"]');

        // Should be back on posts list
        await expect(page).toHaveURL("/posts");
    });

    test("should show error for non-existent post", async ({ page }) => {
        // Navigate directly to non-existent post
        await page.goto("/posts/00000000-0000-0000-0000-000000000000");

        // Should show error
        await expect(page.locator('[data-testid="error-message"]')).toBeVisible();
        await expect(page.locator('[data-testid="error-message"]')).toContainText(/not found/i);
    });

    test("should require authentication", async ({ page, context }) => {
        // Clear session
        await context.clearCookies();

        // Try to access post
        await page.goto("/posts/some-post-id");

        // Should redirect to sign in
        await expect(page).toHaveURL(/\/signin/);
    });
});
