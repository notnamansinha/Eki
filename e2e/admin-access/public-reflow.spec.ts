import { expect, test, type Page } from "@playwright/test";

// Issue #521: authored copy on the public pages must reflow at 320-360px even
// when it holds one long unbroken token (a URL, a compound word, a translation).
const LONG_TOKEN = "Donaudampfschifffahrtselektrizitätenhauptbetriebswerkbauunterbeamtengesellschaft";

// The install page shows different copy per device; cover every branch.
const PLATFORMS = {
  desktop: undefined,
  android: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36",
  "iPhone Safari": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  "iPhone Chrome": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0 Mobile/15E148 Safari/604.1",
};

/** Appends the token to every single-text-node element, as the issue's probe does, and returns the horizontal overflow. */
async function overflowWithLongToken(page: Page) {
  return page.evaluate(token => {
    // The fixture's own controls are not part of the page under test.
    document.querySelector('aside[aria-label="Synthetic verification controls"]')?.remove();
    document.querySelectorAll("h1,h2,h3,button,a,label,li,p").forEach(el => {
      if (el.childNodes.length === 1 && el.firstChild!.nodeType === Node.TEXT_NODE) el.textContent += ` ${token}`;
    });
    return document.documentElement.scrollWidth - document.documentElement.clientWidth;
  }, LONG_TOKEN);
}

for (const width of [320, 360]) {
  for (const [platform, userAgent] of Object.entries(PLATFORMS)) {
    test(`install page reflows a long unbroken token at ${width}px on ${platform}`, async ({ browser, baseURL }) => {
      const context = await browser.newContext({ baseURL, userAgent, viewport: { width, height: 800 } });
      try {
        const page = await context.newPage();
        await page.goto("/?install");
        const heading = page.getByRole("heading", { name: "Install Eki", exact: true });
        await expect(heading).toBeVisible();
        await expect(page.getByText("Checking your device…")).toHaveCount(0);
        // Ordinary copy keeps its shape: the heading stays on one line.
        expect(await heading.evaluate(h1 => h1.getBoundingClientRect().height / parseFloat(getComputedStyle(h1).lineHeight))).toBeLessThan(1.5);
        expect(await overflowWithLongToken(page)).toBeLessThanOrEqual(0);
      } finally { await context.close(); }
    });
  }

  test(`landing page reflows a long unbroken token at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/?landing&restoreHang");
    await expect(page.getByRole("heading", { name: "Track your campus bus" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue with Google", exact: true })).toBeEnabled();
    expect(await overflowWithLongToken(page)).toBeLessThanOrEqual(0);
  });
}
