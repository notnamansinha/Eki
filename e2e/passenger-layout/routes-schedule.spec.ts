import { expect, test, type Page } from "@playwright/test";

// Passenger Routes (schedule) tab. `?schedule=demo` adds the synthetic
// five-stop "Campus Loop" route that the synthetic settings/passengerRoutes
// approves ahead of "QA route"; the synthetic settings/routeUsage gives
// QA route more rides, so it is listed first.
const nav = (page: Page) => page.locator("[data-passenger-workspace] nav");
const navButton = (page: Page, name: "Map" | "Routes" | "Profile") => nav(page).getByRole("button", { name, exact: true });

async function openSchedule(page: Page) {
  await page.goto("/?schedule=demo");
  await navButton(page, "Routes").click();
  await expect(navButton(page, "Routes")).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("heading", { name: "Campus Loop", level: 2 })).toBeVisible();
}

/** Drops a route card's stops down and waits for the open animation to end. */
async function expandRoute(page: Page, name: string) {
  const toggle = page.getByRole("button", { name: `${name} schedule`, exact: true });
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  const list = page.getByRole("list", { name: `${name} stops` });
  await expect(list).toBeVisible();
  await list.evaluate(element => Promise.all(
    element.closest("section")!.getAnimations({ subtree: true }).map(animation => animation.finished),
  ));
}

async function timelineGeometry(page: Page, list: string) {
  return page.getByRole("list", { name: list }).evaluate(element => {
    const card = element.closest("section")!.getBoundingClientRect();
    return {
      cardRight: card.right,
      items: Array.from(element.querySelectorAll(":scope > li")).map(item => {
        const rail = item.querySelector("[data-rail]")!;
        const dot = rail.querySelector("[data-rail-dot]")!.getBoundingClientRect();
        const segments = Array.from(rail.children).filter(child => !child.hasAttribute("data-rail-dot"))
          .map(segment => {
            const rect = segment.getBoundingClientRect();
            return { top: rect.top, bottom: rect.bottom, color: getComputedStyle(segment).backgroundColor };
          });
        const name = item.querySelector("p")!.getBoundingClientRect();
        const time = item.querySelector("[data-stop-time]")!;
        return {
          dotCenterX: dot.left + dot.width / 2,
          dotCenterY: dot.top + dot.height / 2,
          dotRight: dot.right,
          segments,
          nameLeft: name.left,
          timeRight: time.getBoundingClientRect().right,
          timeColor: getComputedStyle(time).color,
        };
      }),
    };
  });
}

// The Routes tab's own maroon accent (#B0303F); the rest of the app stays orange.
const MAROON = "rgb(176, 48, 63)";
const campusLoop = (page: Page) => page.locator('[data-route-schedule="qa-campus-loop"]');

test("Routes tab lists every route by use with buses and a single rail", async ({ page }, info) => {
  await openSchedule(page);
  // Most rides first, ahead of the admin's approval order, with the count and no badge.
  await expect(page.getByRole("heading", { level: 2 })).toHaveText(["QA route", "Campus Loop"]);
  const qaRoute = page.locator('[data-route-schedule="qa-route"]');
  await expect(page.getByText(/most used/i)).toHaveCount(0);
  await expect(qaRoute.locator("[data-ride-count]")).toHaveText("128 rides");
  await expect(campusLoop(page).locator("[data-ride-count]")).toHaveText("42 rides");
  // Both cards start collapsed: the summary shows, the stops do not.
  await expect(page.getByRole("button", { name: /schedule$/ })).toHaveCount(2);
  for (const button of await page.getByRole("button", { name: /schedule$/ }).all()) {
    await expect(button).toHaveAttribute("aria-expanded", "false");
  }
  await expect(page.getByRole("list", { name: "Campus Loop stops" })).toBeHidden();
  await expect(campusLoop(page)).toContainText("5 stops");
  await expect(campusLoop(page).locator("[data-toggle-chevron]")).toBeVisible();
  await page.screenshot({ path: info.outputPath("routes-schedule-collapsed.png") });
  await expandRoute(page, "Campus Loop");
  // One "number - name" line per assigned bus, by bus number.
  const buses = page.getByRole("list", { name: "Campus Loop buses" }).getByRole("listitem");
  await expect(buses).toHaveText(["bus_03 - Campus Hopper", "bus_12 - Green Line Express"]);
  const stops = page.getByRole("list", { name: "Campus Loop stops" }).getByRole("listitem");
  await expect(stops).toHaveText([
    "Main Gate, 7:30 am", "Central Library, 7:38 am", "Girls Hostel Block C (North Wing), 7:45 am",
    "Sports Complex, Time not set", "Administrative Building, 8:05 am",
  ]);
  const { items, cardRight } = await timelineGeometry(page, "Campus Loop stops");
  // Every dot sits on one vertical rail at the left, with the name after it
  // and the time flush with the card's right padding.
  for (const item of items) {
    expect(Math.abs(item.dotCenterX - items[0].dotCenterX)).toBeLessThan(1);
    expect(item.nameLeft).toBeGreaterThan(item.dotRight);
    expect(Math.abs(cardRight - item.timeRight - 17)).toBeLessThan(2);
    for (const segment of item.segments) expect(segment.color).toBe(MAROON);
  }
  // The accent rail is continuous from the first dot to the last.
  expect(items[0].segments).toHaveLength(1);
  expect(items.at(-1)!.segments).toHaveLength(1);
  expect(Math.abs(items[0].segments[0].top - items[0].dotCenterY)).toBeLessThan(1);
  expect(Math.abs(items.at(-1)!.segments[0].bottom - items.at(-1)!.dotCenterY)).toBeLessThan(1);
  for (let index = 1; index < items.length; index += 1) {
    expect(Math.abs(items[index].segments[0].top - items[index - 1].segments.at(-1)!.bottom)).toBeLessThan(1);
  }
  await expect(campusLoop(page).locator("[data-route-direction]"))
    .toHaveText(/^Main Gate.*to Administrative Building$/);
  // Opening does not recolour the card border; it matches the closed card.
  const borders = await page.locator("[data-route-schedule]").evaluateAll(cards => cards.map(card => getComputedStyle(card).borderTopColor));
  expect(new Set(borders).size).toBe(1);
  expect(borders[0]).not.toBe(MAROON);
  // Configured times are the live-status green; the unset one is muted.
  expect(items.filter(item => item.timeColor === "rgb(52, 211, 153)")).toHaveLength(4);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width);
  await page.screenshot({ path: info.outputPath("routes-schedule.png") });
});

test("three navigation tabs fit narrow phones and the schedule scrolls clear of them", async ({ page }, info) => {
  for (const size of [{ width: 320, height: 568 }, { width: 375, height: 812 }]) {
    await page.setViewportSize(size);
    await openSchedule(page);
    const boxes = await Promise.all((["Map", "Routes", "Profile"] as const).map(async name => (await navButton(page, name).boundingBox())!));
    for (const [index, box] of boxes.entries()) {
      expect(box.x, `${size.width}px tab ${index}`).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(size.width);
      if (index > 0) expect(box.x).toBeGreaterThanOrEqual(boxes[index - 1].x + boxes[index - 1].width);
    }
    for (const name of ["Map", "Routes", "Profile"]) {
      const label = navButton(page, name as "Map").locator("span");
      expect(await label.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(size.width);
    await page.screenshot({ path: info.outputPath(`routes-schedule-${size.width}x${size.height}.png`) });
    // Collapsed cards stay compact: the chevron sits beside the name rather
    // than on a line of its own, so two cards fit above the navigation.
    for (const card of await page.locator("[data-route-schedule]").all()) {
      const cardBox = (await card.boundingBox())!;
      const chevron = (await card.locator("[data-toggle-chevron]").boundingBox())!;
      expect(cardBox.height, `${size.width}px collapsed card`).toBeLessThanOrEqual(130);
      expect(chevron.x + chevron.width).toBeLessThanOrEqual(cardBox.x + cardBox.width - 12);
      expect(chevron.y).toBeLessThan(cardBox.y + cardBox.height / 2);
    }
    await expandRoute(page, "QA route");
    await expandRoute(page, "Campus Loop");
    const last = page.getByRole("list", { name: "Campus Loop stops" }).getByRole("listitem").last();
    await last.evaluate(element => { const scroller = element.closest(".overflow-y-auto")!; scroller.scrollTop = scroller.scrollHeight; });
    const navBox = (await nav(page).boundingBox())!;
    const lastBox = (await last.boundingBox())!;
    expect(lastBox.y + lastBox.height).toBeLessThanOrEqual(navBox.y);
  }
});

test("Map returns to live routes and the hidden schedule cannot intercept taps", async ({ page }) => {
  await openSchedule(page);
  await navButton(page, "Map").click();
  await expect(navButton(page, "Map")).toHaveAttribute("aria-current", "page");
  const track = page.getByRole("button", { name: "Track QA route", exact: true });
  await expect(track).toBeVisible();
  await expect(page.getByRole("heading", { name: "Campus Loop" })).toBeHidden();
  await track.click();
  await expect(page.locator("[data-passenger-tracking]")).not.toHaveAttribute("aria-hidden", "true");
});

/**
 * Freezes every running transition at its midpoint and returns how much of
 * the hero image behind the workspace shows through the Routes and Profile
 * views and the page floor beneath them (0 = fully covered).
 */
async function heroLeakMidTransition(page: Page) {
  return page.evaluate(() => {
    for (const animation of document.getAnimations()) { animation.pause(); animation.currentTime = 100; }
    const opacity = (selector: string) => {
      const element = document.querySelector(selector);
      return element ? Number(getComputedStyle(element).opacity) : 0;
    };
    return (1 - opacity('[data-passenger-view="routes"]')) * (1 - opacity('[data-passenger-view="profile"]')) * (1 - opacity("[data-passenger-page-floor]"));
  });
}

test("switching between Routes and Profile never shows the hero image mid-fade", async ({ page }) => {
  await openSchedule(page);
  // Let the fade from the map view (where the hero is meant to show) settle.
  await page.evaluate(() => Promise.all(document.getAnimations().map(animation => animation.finished)));
  expect(await heroLeakMidTransition(page)).toBe(0);
  await navButton(page, "Profile").click();
  expect(await heroLeakMidTransition(page)).toBeLessThan(0.01);
  await page.evaluate(() => { for (const animation of document.getAnimations()) animation.finish(); });
  await expect(navButton(page, "Profile")).toHaveAttribute("aria-current", "page");
  await navButton(page, "Routes").click();
  expect(await heroLeakMidTransition(page)).toBeLessThan(0.01);
});
