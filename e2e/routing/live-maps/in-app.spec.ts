import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { decodePolyline } from "../../../frontend/src/lib/polyline";
const probe = JSON.parse(readFileSync("artifacts/routing-provider/result.json", "utf8"));
test.afterEach(async ({ page }, info) => {
  const snapshot = await page.evaluate(() => (window as any).__ekiInAppMaps?.snapshot()).catch(() => null);
  await info.attach("last-real-sdk-snapshot", { body: JSON.stringify(snapshot, null, 2), contentType: "application/json" });
});
test("real Eki passenger/admin Maps SDK renders directional roads and stable simulated markers", async ({ page }, info) => {
  const errors: string[] = [], blocked: string[] = [], providers = new Map<string, number>();
  const safe = (message: string) => message.replace(/AIza[\w-]+/g, "[redacted]").replace(/key=[^&\s]+/g, "key=[redacted]");
  page.on("pageerror", error => { errors.push(safe(error.message)); console.log("In-app replay error:", safe(error.message)); });
  page.on("console", message => {
    if (message.type() === "error") errors.push(safe(message.text()));
  });
  await page.context().grantPermissions([], { origin: "http://127.0.0.1:3163" });
  await page.route("**/*", async request => {
    const url = new URL(request.request().url());
    if (["127.0.0.1", "localhost"].includes(url.hostname) && url.port === "3163") return request.continue();
    // Real Maps SDK/tiles/traffic only. No Firebase, Eki backend, or new Routes calls.
    if (url.hostname === "maps.googleapis.com" || url.hostname === "maps.gstatic.com" ||
        url.hostname.endsWith(".googleapis.com") && /^(?:maps|khms\d*|streetviewpixels-pa)\./.test(url.hostname) ||
        ["fonts.googleapis.com", "fonts.gstatic.com"].includes(url.hostname)) {
      providers.set(url.hostname, (providers.get(url.hostname) ?? 0) + 1);
      return request.continue();
    }
    blocked.push(url.hostname); return request.abort();
  });
  await page.goto("/?telemetryTrace=1");
  const sdk = () => page.evaluate(() => (window as any).__ekiInAppMaps?.snapshot());
  await expect.poll(async () => {
    if (errors.length) throw new Error(errors.join("; "));
    return (await sdk())?.lines.length ?? 0;
  }, { timeout: 40_000 }).toBe(6);
  const assertDirection = async (direction: "forward" | "reverse") => {
    const expected = decodePolyline(probe.directions.find((item: any) => item.direction === direction).encodedPolyline);
    await expect.poll(async () => (await sdk()).lines.filter((line: any) => JSON.stringify(line.path) === JSON.stringify(expected)).length).toBe(4);
    for (const view of ["Eki passenger map", "Eki admin map"]) {
      await expect.poll(async () => (await sdk()).lines.filter((line: any) => line.view === view && JSON.stringify(line.path) === JSON.stringify(expected)).length).toBe(2);
      const lines = (await sdk()).lines.filter((line: any) => line.view === view);
      expect(lines.filter((line: any) => line.color === "#71717a").map((line: any) => line.path)).toEqual([expected]);
      const blue = lines.filter((line: any) => line.color === "#3b82f6");
      expect(blue).toHaveLength(1);
      expect(blue[0].path.length).toBeGreaterThanOrEqual(2);
      expect(blue[0].path.length).toBeLessThan(expected.length);
    }
    await expect.poll(async () => (await sdk()).markers.filter((marker: any) => marker.title.includes("SIMULATED-BUS")).length).toBe(2);
  };
  await assertDirection("forward");
  await expect.poll(async () => (await sdk()).maps.filter((map: any) => map.tilesLoaded).length, { timeout: 30_000 }).toBe(2);
  await expect.poll(async () => {
    const markers = (await sdk()).markers.filter((marker: any) => marker.title.includes("SIMULATED-BUS"));
    return markers.length === 2 && markers.every((marker: any) => typeof marker.visualOffsetPx === "number" && marker.visualOffsetPx < 3);
  }).toBe(true);
  await page.screenshot({ path: info.outputPath("eki-in-app-forward.png"), fullPage: true });
  // Stop progress is supplied by the backend-style tuple at simulated arrival.
  const firstLeg = (await sdk()).lines.filter((line: any) => line.color === "#3b82f6");
  await page.getByRole("button", { name: "Reach next stop", exact: true }).click();
  await expect.poll(async () => {
    const blue = (await sdk()).lines.filter((line: any) => line.color === "#3b82f6");
    return blue.length === 2 && blue.every((line: any, index: number) => JSON.stringify(line.path) !== JSON.stringify(firstLeg[index].path));
  }).toBe(true);
  const secondLeg = (await sdk()).lines.filter((line: any) => line.color === "#3b82f6");
  expect(secondLeg[0].path).toEqual(secondLeg[1].path);
  for (let i = 0; i < 2; i++) expect(secondLeg[i].path[0]).toEqual(firstLeg[i].path.at(-1));
  const adminTileLoads = (await sdk()).maps.find((map: any) => map.view === "Eki admin map").tileLoads;
  await page.getByRole("region", { name: "Eki admin map", exact: true }).getByTitle(/^SIMULATED-BUS —/).click();
  await expect.poll(async () => (await sdk()).maps.find((map: any) => map.view === "Eki admin map")?.zoom).toBe(15);
  await expect.poll(async () => (await sdk()).maps.find((map: any) => map.view === "Eki admin map")?.tileLoads, { timeout: 30_000 }).toBeGreaterThan(adminTileLoads);
  await page.screenshot({ path: info.outputPath("eki-in-app-next-leg.png"), fullPage: true });
  await page.getByRole("button", { name: "Open live details for SIMULATED-BUS" }).click();
  await expect(page.getByRole("dialog", { name: "Live details for SIMULATED-BUS" })).toBeVisible();
  await page.getByRole("button", { name: "Close live details", exact: true }).click();
  const before = (await sdk()).markers.filter((marker: any) => marker.title.includes("SIMULATED-BUS"));
  const roadObjectsBeforeFix = (await sdk()).observedPolylineCount;
  await page.getByRole("button", { name: "Next fix", exact: true }).click();
  await expect.poll(async () => {
    const next = (await sdk()).markers.filter((marker: any) => marker.title.includes("SIMULATED-BUS"));
    return next.length === 2 && next.every((marker: any, index: number) => JSON.stringify(marker.position) !== JSON.stringify(before[index].position));
  }).toBe(true);
  expect((await sdk()).observedPolylineCount).toBe(roadObjectsBeforeFix);
  await page.getByRole("button", { name: "B → A", exact: true }).click();
  await assertDirection("reverse");
  await expect.poll(async () => (await sdk()).maps.filter((map: any) => map.tilesLoaded).length, { timeout: 30_000 }).toBe(2);
  await page.screenshot({ path: info.outputPath("eki-in-app-return.png"), fullPage: true });
  await page.getByRole("button", { name: "Low-confidence fix", exact: true }).click();
  await expect.poll(async () => (await sdk()).markers.filter((marker: any) => marker.title.includes("updating route position")).length).toBe(2);
  await expect.poll(async () => (await sdk()).markers.filter((marker: any) => marker.title.includes("approximate GNSS position")).length, { timeout: 5000 }).toBe(2);
  await page.getByRole("button", { name: "Next fix", exact: true }).click();
  await expect.poll(async () => (await sdk()).markers.filter((marker: any) => marker.title.includes("SIMULATED-BUS") && !marker.title.includes("approximate") && !marker.title.includes("updating")).length).toBe(2);
  const target = decodePolyline(probe.directions[1].encodedPolyline)[21];
  await expect.poll(async () => (await sdk()).markers.filter((marker: any) => marker.title.includes("SIMULATED-BUS")).map((marker: any) => marker.position)).toEqual([target, target]);
  const settled = (await sdk()).markers.filter((marker: any) => marker.title.includes("SIMULATED-BUS"));
  await page.getByRole("button", { name: "Delayed old revision", exact: true }).click();
  await expect(page.getByTestId("simulation-state")).toContainText("route v1");
  // Observe across the production animation interval: an immediate equality
  // could pass before an incorrectly accepted old fix starts moving a marker.
  let stableObservations = 0;
  await expect.poll(async () => {
    expect((await sdk()).markers.filter((marker: any) => marker.title.includes("SIMULATED-BUS"))).toEqual(settled);
    return ++stableObservations;
  }, { intervals: [100, 100, 100, 100] }).toBe(5);
  const trace = await page.evaluate(() => window.__ekiTelemetryTrace?.snapshot());
  await info.attach("sdk-and-network-evidence", { body: JSON.stringify({
    providerHosts: Object.fromEntries(providers), blockedHosts: [...new Set(blocked)], errors,
    final: await sdk(), trace,
  }, null, 2), contentType: "application/json" });
  expect(errors).toEqual([]);
  expect(blocked).toEqual([]);
  expect(providers.get("maps.googleapis.com")).toBeGreaterThan(0);
  await expect(page.getByText("Sorry! Something went wrong.")).toHaveCount(0);
});
