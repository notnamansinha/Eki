import { expect, test } from "@playwright/test";

// Issue #516: on a computer /install held one sentence and nothing focusable, so a
// keyboard walk found no tabbable element and the page was a dead end. The desktop
// branch now offers Copy link, and every branch links back to the landing page.
// Both projects use a desktop Chrome user agent, which selects the desktop branch;
// the viewport is set per test, so one project is enough.
test.beforeEach(({ page }, info) => {
  test.skip(info.project.name !== "desktop", "viewports are set per test");
  return page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
});

for (const viewport of [
  { width: 1280, height: 720 },
  { width: 1280, height: 585 },
  { width: 390, height: 844 },
  { width: 320, height: 568 },
]) {
  test(`desktop install page offers Copy link and a way back at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/?install");
    await expect(page.getByRole("heading", { name: "Install Eki", level: 1 })).toBeVisible();
    await expect(page.getByText("Open this link on your phone to install Eki.")).toBeVisible();
    // The fixture's own controls are not part of the page under test.
    await page.locator('aside[aria-label="Synthetic verification controls"]').evaluate(aside => aside.remove());

    const tabbable = await page.locator("main").evaluate(main => [...main.querySelectorAll("a[href], button:not(:disabled)")]
      .filter(el => el.getClientRects().length > 0).length);
    expect(tabbable).toBeGreaterThanOrEqual(1);

    const copy = page.getByRole("button", { name: "Copy link" });
    const back = page.getByRole("link", { name: "Back to Eki" });
    await expect(back).toHaveAttribute("href", "/");
    for (const control of [copy, back]) {
      await expect(control).toBeInViewport({ ratio: 1 });
      expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }

    // Keyboard order: Copy link, then the way back.
    await page.keyboard.press("Tab");
    await expect(copy).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(back).toBeFocused();

    // The no-scroll layout holds with the new controls.
    const size = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight }));
    expect(size.scrollWidth).toBeLessThanOrEqual(viewport.width);
    expect(size.scrollHeight).toBeLessThanOrEqual(viewport.height);

    await copy.click();
    await expect(page.getByRole("button", { name: "Link copied" })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(page.url());

    await back.click();
    await page.waitForURL(url => url.pathname === "/" && url.search === "");
  });
}

// The phone branches gained the same link; they must still fit a small phone.
const PHONES = {
  android: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36",
  "iPhone Chrome": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0 Mobile/15E148 Safari/604.1",
};
for (const [platform, userAgent] of Object.entries(PHONES)) {
  test(`install page on ${platform} links back without scrolling at 320x568`, async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL, userAgent, viewport: { width: 320, height: 568 } });
    try {
      const page = await context.newPage();
      await page.goto("/?install");
      await expect(page.getByRole("heading", { name: "Install Eki", level: 1 })).toBeVisible();
      await expect(page.getByText("Checking your device…")).toHaveCount(0);
      const back = page.getByRole("link", { name: "Back to Eki" });
      await expect(back).toHaveAttribute("href", "/");
      await expect(back).toBeInViewport({ ratio: 1 });
      expect((await back.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      const size = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight }));
      expect(size.scrollWidth).toBeLessThanOrEqual(320);
      expect(size.scrollHeight).toBeLessThanOrEqual(568);
    } finally { await context.close(); }
  });
}
