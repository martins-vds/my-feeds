/**
 * Playwright E2E tests for category and feed management
 * TDD: Written FIRST - must FAIL until implementation is complete
 */

import { test, expect } from "@playwright/test";

test.describe("Category Management", () => {
    // Note: These tests require authentication
    // Will need auth fixtures when implementing

    test.describe("Category List", () => {
        test("should display feeds page with category sidebar", async ({ page }) => {
            await page.goto("/feeds");

            // Should show the feeds page (or redirect to signin if not authenticated)
            // Will fail until route and component are implemented
            await expect(
                page.getByRole("heading", { name: /feeds|my feeds|categories/i })
            ).toBeVisible();
        });

        test("should show empty state for new user", async ({ page }) => {
            await page.goto("/feeds");

            // Should show empty state message
            await expect(page.getByText(/no categories|get started|add your first/i)).toBeVisible();
        });

        test("should display categories in sidebar", async ({ page }) => {
            await page.goto("/feeds");

            // Should show category list
            await expect(page.getByRole("list", { name: /categories/i })).toBeVisible();
        });
    });

    test.describe("Create Category", () => {
        test("should open create category dialog", async ({ page }) => {
            await page.goto("/feeds");

            // Click add category button
            await page.getByRole("button", { name: /add category|new category/i }).click();

            // Should show dialog
            await expect(page.getByRole("dialog")).toBeVisible();
            await expect(
                page.getByRole("heading", { name: /create|add|new.*category/i })
            ).toBeVisible();
        });

        test("should create category successfully", async ({ page }) => {
            await page.goto("/feeds");

            // Open dialog
            await page.getByRole("button", { name: /add category/i }).click();

            // Fill in name
            await page.getByLabel(/name/i).fill("Technology");

            // Submit
            await page.getByRole("button", { name: /create|save|add/i }).click();

            // Should close dialog and show new category
            await expect(page.getByRole("dialog")).not.toBeVisible();
            await expect(page.getByText("Technology")).toBeVisible();
        });

        test("should show validation error for empty name", async ({ page }) => {
            await page.goto("/feeds");
            await page.getByRole("button", { name: /add category/i }).click();

            // Try to submit without name
            await page.getByRole("button", { name: /create|save/i }).click();

            // Should show validation error
            await expect(page.getByText(/required|name is required/i)).toBeVisible();
        });

        test("should show error for duplicate name", async ({ page }) => {
            await page.goto("/feeds");

            // Create first category
            await page.getByRole("button", { name: /add category/i }).click();
            await page.getByLabel(/name/i).fill("Technology");
            await page.getByRole("button", { name: /create|save/i }).click();

            // Try to create duplicate
            await page.getByRole("button", { name: /add category/i }).click();
            await page.getByLabel(/name/i).fill("Technology");
            await page.getByRole("button", { name: /create|save/i }).click();

            // Should show duplicate error
            await expect(page.getByText(/already exists|duplicate/i)).toBeVisible();
        });
    });

    test.describe("Edit Category", () => {
        test("should open edit dialog for existing category", async ({ page }) => {
            await page.goto("/feeds");

            // Assuming category exists, click edit button
            await page.getByRole("button", { name: /edit/i }).first().click();

            await expect(page.getByRole("dialog")).toBeVisible();
            await expect(page.getByRole("heading", { name: /edit.*category/i })).toBeVisible();
        });

        test("should rename category successfully", async ({ page }) => {
            await page.goto("/feeds");

            await page.getByRole("button", { name: /edit/i }).first().click();
            await page.getByLabel(/name/i).clear();
            await page.getByLabel(/name/i).fill("Renamed Category");
            await page.getByRole("button", { name: /save|update/i }).click();

            await expect(page.getByText("Renamed Category")).toBeVisible();
        });
    });

    test.describe("Delete Category", () => {
        test("should show confirmation dialog", async ({ page }) => {
            await page.goto("/feeds");

            await page.getByRole("button", { name: /delete/i }).first().click();

            await expect(page.getByText(/are you sure|confirm/i)).toBeVisible();
        });

        test("should delete category on confirm", async ({ page }) => {
            await page.goto("/feeds");

            const categoryName = await page.getByRole("listitem").first().textContent();

            await page.getByRole("button", { name: /delete/i }).first().click();
            await page.getByRole("button", { name: /confirm|yes|delete/i }).click();

            // Category should be removed
            await expect(page.getByText(categoryName!)).not.toBeVisible();
        });
    });
});

test.describe("Feed Management", () => {
    test.describe("Add Feed", () => {
        test("should open add feed dialog", async ({ page }) => {
            await page.goto("/feeds");

            await page.getByRole("button", { name: /add feed/i }).click();

            await expect(page.getByRole("dialog")).toBeVisible();
            await expect(page.getByRole("heading", { name: /add feed|subscribe/i })).toBeVisible();
        });

        test("should add valid RSS feed successfully", async ({ page }) => {
            await page.goto("/feeds");

            await page.getByRole("button", { name: /add feed/i }).click();
            await page.getByLabel(/url/i).fill("https://example.com/feed.xml");
            await page.getByRole("button", { name: /add|subscribe/i }).click();

            // Should show success and feed in list
            // Note: This will fail until backend validation is implemented
            await expect(page.getByText(/example|feed added/i)).toBeVisible();
        });

        test("should show error for invalid URL", async ({ page }) => {
            await page.goto("/feeds");

            await page.getByRole("button", { name: /add feed/i }).click();
            await page.getByLabel(/url/i).fill("not-a-valid-url");
            await page.getByRole("button", { name: /add|subscribe/i }).click();

            await expect(page.getByText(/invalid.*url|not.*valid/i)).toBeVisible();
        });

        test("should show error for non-RSS URL", async ({ page }) => {
            await page.goto("/feeds");

            await page.getByRole("button", { name: /add feed/i }).click();
            await page.getByLabel(/url/i).fill("https://example.com/not-a-feed.html");
            await page.getByRole("button", { name: /add|subscribe/i }).click();

            await expect(page.getByText(/not.*feed|invalid.*feed/i)).toBeVisible();
        });
    });

    test.describe("Feed List", () => {
        test("should display feeds under category", async ({ page }) => {
            await page.goto("/feeds");

            // Click on category to expand
            await page.getByText("Technology").click();

            // Should show feeds under it
            await expect(page.getByRole("list", { name: /feeds/i })).toBeVisible();
        });

        test("should show feed title and icon", async ({ page }) => {
            await page.goto("/feeds");
            await page.getByText("Technology").click();

            // Should display feed metadata
            await expect(page.getByRole("img", { name: /favicon|icon/i })).toBeVisible();
        });
    });

    test.describe("Delete Feed", () => {
        test("should unsubscribe from feed", async ({ page }) => {
            await page.goto("/feeds");
            await page.getByText("Technology").click();

            // Delete first feed
            await page.getByRole("button", { name: /delete|unsubscribe|remove/i }).first().click();
            await page.getByRole("button", { name: /confirm|yes/i }).click();

            // Feed should be removed
            await expect(page.getByText(/unsubscribed|removed/i)).toBeVisible();
        });
    });

    test.describe("Move Feed", () => {
        test("should move feed to different category", async ({ page }) => {
            await page.goto("/feeds");
            await page.getByText("Technology").click();

            // Click move/edit on feed
            await page.getByRole("button", { name: /move|edit/i }).first().click();

            // Select new category
            await page.getByLabel(/category/i).selectOption("Entertainment");
            await page.getByRole("button", { name: /save|move/i }).click();

            // Feed should move to new category
            await expect(page.getByText(/moved/i)).toBeVisible();
        });
    });

    test.describe("Refresh Feed", () => {
        test("should manually refresh feed to fetch new posts", async ({ page }) => {
            await page.goto("/feeds");
            await page.getByText("Technology").click();

            // Click refresh button on feed
            await page.getByRole("button", { name: /refresh|sync/i }).first().click();

            // Should show refreshing state then success
            await expect(page.getByText(/refreshed|updated/i)).toBeVisible();
        });
    });
});
