import { test, expect, type Page, type Route } from "@playwright/test";
// Adversarial browser checks: backend failures, slow and offline networks,
// repeated input and navigation against the real admin and passenger panels.
const routeName = "Ahmedabad University Extended Campus and Science Research Shuttle";
const place = { name: "Synthetic Library", address: "Synthetic campus", lat: 23.02, lng: 72.02 };
async function view(page: Page, name: string) {
  await page.getByText("QA controls", { exact: true }).click();
  await page.getByLabel("QA view").selectOption(name);
  await page.getByText("QA controls", { exact: true }).click();
}
const errors: string[] = [];
test.beforeEach(async ({ page }) => {
  errors.length = 0;
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/**", route => route.fulfill({ json: route.request().url().includes("/places/search") ? { results: [] } : { saved: true } }));
  await page.goto("/");
});
test.afterEach(() => { expect(errors).toEqual([]); });
async function openEditor(page: Page) {
  await view(page, "routes");
  await page.getByRole("button", { name: `Edit route ${routeName}` }).click();
  return page.getByRole("searchbox", { name: "Search for a stop" });
}

test("place search 500 shows an error and a later query recovers", async ({ page }) => {
  let calls = 0;
  await page.route("**/api/places/search**", route => ++calls === 1
    ? route.fulfill({ status: 500, json: { error: "Upstream exploded", code: "INTERNAL" } })
    : route.fulfill({ json: { results: [place] } }));
  const search = await openEditor(page);
  await search.fill("libr");
  await expect(page.getByRole("alert")).toContainText("Upstream exploded");
  await search.fill("library");
  await expect(page.getByRole("button", { name: /Synthetic Library/ })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("non-JSON gateway errors and malformed success bodies never crash the editor", async ({ page }) => {
  let calls = 0;
  await page.route("**/api/places/search**", route => {
    calls++;
    if (calls === 1) return route.fulfill({ status: 502, contentType: "text/html", body: "<html>Bad gateway</html>" });
    if (calls === 2) return route.fulfill({ status: 200, contentType: "application/json", body: "{not json" });
    if (calls === 3) return route.fulfill({ status: 200, contentType: "application/json", body: "null" });
    return route.fulfill({ json: { results: "not-an-array" } });
  });
  const search = await openEditor(page);
  await search.fill("gate");
  await expect(page.getByRole("alert")).toContainText("HTTP 502");
  await search.fill("gate2");
  await expect(page.getByRole("alert")).toContainText("invalid response");
  await search.fill("gate3");
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByRole("alert")).not.toContainText(/Cannot read|undefined|null/);
  await search.fill("gate4");
  await expect(page.getByRole("status").filter({ hasText: "No matching places" })).toBeVisible();
});

test("a slow stale place response never replaces newer results", async ({ page }) => {
  await page.route("**/api/places/search**", async (route: Route) => {
    const query = new URL(route.request().url()).searchParams.get("q");
    if (query === "stale") {
      await new Promise(resolve => setTimeout(resolve, 2_500));
      return route.fulfill({ json: { results: [{ ...place, name: "Stale Place" }] } }).catch(() => {});
    }
    return route.fulfill({ json: { results: [{ ...place, name: "Fresh Place" }] } });
  });
  const search = await openEditor(page);
  await search.fill("stale");
  await page.waitForRequest(request => request.url().includes("q=stale"));
  await search.fill("fresh");
  await expect(page.getByRole("button", { name: /Fresh Place/ })).toBeVisible();
  await page.waitForTimeout(3_000);
  await expect(page.getByRole("button", { name: /Stale Place/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Fresh Place/ })).toBeVisible();
});

test("offline place search reports the connection and recovers once online", async ({ page, context }) => {
  await page.unroute("**/api/**");
  await page.route("**/api/**", route => route.fulfill({ json: { results: [place] } }));
  const search = await openEditor(page);
  try {
    await context.setOffline(true);
    // Routed requests bypass the offline emulation, so fail the request as the network would.
    await page.route("**/api/places/search**", route => route.abort("internetdisconnected"));
    await search.fill("offline");
    await expect(page.getByRole("alert")).toContainText("could not be reached");
  } finally {
    await page.unroute("**/api/places/search**");
    await context.setOffline(false);
  }
  await search.fill("online");
  await expect(page.getByRole("button", { name: /Synthetic Library/ })).toBeVisible();
});

test("route save 500 keeps the editor open with an error and the retry succeeds", async ({ page }) => {
  const puts: string[] = [];
  await page.route("**/api/routes/**", async route => {
    if (route.request().method() !== "PUT") return route.fallback();
    puts.push(route.request().postDataJSON().saveId);
    if (puts.length === 1) return route.fulfill({ status: 500, json: { error: "Route save exploded", code: "INTERNAL" } });
    return route.fulfill({ json: { status: "succeeded", saved: true, saveId: puts.at(-1), routeId: "qa-route", configVersion: 1,
      geometryVersion: 1, geometryReused: false, polyline: "abc", distanceMeters: 1, duration: "1s" } });
  });
  await openEditor(page);
  const update = page.getByRole("button", { name: "Update", exact: true });
  await update.click();
  await expect(page.getByText(/Failed to save: Route save exploded/)).toBeVisible();
  await page.getByRole("button", { name: /^(OK|Close|Dismiss)$/ }).first().click();
  await expect(update).toBeEnabled();
  await update.click();
  await expect(page.getByText("Route updated!")).toBeVisible();
  expect(puts).toHaveLength(2);
});

test("a dropped route save reconciles with the same save id instead of duplicating", async ({ page }) => {
  const puts: string[] = []; const polls: string[] = [];
  await page.route("**/api/routes/**", async route => {
    const request = route.request();
    if (request.method() === "PUT") {
      puts.push(request.postDataJSON().saveId);
      if (puts.length === 1) return route.abort("connectionreset");
      return route.fulfill({ json: { status: "succeeded", saved: true, saveId: puts.at(-1), routeId: "qa-route", configVersion: 1,
        geometryVersion: 1, geometryReused: false, polyline: "abc", distanceMeters: 1, duration: "1s" } });
    }
    if (request.url().includes("/save-operations/")) {
      polls.push(request.url());
      return route.fulfill({ status: 404, json: { error: "No such save", code: "SAVE_OPERATION_NOT_FOUND" } });
    }
    return route.fallback();
  });
  await openEditor(page);
  await page.getByRole("button", { name: "Update", exact: true }).click();
  await expect(page.getByText("Route updated!")).toBeVisible();
  expect(puts).toHaveLength(2);
  expect(puts[1]).toBe(puts[0]);
  expect(polls.length).toBeGreaterThanOrEqual(1);
});

test("rapid double activation of Update sends one save", async ({ page }) => {
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  const puts: string[] = [];
  await page.route("**/api/routes/**", async route => {
    if (route.request().method() !== "PUT") return route.fallback();
    puts.push(route.request().postDataJSON().saveId);
    await gate;
    await route.fulfill({ json: { status: "succeeded", saved: true, saveId: puts.at(-1), routeId: "qa-route", configVersion: 1,
      geometryVersion: 1, geometryReused: false, polyline: "abc", distanceMeters: 1, duration: "1s" } });
  });
  await openEditor(page);
  const update = page.getByRole("button", { name: "Update", exact: true });
  await update.dblclick();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: /Saving/ })).toBeDisabled();
  await page.waitForTimeout(500);
  expect(puts).toHaveLength(1);
  release();
  await expect(page.getByText("Route updated!")).toBeVisible();
  expect(puts).toHaveLength(1);
});

test("route delete 500 reports the failure and leaves the route listed", async ({ page }) => {
  await page.route("**/api/routes/**", route => route.request().method() === "DELETE"
    ? route.fulfill({ status: 500, json: { error: "Delete exploded" } }) : route.fallback());
  await view(page, "routes");
  await page.getByRole("button", { name: `Delete route ${routeName}` }).click();
  await page.getByRole("dialog").getByRole("button", { name: /delete/i }).last().click();
  await expect(page.getByText(/Failed to delete: Delete exploded/)).toBeVisible();
  // The error must be the only, clickable dialog: not dimmed behind the confirmation backdrop.
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await page.getByRole("button", { name: "OK", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: `Edit route ${routeName}` })).toBeAttached();
});

test("rate-limited place search shows the wait message and hostile place names render as text", async ({ page }) => {
  let calls = 0;
  const hostile = `<img src=x onerror="window.__pwned=1">${"‮"}evil`;
  await page.route("**/api/places/search**", route => ++calls === 1
    ? route.fulfill({ status: 429, headers: { "Retry-After": "60" }, json: { error: "slow down", code: "PLACE_SEARCH_RATE_LIMITED" } })
    : route.fulfill({ json: { results: [{ name: hostile, lat: 23.03, lng: 72.03 }, { name: "No coordinates", lat: "x", lng: null }] } }));
  const search = await openEditor(page);
  await search.fill("rate");
  await expect(page.getByRole("alert")).toContainText("Too many searches");
  await search.fill("rated");
  await page.getByRole("button", { name: /No coordinates/ }).click();
  await expect(page.getByText(/does not include valid map coordinates/)).toBeVisible();
  await page.getByRole("button", { name: "OK", exact: true }).click();
  await search.fill("rated again");
  await page.getByRole("button", { name: /evil/ }).click();
  await expect(page.getByRole("button", { name: /onerror/ }).first()).toBeVisible();
  expect(await page.evaluate(() => (window as typeof window & { __pwned?: number }).__pwned)).toBeUndefined();
});

test("browser back and forward from tracking keep the app usable", async ({ page }) => {
  await page.getByRole("button", { name: `Track ${routeName}`, exact: true }).click();
  await expect(page.getByRole("button", { name: "Back to home" })).toBeVisible();
  const before = page.url();
  await page.goBack().catch(() => null);
  if (page.url() !== before) await page.goForward();
  await expect(page.getByRole("button", { name: `Track ${routeName}`, exact: true }).or(page.getByRole("button", { name: "Back to home" }))).toBeVisible();
});

test("passenger tracking survives offline toggles and window resizes without overflow", async ({ page, context }) => {
  await page.getByRole("button", { name: `Track ${routeName}`, exact: true }).click();
  await expect(page.getByRole("button", { name: "Back to home" })).toBeVisible();
  // The shell's back button renders before the lazy tracking map loads. This
  // case tests an established tracking view offline, so wait for that module
  // to mount before cutting the network used to download it from Vite.
  await expect(page.getByLabel("Synthetic map", { exact: true })).toBeVisible();
  try {
    await context.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event("offline")));
    await page.setViewportSize({ width: 320, height: 640 });
    await expect(page.getByRole("button", { name: "Back to home" })).toBeVisible();
  } finally {
    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
  }
  await page.setViewportSize({ width: 1024, height: 600 });
  await page.setViewportSize({ width: 320, height: 640 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Back to home" }).click();
  await expect(page.getByRole("button", { name: `Track ${routeName}`, exact: true })).toBeVisible();
});

test("two tabs track independently and closing one leaves the other live", async ({ context }) => {
  const first = await context.newPage(); const second = await context.newPage();
  for (const tab of [first, second]) {
    tab.on("pageerror", error => errors.push(error.message));
    await tab.route("**/api/**", route => route.fulfill({ json: {} }));
    await tab.goto("/");
  }
  await first.getByRole("button", { name: `Track ${routeName}`, exact: true }).click();
  await expect(first.getByRole("button", { name: "Back to home" })).toBeVisible();
  await expect(second.getByRole("button", { name: `Track ${routeName}`, exact: true })).toBeVisible();
  await second.close();
  await first.getByText("QA controls", { exact: true }).click();
  await first.getByRole("button", { name: "Publish moving update" }).click();
  await expect(first.getByRole("button", { name: "Back to home" })).toBeVisible();
});

test("reload while tracking returns to a working home screen", async ({ page }) => {
  await page.getByRole("button", { name: `Track ${routeName}`, exact: true }).click();
  await page.reload();
  await expect(page.getByRole("button", { name: `Track ${routeName}`, exact: true })).toBeVisible();
  await page.getByRole("button", { name: `Track ${routeName}`, exact: true }).click();
  await expect(page.getByRole("button", { name: "Back to home" })).toBeVisible();
});
