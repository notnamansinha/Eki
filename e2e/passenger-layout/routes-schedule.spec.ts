import { expect, test, type Page } from "@playwright/test";

// Passenger Routes (schedule) tab. `?schedule=demo` adds the synthetic
// five-stop "Campus Loop" route that the synthetic settings/passengerRoutes
// approves ahead of "QA route".
const nav = (page: Page) => page.locator("[data-passenger-workspace] nav");
const navButton = (page: Page, name: "Map" | "Routes" | "Profile") => nav(page).getByRole("button", { name, exact: true });

async function openSchedule(page: Page) {
  await page.goto("/?schedule=demo");
  await navButton(page, "Routes").click();
  await expect(navButton(page, "Routes")).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("heading", { name: "Campus Loop", level: 2 })).toBeVisible();
}

async function timelineGeometry(page: Page, list: string) {
  return page.getByRole("list", { name: list }).evaluate(element => {
    const box = element.getBoundingClientRect();
    const line = getComputedStyle(element, "::before");
    return {
      lineColor: line.backgroundColor,
      center: box.left + box.width / 2,
      dots: Array.from(element.querySelectorAll(":scope > li > span[aria-hidden]")).map(dot => {
        const rect = dot.getBoundingClientRect();
        return rect.left + rect.width / 2;
      }),
      items: Array.from(element.querySelectorAll(":scope > li")).map(item => {
        const text = item.firstElementChild!.getBoundingClientRect();
        const time = item.querySelector("p:last-of-type")!;
        return {
          side: item.getAttribute("data-side"),
          textLeft: text.left, textRight: text.right,
          timeColor: getComputedStyle(time).color,
        };
      }),
    };
  });
}

test("Routes tab lists approved schedules on an alternating timeline", async ({ page }, info) => {
  await openSchedule(page);
  // Approval order; the unapproved second route never appears.
  await expect(page.getByRole("heading", { level: 2 })).toHaveText(["Campus Loop", "QA route"]);
  const stops = page.getByRole("list", { name: "Campus Loop stops" }).getByRole("listitem");
  await expect(stops).toHaveText([
    "Main Gate, 7:30 am", "Central Library, 7:38 am", "Girls Hostel Block C (North Wing), 7:45 am",
    "Sports Complex, Time not set", "Administrative Building, 8:05 am",
  ]);
  const geometry = await timelineGeometry(page, "Campus Loop stops");
  expect(geometry.lineColor).toBe("rgb(250, 93, 41)");
  for (const dot of geometry.dots) expect(Math.abs(dot - geometry.center)).toBeLessThan(1);
  expect(geometry.items.map(item => item.side)).toEqual(["left", "right", "left", "right", "left"]);
  for (const item of geometry.items) {
    if (item.side === "left") expect(item.textRight).toBeLessThanOrEqual(geometry.center);
    else expect(item.textLeft).toBeGreaterThanOrEqual(geometry.center);
  }
  // Configured times are the live-status green; the unset one is muted.
  expect(geometry.items.filter(item => item.timeColor === "rgb(52, 211, 153)")).toHaveLength(4);
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
    const last = page.getByRole("list", { name: "QA route stops" }).getByRole("listitem").last();
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
