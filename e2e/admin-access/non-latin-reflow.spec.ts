import { expect, test } from "@playwright/test";
import { clippingAncestorControl, horizontalReflow, nonLatinSamples, reflowViewport, translateAuthoredCopy } from "../fixtures/nonLatinText";

// Eki ships English-only (EKI-ADR-005). These cases check that the public pages and
// the admin feedback list still reflow at 320 px when they carry non-Latin or
// long-word text with natural break points: a browser translation of the authored
// copy, or a passenger's own name and comment. The viewport is set per test, so one
// project is enough.
test.beforeEach(async ({ page }, info) => {
  test.skip(info.project.name !== "mobile", "320 px reflow runs once");
  await page.setViewportSize(reflowViewport);
});

for (const clip of ["hidden", "clip"] as const) {
  test(`reflow check reports text clipped by an overflow: ${clip} ancestor`, async ({ page }) => {
    const text = nonLatinSamples[0].heading;
    await page.setContent(clippingAncestorControl(text, clip));
    const result = await horizontalReflow(page, [text]);
    expect(result.matched).toBe(1);
    expect(result.pageOverflow).toBeLessThanOrEqual(0);
    expect(result.offenders).toEqual([expect.stringContaining("clipped by div")]);
  });
}

for (const sample of nonLatinSamples) {
  test(`landing page reflows translated ${sample.script} copy at 320 px`, async ({ page }) => {
    await page.goto("/?landing&restoreHang");
    await expect(page.getByRole("button", { name: "Continue with Google", exact: true })).toBeEnabled();
    await translateAuthoredCopy(page, ".transit-landing", sample);
    await expect(page.locator(".transit-landing h1")).toHaveText(sample.heading);
    const result = await horizontalReflow(page, [sample.heading, sample.body]);
    expect(result.matched).toBeGreaterThanOrEqual(4);
    expect(result.offenders).toEqual([]);
    expect(result.pageOverflow).toBeLessThanOrEqual(0);
  });

  test(`install page reflows translated ${sample.script} copy at 320 px`, async ({ browser, baseURL }) => {
    // An Android browser without an install prompt shows the three manual steps.
    const context = await browser.newContext({ baseURL, viewport: reflowViewport,
      userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36" });
    try {
      const page = await context.newPage();
      await page.goto("/?install");
      await expect(page.getByRole("listitem")).toHaveCount(3);
      await translateAuthoredCopy(page, "main", sample);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(sample.heading);
      const result = await horizontalReflow(page, [sample.heading, sample.body]);
      expect(result.matched).toBeGreaterThanOrEqual(5);
      expect(result.offenders).toEqual([]);
      expect(result.pageOverflow).toBeLessThanOrEqual(0);
    } finally { await context.close(); }
  });

  test(`admin feedback reflows a ${sample.script} name and comment at 320 px`, async ({ page }) => {
    await page.route("**/__qa/firestore/feedback**", route => route.fulfill({ json: { feedbacks: [{
      id: "feedback", userId: "passenger", userName: sample.name, type: "general", busId: null, driverId: null,
      sessionId: null, rating: null, comment: sample.body, timestamp: null, status: "new" }] } }));
    await page.goto("/?embedded");
    await page.getByRole("button", { name: "Approve verification" }).click();
    await expect(page.getByText(sample.name, { exact: true })).toBeVisible();
    await page.getByRole("button", { expanded: false }).click();
    await expect(page.getByRole("button", { expanded: true })).toBeVisible();
    const result = await horizontalReflow(page, [sample.name, sample.body]);
    expect(result.matched).toBeGreaterThanOrEqual(2);
    expect(result.offenders).toEqual([]);
    expect(result.pageOverflow).toBeLessThanOrEqual(0);
  });
}
