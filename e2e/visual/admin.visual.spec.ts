import type { Page } from "@playwright/test";
import { capture, expect, open, SURFACE, test } from "./visual";

// The real admin layout, page and panels on the synthetic boundaries of
// e2e/visual/fixture (routes, buses and history from e2e/production-audit/state.ts).
const main = (page: Page) => page.getByRole("main");

async function openTab(page: Page, tab: string) {
  await open(page, `${SURFACE}/?surface=admin&role=admin`);
  await expect(page.getByRole("tablist", { name: "Administration sections" })).toBeVisible();
  await page.getByRole("tab", { name: tab }).click();
  await expect(page.getByRole("tab", { name: tab })).toHaveAttribute("aria-selected", "true");
  // Each panel is a lazy import (the fixture's next/dynamic stand-in shows "Loading fixture view…").
  await expect(page.getByText("Loading fixture view…")).toHaveCount(0);
  await expect(page.getByRole("tabpanel").locator("*").first()).toBeVisible();
}

test("live operations", async ({ page }) => {
  await openTab(page, "Live Ops");
  await capture(page, "admin-live-ops", { tree: main(page) });
});

test("routes", async ({ page }) => {
  await openTab(page, "Routes");
  await capture(page, "admin-routes", { tree: main(page) });
});

test("fleet and people", async ({ page }) => {
  await openTab(page, "Fleet & People");
  await capture(page, "admin-fleet", { tree: main(page) });
});

test("ride history", async ({ page }) => {
  await openTab(page, "History");
  await capture(page, "admin-history", { tree: main(page) });
});

test("feedback", async ({ page }) => {
  await openTab(page, "Feedback");
  await expect(page.getByText("Please add the library stop to the evening route.")).toBeVisible();
  await capture(page, "admin-feedback", { tree: main(page) });
});

test("settings", async ({ page }) => {
  await openTab(page, "Settings");
  await capture(page, "admin-settings", { tree: main(page) });
});
