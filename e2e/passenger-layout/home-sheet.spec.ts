import { expect, test, type Locator } from "@playwright/test";
import { homePanel } from "./liveRoutes";

// Whether the centre of the element takes a tap, rather than whatever covers it.
const takesTaps = (locator: Locator) => locator.evaluate(element => {
  const box = element.getBoundingClientRect();
  return element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
});
const settled = (locator: Locator) => locator.evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished)));

test("touch screens rest Live routes on the tab bar under the artwork and raise it on tap", async ({ page }) => {
  await page.goto("/?scenario=many-routes");
  test.skip(await page.evaluate(() => matchMedia("(any-pointer: fine)").matches), "Pointer devices keep the centred panel.");
  const viewport = page.viewportSize()!;
  const panel = homePanel(page);
  const nav = page.getByRole("navigation", { name: "Passenger sections" });
  const artwork = page.locator(".transit-artwork img").first();
  const card = page.getByRole("button", { name: "Track QA route", exact: true });
  const artworkShift = () => artwork.evaluate(element => new DOMMatrix(getComputedStyle(element).transform).m42);

  // Resting: only the heading peeks above the tab bar, the painting fills the
  // rest, and the hidden route list can be neither tapped nor tabbed to.
  const show = panel.getByRole("button", { name: "Show live routes", exact: true });
  await expect(show).toHaveAttribute("aria-expanded", "false");
  await settled(panel);
  const peek = (await show.boundingBox())!;
  const navBox = (await nav.boundingBox())!;
  // The peek meets the tab bar's frame; the nav itself starts below its hairline edge.
  expect(Math.abs(peek.y + peek.height - navBox.y)).toBeLessThanOrEqual(1.5);
  expect(peek.y).toBeGreaterThan(viewport.height / 2);
  expect(await card.evaluate(element => element.closest("[inert]") !== null)).toBe(true);
  expect(await takesTaps(card)).toBe(false);
  expect(await artworkShift()).toBe(0);

  // Raised: the sheet clears the tab bar, the routes take taps, and in portrait
  // the painting slides up so the band above the sheet shows the passengers.
  await show.click();
  const hide = panel.getByRole("button", { name: "Hide live routes", exact: true });
  await expect(hide).toHaveAttribute("aria-expanded", "true");
  await settled(panel);
  await settled(artwork);
  const raised = (await panel.boundingBox())!;
  expect(raised.y + raised.height).toBeLessThanOrEqual(navBox.y + 0.5);
  expect(await card.evaluate(element => element.closest("[inert]") === null)).toBe(true);
  expect(await takesTaps(card)).toBe(true);
  if (viewport.height > viewport.width) expect(await artworkShift()).toBeLessThan(0);

  // Lowering it again hides the list once more.
  await hide.click();
  await expect(show).toHaveAttribute("aria-expanded", "false");
  await settled(panel);
  expect(await card.evaluate(element => element.closest("[inert]") !== null)).toBe(true);
  expect(await artworkShift()).toBe(0);
});

test("the sheet works from the keyboard and pointer devices never get a toggle", async ({ page }) => {
  await page.goto("/?scenario=many-routes");
  const panel = homePanel(page);
  await expect(panel).toBeVisible();
  if (await page.evaluate(() => matchMedia("(any-pointer: fine)").matches)) {
    await expect(panel.getByRole("button", { name: /live routes$/ })).toHaveCount(0);
    return;
  }
  const show = panel.getByRole("button", { name: "Show live routes", exact: true });
  // The lowered list is inert, so the peek is the only stop before the tab bar.
  await show.focus();
  await page.keyboard.press("Enter");
  const hide = panel.getByRole("button", { name: "Hide live routes", exact: true });
  await expect(hide).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Track QA route", exact: true })).toBeFocused();
  await hide.focus();
  await page.keyboard.press("Space");
  await expect(show).toHaveAttribute("aria-expanded", "false");
});
