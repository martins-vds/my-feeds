/**
 * E2E tests for authentication flow.
 *
 * Tests the sign-in page, OAuth button redirects, protected-route
 * guards, and the OAuth callback page.
 */

import { test, expect, mockApi, TEST_USER } from "./fixtures";

// ── Public sign-in page (no auth mock needed) ──────────────────────────

test.describe("Sign In Page", () => {
  test.beforeEach(async ({ page }) => {
    await mockApi(
      page,
      "**/api/auth/me",
      { error: { code: "UNAUTHORIZED", message: "Not authenticated" } },
      { status: 401 }
    );
  });

  test("displays heading and OAuth provider buttons", async ({ page }) => {
    await page.goto("/signin");

    await expect(page.getByRole("heading", { name: /my-feeds/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /github/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /google/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /microsoft/i })).toBeVisible();
  });

  test("GitHub button redirects to backend OAuth endpoint", async ({ page }) => {
    await page.route("**/api/auth/login/github", (route) =>
      route.fulfill({ status: 200, body: "redirected" })
    );

    await page.goto("/signin");
    const [request] = await Promise.all([
      page.waitForRequest("**/api/auth/login/github"),
      page.getByRole("button", { name: /github/i }).click(),
    ]);
    expect(request.url()).toContain("/api/auth/login/github");
  });

  test("Google button redirects to backend OAuth endpoint", async ({ page }) => {
    await page.route("**/api/auth/login/google", (route) =>
      route.fulfill({ status: 200, body: "redirected" })
    );

    await page.goto("/signin");
    const [request] = await Promise.all([
      page.waitForRequest("**/api/auth/login/google"),
      page.getByRole("button", { name: /google/i }).click(),
    ]);
    expect(request.url()).toContain("/api/auth/login/google");
  });

  test("Microsoft button redirects to backend OAuth endpoint", async ({ page }) => {
    await page.route("**/api/auth/login/microsoft", (route) =>
      route.fulfill({ status: 200, body: "redirected" })
    );

    await page.goto("/signin");
    const [request] = await Promise.all([
      page.waitForRequest("**/api/auth/login/microsoft"),
      page.getByRole("button", { name: /microsoft/i }).click(),
    ]);
    expect(request.url()).toContain("/api/auth/login/microsoft");
  });
});

// ── Protected route redirects ──────────────────────────────────────────

test.describe("Protected Routes", () => {
  test.beforeEach(async ({ page }) => {
    await mockApi(
      page,
      "**/api/auth/me",
      { error: { code: "UNAUTHORIZED", message: "Not authenticated" } },
      { status: 401 }
    );
  });

  test("redirects /posts to /signin when not authenticated", async ({ page }) => {
    await page.goto("/posts");
    await expect(page).toHaveURL(/\/signin/);
  });

  test("redirects /feeds to /signin when not authenticated", async ({ page }) => {
    await page.goto("/feeds");
    await expect(page).toHaveURL(/\/signin/);
  });

  test("redirects /settings to /signin when not authenticated", async ({ page }) => {
    await page.goto("/settings");
    await expect(page).toHaveURL(/\/signin/);
  });
});

// ── OAuth callback ─────────────────────────────────────────────────────

test.describe("OAuth Callback", () => {
  test("shows error message when OAuth returns error", async ({ page }) => {
    await mockApi(
      page,
      "**/api/auth/me",
      { error: { code: "UNAUTHORIZED", message: "Not authenticated" } },
      { status: 401 }
    );
    await page.goto("/auth/callback?error=access_denied&error_description=User%20denied%20access");
    await expect(page.getByText(/denied|error|failed/i)).toBeVisible();
  });

  test("redirects to /posts after successful callback", async ({ page }) => {
    await mockApi(page, "**/api/auth/me", TEST_USER);
    await mockApi(page, "**/api/posts*", { posts: [], hasMore: false, nextCursor: null });
    await mockApi(page, "**/api/categories", { categories: [] });

    await page.goto("/auth/callback?code=test_code&state=test_state");
    await expect(page).toHaveURL(/\/posts/, { timeout: 5000 });
  });
});

// ── Authenticated user header ──────────────────────────────────────────

test.describe("Authenticated User", () => {
  test("displays user avatar in header", async ({ authedPage: page }) => {
    await mockApi(page, "**/api/posts*", { posts: [], hasMore: false, nextCursor: null });
    await mockApi(page, "**/api/categories", { categories: [] });

    await page.goto("/posts");
    await expect(page.getByTestId("user-avatar")).toBeVisible();
  });

  test("sign out clears session and redirects to signin", async ({ authedPage: page }) => {
    await mockApi(page, "**/api/posts*", { posts: [], hasMore: false, nextCursor: null });
    await mockApi(page, "**/api/categories", { categories: [] });
    await mockApi(
      page,
      "**/api/auth/logout",
      { message: "Logged out successfully" },
      { method: "POST" }
    );

    await page.goto("/posts");
    await expect(page.getByTestId("user-avatar")).toBeVisible();

    await page.getByTestId("user-avatar").click();
    await page.getByText(/sign out/i).click();

    // After logout completes, the navigate("/signin") fires.
    // Override auth/me to 401 so the signin page stays unauthenticated.
    await page.route("**/api/auth/me", (route) =>
      route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ error: { code: "UNAUTHORIZED", message: "Not authenticated" } }),
      })
    );

    await expect(page).toHaveURL(/\/signin/, { timeout: 5000 });
  });
});
