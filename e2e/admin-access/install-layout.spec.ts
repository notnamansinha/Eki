import { expect, test } from "@playwright/test";

// Issue #516: on a computer /install held one sentence and nothing focusable, so a
// keyboard walk found no tabbable element and the page was a dead end. The desktop
// branch now offers Copy link, and every branch links back to the landing page.
// The project's desktop user agent selects the desktop branch; the viewport is set
// per test, so one project is enough.
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
