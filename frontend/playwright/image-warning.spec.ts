import { test, expect, mockApi, makePostDetail } from "./fixtures";

for (const width of [320, 1280]) {
  test(`disabled images show a keyboard-accessible warning at ${width}px`, async ({
    authedPage: page,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    const requested: string[] = [];
    const post = makePostDetail("warning-feed", {
      id: "image-warning-post",
      title: "Image warning",
      content: '<p>Article text stays readable.</p><img src="https://tracker.example/pixel" alt="Publisher image">',
    });
    await page.route("https://tracker.example/**", (route) => {
      requested.push(route.request().url());
      return route.abort();
    });
    await mockApi(page, `**/api/posts/${post.id}`, post);
    await mockApi(page, "**/api/categories", { categories: [] });
    await page.goto(`/posts/${post.id}`);
    const notice = page.getByRole("note", { name: "Image security notice" });
    await expect(notice).toContainText("Images disabled for security reasons.");
    const expectIconAligned = async () => {
      const icon = await notice.locator("svg").first().boundingBox();
      const text = await notice.getByText("Images disabled for security reasons.", { exact: true }).boundingBox();
      expect(icon).not.toBeNull();
      expect(text).not.toBeNull();
      expect(Math.abs((icon!.y + icon!.height / 2) - (text!.y + text!.height / 2))).toBeLessThanOrEqual(1);
    };
    await expectIconAligned();
    await expect(page.getByRole("checkbox", { name: /load publisher images/i })).toHaveCount(0);
    const learnMore = notice.getByRole("button", { name: "Learn more" });
    await expect(learnMore).toHaveAttribute("aria-expanded", "false");
    await expect(notice).not.toContainText("IP address");
    await page.screenshot({ path: `test-results/image-warning-${width}.png` });
    await learnMore.focus();
    await learnMore.press("Enter");
    await expect(learnMore).toHaveAttribute("aria-expanded", "true");
    await expect(notice).toContainText("IP address");
    await expect(notice).toContainText("which article you are reading");
    await expectIconAligned();
    await expect(page.getByTestId("post-content").locator("img")).not.toHaveAttribute("src");
    expect(requested).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: `test-results/image-warning-expanded-${width}.png` });
    await learnMore.press("Space");
    await expect(learnMore).toHaveAttribute("aria-expanded", "false");
    await expect(notice).not.toContainText("IP address");
    expect(requested).toEqual([]);
  });
}
