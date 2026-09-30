import { expect, test } from "@playwright/test";

test.describe("authenticated admin UI", () => {
  test.skip(!process.env.EKI_E2E_STORAGE_STATE, "Requires an authenticated admin storage state.");

  test.beforeEach(async ({ page }) => {
    await page.goto("/admin");
    await expect(page.getByRole("tab", { name: "Live Ops" })).toBeVisible();
  });

  test("route actions are visible touch targets and route type is gone", async ({ page }) => {
    await page.getByRole("tab", { name: "Routes" }).click();
    await page.getByRole("button", { name: /^Edit route / }).first().click();
    await expect(page.getByLabel("Route type")).toHaveCount(0);
    const actions = page.locator('button[aria-label^="Move stop"], button[aria-label^="Remove stop"]');
    await expect(actions.first()).toBeVisible();
    for (const action of await actions.all()) {
      const box = await action.boundingBox();
      expect(box?.width).toBeGreaterThanOrEqual(44);
      expect(box?.height).toBeGreaterThanOrEqual(44);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      await page.evaluate(() => window.innerWidth + 1),
    );
  });

  test("Live Ops, Feedback, and Settings do not overflow", async ({ page }) => {
    for (const tabName of ["Live Ops", "Feedback", "Settings"]) {
      await page.getByRole("tab", { name: tabName }).click();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        await page.evaluate(() => window.innerWidth + 1),
      );
    }
    await expect(page.getByRole("button", { name: /Save changes|No changes/ })).toHaveCount(1);
  });
});
