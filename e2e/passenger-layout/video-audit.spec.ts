import { expect, test, type Page } from "@playwright/test";
import { homePanel, raiseLiveRoutes, trackRoute } from "./liveRoutes";

// Regressions for the 2026-10-28 passenger video review (PAX-01..04) and the
// admin "Passenger Panel" placement. Phone insets are injected explicitly, the
// same way the audit simulated them; they are not measured device values.
async function injectInsets(page: Page, top = 47, bottom = 34) {
  await page.addStyleTag({ content: `:root{--safe-area-top:${top}px;--safe-area-bottom:${bottom}px}
    .pt-safe{padding-top:${top}px!important}.pb-safe{padding-bottom:${bottom}px!important}` });
}
const nav = (page: Page) => page.locator("[data-passenger-workspace] nav");
const navButton = (page: Page, name: "Live" | "Routes" | "Profile") => nav(page).getByRole("button", { name, exact: true });

async function paintedNavBottom(page: Page) {
  return nav(page).evaluate(element => {
    // The lowest edge painted with the navigation surface colour.
    let bottom = 0;
    for (let node: HTMLElement | null = element as HTMLElement; node && !node.hasAttribute("data-passenger-workspace"); node = node.parentElement) {
      if (getComputedStyle(node).backgroundColor === "rgba(249, 248, 246, 0.94)") bottom = Math.max(bottom, node.getBoundingClientRect().bottom);
    }
    return bottom;
  });
}

for (const bottomInset of [0, 34]) {
  test(`PAX-01 navigation clears the panel and respects the bottom inset (bottom inset ${bottomInset}px)`, async ({ page }) => {
    await page.goto("/");
    await injectInsets(page, bottomInset ? 47 : 0, bottomInset);
    await expect(nav(page)).toBeVisible();
    const viewport = page.viewportSize()!;
    const desktop = await page.evaluate(() => matchMedia("(any-pointer: fine)").matches);
    expect(await paintedNavBottom(page)).toBeCloseTo(viewport.height - (desktop ? 16 : 0), 0);
    await raiseLiveRoutes(page);
    const panel = (await homePanel(page).boundingBox())!;
    const navBox = (await nav(page).boundingBox())!;
    // Phones rest the sheet on the tab bar; the desktop panel keeps a gap above the dock.
    expect(navBox.y - (panel.y + panel.height)).toBeGreaterThanOrEqual(desktop ? 8 : 0);
    // Profile scroll content can reach past the navigation.
    await navButton(page, "Profile").click();
    const version = page.getByText("Eki", { exact: true });
    await version.evaluate(element => {
      const scroller = element.closest(".overflow-y-auto")!;
      scroller.scrollTop = scroller.scrollHeight;
    });
    const versionBox = (await version.boundingBox())!;
    expect(versionBox.y + versionBox.height).toBeLessThanOrEqual(navBox.y);
  });
}

test("PAX-02 initialization copy is gone once the workspace is ready", async ({ page }) => {
  await page.goto("/");
  await expect(nav(page)).toBeVisible();
  await expect(page.getByText("Restoring your transit session…", { exact: true })).toBeHidden();
  await expect(page.getByText("Loading live route information", { exact: true })).toBeHidden();
});

test("PAX-02 Profile switches settle quickly without exposing the loading screen", async ({ page }) => {
  await page.goto("/");
  await navButton(page, "Profile").click();
  await expect(page.getByRole("button", { name: "Send feedback" })).toBeVisible();
  await navButton(page, "Live").click();
  await page.waitForTimeout(700);
  for (const destination of ["Profile", "Live", "Profile"] as const) {
    const samples = await page.evaluate(async target => {
      const profileView = document.querySelector("[data-passenger-workspace] button")?.ownerDocument
        .evaluate("//button[normalize-space()='Send feedback']", document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null)
        .singleNodeValue as HTMLElement | null;
      const wrapper = profileView?.closest("[aria-hidden]") as HTMLElement | null;
      const restoring = Array.from(document.querySelectorAll("p")).find(p => p.textContent === "Restoring your transit session…");
      const button = Array.from(document.querySelectorAll("[data-passenger-workspace] nav button")).find(b => b.textContent?.trim() === target) as HTMLElement;
      const start = performance.now();
      const frames: { t: number; profileOpacity: number; profileFilled: boolean; restoringVisible: boolean }[] = [];
      button.click();
      await new Promise<void>(resolve => {
        const sample = () => {
          frames.push({
            t: performance.now() - start,
            profileOpacity: wrapper ? Number(getComputedStyle(wrapper).opacity) : -1,
            profileFilled: Boolean(wrapper?.querySelector("button")),
            restoringVisible: Boolean(restoring?.checkVisibility({ visibilityProperty: true, opacityProperty: true })),
          });
          if (performance.now() - start < 800) requestAnimationFrame(sample); else resolve();
        };
        requestAnimationFrame(sample);
      });
      return frames;
    }, destination);
    expect(samples.some(frame => frame.restoringVisible), `${destination}: loading copy exposed`).toBe(false);
    expect(samples.every(frame => frame.profileFilled), `${destination}: Profile emptied mid-transition`).toBe(true);
    const settledAt = samples.find(frame => destination === "Profile" ? frame.profileOpacity >= 0.999 : frame.profileOpacity <= 0.001)?.t;
    expect(settledAt, `${destination}: never settled`).toBeDefined();
    expect(settledAt!).toBeLessThan(350);
  }
});

test("PAX-02 rapid switching ends on a coherent destination", async ({ page }) => {
  await page.goto("/");
  for (let i = 0; i < 12; i++) await navButton(page, i % 2 ? "Live" : "Profile").click({ delay: 0 });
  await navButton(page, "Live").click();
  await expect(navButton(page, "Live")).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("heading", { name: "Live routes" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Send feedback" })).toBeHidden();
  await page.waitForTimeout(400);
  const hit = await page.evaluate(() => {
    const heading = Array.from(document.querySelectorAll("[data-passenger-workspace] h1")).find(h => h.textContent === "Live routes")!;
    const box = heading.getBoundingClientRect();
    const top = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    // On touch screens the sheet's own toggle spans the heading; any other layer is a leak.
    const toggle = heading.closest(".passenger-home-panel")?.querySelector(".pp-home-sheet-toggle");
    return heading.contains(top) || Boolean(toggle?.contains(top));
  });
  expect(hit).toBe(true);
});

test("PAX-02 reduced motion switches immediately", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await navButton(page, "Profile").click();
  const view = page.getByRole("button", { name: "Send feedback" }).locator("xpath=ancestor::*[@aria-hidden][1]");
  // Deterministic: the global reduced-motion override collapses the fade.
  expect(await view.evaluate(element => parseFloat(getComputedStyle(element).transitionDuration))).toBeLessThan(0.001);
  // And observable: the view reaches full opacity (the duration check above proves it is not faded in).
  await expect.poll(() => view.evaluate(element => Number(getComputedStyle(element).opacity)), { timeout: 1_000 })
    .toBeGreaterThanOrEqual(0.999);
});

async function openFeedback(page: Page, draft: string) {
  await navButton(page, "Profile").click();
  await page.getByRole("button", { name: "Send feedback" }).click();
  const dialog = page.getByRole("dialog", { name: "Send feedback" });
  await expect(dialog).toBeVisible();
  if (draft) await dialog.getByRole("textbox").fill(draft);
  return dialog;
}

test("PAX-03 feedback covers navigation and pointer taps cannot discard a draft", async ({ page }) => {
  await page.goto("/");
  await injectInsets(page);
  const dialog = await openFeedback(page, "Synthetic unsent draft");
  for (const name of ["Live", "Routes", "Profile"] as const) {
    const box = (await navButton(page, name).boundingBox())!;
    const hit = await page.evaluate(({ x, y }) => {
      const element = document.elementFromPoint(x, y);
      return { nav: Boolean(element?.closest("nav")), overlay: Boolean(element?.closest(".fixed.inset-0")) };
    }, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
    expect(hit, `${name} button must sit under the feedback layer`).toEqual({ nav: false, overlay: true });
  }
  // Tapping the dimmed backdrop neither closes the sheet nor clears the text.
  await page.mouse.click(page.viewportSize()!.width / 2, 8);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("textbox")).toHaveValue("Synthetic unsent draft");
  await expect(navButton(page, "Profile")).toHaveAttribute("aria-current", "page");
  expect(await page.evaluate(() => (window as unknown as { __qaFeedback?: unknown[] }).__qaFeedback)).toBeUndefined();
});

test("PAX-03 keyboard focus stays in feedback; Escape keeps the draft and restores focus", async ({ page }) => {
  await page.goto("/");
  const dialog = await openFeedback(page, "Keyboard draft");
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press("Tab");
    expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("button", { name: "Send feedback" })).toBeFocused();
  await navButton(page, "Live").click();
  await navButton(page, "Profile").click();
  await page.getByRole("button", { name: "Send feedback" }).click();
  await expect(page.getByRole("dialog").getByRole("textbox")).toHaveValue("Keyboard draft");
});

test("PAX-03 a submitted draft is cleared and recorded once", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  const dialog = await openFeedback(page, "Submitted synthetic note");
  await dialog.getByRole("button", { name: "Submit feedback" }).click();
  await expect(page.getByText("Thank you!", { exact: true })).toBeVisible();
  await expect(page.getByRole("dialog")).toBeHidden({ timeout: 4_000 });
  expect(await page.evaluate(() => (window as unknown as { __qaFeedback?: { input: { comment: string } }[] }).__qaFeedback?.map(entry => entry.input.comment)))
    .toEqual(["Submitted synthetic note"]);
  await page.getByRole("button", { name: "Send feedback" }).click();
  await expect(page.getByRole("dialog").getByRole("textbox")).toHaveValue("");
});

test("PAX-03 feedback stays usable when the visible viewport shrinks (soft keyboard)", async ({ page }) => {
  await page.goto("/");
  await injectInsets(page);
  const dialog = await openFeedback(page, "Short screen");
  const width = page.viewportSize()!.width;
  await page.setViewportSize({ width, height: 480 });
  const submit = dialog.getByRole("button", { name: "Submit feedback" });
  await submit.scrollIntoViewIfNeeded();
  const box = (await submit.boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(480);
});

test("PAX-04 the document cannot rubber-band or scroll the passenger frame", async ({ page }) => {
  await page.goto("/");
  await expect(nav(page)).toBeVisible();
  const styles = await page.evaluate(() => ({
    html: getComputedStyle(document.documentElement).overscrollBehaviorY,
    body: getComputedStyle(document.body).overscrollBehaviorY,
  }));
  expect(styles).toEqual({ html: "none", body: "none" });
  const scroller = homePanel(page).locator("div.overflow-y-auto");
  expect(await scroller.evaluate(element => getComputedStyle(element).overscrollBehaviorY)).toBe("contain");
  await navButton(page, "Profile").click();
  const profileScroller = page.getByRole("button", { name: "Send feedback" }).locator("xpath=ancestor::div[contains(@class,'overflow-y-auto')][1]");
  expect(await profileScroller.evaluate(element => getComputedStyle(element).overscrollBehaviorY)).toBe("contain");
  await page.mouse.move(100, 100);
  await page.mouse.wheel(0, -2000);
  await page.mouse.wheel(0, 2000);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  const navBox = (await nav(page).boundingBox())!;
  expect(navBox.y + navBox.height).toBeLessThanOrEqual(page.viewportSize()!.height + 0.5);
});

test("Admin Panel entry appears in Profile only for administrators", async ({ page }) => {
  await page.goto("/?role=admin");
  await navButton(page, "Profile").click();
  await expect(page.getByRole("link", { name: "Admin panel" })).toBeVisible();
  await page.goto("/?role=passenger");
  await navButton(page, "Profile").click();
  await expect(page.getByRole("button", { name: "Send feedback" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Admin panel" })).toHaveCount(0);
});

test("admin Passenger Panel switch is the last item of the sliding section row", async ({ page }) => {
  await page.goto("/?view=admin&role=admin");
  const tablist = page.getByRole("tablist", { name: "Administration sections" });
  const link = page.getByRole("link", { name: "Passenger Panel" });
  await expect(tablist).toBeVisible();
  const geometry = await link.evaluate(element => {
    const row = element.parentElement!;
    const settings = document.getElementById("admin-tab-settings")!;
    return {
      inRow: getComputedStyle(row).overflowX === "auto" && row.contains(document.querySelector("[role=tablist]")),
      last: row.lastElementChild === element,
      after: element.getBoundingClientRect().left >= settings.getBoundingClientRect().right - 0.5,
      rowWidth: row.getBoundingClientRect().width,
      barWidth: row.parentElement!.getBoundingClientRect().width,
    };
  });
  expect(geometry.inRow).toBe(true);
  expect(geometry.last).toBe(true);
  expect(geometry.after).toBe(true);
  // Nothing pinned beside the row narrows the scrolling area.
  expect(geometry.rowWidth).toBeGreaterThanOrEqual(geometry.barWidth - 48.5);
  const viewport = page.viewportSize()!;
  const fits = await link.evaluate(element => element.parentElement!.scrollWidth <= element.parentElement!.clientWidth);
  if (!fits) await expect(link).not.toBeInViewport({ ratio: 1 });
  await link.evaluate(element => { const row = element.parentElement!; row.scrollLeft = row.scrollWidth; });
  await expect(link).toBeInViewport({ ratio: 1 });
  const box = (await link.boundingBox())!;
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
  // Keyboard users reach it right after the selected tab.
  await page.getByRole("tab", { name: "Live Ops" }).focus();
  await page.keyboard.press("Tab");
  await expect(link).toBeFocused();
  await expect(link).toBeInViewport({ ratio: 1 });
});

// Every sampled point must land on the element's own subtree, not on a control above it.
async function hitTestable(page: Page, selector: string, points: { x: number; y: number }[]) {
  return page.evaluate(({ selector, points }) => {
    const element = document.querySelector(selector)!;
    return points.every(({ x, y }) => element.contains(document.elementFromPoint(x, y)));
  }, { selector, points });
}

// Landscape phones are touch screens, so they do not get the desktop
// (any-pointer: fine) layout; the mouse run checks that layout's frame at the same size.
const shortScreens = [
  { width: 844, height: 390, hasTouch: true },
  { width: 568, height: 320, hasTouch: true },
  { width: 844, height: 390, hasTouch: false },
  { width: 320, height: 568, hasTouch: true },
];

test("edge: landscape phone and tiny heights keep the panel above a painted footer", async ({ browser, baseURL }) => {
  for (const { hasTouch, ...size } of shortScreens) {
    const label = `${size.width}x${size.height}${hasTouch ? " touch" : " mouse"}`;
    const context = await browser.newContext({ baseURL, viewport: size, hasTouch });
    try {
      const page = await context.newPage();
      await page.goto("/?scenario=two-routes");
      await injectInsets(page, 0, 21);
      await expect(nav(page)).toBeVisible();
      // Touch screens paint the bar to the edge; the desktop dock floats 16 px above it.
      expect(await paintedNavBottom(page), label).toBeCloseTo(size.height - (hasTouch ? 0 : 16), 0);
      await raiseLiveRoutes(page);
      const panel = (await homePanel(page).boundingBox())!;
      const navBox = (await nav(page).boundingBox())!;
      expect(panel.y + panel.height, label).toBeLessThanOrEqual(navBox.y);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(size.width);

      const landscape = size.width > size.height;
      if (hasTouch && landscape) {
        // The list stays inside the panel's clipped box, shows most of the first
        // route card where it takes taps, and scrolls the last card's end into view.
        const list = homePanel(page).locator("div.overflow-y-auto");
        const listBox = (await list.boundingBox())!;
        const listBottom = listBox.y + listBox.height;
        expect(listBottom, label).toBeLessThanOrEqual(panel.y + panel.height + 0.5);
        const shownPart = (card: { y: number; height: number }) => Math.min(card.y + card.height, listBottom) - Math.max(card.y, listBox.y);
        const first = (await page.getByRole("button", { name: "Track QA route", exact: true }).boundingBox())!;
        expect(shownPart(first), `${label}: first route card`).toBeGreaterThanOrEqual(first.height * 0.75);
        const center = { x: first.x + first.width / 2, y: Math.max(first.y, listBox.y) + shownPart(first) / 2 };
        expect(await hitTestable(page, "[aria-label='Track QA route']", [center]), label).toBe(true);
        await list.evaluate(element => element.scrollTo({ top: element.scrollHeight, behavior: "instant" }));
        const last = (await page.getByRole("button", { name: "Track QA route B", exact: true }).boundingBox())!;
        expect(last.y + last.height, `${label}: last route card`).toBeLessThanOrEqual(listBottom + 0.5);
        expect(shownPart(last), `${label}: last route card`).toBeGreaterThanOrEqual(last.height * 0.75);
      }

      if (landscape) {
        // The open timeline's header takes taps across its width, including where
        // the boarding card and chat button float over the map.
        await page.goto("/?scenario=forward");
        await injectInsets(page, 0, 21);
        await page.addStyleTag({ content: "aside[aria-label='QA fixture controls']{display:none}" });
        await trackRoute(page);
        const chat = page.getByRole("button", { name: "Open live chat", exact: true });
        await expect(chat).toBeVisible();
        const chatBox = (await chat.boundingBox())!;
        const toggle = page.getByRole("button", { name: "Route timeline", exact: true });
        await toggle.click();
        await expect(toggle).toHaveAttribute("aria-expanded", "true");
        // Sample only once the sheet has finished rising; its closed position is never covered.
        await page.locator("[data-map-sheet]").evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished)));
        const box = (await toggle.boundingBox())!;
        expect(box.y, label).toBeGreaterThanOrEqual(0);
        const xs = [0.1, 0.3, 0.5, 0.7, 0.9].map(f => box.x + box.width * f).concat(chatBox.x + chatBox.width / 2);
        const points = xs.flatMap(x => [{ x, y: box.y + 8 }, { x, y: box.y + box.height / 2 }]);
        expect(await hitTestable(page, "[data-map-sheet] > button[aria-controls]", points), `${label}: timeline header covered`).toBe(true);
        await page.keyboard.press("Escape");
        await expect(toggle).toHaveAttribute("aria-expanded", "false");
        await expect(chat).toBeVisible();
        expect(await hitTestable(page, "[aria-label='Open live chat']", [{ x: chatBox.x + chatBox.width / 2, y: chatBox.y + chatBox.height / 2 }]), label).toBe(true);
      }
    } finally {
      await context.close();
    }
  }
});

test("edge: the collapsed route timeline paints and takes pointers only on its header", async ({ page }) => {
  await page.goto("/?scenario=forward");
  await injectInsets(page, 0, 21);
  await trackRoute(page);
  const toggle = page.getByRole("button", { name: "Route timeline", exact: true });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await page.locator("[data-map-sheet]").evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished)));
  const header = (await toggle.boundingBox())!;
  const navBox = (await nav(page).boundingBox())!;
  const { width, height } = page.viewportSize()!;
  // The body below the header is translated behind the navigation. The touch bar
  // covers it; the floating desktop dock leaves it bare beside and under the dock.
  const points = [8, width - 8].flatMap(x => [navBox.y + 8, height - 8].map(y => ({ x, y })));
  const onSheet = await page.evaluate(points => {
    const sheet = document.querySelector("[data-map-sheet]")!;
    return points.filter(({ x, y }) => sheet.contains(document.elementFromPoint(x, y)));
  }, points);
  expect(onSheet).toEqual([]);
  expect(await hitTestable(page, "[data-map-sheet] > button[aria-controls]", [{ x: width / 2, y: header.y + header.height / 2 }])).toBe(true);
  // The clip would cut an outside focus ring, so the keyboard ring sits inside the toggle.
  await toggle.focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  expect(await toggle.evaluate(element => element.matches(":focus-visible") && getComputedStyle(element).outlineOffset)).toBe("-2px");
});

test("edge: chat overlay ends at the navigation instead of under it", async ({ page }) => {
  await page.goto("/?scenario=forward");
  await injectInsets(page);
  await trackRoute(page);
  const open = page.getByRole("button", { name: "Open live chat", exact: true });
  await expect(open).toBeVisible();
  await open.click();
  // The chat overlay is the tracking view's slide-up layer; wait out its entry animation.
  const overlay = page.locator("[data-passenger-tracking] .animate-slide-up");
  await expect(overlay).toHaveCount(1);
  await overlay.evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished)));
  const navBox = (await nav(page).boundingBox())!;
  const box = (await overlay.boundingBox())!;
  expect(box.y + box.height).toBeLessThanOrEqual(navBox.y + 0.5);
});
