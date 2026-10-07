import { expect, test } from "@playwright/test";
test("healthy short tab switches keep fleet data without another handshake or read", async ({ page }) => {
  await page.clock.install(); await page.goto("/?resume");
  await page.getByRole("button", { name: "Approve verification" }).click();
  await expect(page.getByText("Live qa-bus", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Connection state")).toHaveText("Ready");
  const before = await page.getByLabel("Socket stats").textContent();
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.clock.runFor(1000);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    document.dispatchEvent(new Event("visibilitychange")); window.dispatchEvent(new Event("online"));
  });
  await page.clock.runFor(6000);
  await expect(page.getByLabel("Socket stats")).toHaveText(before!);
  await expect(page.getByText("Live qa-bus", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Connection state")).toHaveText("Ready");
});
test("long suspension makes one debounced handshake and receives a fresh fleet snapshot", async ({ page }) => {
  await page.clock.install(); await page.goto("/?resume");
  await page.getByRole("button", { name: "Approve verification" }).click();
  await expect(page.getByLabel("Connection state")).toHaveText("Ready");
  const readsBefore = Number((await page.getByLabel("Socket stats").textContent())!.split(":")[2]);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.clock.runFor(31_000);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(page.getByLabel("Socket stats")).toHaveText(`0:0:${readsBefore}`);
  await page.clock.runFor(2000);
  await expect(page.getByLabel("Socket stats")).toContainText("1:1:");
  await expect(page.getByText("Live qa-bus", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Connection state")).toHaveText("Ready");
  expect(Number((await page.getByLabel("Socket stats").textContent())!.split(":")[2])).toBeGreaterThan(readsBefore);
});
const entry = { id: "feedback", userId: "passenger", userName: "Browser Passenger", type: "general", busId: null,
  driverId: null, sessionId: null, rating: null, comment: "Browser verification", timestamp: null, status: "new" };
test("fleet and route denial retries share fresh verification before resubscribing", async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    const events: unknown[] = [];
    Object.assign(window, { qaAccessEvents: events });
    for (const name of ["qa-verification", "qa-metadata-read"]) {
      window.addEventListener(name, event => events.push({ name, detail: (event as CustomEvent).detail }));
    }
  });
  await page.goto("/?metadata");
  await page.getByRole("button", { name: "Approve verification" }).click();
  await expect(page.getByRole("alert")).toHaveCount(2);
  await page.getByRole("button", { name: "Retry fleet access" }).click();
  await expect(page.getByText("Signing you in…")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Fleet and routes" })).toHaveCount(0);
  // The gate closes synchronously; dynamic module loading starts the SDK call
  // later. Observe that pending call before asserting its exact count.
  await expect(page.getByRole("button", { name: "Approve verification" })).toBeEnabled();
  const events = () => page.evaluate(() => (window as typeof window & { qaAccessEvents: Array<{ name: string; detail: { forceRefresh?: boolean } }> }).qaAccessEvents);
  const pending = await events();
  expect(pending.filter(event => event.name === "qa-metadata-read")).toHaveLength(2);
  expect(pending.filter(event => event.name === "qa-verification").map(event => event.detail.forceRefresh)).toEqual([false, true]);
  await page.getByRole("button", { name: "Approve verification" }).click();
  await expect(page.getByText("Verified buses", { exact: true })).toBeVisible();
  await expect(page.getByText("Verified routes", { exact: true })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect((await events()).filter(event => event.name === "qa-metadata-read")).toHaveLength(4);
  await page.screenshot({ path: testInfo.outputPath("verified-metadata.png") });
});
test.beforeEach(async ({ page }) => {
  await page.route("**/api/v2/feedback**", async route => {
    if (route.request().method() === "PATCH") await route.fulfill({ json: { updated: true, status: "reviewed" } });
    else await route.fulfill({ json: { feedbacks: [entry] } });
  });
});
test("protected data waits for verification and status updates after acknowledgement", async ({ page }) => {
  const requests: string[] = []; page.on("request", request => { if (request.url().includes("/api/v2/feedback")) requests.push(request.url()); });
  await page.goto("/"); await expect(page.getByText("Signing you in…")).toBeVisible(); expect(requests).toEqual([]);
  await page.getByRole("button", { name: "Approve verification" }).click(); await expect(page.getByText("Browser Passenger")).toBeVisible();
  await page.getByRole("button", { expanded: false }).click(); await page.getByRole("button", { name: "reviewed", exact: true }).click();
  await expect(page.getByRole("button", { name: "reviewed", exact: true })).toBeDisabled();
  expect(requests).toHaveLength(2);
});
test("App Check errors show recovery controls without mounting feedback", async ({ page }) => {
  await page.goto("/"); await expect(page.getByText("Signing you in…")).toBeVisible();
  await page.getByRole("button", { name: "Reject verification" }).click();
  await expect(page.getByRole("alert")).toContainText("Security verification is unavailable");
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible(); await expect(page.getByText("Browser Passenger")).toHaveCount(0);
  await page.getByRole("button", { name: "Try again" }).click(); await expect(page.getByText("Signing you in…")).toBeVisible();
  await page.getByRole("button", { name: "Approve verification" }).click(); await expect(page.getByText("Browser Passenger")).toBeVisible();
});
test("embedded feedback retries GET denial and rejects a failed PATCH", async ({ page }) => {
  let calls = 0;
  await page.route("**/api/v2/feedback**", async route => {
    if (route.request().method() === "PATCH") return route.fulfill({ status: 403, json: { error: "Admin write rejected" } });
    if (++calls === 1) return route.fulfill({ status: 403, json: { error: "Admin read rejected" } });
    return route.fulfill({ json: { feedbacks: [entry] } });
  });
  await page.goto("/?embedded"); await expect(page.getByText("Signing you in…")).toBeVisible();
  await page.getByRole("button", { name: "Approve verification" }).click(); await expect(page.getByText("Admin read rejected")).toBeVisible();
  await page.getByRole("button", { name: /retry/i }).click(); await expect(page.getByText("Browser Passenger")).toBeVisible();
  await page.getByRole("button", { expanded: false }).click(); await page.getByRole("button", { name: "reviewed", exact: true }).click();
  await expect(page.getByText("Admin write rejected")).toBeVisible(); await expect(page.getByRole("button", { name: "new", exact: true })).toBeDisabled();
});
test("account switches hide previous data and wait for fresh verification", async ({ page }) => {
  const tokens: string[] = []; await page.route("**/api/v2/feedback", async route => {
    tokens.push(route.request().headers().authorization); await route.fulfill({ json: { feedbacks: [entry] } });
  });
  await page.goto("/"); await expect(page.getByText("Signing you in…")).toBeVisible();
  await page.getByRole("button", { name: "Approve verification" }).click(); await expect(page.getByText("Browser Passenger")).toBeVisible();
  await page.getByRole("button", { name: "Switch account" }).click(); await expect(page.getByText("Browser Passenger")).toHaveCount(0);
  await page.getByRole("button", { name: "Approve verification" }).click(); await expect(page.getByText("Browser Passenger")).toBeVisible();
  expect(tokens).toEqual(["Bearer token-qa-admin", "Bearer token-qa-second"]);
});

test("same-account verification hides and reloads protected feedback", async ({ page }) => {
  let reads = 0;
  await page.route("**/api/v2/feedback", async route => {
    reads++; await route.fulfill({ json: { feedbacks: [{ ...entry, userName: `Session ${reads}` }] } });
  });
  await page.goto("/"); await page.getByRole("button", { name: "Approve verification" }).click();
  await expect(page.getByText("Session 1")).toBeVisible();
  await page.getByRole("button", { name: "Reverify account" }).click();
  await expect(page.getByText("Session 1")).toHaveCount(0); await expect(page.getByText("Signing you in…")).toBeVisible();
  expect(reads).toBe(1);
  await page.getByRole("button", { name: "Approve verification" }).click();
  await expect(page.getByText("Session 2")).toBeVisible(); expect(reads).toBe(2);
});

test("route projection uses receipt freshness for both preview and catalog and expires silently", async ({ page }) => {
  await page.addInitScript(() => {
    const reads: string[] = []; Object.assign(window, { qaRtdbReads: reads });
    window.addEventListener("qa-rtdb-read", event => reads.push((event as CustomEvent).detail.path));
  });
  await page.clock.install(); await page.goto("/?projection");
  await page.getByRole("button", { name: "Approve verification" }).click();
  await page.getByRole("button", { name: "Publish preview" }).click();
  const reads = await page.evaluate(() => (window as typeof window & { qaRtdbReads: string[] }).qaRtdbReads);
  expect(reads).toContain("publicRouteBuses/qa-route/buses");
  expect(reads).toContain("liveRouteCatalog/values");
  expect(reads).not.toContain("publicRouteBuses");
  expect(reads).not.toContain("activeBuses");
  await expect(page.getByLabel("Preview count", { exact: true })).toHaveText("1");
  await expect(page.getByLabel("Catalog preview count")).toHaveText("1");
  await page.clock.runFor(11_000); // Sample is now stale, but receipt remains fresh.
  await expect(page.getByLabel("Preview count", { exact: true })).toHaveText("1");
  await page.clock.runFor(49_001);
  await expect(page.getByLabel("Preview count", { exact: true })).toHaveText("0");
  await expect(page.getByLabel("Catalog preview count")).toHaveText("0");
});
test("route projection preserves coalesced return completion and hides it during reverification", async ({ page }) => {
  await page.goto("/?projection"); await page.getByRole("button", { name: "Approve verification" }).click();
  await page.getByRole("button", { name: "Publish automatic return" }).click();
  await expect(page.getByLabel("Joined session state")).toHaveText("completed");
  await page.getByRole("button", { name: "Reverify account" }).click();
  await expect(page.getByLabel("Joined session state")).toHaveCount(0);
  await expect(page.getByText(/Signing you in/)).toBeVisible();
  await page.getByRole("button", { name: "Approve verification" }).click();
  await expect(page.getByLabel("Joined session state")).toHaveText("completed");
});
