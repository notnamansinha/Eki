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
    expect(database.rules.activeBuses[".indexOn"]).toContain("busId");
  });

  it("keeps signal loss separate from lifecycle and persistence ordered", () => {
    const analytics = workspaceFile("backend/src/routes/analytics.ts");
    const tripStateEngine = workspaceFile("backend/src/services/tripStateEngine.ts");

    expect(analytics).toContain('data.deviceState === "offline"');
    expect(analytics).toContain('data.motionState === "uncertain"');
    expect(analytics).not.toContain('data.tripState === "maintenance"');
    expect(tripStateEngine).toContain("function readIntervalMs");
    expect(tripStateEngine).toContain("fleetWriteQueues");
    expect(tripStateEngine).toContain("telemetryQueues");
    expect(tripStateEngine).toContain("persistedActiveRideState");
    expect(tripStateEngine).not.toContain("etaTimestamp");
  });

  it("bounds graceful shutdown and drains workers before Firebase closes", () => {
    const server = workspaceFile("backend/src/server.ts");
    const engine = workspaceFile("backend/src/services/tripStateEngine.ts");
    const workers = workspaceFile("backend/src/services/workerCoordinator.ts");

    const backstopIndex = server.indexOf("const shutdownBackstop = setTimeout");
    const drainIndex = server.indexOf("await Promise.allSettled");
    expect(backstopIndex).toBeGreaterThanOrEqual(0);
    expect(drainIndex).toBeGreaterThanOrEqual(0);
    expect(backstopIndex).toBeLessThan(drainIndex);
    expect(server).not.toContain("process.exit(0)");
    expect(server).toContain("httpServer.closeIdleConnections()");
    expect(server).toContain("httpServer.closeAllConnections()");
    expect(engine).toContain("drainDynamicPromises");
    expect(engine).toContain("void completion.run()");
    expect(workers).toContain("await stopWork()");
  });

  it("keeps sensitive Firestore collections and chat identity protected", () => {
    const rules = workspaceFile("firestore.rules");
    const devices = ruleBlock(rules, "match /devices/{deviceId}");
    const activeRides = ruleBlock(rules, "match /active_rides/{rideId}");
    const activeBusLocks = ruleBlock(rules, "match /_active_bus_locks/{busId}");
    const messages = ruleBlock(rules, "match /messages/{messageId}");
    const messageRateLimits = ruleBlock(rules, "match /messageRateLimits/{uid}");
    const sessions = ruleBlock(rules, "match /ride_sessions/{sessionId}");
    const feedback = ruleBlock(rules, "match /feedbacks/{feedbackId}");

    expect(devices).toContain("allow read, write: if false;");
    expect(activeRides).toContain("allow read, write: if false;");
    expect(activeBusLocks).toContain("allow read, write: if false;");
    expect(messages).toContain("request.resource.data.senderId == request.auth.uid");
    expect(messages).toContain("request.resource.data.from == 'passenger'");
    expect(messages).toContain("request.resource.data.from == 'driver'");
    expect(messages).toContain("messageRateAdvanced(sessionId)");
    expect(messages).toContain("request.resource.data.text.size() > 0");
    expect(messageRateLimits).toContain("isSessionPassenger(sessionId)");
    expect(messageRateLimits).toContain("isSessionOperator(sessionId)");
    expect(sessions).toContain("allow read: if isSessionOperator(sessionId)");
    expect(sessions).toContain("allow update: if false;");
    expect(sessions).not.toContain("boardingStopId.size() <= 128");
    // Manifest shape and route-order validation now live in the server join policy.
    const sessionsRoute = workspaceFile("backend/src/routes/sessions.ts");
    expect(sessionsRoute).toContain("validateStopSelection(");
    expect(sessionsRoute).not.toContain("req.body?.userName");
    expect(feedback).toContain("isSessionPassenger(request.resource.data.sessionId)");
    expect(feedback).toContain("sessionDoc(request.resource.data.sessionId).data.status == 'completed'");
    expect(feedback).toContain("request.resource.data.rating is int");
    expect(feedback).toContain("sessionDoc(request.resource.data.sessionId).data.busId");
    expect(workspaceFile("frontend/src/components/shared/MessagingPanel.tsx")).toContain("limitToLast(200)");
  });

  it("gates post-ride feedback on a stop selection scoped to the current session", () => {
    const passengerPage = workspaceFile("frontend/src/app/passenger/page.tsx");
    const boardingView = workspaceFile(
      "frontend/src/components/passenger/PassengerBoardingView.tsx",
    );

    expect(passengerPage).toContain("recordStopSelection(");
    expect(passengerPage).toContain("isPostRideFeedbackEligible(");
    expect(passengerPage).toContain("key={activeSessionId}");
    expect(passengerPage).toContain("sessionId={feedbackSessionId}");
    expect(boardingView).toContain("onStopSelected?.(true)");
    expect(boardingView).not.toContain("hasSelectedRideStop(");
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
    expect(passengerPage).toContain(
      "hasValidBusCoordinates(normalizedBus.lat, normalizedBus.lng)",
    );
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

  it("rate-limits billable routes and authenticated HTTPS device telemetry", () => {
    const server = workspaceFile("backend/src/server.ts");
    const devices = workspaceFile("backend/src/routes/devices.ts");
    const telemetry = workspaceFile("backend/src/services/deviceTelemetryService.ts");

    expect(server).toContain("const routeComputeLimiter");
    expect(server).toContain('app.use("/api/routes", routeComputeLimiter, polylineRoutes)');
    expect(server).toContain("const routePlanLimiter");
    expect(server).toContain('express.json({ limit: "512b", strict: true })');
    expect(devices).toContain("telemetryLimiter");
    expect(devices).toContain('"/:deviceId/telemetry"');
    expect(telemetry).toContain("HTTPS_DEVICE_RATE_PER_MINUTE");
    expect(telemetry).toContain("withinDeviceRateLimit");
    expect(telemetry).toContain("timingSafeEqual");
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
    expect(authHook).toContain("invalidateLiveBusCache();");
    expect(collectionHook).toContain("export function clearCollectionCache");
    expect(settingsHook).toContain("export function clearSettingsCache");
  });

  it("requires verified HTTPS TLS for hardware credentials", () => {
    const firmware = workspaceFile("hardware/src/main.cpp");
    expect(firmware).toContain("tlsClient.setCACert(BACKEND_ROOT_CA)");
    expect(firmware).toContain("HTTPClient");
    expect(firmware).toContain(
      'authorizationHeader = String("Device ") + DEVICE_SECRET',
    );
    expect(firmware).toContain(
      'http.addHeader("Authorization", authorizationHeader)',
    );
    expect(firmware).not.toContain("Firebase_ESP_Client");
    expect(firmware).not.toContain("setInsecure(");
  });

  it("keeps routing identity outside the closed HTTPS payload", () => {
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
    const telemetryPolicy = workspaceFile("hardware/include/telemetry_policy.h");
    const tripStateEngine = workspaceFile("backend/src/services/tripStateEngine.ts");

    expect(telemetryPolicy).toContain("STOPPED_HEARTBEAT_MS = 60000");
    expect(telemetryPolicy).toContain("motionStateChanged");
    expect(tripStateEngine).toContain("const STALE_BUS_MS = readIntervalMs");
    expect(firmware).toContain("bufferedFix");
    expect(telemetryPolicy).toContain("HTTPS_RETRY_BASE_MS");
    expect(telemetryPolicy).toContain("HTTPS_RETRY_MAX_MS");
    expect(firmware).toContain("httpsRetryIsPending()");
    expect(firmware).toContain("resetHttpsRetry()");
    expect(firmware).toContain("setRxBufferSize(GPS_RX_BUFFER_BYTES)");
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
    expect(sessions).toContain("allow update: if false;");
    expect(sessions).not.toContain("resource.data.status in ['armed', 'active']");
    expect(routeEditor).toContain('method: "PUT"');
    expect(routeEditor).not.toContain("setDoc(");
    expect(routeEditor).not.toContain("updateDoc(");
    expect(driverMap).toContain("/api/shifts/delay");
    expect(driverMap).not.toContain("update(busRef");
    expect(dashboard).not.toContain('method: "PATCH"');
    expect(dashboard).not.toContain("Force Offline");
    expect(dashboard).not.toContain("Position Override");
    expect(dashboard).not.toContain("update(ref(rtdb");
  });

  it("restricts drivers to status-only passenger request updates", () => {
    const rules = workspaceFile("firestore.rules");
    const requests = ruleBlock(rules, "match /passenger_requests/{requestId}");

    expect(requests).toContain("affectedKeys().hasOnly(['status'])");
    expect(requests).toContain("request.resource.data.busId == resource.data.busId");
  });

  it("gates passenger manifest self-join behind driver-issued proof and proximity", () => {
    const rules = workspaceFile("firestore.rules");
    const sessions = ruleBlock(rules, "match /ride_sessions/{sessionId}");
    const boarding = workspaceFile(
      "frontend/src/components/passenger/PassengerBoardingView.tsx",
    );
    const sessionsRoute = workspaceFile("backend/src/routes/sessions.ts");
    const boardingPolicy = workspaceFile("backend/src/services/boardingPolicy.ts");
    const driverPage = workspaceFile("frontend/src/app/driver/page.tsx");
    const cspBuild = workspaceFile("scripts/update-csp.mjs");
    const server = workspaceFile("backend/src/server.ts");

    // Clients can never write ride_sessions; the manifest is backend-authoritative.
    expect(sessions).toContain("allow update: if false;");
    expect(sessions).toContain("allow delete: if false;");
    expect(sessions).not.toContain("affectedKeys().hasOnly(['passengers'])");
    // Boarding is issued by the backend join endpoint.
    expect(server).toContain('app.use("/api/sessions"');
    expect(sessionsRoute).toContain('router.post("/:sessionId/join", requireAuth');
    expect(sessionsRoute).toContain('router.post("/:sessionId/boarding-code", requireAuth');
    expect(sessionsRoute).toContain("user?.role !== \"driver\"");
    expect(sessionsRoute).toContain("boardingCodesMatch");
    expect(sessionsRoute).toContain("validateLiveBoardingProjection");
    expect(sessionsRoute).toContain("db.runTransaction");
    expect(boardingPolicy).toContain("timingSafeEqual");
    expect(boardingPolicy).toContain("timestamp > now + MAX_JOIN_FIX_FUTURE_MS");
    expect(sessionsRoute).toContain("JOIN_RADIUS_M");
    expect(sessionsRoute).toContain("You must be near the bus to board");
    // The client asks the backend to board; it never writes the manifest.
    expect(boarding).toContain('/api/sessions/');
    expect(boarding).toContain('Authorization: `Bearer ${token}`');
    expect(boarding).toContain("position.coords.accuracy");
    expect(driverPage).toContain("/boarding-code");
    expect(cspBuild).toContain("backendOrigin");
    expect(boarding).not.toContain('updateDoc');
    expect(boarding).not.toContain('setDoc');
  });

  it("uses backend-authoritative shift lifecycle endpoints", () => {
    const server = workspaceFile("backend/src/server.ts");
    const driverPage = workspaceFile("frontend/src/app/driver/page.tsx");
    const driverMap = workspaceFile("frontend/src/components/maps/DriverMap.tsx");
    const passengerBoarding = workspaceFile(
      "frontend/src/components/passenger/PassengerBoardingView.tsx",
    );
    const shifts = workspaceFile("backend/src/routes/shifts.ts");

    expect(server).toContain('app.use("/api/shifts"');
    expect(driverPage).toContain("/api/shifts/start");
    expect(driverPage).not.toContain("/api/shifts/stop");
    expect(driverPage).not.toContain("arrayUnion(");
    expect(driverPage).not.toContain("test_bus_1");
    expect(shifts).toContain("nodeRef.transaction");
    expect(shifts).toContain("final ordered stop");
    expect(shifts).toContain("STOP_GEOFENCE_M");
    expect(shifts).toContain("arrivedAtOrigin");
    expect(driverMap).toContain("Armed · awaiting stop 1");
    expect(passengerBoarding).toContain("Ride in service");
  });

  it("keeps terminal ride-history deletion behind the admin API", () => {
    const shifts = workspaceFile("backend/src/routes/shifts.ts");
    const deletion = workspaceFile("backend/src/services/rideHistoryDeletion.ts");

    expect(shifts).toContain('router.delete("/:sessionId/history", requireAdmin');
    expect(shifts).toContain("SAFE_ID.test(sessionId)");
    expect(shifts).toContain("RideHistoryConflictError");
    expect(deletion).toContain('new Set(["completed", "interrupted", "failed"])');
    expect(deletion).toContain('collection("ride_sessions")');
    expect(deletion).toContain("recursiveDelete(sessionRef)");
    expect(deletion).toContain('collection("completed_trips")');
    expect(deletion).toContain('.where("sessionId", "==", sessionId)');
    expect(deletion).not.toContain("feedbacks");
    expect(deletion).not.toContain("active_rides");
    expect(deletion).not.toContain("activeBuses");
  });

  it("bounds telemetry recovery state and records stop history with merge semantics", () => {
    const engine = workspaceFile("backend/src/services/tripStateEngine.ts");
    const completionBlock = engine.slice(
      engine.indexOf('if (tripState === "completed"'),
      engine.indexOf(
        'if (tripState === "pre_departure" || tripState === "in_service")',
      ),
    );

    expect(engine).toContain("telemetryTimestamp > previousTelemetry.timestamp");
    expect(engine).toContain('busesRef.on("child_added", liveSnapshotHandler)');
    expect(engine).toContain('busesRef.on("child_changed", liveSnapshotHandler)');
    expect(engine).toContain("processedTelemetry.delete");
    expect(engine).toContain("forgetAfterWrite");
    expect(engine).toContain("stopsReached:");
    expect(engine).toContain("{ merge: true }");
    expect(engine).not.toContain('.doc(data.sessionId).update({');
    expect(engine).toContain("live.sessionId !== data.sessionId");
    expect(engine).not.toContain("snapshot.ref.update({ status: \"offline\" })");
    expect(completionBlock.indexOf("await db.runTransaction")).toBeGreaterThan(-1);
    expect(completionBlock.indexOf("await snapshot.ref.transaction")).toBeGreaterThan(
      completionBlock.indexOf("await db.runTransaction"),
    );
    const telemetry = workspaceFile(
      "backend/src/services/deviceTelemetryService.ts",
    );
    expect(telemetry).toContain("durableRideRestores");
    expect(telemetry).toContain("scheduleDurableRideRestore(assignment, sample)");
    expect(telemetry).not.toContain("await restoreDurableRide(assignment, sample)");
  });

  it("serializes one active session per bus and makes completion session-safe", () => {
    const shifts = workspaceFile("backend/src/routes/shifts.ts");
    const engine = workspaceFile("backend/src/services/tripStateEngine.ts");
    const reconciler = workspaceFile(
      "backend/src/services/abandonedRideReconciler.ts",
    );

    expect(shifts).toContain('collection("_active_bus_locks").doc(busId)');
    expect(shifts).toContain("transaction.create(lockRef");
    expect(shifts).toContain("lockData?.driverId !== assignment.driverId");
    expect(shifts).toContain("winner.sessionId === sessionRef.id");
    expect(engine).toContain('collection("_active_bus_locks").doc(data.busId)');
    expect(engine).toContain("data.sessionId.length > 0");
    expect(engine).toContain("lock.data()?.sessionId === data.sessionId");
    expect(engine).toContain("live.sessionId !== data.sessionId");
    expect(reconciler).toContain("currentBusLock.data()?.sessionId === sessionId");
  });

  it("never runtime-caches authenticated API data and fails closed production config", () => {
    const serviceWorker = workspaceFile("frontend/src/sw.js");
    const nextConfig = workspaceFile("frontend/next.config.ts");
    const productionBuild = workspaceFile("scripts/build-production.mjs");

    expect(serviceWorker).toContain("new NetworkOnly()");
    expect(serviceWorker).toContain("setDefaultHandler(new NetworkOnly())");
    expect(serviceWorker).not.toContain('cacheName: "eki-firebase-api"');
    expect(serviceWorker).not.toContain('cacheName: "eki-default"');
    expect(productionBuild).toContain('EKI_STRICT_PRODUCTION_BUILD = "true"');
    expect(nextConfig).toContain('process.env.EKI_STRICT_PRODUCTION_BUILD === "true"');
    expect(nextConfig).toContain('"NEXT_PUBLIC_BACKEND_URL"');
    expect(nextConfig).toContain("must be a non-local HTTPS URL");
  });

  it("revokes fleet assignments through an admin backend boundary", () => {
    const server = workspaceFile("backend/src/server.ts");
    const fleetPanel = workspaceFile("frontend/src/components/admin/FleetManagementPanel.tsx");
    const fleet = workspaceFile("backend/src/routes/fleet.ts");
    const routes = workspaceFile("backend/src/routes/polyline.ts");

    expect(server).toContain('app.use("/api/fleet"');
    expect(fleetPanel).toContain("fleetRequest(`/drivers/");
    expect(fleetPanel).toContain("fleetRequest(`/buses/");
    expect(fleetPanel).not.toContain("deleteDoc(");
    expect(fleet).toContain("demoteDriverAccount(previousAuthUid)");
    expect(fleet).toContain('collection("active_rides")');
    expect(fleet).toContain("cannot be deleted before its final stop");
    expect(routes).toContain("active ride route cannot be edited");
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

  it("ships every Firestore index manifest referenced by Firebase", () => {
    const firebase = JSON.parse(workspaceFile("firebase.json"));
    const indexPath = firebase.firestore.indexes as string;
    const manifest = JSON.parse(workspaceFile(indexPath));

    expect(indexPath).toBe("firestore.indexes.json");
    expect(manifest.indexes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          collectionGroup: "ride_sessions",
          queryScope: "COLLECTION",
        }),
      ]),
    );
    expect(manifest.fieldOverrides).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          collectionGroup: "messages",
          fieldPath: "senderId",
        }),
        expect.objectContaining({
          collectionGroup: "messageRateLimits",
          fieldPath: "userId",
        }),
      ]),
    );
  });
});
