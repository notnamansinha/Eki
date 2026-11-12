import { expect, test, type Page } from "@playwright/test";
import { clippingAncestorControl, horizontalReflow, nonLatinSamples, reflowViewport } from "../fixtures/nonLatinText";
import { raiseLiveRoutes, trackRoute } from "./liveRoutes";

// Eki ships English-only (EKI-ADR-005), but route and stop names are typed by
// administrators and account names come from Google, so they may be in any script.
// `?qaLabel=` gives the route, both stops and the signed-in passenger the sample name.
// The viewport is set per test on the touch-enabled narrow project.
test.beforeEach(async ({ page }, info) => {
  test.skip(info.project.name !== "narrow", "320 px reflow runs once, with touch");
  // Four views per sample.
  test.setTimeout(60_000);
  await page.setViewportSize(reflowViewport);
});

async function expectReflow(page: Page, view: string, texts: string[], minimum: number) {
  const result = await horizontalReflow(page, texts);
  expect(result.matched, view).toBeGreaterThanOrEqual(minimum);
  expect(result.offenders, view).toEqual([]);
  expect(result.pageOverflow, view).toBeLessThanOrEqual(0);
}

for (const clip of ["hidden", "clip"] as const) {
  test(`reflow check reports a name clipped by an overflow: ${clip} ancestor`, async ({ page }) => {
    const text = nonLatinSamples[0].name;
    await page.setContent(clippingAncestorControl(text, clip));
    const result = await horizontalReflow(page, [text]);
    expect(result.matched).toBe(1);
    expect(result.pageOverflow).toBeLessThanOrEqual(0);
    expect(result.offenders).toEqual([expect.stringContaining("clipped by div")]);
  });
}

for (const sample of nonLatinSamples) {
  test(`passenger route, stops and profile reflow a ${sample.script} name at 320 px`, async ({ page }) => {
    const stops = [`${sample.name} 1`, `${sample.name} 2`];
    await page.goto(`/?qaLabel=${encodeURIComponent(sample.name)}`);

    await raiseLiveRoutes(page);
    // The route list loads lazily, as in the application.
    await expect(page.getByRole("button", { name: `Track ${sample.name}`, exact: true })).toBeVisible({ timeout: 15_000 });
    await expectReflow(page, "Live routes", [sample.name], 1);

    await trackRoute(page, `Track ${sample.name}`);
    const destination = page.getByRole("combobox", { name: "Destination station" });
    await expect(destination).toBeVisible({ timeout: 15_000 });
    await destination.click();
    for (const stop of stops) await expect(page.getByRole("option", { name: stop, exact: true })).toBeVisible();
    await expectReflow(page, "destination list", stops, 2);
    await page.keyboard.press("Escape");

    // Without a live bus the tracking header shows the full route name.
    await page.getByText("QA controls (synthetic)", { exact: true }).click();
    await page.getByLabel("QA scenario").selectOption("empty");
    await page.getByText("QA controls (synthetic)", { exact: true }).click();
    await expect(page.getByText("Waiting for live bus data…", { exact: true })).toBeVisible();
    await expectReflow(page, "tracking header", [sample.name], 1);

    await page.getByRole("button", { name: "Back to home", exact: true }).click();
    await page.getByRole("button", { name: "Profile", exact: true }).click();
    await expect(page.locator(".pp-profile-name")).toHaveText(sample.name);
    await expectReflow(page, "Profile", [sample.name], 1);
  });
}
