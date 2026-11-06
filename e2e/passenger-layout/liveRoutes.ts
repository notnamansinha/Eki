import { expect, type Page } from "@playwright/test";

/** The Live routes panel; on touch screens it is a sheet resting on the tab bar. */
export const homePanel = (page: Page) => page.locator("[data-passenger-workspace] .passenger-home-panel");

/**
 * Touch screens rest Live routes as a peek, so raise it before using the
 * route cards or measuring the open panel. Pointer devices have no toggle, so
 * there this only waits for the panel.
 */
export async function raiseLiveRoutes(page: Page) {
  const panel = homePanel(page);
  await expect(panel).toBeVisible();
  const toggle = panel.getByRole("button", { name: "Show live routes", exact: true });
  if (await toggle.isVisible()) await toggle.click();
  // The sheet slides for 0.45 s; measurements need it settled.
  await expect.poll(() => panel.evaluate(node => getComputedStyle(node).transform)).toBe("none");
}

/** Raise the sheet when needed, then open a route from Live routes. */
export async function trackRoute(page: Page, name = "Track QA route") {
  await raiseLiveRoutes(page);
  await page.getByRole("button", { name, exact: true }).click();
}
