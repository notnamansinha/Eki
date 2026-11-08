import { expect, test, type Page } from "@playwright/test";
import { raiseLiveRoutes } from "./liveRoutes";

const nav =(page: Page) => page.getByRole("navigation", { name: "Passenger sections" });
const navButton = (page: Page, name: "Live" | "Routes" | "Profile") => nav(page).getByRole("button", { name, exact: true });

async function openSchedules(page: Page) {
  await page.goto("/?schedule=demo");
  await page.addStyleTag({ content: '[aria-label="QA fixture controls"] { display: none; }' });
  await navButton(page, "Routes").click();
  await expect(navButton(page, "Routes")).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("heading", { name: "Routes", exact: true })).toBeVisible();
}

test("Routes tab lists approved schedules with a compact badge and one-sided timeline", async ({ page }, info) => {
  const maps: string[] = [];
  page.on("request", request => {
    const url = new URL(request.url());
    if (url.hostname === "maps.googleapis.com" || url.hostname === "maps.gstatic.com") {
      maps.push(url.href);
    }
  });
  await openSchedules(page);
  const list = page.getByRole("list", { name: "Published routes" });
  await expect(list.getByRole("button")).toHaveCount(2);
  await expect(list.getByRole("button").first()).toHaveAccessibleName("View schedule for Campus Loop");
  const badge = list.locator(".schedule-line-badge").first();
  await expect(badge).toHaveCSS("background-color", "rgb(128, 18, 20)");
  await expect(badge.locator("svg")).toBeVisible();
  const search = page.getByRole("searchbox");
  await search.fill("hostel");
  await expect(list.getByRole("button")).toHaveCount(1);
  await search.fill("nonexistent");
  await expect(page.getByText("No routes match your search.")).toBeVisible();
  await search.clear();
  await page.screenshot({ path: info.outputPath("routes-list.png") });

  const row = list.getByRole("button", { name: "View schedule for Campus Loop" });
  await row.focus();
  await page.keyboard.press("Enter");
  const heading = page.getByRole("heading", { name: "Campus Loop", exact: true });
  await expect(heading).toBeFocused();
  const timeline = page.getByRole("list", { name: "Campus Loop stops" });
  await expect(timeline.getByRole("listitem")).toHaveText([
    "Main GateScheduled 7:30 am", "Central LibraryScheduled 7:38 am", "Girls Hostel Block C (North Wing)Scheduled 7:45 am",
    "Sports ComplexTime not set", "Administrative BuildingScheduled 8:05 am",
  ]);
  expect(await timeline.getByRole("listitem").evaluateAll(items => items.every(item => {
    const rail = item.querySelector(".schedule-stop-rail")!;
    const copy = item.querySelector(".schedule-stop-copy")!;
    return copy.getBoundingClientRect().left >= rail.getBoundingClientRect().right &&
      getComputedStyle(rail, "::before").backgroundColor === "rgb(67, 71, 71)";
  }))).toBe(true);
  await expect(page.locator("[data-passenger-tracking]")).toHaveAttribute("aria-hidden", "true");
  expect(maps).toEqual([]);
  await page.screenshot({ path: info.outputPath("routes-detail.png") });

  const back = page.getByRole("button", { name: "Back to all routes" });
  if (await back.isVisible()) {
    await back.click();
    await expect(row).toBeFocused();
  } else {
    await expect(list).toBeVisible();
    const navBox = (await nav(page).boundingBox())!;
    const listBox = (await list.boundingBox())!;
    // Routes keeps the same bottom dock as Live and Profile; the list ends above it.
    expect(listBox.y + listBox.height).toBeLessThanOrEqual(navBox.y + 0.5);
  }
});

test("three navigation tabs fit narrow phones and the schedule scrolls clear of them", async ({ page }, info) => {
  for (const size of [{ width: 320, height: 568 }, { width: 375, height: 812 }]) {
    await page.setViewportSize(size);
    await openSchedules(page);
    const boxes = await Promise.all((["Live", "Routes", "Profile"] as const).map(async name => (await navButton(page, name).boundingBox())!));
    for (const [index, box] of boxes.entries()) {
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(size.width);
      expect(box.height).toBeGreaterThanOrEqual(44);
      if (index > 0) expect(box.x).toBeGreaterThanOrEqual(boxes[index - 1].x + boxes[index - 1].width);
    }
    await page.getByRole("button", { name: "View schedule for Campus Loop" }).click();
    const last = page.getByRole("list", { name: "Campus Loop stops" }).getByRole("listitem").last();
    await last.scrollIntoViewIfNeeded();
    const navBox = (await nav(page).boundingBox())!;
    const lastBox = (await last.boundingBox())!;
    expect(lastBox.y + lastBox.height).toBeLessThanOrEqual(navBox.y + 0.5);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(size.width);
    await page.screenshot({ path: info.outputPath(`routes-schedule-${size.width}x${size.height}.png`) });
  }
});

test("Live returns to the route list and the hidden schedule cannot intercept taps", async ({ page }) => {
  await openSchedules(page);
  await navButton(page, "Profile").click();
  await expect(navButton(page, "Profile")).toHaveAttribute("aria-current", "page");
  await page.goBack();
  await expect(navButton(page, "Routes")).toHaveAttribute("aria-current", "page");
  await page.goForward();
  await expect(navButton(page, "Profile")).toHaveAttribute("aria-current", "page");

  await navButton(page, "Live").click();
  await expect(navButton(page, "Live")).toHaveAttribute("aria-current", "page");
  const track = page.getByRole("button", { name: "Track QA route", exact: true });
  await expect(track).toBeVisible();
  await expect(page.getByRole("heading", { name: "Routes", exact: true })).toBeHidden();
  await raiseLiveRoutes(page);
  await track.click();
  await expect(page.locator("[data-passenger-tracking]")).not.toHaveAttribute("aria-hidden", "true");
});
