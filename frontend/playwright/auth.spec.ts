/**
 * E2E tests for authentication flow.
 *
 * Tests the sign-in page, OAuth button redirects, protected-route
 * guards, the OAuth callback page, and the post-OAuth sign-up flow.
 */

import { test, expect, mockApi, setupReaderApi, TEST_USER } from "./fixtures";

// ── Pending sign-up mock data ──────────────────────────────────────────

const PENDING_PROFILE = {
  pending_signup: true,
  profile: {
    email: "newuser@example.com",
    name: "New User",
    avatarUrl: "https://avatars.example.com/new",
    provider: "github" as const,
  },
};

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

    await expect(page.getByRole("heading", { name: /almanac/i })).toBeVisible();
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

// ── Sign-Up Flow (Post-OAuth) ──────────────────────────────────────────

test.describe("Sign Up Flow", () => {
  test("new user is redirected to /signup when pending", async ({ page }) => {
    await mockApi(page, "**/api/auth/me", PENDING_PROFILE);

    await page.goto("/posts");
    await expect(page).toHaveURL(/\/signup/, { timeout: 5000 });
  });

  test("sign-up page displays profile and form fields", async ({ page }) => {
    await mockApi(page, "**/api/auth/me", PENDING_PROFILE);

    await page.goto("/signup");
    await expect(page.getByRole("heading", { name: /complete your profile/i })).toBeVisible();
    await expect(page.getByText("newuser@example.com")).toBeVisible();
    // Name should be pre-filled
    await expect(page.getByRole("textbox", { name: /display name/i })).toHaveValue("New User");
    // Timezone autocomplete should be present
    await expect(page.getByRole("combobox", { name: /timezone/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /complete sign up/i })).toBeVisible();
  });

  test("form validation rejects empty name", async ({ page }) => {
    await mockApi(page, "**/api/auth/me", PENDING_PROFILE);

    await page.goto("/signup");
    // Clear the pre-filled name
    const nameInput = page.getByRole("textbox", { name: /display name/i });
    await nameInput.fill("   ");

    await page.getByRole("button", { name: /complete sign up/i }).click();
    await expect(page.getByText(/display name is required/i)).toBeVisible();
  });

  test("successful sign-up redirects to /posts", async ({ page }) => {
    // /auth/me stays pending until the sign-up POST succeeds, then returns the
    // authenticated user (deterministic — no dependence on call ordering).
    let signedUp = false;
    await page.route("**/api/auth/me", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(signedUp ? TEST_USER : PENDING_PROFILE),
      })
    );
    await page.route("**/api/auth/complete-signup", (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      signedUp = true;
      return route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ authenticated: true, user: TEST_USER }),
      });
    });

    // Landing page (reader) data.
    await setupReaderApi(page, { categories: [], feeds: [], posts: [] });

    await page.goto("/signup");
    await expect(page.getByRole("heading", { name: /complete your profile/i })).toBeVisible();

    await page.getByRole("button", { name: /complete sign up/i }).click();

    await expect(page).toHaveURL(/\/posts/, { timeout: 5000 });
  });

  test("returning user bypasses sign-up", async ({ authedPage: page }) => {
    await mockApi(page, "**/api/posts*", { posts: [], hasMore: false, nextCursor: null });
    await mockApi(page, "**/api/categories", { categories: [] });

    await page.goto("/posts");
    // Should NOT redirect to /signup
    await expect(page).toHaveURL(/\/posts/, { timeout: 5000 });
  });

  test("expired pending redirects to signin via /signup guard", async ({ page }) => {
    // Mock: /auth/me returns 401 (expired pending is treated as no session)
    await mockApi(
      page,
      "**/api/auth/me",
      { error: { code: "UNAUTHORIZED", message: "Not authenticated" } },
      { status: 401 }
    );

    await page.goto("/signup");
    // SignUpPage guard redirects to /signin when not pending
    await expect(page).toHaveURL(/\/signin/, { timeout: 5000 });
  });
});
