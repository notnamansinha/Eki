import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    return url.hostname === "127.0.0.1" ? route.continue() : route.abort();
  });
  await page.goto("/");
  await expect(page.getByTestId("Passenger")).toHaveAttribute("data-decision", "matched");
});
test("shared production marker hooks bridge uncertainty and reject an old revision in both views", async ({ page }, testInfo) => {
  await page.getByRole("button", { name: "Low confidence" }).click();
  for (const view of ["Passenger", "Admin"]) {
    await expect(page.getByTestId(view)).toHaveAttribute("data-decision", "match_pending");
    await expect(page.getByTestId(view)).toHaveAttribute("data-lng", "72");
  }
  await page.screenshot({ path: testInfo.outputPath("confidence-hold.png"), fullPage: true });
  await page.getByRole("button", { name: "Reliable match" }).click();
  await expect(page.getByTestId("Passenger")).toHaveAttribute("data-decision", "matched");
  await page.getByRole("button", { name: "Delayed old revision" }).click();
  await expect(page.getByTestId("Passenger")).toHaveAttribute("data-version", "4");
  await expect(page.getByTestId("Admin")).toHaveAttribute("data-version", "4");
});
test("bounded uncertainty eventually exposes an approximate raw fallback", async ({ page }, testInfo) => {
  await page.getByRole("button", { name: "Low confidence" }).click();
  await expect(page.getByTestId("Passenger")).toHaveAttribute("data-decision", "match_pending");
  await expect(page.getByTestId("Passenger")).toHaveAttribute("data-decision", "raw", { timeout: 4000 });
  await expect(page.getByTestId("Passenger")).toHaveAttribute("data-uncertain", "true");
  await expect.poll(async () => Number(await page.getByTestId("Passenger").getAttribute("data-lng"))).toBeCloseTo(72.0002, 6);
  await page.screenshot({ path: testInfo.outputPath("approximate-fallback.png"), fullPage: true });
});
