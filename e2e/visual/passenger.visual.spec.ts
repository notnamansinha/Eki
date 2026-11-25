import type { Page } from "@playwright/test";
import { raiseLiveRoutes, trackRoute } from "../passenger-layout/liveRoutes";
import { capture, expect, isTouch, open, PASSENGER, test } from "./visual";

// The passenger fixture (e2e/fixtures/README.md): the real passenger layout,
// theme and workspace with synthetic routes and buses.
const workspace = (page: Page) => page.locator(".passenger-layout");
const nav = (page: Page) => page.getByRole("navigation", { name: "Passenger sections" });
// See CaptureOptions.maxDiffPixels; the accessibility tree of these states is still exact.
const MAP_NOISE = 1000;

async function scenario(page: Page, value: string) {
  await page.getByText("QA controls (synthetic)", { exact: true }).click();
  await page.getByLabel("QA scenario").selectOption(value);
  await page.getByText("QA controls (synthetic)", { exact: true }).click();
}

async function openProfile(page: Page) {
  await open(page, `${PASSENGER}/?scenario=forward`);
  await nav(page).getByRole("button", { name: "Profile", exact: true }).click();
  await expect(page.getByRole("region", { name: "Account" })).toBeVisible();
}

test("home with one live route", async ({ page }) => {
  await open(page, `${PASSENGER}/?scenario=forward`);
  await expect(page.getByRole("heading", { name: "Live routes" })).toBeVisible();
  await capture(page, "passenger-home", { tree: workspace(page) });
});

test("live routes raised on touch screens", async ({ page }) => {
  await open(page, `${PASSENGER}/?scenario=two-routes`);
  test.skip(!(await isTouch(page)), "Pointer screens show the list without a sheet; passenger-home covers them.");
  await raiseLiveRoutes(page);
  await capture(page, "passenger-live-routes", { tree: workspace(page) });
});

test("tracking a bus", async ({ page }) => {
  await open(page, `${PASSENGER}/?scenario=forward`);
  await trackRoute(page);
  await expect(page.getByRole("button", { name: "Open live chat", exact: true })).toBeVisible();
  await expect(page.getByText("Synthetic SDK adapter · actual map logic")).toBeVisible();
  await capture(page, "passenger-tracking", { tree: workspace(page), maxDiffPixels: MAP_NOISE });
});

test("tracking warning after a GPS signal loss", async ({ page }) => {
  await open(page, `${PASSENGER}/?scenario=forward`);
  await trackRoute(page);
  await expect(page.getByRole("button", { name: "Open live chat", exact: true })).toBeVisible();
  await scenario(page, "gnss-lost");
  await expect(page.locator("[data-map-notices]").getByText("GPS signal lost", { exact: true })).toBeVisible();
  await capture(page, "passenger-tracking-gnss-lost", { tree: workspace(page), maxDiffPixels: MAP_NOISE });
});

test("no buses running", async ({ page }) => {
  await open(page, `${PASSENGER}/?scenario=empty`);
  await expect(page.getByRole("heading", { name: "Live routes" })).toBeVisible();
  await capture(page, "passenger-no-service", { tree: workspace(page) });
});

test("published route schedules", async ({ page }) => {
  await open(page, `${PASSENGER}/?scenario=forward&schedule=demo`);
  await nav(page).getByRole("button", { name: "Routes", exact: true }).click();
  await expect(page.getByRole("list", { name: "Published routes" }).getByRole("button")).toHaveCount(2);
  await capture(page, "passenger-routes", { tree: workspace(page) });
});

test("profile", async ({ page }) => {
  await openProfile(page);
  await capture(page, "passenger-profile", { tree: workspace(page) });
});

test("feedback form", async ({ page }) => {
  await openProfile(page);
  await page.getByRole("button", { name: "Send feedback" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await capture(page, "passenger-feedback", { tree: page.getByRole("dialog") });
});

test("delete account confirmation", async ({ page }) => {
  await openProfile(page);
  await page.getByRole("button", { name: "Delete account" }).click();
  const dialog = page.getByRole("dialog", { name: "Delete account?" });
  await expect(dialog).toBeVisible();
  await capture(page, "passenger-delete-account", { tree: dialog });
});
