import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright configuration for E2E tests.
 *
 * All API calls are intercepted via page.route() in fixtures, so the
 * backend is NOT required — only the Vite dev server needs to be running.
 *
 * Run:
 *   npx playwright test              # headless
 *   npx playwright test --ui         # interactive UI mode
 *   npx playwright test --headed     # visible browser
 */
export default defineConfig({
  testDir: "./playwright",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [["list"], ["html", { open: "never" }]],
  timeout: 30_000,

  use: {
    baseURL: "http://localhost:5173",
    // Route-based API mocks must not be bypassed by an installed worker.
    // The dedicated worker suite opts back into real service workers.
    serviceWorkers: "block",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  webServer: {
    command: "npx vite --port 5173",
    url: "http://localhost:5173",
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
