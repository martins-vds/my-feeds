/**
 * Playwright E2E tests for authentication flow
 * TDD: Written FIRST - must FAIL until implementation is complete
 */

import { test, expect } from "@playwright/test";

test.describe("Authentication Flow", () => {
    test.describe("Sign In Page", () => {
        test("should display sign in page with OAuth buttons", async ({ page }) => {
            await page.goto("/signin");

            // Should show the sign in page
            await expect(page.getByRole("heading", { name: /sign in/i })).toBeVisible();

            // Should have OAuth provider buttons
            await expect(page.getByRole("button", { name: /github/i })).toBeVisible();
            await expect(page.getByRole("button", { name: /google/i })).toBeVisible();
            await expect(page.getByRole("button", { name: /microsoft|outlook/i })).toBeVisible();
        });

        test("should redirect to GitHub OAuth when clicking GitHub button", async ({ page }) => {
            await page.goto("/signin");

            // Click GitHub sign in button
            await page.getByRole("button", { name: /github/i }).click();

            // Should redirect to backend auth endpoint (which redirects to GitHub)
            await expect(page).toHaveURL(/\/api\/auth\/login\/github|github\.com/);
        });

        test("should redirect to Google OAuth when clicking Google button", async ({ page }) => {
            await page.goto("/signin");

            await page.getByRole("button", { name: /google/i }).click();

            await expect(page).toHaveURL(/\/api\/auth\/login\/google|accounts\.google\.com/);
        });

        test("should redirect to Microsoft OAuth when clicking Microsoft button", async ({ page }) => {
            await page.goto("/signin");

            await page.getByRole("button", { name: /microsoft|outlook/i }).click();

            await expect(page).toHaveURL(/\/api\/auth\/login\/microsoft|login\.microsoftonline\.com/);
        });
    });

    test.describe("Protected Routes", () => {
        test("should redirect unauthenticated users to sign in", async ({ page }) => {
            // Try to access a protected route without authentication
            await page.goto("/posts");

            // Should redirect to sign in page
            await expect(page).toHaveURL(/\/signin/);
        });

        test("should redirect unauthenticated users from feeds page", async ({ page }) => {
            await page.goto("/feeds");

            await expect(page).toHaveURL(/\/signin/);
        });

        test("should redirect unauthenticated users from settings page", async ({ page }) => {
            await page.goto("/settings");

            await expect(page).toHaveURL(/\/signin/);
        });
    });

    test.describe("OAuth Callback", () => {
        test("should handle OAuth callback and redirect to main page", async ({ page }) => {
            // Mock a successful OAuth callback
            // In a real test, we'd mock the backend response
            await page.goto("/auth/callback?code=test_code&state=test_state");

            // Should show loading or redirect to main page
            // The actual behavior depends on the callback implementation
            await expect(
                page.getByText(/loading|redirecting/i).or(page.locator('[data-testid="main-content"]'))
            ).toBeVisible({ timeout: 5000 });
        });

        test("should handle OAuth error and show error message", async ({ page }) => {
            await page.goto("/auth/callback?error=access_denied&error_description=User%20denied%20access");

            // Should show error message
            await expect(page.getByText(/error|denied|failed/i)).toBeVisible();
        });
    });

    test.describe("Authenticated User", () => {
        // These tests require mocking the auth state
        // In a real setup, we'd use a test user or mock the session

        test.skip("should display user avatar in header when authenticated", async ({ page }) => {
            // TODO: Implement with mock authentication
            await page.goto("/posts");

            await expect(page.getByTestId("user-avatar")).toBeVisible();
        });

        test.skip("should allow sign out from header menu", async ({ page }) => {
            // TODO: Implement with mock authentication
            await page.goto("/posts");

            // Open user menu
            await page.getByTestId("user-avatar").click();

            // Click sign out
            await page.getByRole("menuitem", { name: /sign out/i }).click();

            // Should redirect to sign in
            await expect(page).toHaveURL(/\/signin/);
        });
    });
});
