import { test, expect, type Page } from "@playwright/test";
const routeName = "Ahmedabad University Extended Campus and Science Research Shuttle";
const originName = "Shilp Revanta Residential Campus Main Entrance";
const destinationName = "Gate 12 Ahmedabad University Science and Engineering Campus";
async function view(page: Page, name: string) {
  await page.getByText("QA controls", { exact: true }).click();
  await page.getByLabel("QA view").selectOption(name);
  await page.getByText("QA controls", { exact: true }).click();
}
test.beforeEach(async ({ page }) => {
  await page.route("**/api/**", route => route.fulfill({ json: route.request().url().includes("/places/search") ? { results: [] } : { saved: true } }));
  await page.goto("/");
});

async function publishAge(page: Page, age: number) {
  await page.getByText("QA controls", { exact: true }).click();
  await page.getByRole("button", { name: `Publish age ${age}`, exact: true }).click();
  await page.getByText("QA controls", { exact: true }).click();
}
test("admin and passenger label 90 to 200 second telemetry gaps and recover without reload", async ({ page }, info) => {
  await view(page, "admin");
  await page.getByRole("button", { name: "Open live details for qa-bus" }).click();
  const drawer = page.getByRole("dialog", { name: "Live details for qa-bus" });
  await expect(drawer.getByText("Connected", { exact: true })).toBeVisible();
  await drawer.getByRole("button", { name: "Close live details" }).click();
  for (const age of [90_001, 120_000, 200_000]) {
    await publishAge(page, age);
    await expect(page.getByText("Live location updates delayed", { exact: true })).toBeVisible();
  }
  await page.getByRole("button", { name: "Open live details for qa-bus" }).click();
  await expect(drawer.getByText("Live location updates delayed", { exact: true })).toBeVisible();
  await drawer.getByRole("button", { name: "Close live details" }).click();
  await page.screenshot({ path: info.outputPath("admin-delayed-location.png"), fullPage: true });
  await publishAge(page, 0);
  await expect(page.getByText("Live location updates delayed", { exact: true })).toHaveCount(0);
  await view(page, "passenger");
  await page.getByRole("button", { name: `Track ${routeName}`, exact: true }).click();
  for (const age of [90_001, 120_000, 200_000]) {
    await publishAge(page, age);
    await expect(page.getByText(/Live location updates delayed/)).toBeVisible();
  }
  await publishAge(page, 0);
  await expect(page.getByText(/Live location updates delayed/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Back to home" })).toBeVisible();
});
test("passenger read denial is distinct from telemetry delay and recovers on a new delivery", async ({ page }) => {
  await page.getByRole("button", { name: `Track ${routeName}`, exact: true }).click();
  await page.getByText("QA controls", { exact: true }).click();
  await page.getByLabel("QA scenario").selectOption("detail-denied");
  await page.getByText("QA controls", { exact: true }).click();
  await expect(page.getByText("Live bus data unavailable.", { exact: true })).toBeVisible();
  await expect(page.getByText(/Live location updates delayed/)).toHaveCount(0);
  await publishAge(page, 0);
  await expect(page.getByText("Live bus data unavailable.", { exact: true })).toHaveCount(0);
});
test("long route and endpoint labels remain fully rendered and selectable", async ({ page }, info) => {
  const title = page.getByRole("heading", { name: routeName });
  await expect(title).toBeVisible();
  const clipped = await title.evaluate(el => el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1);
  expect(clipped).toBe(false);
  const endpoints = page.getByText(`${originName} → ${destinationName}`, { exact: true });
  await expect(endpoints).toBeVisible();
  expect(await endpoints.evaluate(el => el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1)).toBe(false);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.screenshot({ path: info.outputPath("route-labels.png"), fullPage: true });
  await page.getByRole("button", { name: `Track ${routeName}`, exact: true }).click();
  await expect(page.getByRole("button", { name: "Back to home" })).toBeVisible();
});
test("tracking keeps the full route name while waiting for live data", async ({ page }, info) => {
  await page.getByRole("button", { name: `Track ${routeName}`, exact: true }).click();
  await page.getByText("QA controls", { exact: true }).click();
  await page.getByLabel("QA scenario").selectOption("empty");
  await page.getByText("QA controls", { exact: true }).click();
  const label = page.getByRole("paragraph").filter({ hasText: new RegExp(`^${routeName}$`) });
  await expect(label).toBeVisible();
  expect(await label.evaluate(el => el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1)).toBe(false);
  await page.screenshot({ path: info.outputPath("tracking-route-label.png") });
});
for (const commit of ["Enter", "blur"]) test(`blank rename ${commit} preserves the original stop and recovers`, async ({ page }, info) => {
  await view(page, "routes");
  await page.getByRole("button", { name: `Edit route ${routeName}` }).click();
  await page.getByRole("button", { name: new RegExp("^" + originName) }).click();
  const input = page.getByRole("textbox", { name: `Rename stop ${originName}` });
  await input.fill("   ");
  if (commit === "Enter") await input.press("Enter");
  else await page.getByLabel("Display Name").click();
  await expect(page.getByRole("alert")).toContainText("Stop name cannot be blank");
  const original = page.getByRole("button", { name: new RegExp("^" + originName) });
  await expect(original).toBeVisible();
  await page.screenshot({ path: info.outputPath(`blank-${commit}.png`), fullPage: true });
  await original.click();
  const retry = page.getByRole("textbox", { name: `Rename stop ${originName}` });
  await retry.fill("Renamed test stop"); await retry.press("Enter");
  await expect(page.getByRole("button", { name: /^Renamed test stop/ })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});
test("history shows actual interruption reasons and honest legacy fallbacks", async ({ page }, info) => {
  await view(page, "history");
  for (const reason of ["Manually ended before the final stop.", "Closed after the ride's inactivity limit was reached.", "The interruption reason was not recorded.", "The interruption reason is unavailable."]) await expect(page.getByText(reason, { exact: true })).toBeVisible();
  await expect(page.getByText(/GPS timeout|phone death|GNSS_TIMEOUT_15M/)).toHaveCount(0);
  await page.screenshot({ path: info.outputPath("history-reasons.png"), fullPage: true });
});
test("measure the actual empty-search notice contrast without guessing its backdrop", async ({ page }, info) => {
  await view(page, "routes"); await page.getByRole("button", { name: `Edit route ${routeName}` }).click();
  await page.getByRole("searchbox", { name: "Search for a stop" }).fill("zzzzqqqqxxxx999");
  const notice = page.getByRole("status").filter({ hasText: "No matching places" });
  await expect(notice).toBeVisible();
  const measured = await notice.evaluate(el => {
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = 1;
    const ctx = canvas.getContext("2d")!;
    function color(css: string) {
      const alpha = /\/\s*([\d.]+)\s*\)/.exec(css)?.[1] ?? /^rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)/.exec(css)?.[1];
      // Convert an opaque color, then compose the original fractional alpha.
      // Reading a translucent pixel first introduces premultiplication rounding.
      const opaque = css.replace(/\/\s*[\d.]+\s*\)/, "/ 1)")
        .replace(/^(rgba\([^,]+,[^,]+,[^,]+,)\s*[\d.]+/, "$1 1");
      ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = opaque; ctx.fillRect(0, 0, 1, 1);
      const v = Array.from(ctx.getImageData(0, 0, 1, 1).data);
      return [v[0], v[1], v[2], alpha ? Number(alpha) : v[3] / 255];
    }
    const layers: { color: string; tag: string }[] = [];
    let node: Element | null = el;
    while (node) { layers.unshift({ color: getComputedStyle(node).backgroundColor, tag: node.tagName }); node = node.parentElement; }
    let bg = [255, 255, 255];
    for (const layer of layers) { const c = color(layer.color); bg = bg.map((v, i) => c[i] * c[3] + v * (1 - c[3])); }
    const css = getComputedStyle(el).color, fg = color(css);
    const text = bg.map((v, i) => fg[i] * fg[3] + v * (1 - fg[3]));
    const lum = (rgb: number[]) => rgb.map(c => c / 255).map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4).reduce((sum, c, i) => sum + c * [.2126, .7152, .0722][i], 0);
    return { css, layers, background: bg, foreground: text, ratio: (lum(text) + .05) / (lum(bg) + .05) };
  });
  await info.attach("contrast.json", { body: JSON.stringify(measured, null, 2), contentType: "application/json" });
  expect(measured.ratio).toBeGreaterThanOrEqual(4.5);
});
test("map movement remains inspectable under isolated four-times CPU throttling", async ({ page }, info) => {
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 }); await cdp.send("Performance.enable");
  await page.getByRole("button", { name: `Track ${routeName}`, exact: true }).click();
  await expect(page.getByLabel("Synthetic map")).toBeVisible();
  for (let i = 0; i < 20; i++) await page.evaluate(() => window.dispatchEvent(new Event("qa-motion")));
  const began = performance.now();
  const snapshot = await page.locator("body").ariaSnapshot({ timeout: 5000 });
  expect(snapshot).toContain("Center on bus");
  const snapshotMs = performance.now() - began;
  const screenshotStart = performance.now();
  await page.screenshot({ path: info.outputPath("map-inspection.png"), timeout: 5000 });
  const metrics = await cdp.send("Performance.getMetrics");
  await info.attach("inspection.json", { body: JSON.stringify({ snapshotMs, screenshotMs: performance.now() - screenshotStart, metrics, sdk: "synthetic", throttle: 4, updates: 20 }), contentType: "application/json" });
  expect(errors).toEqual([]);
});
