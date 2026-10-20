import { expect, test } from "@playwright/test";

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
  await page.clock.runFor(60_001);
  await expect(warning).toBeVisible();
  // Visibility alone does not establish that another layer leaves text readable.
  const header = page.getByRole("button", { name: "Back to home", exact: true }).locator("..").locator("..");
  const headerBox = (await header.boundingBox())!;
  const warningBox = (await warning.boundingBox())!;
  expect(warningBox.y).toBeGreaterThanOrEqual(headerBox.y + headerBox.height);
  expect(await warning.evaluate(element => {
    const box = element.getBoundingClientRect();
    const top = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return top === element || element.contains(top);
  })).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width);
  await expect(page.getByRole("button", { name: "Route Timeline", exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath("location-delay.png"), fullPage: true });
  await page.getByText("QA controls (synthetic)", { exact: true }).click();
  await page.getByLabel("QA scenario").selectOption("reverse");
  await expect(warning).toHaveCount(0);
});
