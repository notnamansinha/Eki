import { expect, test } from "@playwright/test";

test("Live Routes adapts the panel and dock to the input device", async ({ page }) => {
  await page.goto("/?scenario=many-routes");
  const desktop = await page.evaluate(() => matchMedia("(any-pointer: fine)").matches);
  const list = page.locator(".passenger-live-route-scroll");
  const cards = list.getByRole("button", { name: /^Track QA route/ });
  await expect(cards).toHaveCount(8);

  const panel = page.locator("[data-passenger-workspace] .passenger-home-panel");
  const nav = page.getByRole("navigation", { name: "Passenger sections" });
  const panelBox = (await panel.boundingBox())!;
  const navBox = (await nav.boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(panelBox.y + panelBox.height).toBeLessThan(navBox.y);

  if (!desktop) {
    // On phones the Live Routes sheet spans the screen and rests on the tab bar.
    expect(panelBox.width).toBe(viewport.width);
    expect(navBox.width).toBe(viewport.width);
    await expect(list).toHaveCSS("scrollbar-width", "none");
    return;
  }

  expect(panelBox.width).toBeLessThan(viewport.width);
  expect(panelBox.x).toBeCloseTo((viewport.width - panelBox.width) / 2, 0);
  expect(navBox.width).toBeLessThan(panelBox.width);
  await expect(page.locator(".passenger-home-count")).toHaveText("8 routes");
  await expect(list).toHaveCSS("scrollbar-width", "thin");
  const hint = page.getByText("Scroll for more routes", { exact: true });
  await expect(hint).toBeVisible();

  const listBox = (await list.boundingBox())!;
  const fourth = (await cards.nth(3).boundingBox())!;
  expect(fourth.y + fourth.height).toBeLessThanOrEqual(listBox.y + listBox.height);

  const last = cards.last();
  await page.keyboard.press("Tab"); // Give programmatic focus the keyboard modality.
  await last.focus();
  await expect.poll(() => list.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  await list.evaluate(element => { element.scrollTop = element.scrollHeight; });
  await expect(hint).toBeHidden();
  await page.keyboard.press("Enter");

  const back = page.getByRole("button", { name: "Back to home" });
  await expect(back).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(last).toBeFocused();

  // Leaving tracking for another section forgets the route, so the first tab keeps focus.
  await page.keyboard.press("Enter");
  await expect(back).toBeFocused();
  const sections = nav.getByRole("button");
  await sections.last().focus();
  await page.keyboard.press("Enter");
  await sections.first().focus();
  await page.keyboard.press("Enter");
  await expect(sections.first()).toBeFocused();
});
