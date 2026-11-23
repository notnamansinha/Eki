import path from "node:path";
import { expect, test as base, type Locator, type Page } from "@playwright/test";

export { expect };

/** The passenger fixture (e2e/fixtures) and the public and admin surfaces (e2e/visual/fixture). */
export const PASSENGER = "http://127.0.0.1:3141";
export const SURFACE = "http://127.0.0.1:3142";

// A fixed instant (a Monday morning in Ahmedabad) so dates, "updated … ago"
// labels and the synthetic telemetry ages render the same in every run.
export const VISUAL_NOW = new Date("2026-11-23T09:30:00+05:30");

// next/font sets these variables in production. The fixtures have no font
// origin, so the image's metric-compatible families stand in (see the guide).
const FONT_STAND_INS = ':root { --font-roboto: "Liberation Sans"; --font-playfair: "Liberation Serif"; }';
// Hides the passenger fixture's own QA controls in screenshots only, so tests can still use them.
const CAPTURE_STYLE = path.join(__dirname, "capture.css");
const NO_ARTWORK_STYLE = path.join(__dirname, "capture-no-artwork.css");

type VisualFixtures = { blockedRequests: string[] };

export const test = base.extend<VisualFixtures>({
  blockedRequests: [async ({ context }, use) => {
    const blocked: string[] = [];
    // Fixtures never leave loopback; an outside request would make a baseline depend on the network.
    await context.route("**/*", route => {
      const url = new URL(route.request().url());
      if (url.hostname === "127.0.0.1") return route.fallback();
      blocked.push(url.origin);
      return route.abort("blockedbyclient");
    });
    await use(blocked);
    expect(blocked, "requests outside loopback").toEqual([]);
  }, { auto: true }],
  page: async ({ page }, use) => {
    await page.clock.setFixedTime(VISUAL_NOW);
    await use(page);
  },
});

/** Opens a fixture URL and applies the font stand-ins. */
export async function open(page: Page, url: string) {
  await page.goto(url);
  await page.addStyleTag({ content: FONT_STAND_INS });
}

/** Waits until fonts and images have loaded, so a capture never catches them half-drawn. */
async function settle(page: Page) {
  // Lazy views (maps, panels) show the fixtures' next/dynamic placeholder until they load.
  await expect(page.getByText("Loading fixture view…")).toHaveCount(0);
  await page.waitForLoadState("networkidle");
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(Array.from(document.images, image => image.complete ? null : new Promise(done => {
      image.addEventListener("load", done, { once: true });
      image.addEventListener("error", done, { once: true });
    })));
  });
}

type CaptureOptions = {
  /** The subtree whose accessibility tree is recorded; the whole page by default. */
  tree?: Locator;
  /** Keep the transit artwork instead of replacing it with a flat tone. */
  showArtwork?: boolean;
  /**
   * Differing pixels tolerated. Every state is pixel-exact except the map
   * tracking views, whose overlays and translucent sheet anti-alias slightly
   * differently from run to run (qa/VISUAL_BASELINES.md, Section 5).
   */
  maxDiffPixels?: number;
};

/**
 * Records one reviewed state: a viewport screenshot and the accessibility tree
 * (roles, names and states a screen reader is given) of the same moment.
 */
export async function capture(page: Page, name: string, options: CaptureOptions = {}) {
  await settle(page);
  // The artwork has its own checks (e2e/passenger-layout/transit-artwork.spec.ts) and the
  // landing baseline shows it; elsewhere a flat tone keeps the baselines small.
  const stylePath = options.showArtwork ? [CAPTURE_STYLE] : [CAPTURE_STYLE, NO_ARTWORK_STYLE];
  // Soft, so a change reports both the picture and the accessibility tree in one run.
  await expect.soft(page).toHaveScreenshot(`${name}.png`, { stylePath, maxDiffPixels: options.maxDiffPixels ?? 0 });
  await expect(options.tree ?? page.locator("body")).toMatchAriaSnapshot({ name: `${name}.aria.yml` });
}

/** True for the touch projects (phone and tablet). */
export function isTouch(page: Page) {
  return page.evaluate(() => matchMedia("(pointer: coarse)").matches);
}
