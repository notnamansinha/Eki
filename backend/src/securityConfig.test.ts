import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const workspaceFile = (path: string) =>
  readFileSync(resolve(__dirname, "../..", path), "utf8");

const ruleBlock = (rules: string, matchPath: string) => {
  const start = rules.indexOf(matchPath);
  if (start < 0) return "";

  let depth = 0;
  let opened = false;
  for (let index = start + matchPath.length; index < rules.length; index += 1) {
    if (rules[index] === "{") {
      depth += 1;
      opened = true;
    } else if (rules[index] === "}" && opened && --depth === 0) {
      return rules.slice(start, index + 1);
    }
  }
  return "";
};

describe("production security configuration", () => {
  it("keeps realtime bus writes bound to authenticated assignments", () => {
    const database = JSON.parse(workspaceFile("database.rules.json"));
    const activeBus = database.rules.activeBuses.$busKey;

    expect(activeBus[".write"]).toContain("auth.token.assignedBusId");
    expect(activeBus[".write"]).toContain("auth.token.driverId");
    expect(activeBus[".write"]).toContain("driverRouteAssignments");
    expect(activeBus[".write"]).toContain("auth.token.deviceId");
    expect(activeBus[".write"]).toContain("auth.token.routeId");
    expect(database.rules.messages.sessions.$sessionId.$msgId[".write"]).toBe("false");
    expect(database.rules.messages.$busId.$msgId[".write"]).toBe("false");
    const syncRoles = workspaceFile("backend/src/syncRoleClaims.ts");
    expect(syncRoles).toContain("driverRouteAssignments/");
  });

  it("keeps sensitive Firestore collections and chat identity protected", () => {
    const rules = workspaceFile("firestore.rules");
    const devices = ruleBlock(rules, "match /devices/{deviceId}");
    const messages = ruleBlock(rules, "match /messages/{messageId}");

    expect(devices).toContain("allow read, write: if false;");
    expect(messages).toContain("request.resource.data.senderId == request.auth.uid");
    expect(messages).toContain("request.resource.data.from == 'passenger'");
    expect(messages).toContain("request.resource.data.from == 'driver'");
  });

  it("requires sign-in for live application data and route APIs", () => {
    const rules = workspaceFile("firestore.rules");
    const routes = ruleBlock(rules, "match /routes/{routeId}");
    const buses = ruleBlock(rules, "match /buses/{busId}");
    const settings = ruleBlock(rules, "match /settings/{document}");
    const locations = ruleBlock(rules, "match /bus_locations/{busId}");
    const planRoute = workspaceFile("backend/src/routes/plan.ts");
    const routesList = workspaceFile("backend/src/routes/routesList.ts");

    expect(routes).toContain("allow read: if isAuthenticated();");
    expect(buses).toContain("allow read: if isAuthenticated();");
    expect(settings).toContain("allow read: if isAuthenticated();");
    expect(locations).toContain("allow read, write: if isAdmin();");
    expect(planRoute).toContain('router.post("/", requireAuth');
    expect(routesList).toContain('router.get("/", requireAuth');
  });

  it("does not let the browser seed or take down hardware GNSS coordinates", () => {
    const driverPage = workspaceFile("frontend/src/app/driver/page.tsx");
    const passengerPage = workspaceFile("frontend/src/app/passenger/page.tsx");

    expect(driverPage).not.toContain("onDisconnect(");
    expect(driverPage).not.toContain("lat: activeRoute?.stops");
    expect(driverPage).toContain("serverTimestamp as firestoreServerTimestamp");
    expect(driverPage).toContain("timestamp: firestoreServerTimestamp()");
    expect(passengerPage).toContain("hasValidBusCoordinates(bus.lat, bus.lng)");
    expect(driverPage).toContain("!assignedRouteIds.includes(selectedRouteIds[0])");
  });

  it("renders stored route geometry without browser Directions API calls", () => {
    const directionsRoute = workspaceFile("frontend/src/components/maps/DirectionsRoute.tsx");

    expect(directionsRoute).toContain("function decodePolyline");
    expect(directionsRoute).not.toContain("DirectionsService");
    expect(directionsRoute).not.toContain("DirectionsRenderer");
  });

  it("rate-limits billable route computation and failed device authentication", () => {
    const server = workspaceFile("backend/src/server.ts");
    const devices = workspaceFile("backend/src/routes/devices.ts");

    expect(server).toContain("const routeComputeLimiter");
    expect(server).toContain('app.use("/api/routes", routeComputeLimiter, polylineRoutes)');
    expect(devices).toContain("const deviceAuthLimiter");
    expect(devices).toContain("skipSuccessfulRequests: true");
  });

  it("keeps admin place searches authenticated and server-side", () => {
    const places = workspaceFile("backend/src/routes/places.ts");
    const editor = workspaceFile("frontend/src/components/admin/RouteManagementPanel.tsx");

    expect(places).toContain("requireAdmin");
    expect(places).toContain("AbortSignal.timeout(5_000)");
    expect(places).toContain("NOMINATIM_USER_AGENT");
    expect(editor).toContain("/api/places/search");
    expect(editor).not.toContain("https://nominatim.openstreetmap.org/search?format=json");
  });

  it("clears in-memory data caches on logout", () => {
    const authHook = workspaceFile("frontend/src/hooks/useAuth.ts");
    const collectionHook = workspaceFile("frontend/src/hooks/useCollection.ts");
    const settingsHook = workspaceFile("frontend/src/hooks/useSettings.ts");

    expect(authHook).toContain("clearCollectionCache();");
    expect(authHook).toContain("clearSettingsCache();");
    expect(collectionHook).toContain("export function clearCollectionCache");
    expect(settingsHook).toContain("export function clearSettingsCache");
  });

  it("requires verified HTTPS for hardware credentials", () => {
    const firmware = workspaceFile("hardware/src/main.cpp");
    const tokenRequest = firmware.slice(
      firmware.indexOf("bool fetchCustomToken()"),
      firmware.indexOf("bool waitForNtpSync"),
    );

    expect(tokenRequest).toContain('url.startsWith("https://")');
    expect(tokenRequest).toContain("clientSecure.setCACert(BACKEND_ROOT_CA)");
    expect(tokenRequest).not.toContain("setInsecure(");
  });

  it("lets the GNSS tracker seed its own static bus identity", () => {
    const firmware = workspaceFile("hardware/src/main.cpp");
    const metadataWriter = firmware.slice(
      firmware.indexOf("void writeBusMeta()"),
      firmware.indexOf("void sendLocationToRTDB()"),
    );

    expect(metadataWriter).toContain('meta.set("busId",         BUS_ID)');
    expect(metadataWriter).toContain('meta.set("routeId",       ROUTE_ID)');
    expect(metadataWriter).toContain('meta.set("meta/source",   "gnss_hw")');
  });

  it("keeps the parked GNSS heartbeat safely inside stale-record expiry", () => {
    const firmware = workspaceFile("hardware/src/main.cpp");
    const tripStateEngine = workspaceFile("backend/src/services/tripStateEngine.ts");

    expect(firmware).toContain("#define MAX_SILENT_INTERVAL_IDLE   120000");
    expect(tripStateEngine).toContain('process.env.BUS_STALE_MS || "300000"');
  });

  it("ships exact browser security headers", () => {
    const firebase = JSON.parse(workspaceFile("firebase.json"));
    const defaultHeaders = firebase.hosting.headers.find(
      (entry: { source: string }) => entry.source === "**",
    ).headers as Array<{ key: string; value: string }>;
    const headers = new Map(defaultHeaders.map(({ key, value }) => [key, value]));

    expect(headers.get("Content-Security-Policy")).toContain("default-src 'self'");
    expect(headers.get("Strict-Transport-Security")).toMatch(/^max-age=\d+/);
    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(headers.get("X-Frame-Options")).toBe("DENY");
    expect(headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
  });
});
