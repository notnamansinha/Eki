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
  it("keeps realtime telemetry server-only and denies every RTDB client mutation", () => {
    const database = JSON.parse(workspaceFile("database.rules.json"));
    const activeBus = database.rules.activeBuses.$busKey;

    expect(database.rules[".read"]).toBe(false);
    expect(database.rules[".write"]).toBe(false);
    expect(database.rules.activeBuses[".write"]).toBe(false);
    expect(activeBus[".write"]).toBe(false);
    expect(database.rules.driverRouteAssignments[".read"]).toBe(false);
    expect(database.rules.driverRouteAssignments[".write"]).toBe(false);
    expect(database.rules.messages[".write"]).toBe(false);
    const syncRoles = workspaceFile("backend/src/syncRoleClaims.ts");
    expect(syncRoles).toContain("driverRouteAssignments/");
    expect(syncRoles).toContain("previousDriverId");
    expect(syncRoles).toContain("previousDriverId");
    expect(database.rules.activeBuses[".indexOn"]).toContain("busId");
  });

  it("keeps maintenance fleet state and lifecycle persistence ordered", () => {
    const analytics = workspaceFile("backend/src/routes/analytics.ts");
    const tripStateEngine = workspaceFile("backend/src/services/tripStateEngine.ts");

    expect(analytics.indexOf('data.tripState === "maintenance"'))
      .toBeLessThan(analytics.indexOf('data.status === "active"'));
    expect(tripStateEngine).toContain("function readIntervalMs");
    expect(tripStateEngine).toContain("fleetWriteQueues");
    expect(tripStateEngine).toContain("const ETA_INTERVAL_MS = readIntervalMs");
  });

  it("keeps sensitive Firestore collections and chat identity protected", () => {
    const rules = workspaceFile("firestore.rules");
    const devices = ruleBlock(rules, "match /devices/{deviceId}");
    const messages = ruleBlock(rules, "match /messages/{messageId}");

    expect(devices).toContain("allow read, write: if false;");
    expect(messages).toContain("request.resource.data.senderId == request.auth.uid");
    expect(messages).toContain("request.resource.data.from == 'passenger'");
    expect(messages).toContain("request.resource.data.from == 'driver'");
    expect(messages).toContain("messageRateAdvanced(sessionId)");
    expect(workspaceFile("frontend/src/components/shared/MessagingPanel.tsx")).toContain("limitToLast(200)");
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
    expect(driverPage).toContain("/api/shifts/start");
    expect(driverPage).not.toContain("updateDoc(");
    expect(passengerPage).toContain("hasValidBusCoordinates(bus.lat, bus.lng)");
    expect(driverPage).toContain("!assignedRouteIds.includes(selectedRouteIds[0])");
  });

  it("renders stored route geometry without browser Directions API calls", () => {
    const directionsRoute = workspaceFile("frontend/src/components/maps/DirectionsRoute.tsx");
    const polyline = workspaceFile("frontend/src/lib/polyline.ts");

    expect(directionsRoute).toContain('from "@/lib/polyline"');
    expect(polyline).toContain("export function decodePolyline");
    expect(directionsRoute).not.toContain("DirectionsService");
    expect(directionsRoute).not.toContain("DirectionsRenderer");
  });

  it("rate-limits billable route computation and MQTT device telemetry", () => {
    const server = workspaceFile("backend/src/server.ts");
    const ingestor = workspaceFile("backend/src/services/mqttIngestor.ts");

    expect(server).toContain("const routeComputeLimiter");
    expect(server).toContain('app.use("/api/routes", routeComputeLimiter, polylineRoutes)');
    expect(server).toContain("const routePlanLimiter");
    expect(ingestor).toContain("MQTT_DEVICE_RATE_PER_MINUTE");
    expect(ingestor).toContain("packet.qos !== 1");
  });

  it("keeps admin place searches authenticated and server-side", () => {
    const places = workspaceFile("backend/src/routes/places.ts");
    const editor = workspaceFile("frontend/src/components/admin/RouteManagementPanel.tsx");

    expect(places).toContain("requireAdmin");
    expect(places).toContain("new AbortController()");
    expect(places).toContain("response.status");
    expect(places).toContain("response.text()");
    expect(places).toContain("GOOGLE_MAPS_API_KEY");
    expect(places).toContain("places:searchText");
    expect(places).not.toContain("nominatim.openstreetmap.org");
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

  it("requires verified MQTT TLS for hardware credentials", () => {
    const firmware = workspaceFile("hardware/src/main.cpp");
    expect(firmware).toContain("tlsClient.setCACert(MQTT_ROOT_CA)");
    expect(firmware).toContain("MQTT_QOS = 1");
    expect(firmware).not.toContain("HTTPClient");
    expect(firmware).not.toContain("Firebase_ESP_Client");
    expect(firmware).not.toContain("setInsecure(");
  });

  it("keeps routing identity outside the closed MQTT payload", () => {
    const firmware = workspaceFile("hardware/src/main.cpp");
    const publisher = firmware.slice(
      firmware.indexOf("bool publishFix"),
      firmware.indexOf("TelemetryFix currentFix"),
    );
    expect(publisher).toContain('document["lat"]');
    expect(publisher).toContain('document["timestamp"]');
    expect(publisher).not.toContain('document["busId"]');
    expect(publisher).not.toContain('document["routeId"]');
    expect(publisher).not.toContain('document["hdop"]');
  });

  it("keeps the parked GNSS heartbeat safely inside stale-record expiry", () => {
    const firmware = workspaceFile("hardware/src/main.cpp");
    const tripStateEngine = workspaceFile("backend/src/services/tripStateEngine.ts");

    expect(firmware).toContain("STOPPED_HEARTBEAT_MS = 120000");
    expect(tripStateEngine).toContain("const STALE_BUS_MS = readIntervalMs");
    expect(firmware).toContain("bufferedFix");
    expect(firmware).toContain("MQTT_QOS");
    expect(tripStateEngine).not.toContain("snapshot.ref.remove().catch(console.error);");
  });

  it("routes all privileged route and delay mutations through the backend", () => {
    const rules = workspaceFile("firestore.rules");
    const routes = ruleBlock(rules, "match /routes/{routeId}");
    const sessions = ruleBlock(rules, "match /ride_sessions/{sessionId}");
    const routeEditor = workspaceFile("frontend/src/components/admin/RouteManagementPanel.tsx");
    const driverMap = workspaceFile("frontend/src/components/maps/DriverMap.tsx");
    const dashboard = workspaceFile("frontend/src/components/admin/DashboardPanel.tsx");

    expect(routes).toContain("allow create, update, delete: if false;");
    expect(sessions).toContain("allow create: if false;");
    expect(routeEditor).toContain('method: "PUT"');
    expect(routeEditor).not.toContain("setDoc(");
    expect(routeEditor).not.toContain("updateDoc(");
    expect(driverMap).toContain("/api/shifts/delay");
    expect(driverMap).not.toContain("update(busRef");
    expect(dashboard).toContain("/api/buses/");
    expect(dashboard).not.toContain("update(ref(rtdb");
  });

  it("restricts drivers to status-only passenger request updates", () => {
    const rules = workspaceFile("firestore.rules");
    const requests = ruleBlock(rules, "match /passenger_requests/{requestId}");

    expect(requests).toContain("affectedKeys().hasOnly(['status'])");
    expect(requests).toContain("request.resource.data.busId == resource.data.busId");
  });

  it("uses backend-authoritative shift lifecycle endpoints", () => {
    const server = workspaceFile("backend/src/server.ts");
    const driverPage = workspaceFile("frontend/src/app/driver/page.tsx");
    const shifts = workspaceFile("backend/src/routes/shifts.ts");

    expect(server).toContain('app.use("/api/shifts"');
    expect(driverPage).toContain("/api/shifts/start");
    expect(driverPage).toContain("/api/shifts/stop");
    expect(driverPage).not.toContain("arrayUnion(");
    expect(driverPage).not.toContain("test_bus_1");
    expect(shifts).toContain("nodeRef.transaction");
  });

  it("bounds telemetry recovery state and records stop history with merge semantics", () => {
    const engine = workspaceFile("backend/src/services/tripStateEngine.ts");

    expect(engine).toContain("telemetryTimestamp > previousTelemetry.timestamp");
    expect(engine).toContain("processedTelemetry.delete");
    expect(engine).toContain("forgetAfterWrite");
    expect(engine).toContain("stopsReached:");
    expect(engine).toContain("{ merge: true }");
    expect(engine).not.toContain('.doc(data.sessionId).update({');
    expect(engine).toContain("live.sessionId !== data.sessionId");
    expect(engine).not.toContain("snapshot.ref.update({ status: \"offline\" })");
  });

  it("revokes fleet assignments through an admin backend boundary", () => {
    const server = workspaceFile("backend/src/server.ts");
    const fleetPanel = workspaceFile("frontend/src/components/admin/FleetManagementPanel.tsx");

    expect(server).toContain('app.use("/api/fleet"');
    expect(fleetPanel).toContain("fleetRequest(`/drivers/");
    expect(fleetPanel).toContain("fleetRequest(`/buses/");
    expect(fleetPanel).not.toContain("deleteDoc(");
    expect(workspaceFile("backend/src/routes/fleet.ts")).toContain("demoteDriverAccount(previousAuthUid)");
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
