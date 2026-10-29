import { expect, test } from "@playwright/test";

test("ETA follows the later itinerary visit at identical coordinates and heading", async ({ page }, info) => {
  await page.goto("/?loop");
  const picker = page.getByRole("combobox", { name: "Destination station" });
  await picker.click();
  const end = page.getByRole("option", { name: "End", exact: true });
  const firstMinutes = Number(/(\d+)\s*min/.exec(await end.innerText())?.[1]);
  expect(firstMinutes).toBeGreaterThan(2);
  await picker.press("Escape");
  await page.getByRole("button", { name: "Publish next stop", exact: true }).click();
  await picker.click();
  await expect(page.getByRole("option", { name: "First visit", exact: true })).toContainText("Passed");
  await expect(end).toContainText(/min/);
  const laterMinutes = Number(/(\d+)\s*min/.exec(await end.innerText())?.[1]);
  expect(firstMinutes - laterMinutes).toBeGreaterThanOrEqual(2);
  await page.screenshot({ path: info.outputPath("repeated-road-eta.png"), fullPage: true });
});

for (const direction of ["forward", "reverse"]) {
  test(`workspace shows ETA and authoritative corridor stop passage after credible ${direction} departure`, async ({ page }, info) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`/?workspace&pending&direction=${direction}`);
    await page.getByRole("button", { name: "Track Synthetic campus route", exact: true }).click();
    const picker = page.getByRole("combobox", { name: "Destination station" });
    await picker.click();
    const nextStop = direction === "forward" ? "Beta" : "Gamma";
    const followingStop = direction === "forward" ? "Gamma" : "Beta";
    await expect(page.getByRole("option", { name: nextStop, exact: true })).toContainText("Direction pending");
    await expect(page.locator('[data-road-color="#71717a"]')).toHaveCount(0);
    await picker.press("Escape");
    await page.getByRole("button", { name: "Replay credible departure", exact: true }).click();
    await expect(page.getByText(/^Ride in service · Live/)).toBeVisible();
    await picker.click();
    await expect(page.getByRole("option", { name: nextStop, exact: true })).toContainText(/min/);
    await expect(page.getByRole("option", { name: followingStop, exact: true })).toContainText(/min/);
    await picker.press("Escape");
    await page.getByRole("button", { name: "Fix outside arrival corridor", exact: true }).click();
    await picker.click();
    await expect(page.getByRole("option", { name: nextStop, exact: true })).not.toContainText("Passed");
    await picker.press("Escape");
    await page.getByRole("button", { name: "Fix inside arrival corridor", exact: true }).click();
    await picker.click();
    await expect(page.getByRole("option", { name: nextStop, exact: true })).toContainText("Passed");
    await expect(page.getByRole("option", { name: followingStop, exact: true })).toContainText(/min/);
    await expect(page.getByLabel(`${nextStop} — passed`, { exact: true })).toBeVisible();
    await expect(page.locator('[data-road-color="#71717a"]')).toHaveCount(1);
    await expect(page.locator('[role="img"] .lucide-bus-front')).toHaveCount(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width);
    expect(errors).toEqual([]);
    await page.screenshot({ path: info.outputPath(`${direction}-arrival-workspace.png`), fullPage: true });
  });
}

test("destination ETA, passed stops, segmented road and one bus glyph stay consistent through silence and recovery", async ({ page }, info) => {
  await page.clock.install();
  await page.goto("/");
  await expect(page.locator("[data-position-marker]")).toHaveCount(5); // four stations and one bus
  const picker = page.getByRole("combobox", { name: "Destination station" });
  await picker.click();
  await expect(page.getByRole("option", { name: "Alpha" })).toContainText("Passed");
  await expect(page.getByRole("option", { name: "Beta" })).toContainText("Passed");
  await expect(page.getByRole("option", { name: "Gamma" })).toContainText(/min/);
  await expect(page.getByRole("option", { name: "Delta" })).toContainText(/min/);
  for (const name of ["Gamma", "Delta"]) {
    expect(await page.getByRole("option", { name }).evaluate(element => {
      const rect = element.getBoundingClientRect();
      const top = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      return top === element || element.contains(top);
    })).toBe(true);
  }
  await expect(page.locator('[data-road-color="#71717a"]')).toHaveCount(1);
  await expect(page.locator('[data-road-color="#3b82f6"]')).toHaveCount(2);
  await expect(page.locator('[data-road-color="#22c55e"]')).toHaveCount(0);
  await expect(page.getByLabel("Beta — passed", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width);
  await page.screenshot({ path: info.outputPath("destination-etas.png"), fullPage: true });
  await picker.press("Escape");
  await page.getByRole("button", { name: "Publish next stop", exact: true }).click();
  await expect(page.getByLabel("Gamma — passed", { exact: true })).toBeVisible();
  await picker.click();
  await expect(page.getByRole("option", { name: "Gamma" })).toContainText("Passed");
  // Lost after 30 s of silence (SIGNAL_LOST_MS), not 90-105 s.
  await page.clock.runFor(31_000);
  await expect(page.getByRole("option", { name: "Delta" })).toContainText("Live tracking lost");
  await picker.press("Escape");
  await page.getByRole("button", { name: "Publish fresh fix", exact: true }).click();
  await picker.click();
  await expect(page.getByRole("option", { name: "Gamma" })).toContainText(/min/);
  await expect(page.getByRole("option", { name: "Delta" })).not.toContainText("Live tracking lost");
});

test("a detour replaces the original future road, retains covered road and restores configured tracking on rejoin", async ({ page }, info) => {
  await page.goto("/");
  const grey = page.locator('[data-road-color="#71717a"] polyline');
  // Wait for the initial confident match, rather than sampling its stop-only
  // first render before the marker selection has settled.
  await expect.poll(async () => (await grey.getAttribute("points"))?.trim().split(/\s+/).length).toBe(3);
  const before = await grey.getAttribute("points");
  const configured = await page.locator('[data-road-color="#3b82f6"] polyline').first().getAttribute("points");
  await page.getByRole("button", { name: "Publish uncertain fix", exact: true }).click();
  await expect(grey).toHaveAttribute("points", before!);
  await page.getByRole("button", { name: "Publish pending detour", exact: true }).click();
  await expect(page.locator('[data-road-color="#3b82f6"]')).toHaveCount(0);
  await expect(grey).toHaveAttribute("points", before!);
  const picker = page.getByRole("combobox", { name: "Destination station" });
  await picker.click();
  await expect(page.getByRole("option", { name: "Delta" })).toContainText("Route unavailable");
  await picker.press("Escape");
  await page.getByRole("button", { name: "Publish detour", exact: true }).click();
  await expect(page.locator('[data-road-color="#3b82f6"]')).toHaveCount(2);
  await expect(grey).toHaveAttribute("points", before!);
  for (const line of await page.locator('[data-road-color="#3b82f6"] polyline').all()) {
    expect(await line.getAttribute("points")).not.toBe(configured);
  }
  await picker.click();
  await expect(page.getByRole("option", { name: "Delta" })).toContainText(/min/);
  await picker.press("Escape");
  await page.screenshot({ path: info.outputPath("detour-blue-with-retained-grey.png"), fullPage: true });
  await page.getByRole("button", { name: "Publish fresh fix", exact: true }).click();
  await expect(page.locator('[data-road-color="#3b82f6"] polyline').first()).toHaveAttribute("points", configured!);
});

test("field ride 29 Oct 2026: A marked at A, B at B, GNSS loss and silence shown promptly, recovery restores live", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.clock.install();
  await page.goto("/?workspace&direction=forward");
  await page.getByRole("button", { name: "Track Synthetic campus route", exact: true }).click();
  await page.getByRole("button", { name: "Publish at origin", exact: true }).click();
  const header = page.getByRole("status").filter({ hasText: "Ride in service" });
  await expect(header).toContainText("Ride in service · Live");
  await expect(header).toContainText("At Alpha · Next: Beta");
  await expect(page.getByLabel("Alpha — bus is here", { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath("at-origin.png"), fullPage: true });

  await page.getByRole("button", { name: "Replay credible departure", exact: true }).click();
  await expect(page.getByLabel("Alpha — passed", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Arrive at next stop", exact: true }).click();
  // B is marked while the bus is at B, not when it reaches C.
  await expect(header).toContainText("At Beta · Next: Gamma");
  await expect(page.getByLabel("Beta — bus is here", { exact: true })).toBeVisible();
  const picker = page.getByRole("combobox", { name: "Destination station" });
  await picker.click();
  await expect(page.getByRole("option", { name: "Beta", exact: true })).toContainText("Bus is here");
  await expect(page.getByRole("option", { name: "Alpha", exact: true })).toContainText("Passed");
  await picker.press("Escape");
  await page.screenshot({ path: info.outputPath("at-beta.png"), fullPage: true });

  // GNSS disconnected: the single loss packet is reported at once, boarding withheld.
  await page.getByRole("button", { name: "Publish GNSS loss", exact: true }).click();
  await expect(page.getByText("GPS signal lost").first()).toBeVisible();
  // The card stays (a chosen stop or "On board" survives the blip); boarding waits for GPS.
  await expect(page.getByRole("button", { name: "Board", exact: true })).toBeDisabled();
  await expect(page.getByText("Boarding resumes when live tracking returns.")).toBeVisible();
  await expect(page.getByTitle(/GPS signal lost, last known location/)).toBeVisible();
  await page.screenshot({ path: info.outputPath("gnss-lost.png"), fullPage: true });

  // A fresh fix restores the live ride.
  await page.getByRole("button", { name: "Publish fresh fix", exact: true }).click();
  await expect(header).toContainText("Ride in service · Live");

  // Backend or uplink stopped: no snapshot arrives, the client clock degrades the claim.
  await page.clock.runFor(13_000);
  await expect(page.getByText("Updates delayed").first()).toBeVisible();
  await page.clock.runFor(18_000);
  await expect(page.getByText("Live tracking lost").first()).toBeVisible();
  await expect(page.getByText(/Ride in service · Live/)).toHaveCount(0);
  await page.screenshot({ path: info.outputPath("tracking-lost.png"), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width);
  expect(errors).toEqual([]);
});
