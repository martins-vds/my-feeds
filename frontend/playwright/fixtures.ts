/**
 * Shared Playwright fixtures and mock data helpers for E2E tests.
 *
 * Provides an `authenticatedPage` fixture that mocks the auth session
 * so every test starts as a logged-in user, and factory functions for
 * categories, feeds, posts, etc.
 */

import { test as base, type Page } from "@playwright/test";

// ── Test user ──────────────────────────────────────────────────────────

export const TEST_USER = {
  id: "e2e-user-00000000-0000-4000-a000-000000000001",
  email: "e2e@example.com",
  name: "E2E Test User",
  avatarUrl: null,
  provider: "github" as const,
  timezone: "UTC",
  notificationsEnabled: false,
};

// ── Mock data factories ────────────────────────────────────────────────

let _seq = 0;
function seq() {
  return ++_seq;
}

export function makeCategory(overrides: Record<string, unknown> = {}) {
  const n = seq();
  return {
    id: `cat-${n}`,
    name: `Category ${n}`,
    position: n - 1,
    feedCount: 0,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

export function makeFeed(categoryId: string, overrides: Record<string, unknown> = {}) {
  const n = seq();
  return {
    id: `feed-${n}`,
    categoryId,
    url: `https://example.com/feed-${n}.xml`,
    title: `Feed ${n}`,
    description: `Description for feed ${n}`,
    siteUrl: `https://example.com`,
    iconUrl: null,
    lastFetchedAt: "2026-01-01T00:00:00Z",
    fetchErrorCount: 0,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

export function makePost(feedId: string, overrides: Record<string, unknown> = {}) {
  const n = seq();
  return {
    id: `post-${n}`,
    feedId,
    feedTitle: `Feed Title`,
    feedIconUrl: null,
    title: `Post Title ${n}`,
    summary: `Summary of post ${n}`,
    author: `Author ${n}`,
    link: `https://example.com/post-${n}`,
    publishedAt: new Date(2026, 0, 15, 12, 0, 0).toISOString(),
    isRead: false,
    hasAudio: false,
    ...overrides,
  };
}

export function makePostDetail(feedId: string, overrides: Record<string, unknown> = {}) {
  const base = makePost(feedId, overrides);
  return {
    ...base,
    content: `<p>Full content for ${base.title}</p>`,
    ...overrides,
  };
}

// ── API mock helper ────────────────────────────────────────────────────

/**
 * Convenience: set up a page.route() that returns JSON.
 */
export async function mockApi(
  page: Page,
  urlPattern: string | RegExp,
  body: unknown,
  options: { status?: number; method?: string } = {}
) {
  const { status = 200, method } = options;
  await page.route(urlPattern, (route) => {
    if (method && route.request().method() !== method) {
      return route.fallback();
    }
    return route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
}

// ── Custom fixtures ────────────────────────────────────────────────────

type Fixtures = {
  /** A Page that has GET /api/auth/me mocked to return TEST_USER. */
  authedPage: Page;
};

/**
 * Extended test object whose `authedPage` fixture automatically mocks
 * the authentication endpoint so the app considers the user logged in.
 */
export const test = base.extend<Fixtures>({
  authedPage: async ({ page }, use) => {
    // Mock the auth check – this is the first call AuthProvider makes.
    await mockApi(page, "**/api/auth/me", TEST_USER);
    await use(page);
  },
});

export { expect } from "@playwright/test";
