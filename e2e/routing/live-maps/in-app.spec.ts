import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { decodePolyline } from "../../../frontend/src/lib/polyline";
const probe = JSON.parse(readFileSync("artifacts/routing-provider/result.json", "utf8"));

test.describe("mobile real Maps",()=>{
  test.use({viewport:{width:360,height:800},hasTouch:true});
  test("keeps the passenger marker and stop controls usable at phone width",async({page},info)=>{
    const errors:string[]=[],blocked:string[]=[];
    page.on("pageerror",error=>errors.push(error.message.replace(/AIza[\w-]+/g,"[redacted]")));
    await page.route("**/*",async route=>{
      const u=new URL(route.request().url());
      if(["127.0.0.1","localhost"].includes(u.hostname)&&u.port==="3163")return route.continue();
      if(["maps.googleapis.com","mapsresources-pa.googleapis.com","maps.gstatic.com","fonts.googleapis.com","fonts.gstatic.com"].includes(u.hostname))return route.continue();
      blocked.push(u.hostname);return route.abort();
    });
    await page.goto("/");
    const passenger=page.getByRole("region",{name:"Eki passenger map",exact:true});
    await passenger.scrollIntoViewIfNeeded();
    await expect.poll(async()=>page.evaluate(()=>(window as any).__ekiInAppMaps?.snapshot().maps.some((m:any)=>m.view==="Eki passenger map"&&m.tilesLoaded)??false),{timeout:30000}).toBe(true);
    const center=passenger.getByRole("button",{name:"Center on bus"});
    await center.scrollIntoViewIfNeeded();
    expect(await center.evaluate(el=>{const r=el.getBoundingClientRect(),top=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return top===el||el.contains(top);})).toBe(true);
    await center.click();
    await expect.poll(async()=>page.evaluate(()=>(window as any).__ekiInAppMaps.snapshot().maps.find((m:any)=>m.view==="Eki passenger map")?.zoom)).toBe(16);
    await expect(passenger.getByRole("button",{name:/Show stop/}).first()).toBeAttached();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
    await passenger.screenshot({path:info.outputPath("passenger-phone-real-maps.png")});
    const overview=passenger.getByRole("button",{name:"Show route overview"});
    await overview.click();
    const camera=()=>page.evaluate(()=>(window as any).__ekiInAppMaps.snapshot().maps.find((m:any)=>m.view==="Eki passenger map"));
    await expect.poll(async()=>(await camera()).zoom).toBeLessThan(16);
    const original=(await camera()).center;
    const box=(await passenger.boundingBox())!;
    await page.mouse.move(box.x+box.width*0.6,box.y+box.height*0.4);
    await page.mouse.down();await page.mouse.move(box.x+box.width*0.3,box.y+box.height*0.45,{steps:10});await page.mouse.up();
    await expect.poll(async()=>Math.abs((await camera()).center.lng-original.lng)).toBeGreaterThan(0.0001);
    await overview.click();
    await expect.poll(async()=>Math.abs((await camera()).center.lng-original.lng)).toBeLessThan(0.00001);
    expect(errors).toEqual([]);expect(blocked).toEqual([]);
  });
});
test.afterEach(async ({ page }, info) => {
  if (info.status !== info.expectedStatus) await page.screenshot({ path: info.outputPath("failed-map-view.png"), fullPage: true }).catch(() => {});
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
    if (url.hostname === "maps.googleapis.com" || url.hostname === "mapsresources-pa.googleapis.com" || url.hostname === "maps.gstatic.com" ||
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
  }, { timeout: 40_000 }).toBe(3);
  const assertDirection = async (direction: "forward" | "reverse") => {
    const expected = decodePolyline(probe.directions.find((item: any) => item.direction === direction).encodedPolyline);
    await expect.poll(async () => (await sdk()).lines.filter((line: any) => line.view === "Eki passenger map" && JSON.stringify(line.path) === JSON.stringify(expected)).length).toBe(2);
    const lines = (await sdk()).lines.filter((line: any) => line.view === "Eki passenger map");
    // Every upcoming leg is blue; gray is reserved for confirmed progress.
    expect(lines.filter((line: any) => line.color === "#22c55e")).toHaveLength(0);
    expect(lines.filter((line: any) => line.color === "#71717a")).toHaveLength(0);
    const blue = lines.filter((line: any) => line.color === "#3b82f6");
    expect(blue).toHaveLength(2);
    expect(blue.some((line: any) => JSON.stringify(line.path) === JSON.stringify(expected))).toBe(true);
    const active = blue.find((line: any) => line.path.length < expected.length);
    expect(active.path.length).toBeGreaterThanOrEqual(2);
    await expect.poll(async () => (await sdk()).markers.filter((marker: any) => marker.title.includes("SIMULATED-BUS")).length).toBe(2);
    // Live Ops shows buses only, never route lines; checked once its marker is up.
    expect((await sdk()).lines.filter((line: any) => line.view === "Eki admin map")).toHaveLength(0);
  };
  await assertDirection("forward");
  await expect.poll(async () => (await sdk()).maps.filter((map: any) => map.tilesLoaded).length, { timeout: 30_000 }).toBe(2);
  await expect.poll(async () => {
    const markers = (await sdk()).markers.filter((marker: any) => marker.title.includes("SIMULATED-BUS"));
    return markers.length === 2 && markers.every((marker: any) => typeof marker.visualOffsetPx === "number" && marker.visualOffsetPx < 3);
  }).toBe(true);
  await page.screenshot({ path: info.outputPath("eki-in-app-forward.png"), fullPage: true });
  // Stop progress is supplied by the backend-style tuple at simulated arrival.
  const firstLeg = (await sdk()).lines.filter((line: any) => line.color === "#3b82f6" && line.zIndex === 23);
  expect(firstLeg).toHaveLength(1);
  await page.getByRole("button", { name: "Reach next stop", exact: true }).click();
  await expect.poll(async () => {
    const blue = (await sdk()).lines.filter((line: any) => line.color === "#3b82f6" && line.zIndex === 23);
    return blue.length === 1 && JSON.stringify(blue[0].path) !== JSON.stringify(firstLeg[0].path);
  }).toBe(true);
  const [secondLeg] = (await sdk()).lines.filter((line: any) => line.color === "#3b82f6" && line.zIndex === 23);
  const passedLegs = (await sdk()).lines.filter((line: any) => line.color === "#71717a");
  expect(passedLegs).toHaveLength(1);
  expect(passedLegs[0].view).toBe("Eki passenger map");
  expect(passedLegs[0].path.at(-1)).toEqual(secondLeg.path[0]);
  expect(secondLeg.path[0]).toEqual(firstLeg[0].path.at(-1));
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
  // DOM projection measurements can differ by subpixel rounding as a mobile
  // pane scrolls. Compare the authoritative marker coordinates and identity.
  const stableMarkers = (snapshot: any) => snapshot.markers.filter((marker: any) => marker.title.includes("SIMULATED-BUS"))
    .map(({ visualOffsetPx: _visualOffsetPx, ...marker }: any) => marker);
  const settled = stableMarkers(await sdk());
  await page.getByRole("button", { name: "Delayed old revision", exact: true }).click();
  await expect(page.getByTestId("simulation-state")).toContainText("route v1");
  // Observe across the production animation interval: an immediate equality
  // could pass before an incorrectly accepted old fix starts moving a marker.
  let stableObservations = 0;
  await expect.poll(async () => {
    expect(stableMarkers(await sdk())).toEqual(settled);
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
  // The actual editor must redraw the same real road path in the selected
  // preview colour. Saving/persistence is covered by the emulator browser suite.
  await page.getByRole("button", { name: "Open route editor", exact: true }).click();
  await page.getByRole("button", { name: /^Edit route / }).click();
  const expectedPreview = decodePolyline(probe.directions[0].encodedPolyline);
  for (const color of ["#EC4899", "#10B981"]) {
    const picker = page.getByRole("button", { name: `Route colour ${color}`, exact: true });
    await picker.click(); await expect(picker).toHaveAttribute("aria-pressed", "true");
    await expect.poll(async () => (await sdk()).lines.filter((line: any) => line.view === "Eki route editor" && line.color === color).map((line: any) => line.path)).toEqual([expectedPreview]);
    expect((await sdk()).lines.filter((line: any) => line.view === "Eki route editor" && line.color === "#71717a")).toHaveLength(0);
  }
  await expect.poll(async () => (await sdk()).maps.some((map: any) => map.view === "Eki route editor" && map.tilesLoaded), { timeout: 30_000 }).toBe(true);
  await page.screenshot({ path: info.outputPath("eki-route-editor-green.png"), fullPage: true });
  await page.getByRole("button", { name: "Cancel route editing", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Routes", exact: true })).toBeVisible();
  expect(errors).toEqual([]); expect(blocked).toEqual([]);
});
