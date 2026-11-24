import { expect, test, type Locator, type Page } from "@playwright/test";

// The demo ride end to end on the real passenger layout, workspace, boarding
// view and map logic: listed under Practice, the Thumb drawer stop picker,
// boarding at the stop and the end of the ride. The page clock compresses the
// scripted ride (about five minutes) into seconds.

const box = async (locator: Locator) => (await locator.boundingBox())!;
async function runUntil(page: Page, done: () => Promise<boolean>, stepMs = 2_000, limitMs = 600_000) {
  for (let elapsed = 0; elapsed < limitMs; elapsed += stepMs) {
    if (await done()) return;
    await page.clock.runFor(stepMs);
  }
  throw new Error("The scripted ride did not reach the expected state");
}

test("the demo ride is listed under Practice and rides end to end with the Thumb drawer", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.clock.install({ time: new Date("2026-11-25T08:40:00+05:30") });
  await page.goto("/?scenario=empty");
  const raise = page.getByRole("button", { name: "Show live routes" });
  if (await raise.isVisible()) await raise.click();
  await expect(page.getByText("No buses running")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Practice" })).toBeVisible();
  await expect(page.getByText("Not a real bus")).toBeVisible();
  await page.screenshot({ path: info.outputPath("01-live-routes.png") });
  await page.getByRole("button", { name: "Try the demo ride" }).click();

  // At rest: a From → To bar in the thumb zone; the top of the map stays clear.
  const from = page.getByRole("combobox", { name: "Boarding stop" });
  await expect(from).toContainText("Your stop");
  const viewport = page.viewportSize()!;
  expect((await box(from)).y).toBeGreaterThan(viewport.height * 0.6);
  const peek = page.getByRole("button", { name: "Route timeline" });
  await expect(peek).toContainText("Next · Doordarshan Kendra");
  await expect(peek).toContainText("Live");
  await expect(page.getByRole("button", { name: "Open live chat" })).toHaveCount(0);
  await expect(page.getByText("Show your walking time?")).toHaveCount(0);
  await page.screenshot({ path: info.outputPath("02-at-rest.png") });

  // Choosing opens the route timeline: the same stops and live ETAs.
  await from.click();
  await expect(page.getByText("Where are you boarding?")).toBeVisible();
  await expect(page.getByRole("button", { name: "3 passed stops" })).toBeVisible();
  await expect(page.getByRole("option", { name: "Doordarshan Kendra" })).toContainText("Next stop");
  await expect(page.getByRole("option", { name: "Gurukul Road" })).toContainText(/\d+ min/);
  await page.screenshot({ path: info.outputPath("03-picker-boarding.png") });
  await page.getByRole("option", { name: "Gurukul Road" }).click();
  await expect(page.getByText("Stops after Gurukul Road")).toBeVisible();
  await expect(page.getByRole("option", { name: "Doordarshan Kendra" })).toHaveAttribute("aria-disabled", "true");
  await page.screenshot({ path: info.outputPath("04-picker-destination.png") });
  await page.getByRole("option", { name: "Ahmedabad University" }).click();
  await expect(from).toContainText("Gurukul Road");
  await expect(page.getByRole("combobox", { name: "Destination station" })).toContainText("Ahmedabad University");
  await expect(page.getByRole("button", { name: /^Show stop Gurukul Road/ })).toBeVisible();
  await page.screenshot({ path: info.outputPath("05-trip-bar.png") });

  // Then it slides into the right edge: stop, bus ETA and Board.
  await page.clock.runFor(1_000);
  const drawer = page.getByRole("group", { name: "Your trip" });
  await expect(drawer).toContainText("Gurukul Road");
  await expect(drawer).toContainText(/Bus in \d+ min/);
  await expect(page.getByText("Demo ride: boarding is simulated and does not use your location.")).toBeVisible();
  const drawerBox = await box(drawer);
  if (viewport.width < 544) {
    expect(drawerBox.x + drawerBox.width).toBeGreaterThanOrEqual(viewport.width - 1);
    expect(drawerBox.width).toBeLessThan(viewport.width * 0.85);
  }
  await page.screenshot({ path: info.outputPath("06-drawer.png") });

  // Board too early, as the 150 m check would refuse it.
  const board = page.getByRole("button", { name: "Board", exact: true });
  await board.click();
  await expect(page.getByRole("alert")).toHaveText("You must be near the bus to board. Wait until the demo bus reaches Gurukul Road.");
  await runUntil(page, async () => /Bus is here/.test(await drawer.textContent() ?? ""));
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(peek).toContainText("At Gurukul Road");
  // Board is what a tap at its centre reaches.
  expect(await board.evaluate(element => {
    const rect = element.getBoundingClientRect();
    const top = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    return top === element || element.contains(top);
  })).toBe(true);
  await page.screenshot({ path: info.outputPath("07-bus-here.png") });
  await board.click();
  await expect(page.getByText("Boarding the demo bus…")).toBeVisible();
  await page.clock.runFor(1_500);
  await expect(drawer).toContainText("On board");
  await expect(drawer).toContainText(/\d+ min to Ahmedabad University/);
  await expect(board).toHaveCount(0);
  await page.screenshot({ path: info.outputPath("08-on-board.png") });

  // ‹ pulls the full bar back out; Escape tucks it away.
  await page.getByRole("button", { name: "Show trip" }).click();
  await expect(from).toContainText("From · on board");
  await page.screenshot({ path: info.outputPath("09-bar-reopened.png") });
  await page.keyboard.press("Escape");
  await expect(drawer).toBeVisible();

  // The ride ends at the terminus without asking for feedback.
  await runUntil(page, () => page.getByText("Demo ride complete").isVisible(), 5_000);
  await page.screenshot({ path: info.outputPath("10-complete.png") });
  await page.getByRole("button", { name: "Return to live routes" }).click();
  await expect(page.getByRole("button", { name: "Try the demo ride" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
  expect(errors).toEqual([]);
});

test("with live buses running, the demo ride is listed after them", async ({ page }) => {
  await page.goto("/?scenario=forward");
  const raise = page.getByRole("button", { name: "Show live routes" });
  if (await raise.isVisible()) await raise.click();
  const cards = page.locator("[data-passenger-route]");
  await expect(cards).toHaveCount(2);
  await expect(cards.nth(0)).toHaveAttribute("data-passenger-route", "qa-route");
  await expect(cards.nth(1)).toHaveAttribute("data-passenger-route", "demo-ride");
  await expect(page.getByText("1 route", { exact: true })).toBeVisible();
});
