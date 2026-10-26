import { expect, test } from "@playwright/test";

async function scenario(page: import("@playwright/test").Page, value: string) {
  await page.getByText("QA controls (synthetic)", { exact: true }).click();
  await page.getByLabel("QA scenario").selectOption(value);
  await page.getByText("QA controls (synthetic)", { exact: true }).click();
}
async function fullMap(page: import("@playwright/test").Page) {
  const frame = (await page.locator("[data-passenger-tracking]").boundingBox())!;
  const map = (await page.locator("[data-passenger-map]").boundingBox())!;
  expect(map.y).toBeCloseTo(frame.y, 0);
  expect(map.height).toBeCloseTo(frame.height, 0);
  expect(frame.y).toBeGreaterThanOrEqual(0);
}
test("reconnecting retains a full map and paused tracking without new ride controls", async ({ page }, info) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Track QA route", exact: true }).click();
  await scenario(page, "reconnecting");
  await expect(page.getByText("Reconnecting to live bus data...",{exact:true})).toBeVisible();
  await expect(page.getByText("Live tracking paused", { exact: true })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Destination station" })).toHaveCount(0);
  await fullMap(page);
  await page.getByRole("button", { name: "Back to home", exact: true }).click();
  await expect(page.getByRole("button", { name: "Track QA route", exact: true })).toHaveCount(0);
  await page.screenshot({path:info.outputPath("reconnecting-header.png")});
});

test("destination dropdown stays above notices in the map pane", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Track QA route", exact: true }).click();
  await fullMap(page);
  await page.getByRole("combobox", { name: "Destination station" }).click();
  for (const name of ["Alpha", "Beta"]) {
    const option = page.getByRole("option", { name, exact: true });
    await expect(option).toBeVisible();
    expect(await option.evaluate(element => {
      const rect = element.getBoundingClientRect();
      const top = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      return top === element || element.contains(top);
    })).toBe(true);
  }
});

test("location delay stays below variable ride controls and clears on recovery", async ({ page }, info) => {
  await page.clock.install();
  await page.goto("/");
  await page.getByText("QA controls (synthetic)", { exact: true }).click();
  await page.getByLabel("QA scenario").selectOption("multiple");
  await page.getByText("QA controls (synthetic)", { exact: true }).click();
  await page.getByRole("button", { name: "Track QA route", exact: true }).click();
  const warning = page.getByText(/Live location updates delayed/);
  await expect(page.getByLabel("Synthetic map", { exact: true })).toBeVisible();
  await expect(warning).toHaveCount(0);
  await page.clock.runFor(95_001);
  await expect(warning).toBeVisible();
  // Visibility alone does not establish that another layer leaves text readable.
  const header = page.getByRole("button", { name: "Back to home", exact: true }).locator("..").locator("..");
  const headerBox = (await header.boundingBox())!;
  const warningBox = (await warning.boundingBox())!;
  expect(warningBox.y).toBeGreaterThanOrEqual(headerBox.y + headerBox.height);
  await fullMap(page);
  expect(await warning.evaluate(element => {
    const box = element.getBoundingClientRect();
    // Notices deliberately pass pointer events through to the map. Enable
    // hit testing only for this visual occlusion probe; preserve layout/stacking.
    const prior = element.style.pointerEvents;
    try {
      element.style.pointerEvents = "auto";
      const top = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
      return top === element || element.contains(top);
    } finally { element.style.pointerEvents = prior; }
  })).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width);
  await expect(page.getByRole("button", { name: "Route Timeline", exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath("location-delay.png"), fullPage: true });
  await page.getByText("QA controls (synthetic)", { exact: true }).click();
  await page.getByLabel("QA scenario").selectOption("reverse");
  await expect(warning).toHaveCount(0);
});

test("offline buses disappear from new choices and return on fresh telemetry", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Track QA route", exact: true }).click();
  await scenario(page, "offline");
  await expect(page.getByText("Live tracking paused", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open live chat", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Back to home", exact: true }).click();
  await expect(page.getByRole("button", { name: "Track QA route", exact: true })).toHaveCount(0);
  await scenario(page, "pending");
  await page.getByRole("button", { name: "Track QA route", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Destination station" })).toBeVisible();
  await fullMap(page);
});

test("one stale bus neither hides another fresh bus nor becomes a picker option", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Track QA route", exact: true }).click();
  await scenario(page, "multiple-stale");
  await expect(page.getByText("Live tracking paused", { exact: true })).toBeVisible();
  await page.getByRole("combobox", { name: "Live bus", exact: true }).click();
  await expect(page.getByRole("listbox", { name: "Live bus", exact: true }).getByRole("option")).toHaveCount(1);
  await page.getByRole("option", { name: "Bus qa-bus-2 · B → A", exact: true }).click();
  await expect(page.getByText("Live tracking paused", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Back to home", exact: true }).click();
  await expect(page.getByRole("button", { name: "Track QA route", exact: true })).toBeVisible();
});

test("navigation cannot scroll the tracking frame under the viewport", async ({ page }) => {
  await page.goto("/");
  for (let visit = 0; visit < 3; visit++) {
    await page.getByRole("button", { name: "Track QA route", exact: true }).click();
    await page.getByLabel("Synthetic map", { exact: true }).waitFor();
    await fullMap(page);
    await page.getByRole("button", { name: "Back to home", exact: true }).click();
    await page.getByRole("button", { name: "Profile", exact: true }).click();
    await page.getByRole("button", { name: "Routes", exact: true }).click();
  }
});
