import { capture, expect, open, SURFACE, test } from "./visual";

test("landing, signed out", async ({ page }) => {
  await open(page, `${SURFACE}/?surface=landing`);
  await expect(page.getByRole("button", { name: "Continue with Google" })).toBeEnabled();
  await capture(page, "landing", { showArtwork: true });
});

test("install guide", async ({ page }) => {
  await open(page, `${SURFACE}/?surface=install`);
  await expect(page.getByRole("heading", { level: 1, name: "Install Eki" })).toBeVisible();
  await capture(page, "install");
});

test("page not found, light and dark", async ({ page }) => {
  await open(page, `${SURFACE}/?surface=not-found`);
  await expect(page.getByRole("link", { name: "Go to Eki home" })).toBeVisible();
  await capture(page, "not-found");
  await page.emulateMedia({ colorScheme: "dark" });
  await capture(page, "not-found-dark");
});
