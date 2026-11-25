import { chromium } from "@playwright/test";
import { PASSENGER, SURFACE } from "./visual";

// Vite bundles each fixture's dependencies on the first page load and then
// reloads the page, so the first test would otherwise race a cold server.
// This opens every surface once before the tests start.
const pages = [
  { url: `${PASSENGER}/?scenario=forward`, ready: "[data-passenger-workspace]" },
  { url: `${SURFACE}/?surface=landing`, ready: "main" },
  { url: `${SURFACE}/?surface=install`, ready: "main" },
  { url: `${SURFACE}/?surface=admin&role=admin`, ready: "[role=tablist]" },
];

export default async function warmUp() {
  const browser = await chromium.connect(process.env.EKI_VISUAL_WS_ENDPOINT!, { exposeNetwork: "<loopback>" });
  try {
    const page = await browser.newPage();
    for (const { url, ready } of pages) {
      const deadline = Date.now() + 120_000;
      for (;;) {
        await page.goto(url);
        await page.waitForLoadState("networkidle");
        if (await page.locator(ready).count()) break;
        if (Date.now() > deadline) throw new Error(`Warm-up: ${url} did not render ${ready} within 120 s.`);
      }
    }
    // Every admin panel is a separate dynamic import; load each once.
    for (const tab of await page.getByRole("tab").all()) {
      await tab.click();
      await page.waitForLoadState("networkidle");
    }
  } finally {
    await browser.close();
  }
}
