import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { readFile } from "node:fs/promises";

async function verifyLocalExport(page: Page, testInfo: TestInfo, role: "passenger" | "driver" | "admin") {
    const healthRequests: string[] = [];
    page.on("request", request => { if (new URL(request.url()).pathname.includes("health")) healthRequests.push(request.url()); });
    await page.goto(`/?traceExport&traceRole=${role}&telemetryTrace=1`);
    const button = page.getByRole("button", { name: "Download telemetry trace" });
    await expect(button).toHaveCount(0);
    await page.getByRole("button", { name: "Approve verification" }).click();
    await expect(button).toBeVisible();
    const before = await page.evaluate(() => window.__ekiTelemetryTrace!.snapshot());
    const downloading = page.waitForEvent("download");
    await button.click();
    const download = await downloading;
    const exported = JSON.parse(await readFile((await download.path())!, "utf8"));
    expect(exported.runId).toBe(before.runId);
    expect(exported.version).toBe(1);
    expect(Array.isArray(exported.records)).toBe(true);
    expect(healthRequests).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath(`${role}-trace-export.png`) });
    await page.getByRole("button", { name: "Synthetic sign out" }).click();
    await expect(button).toHaveCount(0);
}
test("opt-in passenger downloads its own tab trace without protected health", async ({ page }, testInfo) => verifyLocalExport(page, testInfo, "passenger"));
test("opt-in driver downloads its own tab trace without protected health", async ({ page }, testInfo) => verifyLocalExport(page, testInfo, "driver"));
test("opt-in admin downloads its own tab trace without protected health", async ({ page }, testInfo) => verifyLocalExport(page, testInfo, "admin"));
test("opt-in traces retain actual browser online and reduced-motion context", async ({ page, context }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/?telemetryTrace=1");
  await expect.poll(() => page.evaluate(() => Boolean(window.__ekiTelemetryTrace))).toBe(true);
  await page.evaluate(() => window.__ekiTelemetryTrace!.clear());
  try {
    await context.setOffline(true);
    await expect.poll(() => page.evaluate(() => window.__ekiTelemetryTrace!.snapshot().records
      .find(record => record.trigger === "offline"))).toMatchObject({
      event: "browser_lifecycle", browserOnline: false, browserVisibilityState: "visible", browserReducedMotion: true,
    });
  } finally {
    await context.setOffline(false);
  }
  await expect.poll(() => page.evaluate(() => window.__ekiTelemetryTrace!.snapshot().records
    .find(record => record.trigger === "online"))).toMatchObject({ browserOnline: true });
});

test("live fleet details remain reachable below service controls on a short screen", async ({ page }) => {
  await page.goto("/?dashboard");
  await page.getByRole("button", { name: "Approve verification" }).click();
  const details = page.getByRole("button", { name: "Open live details for qa-bus", exact: true });
  await details.click();
  await expect(page.getByRole("dialog", { name: "Live details for qa-bus", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Close live details", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Live details for qa-bus", exact: true })).toHaveCount(0);
  await expect(details).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(await page.evaluate(() => window.innerWidth));
});
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
  expect(pending.filter(event => event.name === "qa-verification").map(event => event.detail.forceRefresh)).toEqual([true, true]);
  await page.getByRole("button", { name: "Approve verification" }).click();
  await expect(page.getByText("Verified buses", { exact: true })).toBeVisible();
  await expect(page.getByText("Verified routes", { exact: true })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect((await events()).filter(event => event.name === "qa-metadata-read")).toHaveLength(4);
  await page.screenshot({ path: testInfo.outputPath("verified-metadata.png") });
});
test.beforeEach(async ({ page }) => {
  await page.route("**/__qa/firestore/feedback**", async route => {
    if (route.request().method() === "PATCH") await route.fulfill({ json: { updated: true, status: "reviewed" } });
    else await route.fulfill({ json: { feedbacks: [entry] } });
  });
});
test("protected data waits for verification and status updates after acknowledgement", async ({ page }) => {
  let acknowledgePatch!: () => void;
  const patchAcknowledgement = new Promise<void>(resolve => { acknowledgePatch = resolve; });
  await page.route("**/__qa/firestore/feedback**", async route => {
    if (route.request().method() !== "PATCH") return route.fallback();
    await patchAcknowledgement;
    await route.fulfill({ json: { updated: true, status: "reviewed" } });
  });
  const attestations: Array<string | undefined> = [];
  page.on("request", request => { if (request.url().includes("/__qa/firestore/feedback")) attestations.push(request.headers()["x-firebase-appcheck"]); });
  const requests: string[] = []; page.on("request", request => { if (request.url().includes("/__qa/firestore/feedback")) requests.push(request.url()); });
  await page.goto("/"); await expect(page.getByText("Signing you in…")).toBeVisible(); expect(requests).toEqual([]);
  await page.getByRole("button", { name: "Approve verification" }).click(); await expect(page.getByText("Browser Passenger")).toBeVisible();
  await page.getByRole("button", { expanded: false }).click(); await page.getByRole("button", { name: "reviewed", exact: true }).click();
  // Busy controls disable before the synthetic Firestore write is dispatched.
  // Observe the actual request, then hold its response to check no optimistic status.
  await expect.poll(() => requests.length).toBe(2);
  await expect(page.getByRole("button", { expanded: true })).toContainText("new");
  await expect(page.getByRole("button", { name: "reviewed", exact: true })).toBeDisabled();
  expect(requests).toHaveLength(2);
  expect(attestations).toEqual([undefined, undefined]);
  acknowledgePatch();
  await expect(page.getByRole("button", { expanded: true })).toContainText("reviewed");
  await expect(page.getByRole("button", { name: "reviewed", exact: true })).toBeDisabled();
});
test("Role verification errors show recovery controls without mounting feedback", async ({ page }) => {
  await page.goto("/"); await expect(page.getByText("Signing you in…")).toBeVisible();
  await page.getByRole("button", { name: "Reject verification" }).click();
  await expect(page.getByRole("alert")).toContainText("We could not verify your access");
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible(); await expect(page.getByText("Browser Passenger")).toHaveCount(0);
  await page.getByRole("button", { name: "Try again" }).click(); await expect(page.getByText("Signing you in…")).toBeVisible();
  await page.getByRole("button", { name: "Approve verification" }).click(); await expect(page.getByText("Browser Passenger")).toBeVisible();
});

test("ten-minute offline access failure recovers on browser online without reload or protected reads before verification", async ({ page, context }, testInfo) => {
  await page.clock.install();
  const requests: string[] = [];
  page.on("request", request => { if (request.url().includes("/__qa/firestore/feedback")) requests.push(request.url()); });
  await page.goto("/?recovery");
  await expect(page.getByRole("button", { name: "Reject network verification" })).toBeEnabled();
  try {
    await context.setOffline(true);
    await page.getByRole("button", { name: "Reject network verification" }).click();
    await expect(page.getByRole("alert")).toContainText("We could not verify your access");
    await page.clock.runFor(600_000);
    await expect(page.getByRole("button", { name: "Approve verification" })).toBeDisabled();
    expect(requests).toEqual([]);
  } finally {
    await context.setOffline(false);
  }
  await expect(page.getByRole("button", { name: "Approve verification" })).toBeEnabled();
  await expect(page.getByText("Signing you in…")).toBeVisible();
  expect(requests).toEqual([]);
  await page.getByRole("button", { name: "Approve verification" }).click();
  await expect(page.getByText("Browser Passenger")).toBeVisible();
  expect(requests).toHaveLength(1);
  await page.screenshot({ path: testInfo.outputPath("access-recovered-online.png") });
});
test("embedded feedback retries Firestore read denial and rejects a failed write", async ({ page }) => {
  let calls = 0;
  await page.route("**/__qa/firestore/feedback**", async route => {
    if (route.request().method() === "PATCH") return route.fulfill({ status: 403, json: { error: "Admin write rejected" } });
    if (++calls === 1) return route.fulfill({ status: 403, json: { error: "Admin read rejected" } });
    return route.fulfill({ json: { feedbacks: [entry] } });
  });
  await page.goto("/?embedded"); await expect(page.getByText("Signing you in…")).toBeVisible();
  await page.getByRole("button", { name: "Approve verification" }).click(); await expect(page.getByText("Admin read rejected")).toBeVisible();
  await page.getByRole("button", { name: /retry/i }).click(); await expect(page.getByText("Browser Passenger")).toBeVisible();
  await page.getByRole("button", { expanded: false }).click(); await page.getByRole("button", { name: "reviewed", exact: true }).click();
  await expect(page.getByText("Admin write rejected")).toBeVisible(); await expect(page.getByRole("button", { name: "reviewed", exact: true })).toBeEnabled();
});
test("account switches hide previous data and wait for fresh verification", async ({ page }) => {
  const tokens: string[] = []; await page.route("**/__qa/firestore/feedback", async route => {
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
  await page.route("**/__qa/firestore/feedback", async route => {
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
  expect(reads).toContain("publicRouteBuses/route:qa-route/buses");
  expect(reads).toContain("liveRouteCatalog/values");
  expect(reads).not.toContain("publicRouteBuses");
  expect(reads).not.toContain("activeBuses");
  await expect(page.getByLabel("Preview count", { exact: true })).toHaveText("1");
  await expect(page.getByLabel("Catalog preview count")).toHaveText("1");
  await page.clock.runFor(221_000); // Sample exceeds five minutes; its server receipt remains fresh.
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

test("End ride early stays reachable by wheel scrolling an expanded card among several live rides (desktop retest, 29 Oct 2026)", async ({ page }, testInfo) => {
  const stops: unknown[] = [];
  await page.route("**/api/shifts/stop", async route => {
    stops.push(JSON.parse(route.request().postData() ?? "{}"));
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ stopped: true, interrupted: true, alreadyInterrupted: false }) });
  });
  await page.goto("/?dashboard&fleet");
  await page.getByRole("button", { name: "Approve verification" }).click();
  const cards = page.locator("[data-fleet-card]");
  await expect(cards).toHaveCount(3);
  // Expand every card: the list now holds far more than the sidebar height.
  for (const toggle of await page.locator("[data-fleet-card] button[aria-expanded]").all()) await toggle.click();
  const endRide = cards.nth(2).getByRole("button", { name: "End ride early", exact: true });
  // A human scrolls with the wheel; programmatic scrollIntoView would hide clipping.
  // Point at the visible part of whichever element actually scrolls the fleet
  // (the list on desktop, the sidebar on phones).
  const pointer = await cards.first().evaluate(element => {
    let node = element.parentElement;
    while (node && !/(auto|scroll)/.test(getComputedStyle(node).overflowY)) node = node.parentElement;
    const rect = node!.getBoundingClientRect();
    const top = Math.max(rect.top, 0), bottom = Math.min(rect.bottom, innerHeight);
    return { x: rect.x + rect.width / 2, y: (top + bottom) / 2 };
  });
  await page.mouse.move(pointer.x, pointer.y);
  for (let attempt = 0; attempt < 30 && !(await endRide.isVisible() && await endRide.evaluate(element => {
    const rect = element.getBoundingClientRect();
    const top = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    return top === element || element.contains(top);
  })); attempt++) await page.mouse.wheel(0, 250);
  await expect(endRide).toBeInViewport();
  // Each card keeps its full height; nothing is squashed and clipped.
  for (const card of await cards.all()) {
    expect(await card.evaluate(element => element.scrollHeight - element.clientHeight)).toBeLessThanOrEqual(1);
  }
  await page.screenshot({ path: testInfo.outputPath("end-ride-reachable.png") });
  await endRide.click({ trial: false });
  await page.getByRole("dialog", { name: "End ride early?" }).getByRole("button", { name: "End ride", exact: true }).click();
  await expect(page.getByText(/ended early and was saved to history/)).toBeVisible();
  expect(stops).toEqual([expect.objectContaining({ busId: "qa-bus-3", sessionId: "qa-session-3", driverId: "qa-driver-3" })]);
});
test("End ride early is offered from the live details drawer too", async ({ page }) => {
  await page.route("**/api/shifts/stop", route => route.fulfill({ status: 200, contentType: "application/json",
    body: JSON.stringify({ stopped: true, interrupted: true, alreadyInterrupted: false }) }));
  await page.goto("/?dashboard&fleet");
  await page.getByRole("button", { name: "Approve verification" }).click();
  await page.getByRole("button", { name: "Open live details for qa-bus-2", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: "Live details for qa-bus-2", exact: true });
  await drawer.getByRole("button", { name: "End ride early", exact: true }).click();
  await expect(drawer).toHaveCount(0);
  await page.getByRole("dialog", { name: "End ride early?" }).getByRole("button", { name: "End ride", exact: true }).click();
  await expect(page.getByText(/qa-session-2 ended early/)).toBeVisible();
});
