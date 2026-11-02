import { expect, test } from "@playwright/test";

// A 1920x1080 Windows display at 150% system scaling has roughly this
// 1280x585 CSS viewport after Chrome and the taskbar take their space.
for (const viewport of [
  { width: 1280, height: 585 },
  { width: 1280, height: 720 },
  { width: 1920, height: 878 },
  { width: 390, height: 844 },
]) {
  test(`landing controls and footer fit without scrolling at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const start = new Date("2026-11-03T08:00:00+05:30").getTime();
    await page.clock.install({ time: start });
    await page.clock.pauseAt(start + 500);
    await page.goto("/?landing&restoreHang");
    await page.clock.runFor(1000);
    await page.locator(".transit-artwork img").evaluate(img => (img as HTMLImageElement).decode());
    const heading = page.getByRole("heading", { name: /Campus routes/ });
    const signIn = page.getByRole("button", { name: "Sign In with Google", exact: true });
    await expect(heading).toBeVisible();
    await expect(signIn).toBeEnabled();
    await expect(page.locator('img[src*="uni-logo"]')).toHaveCount(0);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    const bounds = await page.locator(".transit-landing").evaluate(main => {
      const nodes = [main.querySelector("h1")!, main.querySelector("section > p")!,
        main.querySelector("section button")!, main.querySelector("footer")!];
      return {
        overflow: document.documentElement.scrollWidth > innerWidth,
        height: main.getBoundingClientRect().height,
        nodes: nodes.map(node => {
          const rect = node.getBoundingClientRect();
          return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right };
        }),
      };
    });
    expect(bounds.overflow).toBe(false);
    expect(bounds.height).toBeLessThanOrEqual(viewport.height + 1);
    for (const rect of bounds.nodes) {
      expect(rect.top).toBeGreaterThanOrEqual(0);
      expect(rect.bottom).toBeLessThanOrEqual(viewport.height + 1);
      expect(rect.left).toBeGreaterThanOrEqual(0);
      expect(rect.right).toBeLessThanOrEqual(viewport.width + 1);
    }
    const rect = bounds.nodes[2]!;
    expect(await signIn.evaluate((button, point) => button.contains(document.elementFromPoint(point.x, point.y)),
      { x: (rect.left + rect.right) / 2, y: (rect.top + rect.bottom) / 2 })).toBe(true);
  });
}

test("100% browser zoom on a 150%-scaled desktop keeps the full sign-in view visible", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, viewport: { width: 1280, height: 585 }, deviceScaleFactor: 1.5 });
  try {
    const page = await context.newPage();
    const start = new Date("2026-11-03T08:00:00+05:30").getTime();
    await page.clock.install({ time: start });
    await page.clock.pauseAt(start + 500);
    await page.goto("/?landing&restoreHang");
    await page.clock.runFor(1000);
    await page.locator(".transit-artwork img").evaluate(img => (img as HTMLImageElement).decode());
    await expect(page.getByRole("button", { name: "Sign In with Google", exact: true })).toBeInViewport({ ratio: 1 });
    await expect(page.locator(".transit-landing footer")).toBeInViewport({ ratio: 1 });
    expect(await page.evaluate(() => devicePixelRatio)).toBe(1.5);
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(586);
    expect(await page.evaluate(() => scrollY)).toBe(0);
  } finally { await context.close(); }
});
