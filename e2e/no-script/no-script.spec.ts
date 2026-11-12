import { expect, test, type Page } from "@playwright/test";

// Issue #512: with JavaScript disabled the landing page stalled at
// "Preparing sign-in…" and /install at "Checking your device…", with nothing
// telling the visitor what to do. Note: getByText skips <noscript> subtrees, so
// the fallbacks are located by role.

function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return errors;
}

async function expectNoHorizontalScroll(page: Page) {
  // page.evaluate still runs with javaScriptEnabled: false; only page scripts are off.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

test("landing explains that JavaScript is needed instead of an endless sign-in spinner", async ({ page }, testInfo) => {
  const errors = collectConsoleErrors(page);
  await page.goto("/");

  await expect(page.getByRole("heading", { level: 1 })).toContainText("Track your");
  const notice = page.getByRole("note", { name: "JavaScript is turned off" });
  await expect(notice).toBeVisible();
  await expect(notice).toContainText("Turn on JavaScript");
  await expect(page.getByText("Preparing sign-in…")).toBeHidden();
  await expect(page.getByRole("link", { name: "Campus Operations" })).toBeVisible();
  await expectNoHorizontalScroll(page);

  await page.screenshot({ path: testInfo.outputPath("landing-no-script.png"), fullPage: true });
  expect(errors.filter((text) => /Content Security Policy/i.test(text))).toEqual([]);
});

test.describe("with JavaScript enabled", () => {
  test.use({ javaScriptEnabled: true });

  test("the fallbacks stay out of the way of the hydrated pages", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("button", { name: /Preparing sign-in…|Continue with Google/ })).toBeVisible();
    await expect(page.getByRole("note", { name: "JavaScript is turned off" })).toHaveCount(0);

    await page.goto("/install");
    await expect(page.getByText(/Open this link on your phone|Tap the ⋮ menu/).first()).toBeVisible();
    await expect(page.getByRole("region", { name: "Install without JavaScript" })).toHaveCount(0);
  });
});

test("install page gives manual installation steps instead of checking the device forever", async ({ page }, testInfo) => {
  const errors = collectConsoleErrors(page);
  await page.goto("/install");

  await expect(page.getByRole("heading", { level: 1, name: "Install Eki" })).toBeVisible();
  await expect(page.getByText("Checking your device…")).toBeHidden();
  const steps = page.getByRole("region", { name: "Install without JavaScript" });
  await expect(steps).toBeVisible();
  await expect(steps.getByRole("heading", { name: "iPhone or iPad" })).toBeVisible();
  await expect(steps).toContainText("Add to Home Screen");
  await expect(steps.getByRole("heading", { name: "Android" })).toBeVisible();
  await expect(steps).toContainText("Install app");
  await expect(steps.getByRole("heading", { name: "Computer" })).toBeVisible();
  await expectNoHorizontalScroll(page);

  await page.screenshot({ path: testInfo.outputPath("install-no-script.png"), fullPage: true });
  expect(errors.filter((text) => /Content Security Policy/i.test(text))).toEqual([]);
});
