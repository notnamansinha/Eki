import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const workspaceFile = (path: string) =>
  readFileSync(resolve(__dirname, "../..", path), "utf8");

const loadPassengerSource = () =>
  `${workspaceFile("frontend/src/app/passenger/page.tsx")}\n${workspaceFile(
    "frontend/src/components/passenger/PassengerWorkspace.tsx",
  )}`;

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
  it("pins every CI action to an immutable commit", () => {
    const workflow = workspaceFile(".github/workflows/ci.yml");
    const references = [...workflow.matchAll(/uses:\s+([^@\s]+)@([^\s#]+)/g)];
    expect(references.length).toBeGreaterThan(0);
    for (const [, action, reference] of references) {
      expect(action).toMatch(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
      expect(reference).toMatch(/^[a-f0-9]{40}$/);
    }
  });

  it("keeps realtime telemetry server-only and removes dead RTDB rule blocks", () => {
    const database = JSON.parse(workspaceFile("database.rules.json"));
    const activeBus = database.rules.activeBuses.$busKey;

    expect(database.rules[".read"]).toBe(false);
    expect(database.rules[".write"]).toBe(false);
    expect(database.rules.activeBuses[".write"]).toBe(false);
    expect(activeBus[".write"]).toBe(false);
    expect(database.rules.activeBuses[".indexOn"]).toContain("busId");
    // Dead rule blocks are gone: nothing reads RTDB messages/users, and the
    // driverRouteAssignments mirror is Admin-SDK-only (default-deny for
    // clients is identical to the removed explicit denies) (issue #49 L2).
    expect(database.rules.driverRouteAssignments).toBeUndefined();
    expect(database.rules.messages).toBeUndefined();
    expect(database.rules.users).toBeUndefined();
    const syncRoles = workspaceFile("backend/src/syncRoleClaims.ts");
    expect(syncRoles).toContain("driverRouteAssignments/");
    expect(syncRoles).toContain("previousDriverId");
  });

  it("keeps signal loss separate from lifecycle and persistence ordered", () => {
    const analytics = workspaceFile("backend/src/routes/analytics.ts");
    const tripStateEngine = workspaceFile("backend/src/services/tripStateEngine.ts");

    expect(analytics).toContain('data.deviceState === "offline"');
    expect(analytics).toContain('data.motionState === "uncertain"');
    expect(analytics).not.toContain('data.tripState === "maintenance"');
    expect(tripStateEngine).toContain("function readIntervalMs");
    // Per-key serialized writers keep fleet, active-ride and telemetry
    // persistence ordered (one generic writer used for all three streams),
    // and every long-lived in-memory map is LRU-bounded (issue #37).
    expect(tripStateEngine).toContain("new SerializedChangeWriter(MAX_CACHE_ENTRIES)");
    expect(tripStateEngine).toContain("new LruCache<string, RouteStop[]>(MAX_CACHE_ENTRIES)");
    expect(tripStateEngine).toContain("new LruCache<string, TelemetrySample>(MAX_CACHE_ENTRIES)");
    expect(tripStateEngine).toContain("new LruCache<string, PendingCompletion>(");
    expect(tripStateEngine).toContain("fleetWrites.enqueue");
    expect(tripStateEngine).toContain("activeRideWrites.enqueue");
    expect(tripStateEngine).toContain("telemetryWrites.enqueue");
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

  it("denies every unlisted path with an explicit catch-all and keeps comments accurate", () => {
    const rules = workspaceFile("firestore.rules");

    // Explicit catch-all deny: overlapping rules use OR semantics, so this
    // never overrides a narrower allow, and unlisted collections fail closed
    // with documented intent (issue #49 L6).
    expect(rules).toContain("match /{document=**}");
    expect(rules).toContain("allow read, write: if false;");
    // Routes/bus_locations comments no longer claim PUBLIC when the rules
    // require authentication or admin (issue #49 L5).
    expect(rules).not.toContain("PUBLIC read");
  });

  it("reads the session document once for chat access checks", () => {
    const rules = workspaceFile("firestore.rules");
    const messages = ruleBlock(rules, "match /messages/{messageId}");
    const rateLimits = ruleBlock(rules, "match /messageRateLimits/{uid}");
    const helper = ruleBlock(rules, "function canReadSession");

    // Chat reads check operator OR passenger membership in one get() instead of
    // two (issue #40): a passenger reading chat must not pay for two billable
    // session fetches per request.
    expect(messages).toContain("canReadSession(sessionId)");
    expect(rateLimits).toContain("canReadSession(sessionId)");
    expect(helper).not.toContain("isSessionOperator");
    // Firestore caches repeated access calls for the same document within a
    // rule evaluation. The helper deliberately repeats the same sessionDoc
    // path only behind authenticated branches, keeping one billed get().
    expect(helper.split("sessionDoc(").length - 1).toBe(4);
    expect(rules).not.toContain("function isSessionPassenger");
  });

  it("evaluates authentication before the session fetch (audit #112)", () => {
    const rules = workspaceFile("firestore.rules");
    const helper = ruleBlock(rules, "function canReadSession");
    const operator = ruleBlock(rules, "function isSessionOperator");

    // A denied unauthenticated read must never evaluate the billable get(): the
    // auth short-circuit must appear before any sessionDoc() call in both read
    // helpers, and the helper must not bind the session eagerly.
    for (const block of [helper, operator]) {
      const authIdx = block.indexOf("isAuthenticated()");
      const sessionIdx = block.indexOf("sessionDoc(");
      expect(authIdx).toBeGreaterThan(-1);
      expect(authIdx).toBeLessThan(sessionIdx);
    }
    expect(helper).toContain("isAuthenticated() &&");
  });

  it("keeps rules get() cost bounded: one session fetch, no write-path gets (issue #40)", () => {
    const rules = workspaceFile("firestore.rules");
    const feedback = ruleBlock(rules, "match /feedbacks/{feedbackId}");
    const messages = ruleBlock(rules, "match /messages/{messageId}");
    const rateLimits = ruleBlock(rules, "match /messageRateLimits/{uid}");
    const cooldowns = ruleBlock(rules, "match /feedbackCooldowns/{uid}");
    const operator = ruleBlock(rules, "function isSessionOperator");
    const sessionHelper = ruleBlock(rules, "function canReadSession");

    // Chat create used to cost 2 session get()s + 2 rate-limit get()/getAfter();
    // feedback create cost 3 session get()s (issue #40). Those writes are now
    // backend-authoritative, so the ONLY get() left in the whole rules file is
    // the single session fetch shared by read checks. This guard fails if a
    // future rule reintroduces a second fetch or a write-path get().
    // (Comments are stripped so "single get()" prose doesn't count.)
    const code = rules.replace(/\/\/.*$/gm, "");
    expect(code.match(/get\(/g) ?? []).toHaveLength(1);
    expect(code).not.toContain("getAfter(");

    // The one allowed get() lives in the sessionDoc helper and is shared by
    // exactly the two read helpers; client write rules must never call it.
    expect(sessionHelper).toContain("sessionDoc(sessionId)");
    expect(rules.match(/sessionDoc\(/g) ?? []).toHaveLength(7);
    expect(operator.split("sessionDoc(").length - 1).toBe(1);
    expect(feedback).not.toContain("sessionDoc(");
    expect(messages).not.toContain("sessionDoc(");
    expect(rateLimits).not.toContain("sessionDoc(");
    expect(cooldowns).not.toContain("sessionDoc(");

    // Rate-limit reads short-circuit the cheap ownership check before paying
    // for the session fetch, so a non-owner read costs zero get()s.
    expect(rateLimits.indexOf("isOwner(uid)")).toBeLessThan(rateLimits.indexOf("canReadSession(sessionId)"));
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
    // Message and rate-limit writes are backend-authoritative; clients read only.
    expect(messages).toContain("allow create, update, delete: if false;");
    expect(messages).toContain("canReadSession(sessionId)");
    expect(messages).not.toContain("messageRateAdvanced(sessionId)");
    expect(messageRateLimits).toContain("allow create, update, delete: if false;");
    expect(messageRateLimits).toContain("canReadSession(sessionId)");
    expect(sessions).toContain("allow read: if isSessionOperator(sessionId);");
    expect(sessions).toContain("allow update: if false;");
    expect(sessions).not.toContain("boardingStopId.size() <= 128");
    // Manifest shape and route-order validation now live in the server join policy.
    const sessionsRoute = workspaceFile("backend/src/routes/sessions.ts");
    expect(sessionsRoute).toContain("validateStopSelection(");
    expect(sessionsRoute).not.toContain("req.body?.userName");
    expect(sessionsRoute).toContain('router.post("/:sessionId/messages", requireAuth');
    expect(sessionsRoute).toContain("evaluateChatRate");
    expect(sessionsRoute).toContain("censorText");
    expect(feedback).toContain("allow create: if false;");
    expect(feedback).toContain("allow update: if false;");
    // Ride-eligibility and cooldown enforcement now live in the feedback
    // endpoint and its service.
    const feedbackRoute = workspaceFile("backend/src/routes/feedback.ts");
    const feedbackService = workspaceFile("backend/src/services/feedbackService.ts");
    expect(feedbackRoute).toContain('router.post("/", requireAuth');
    expect(feedbackRoute).toContain("evaluateFeedback");
    expect(feedbackRoute).toContain("feedbackCooldowns");
    expect(feedbackRoute).toContain('router.patch("/:feedbackId/status", requireAdmin');
    expect(feedbackRoute).not.toContain("req.body?.userName");
    expect(feedbackRoute).toContain("transaction.getAll(cooldownRef");
    expect(feedbackService).toContain("sessionCompleted");
    expect(feedbackService).toContain("isSessionPassenger");
    const messagingPanel = workspaceFile("frontend/src/components/shared/MessagingPanel.tsx");
    const feedbackPage = workspaceFile("frontend/src/app/feedback/page.tsx");
    expect(messagingPanel).toContain("limitToLast(200)");
    expect(messagingPanel).toContain("requestId: pending.requestId");
    expect(messagingPanel).not.toContain("currentUserName");
    expect(feedbackPage).toContain("/api/feedback/${id}/status");
    expect(feedbackPage).not.toContain("updateDoc(");
  });

  it("gates post-ride feedback on a successful join scoped to the current session", () => {
    const passengerSource = loadPassengerSource();
    const boardingView = workspaceFile(
      "frontend/src/components/passenger/PassengerBoardingView.tsx",
    );

    expect(passengerSource).toContain("recordSuccessfulJoin(");
    expect(passengerSource).toContain("isPostRideFeedbackEligible(");
    expect(passengerSource).toContain("if (!hasSessionId(bus)) continue;");
    expect(passengerSource).toContain("key={activeBusOnRoute.sessionId}");
    expect(passengerSource).toContain("sessionId={activeBusOnRoute.sessionId}");
    expect(passengerSource).toContain("sessionId={feedbackSessionId}");
    expect(boardingView).toContain("result.joined !== true");
    expect(boardingView).toContain("onJoined?.()");
    expect(passengerSource).not.toContain("recordStopSelection(");
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

  it("keeps App Check enforcement out of Firestore rules", () => {
    const rules = workspaceFile("firestore.rules");
    expect(rules).not.toContain("request.app");
    expect(rules).not.toContain("isAppChecked");
  });

  it("keeps Realtime Database rules valid while App Check is enforced by Firebase", () => {
    const database = JSON.parse(workspaceFile("database.rules.json"));
    expect(database.rules.activeBuses[".read"]).toBe("auth != null");
    expect(JSON.stringify(database)).not.toContain("request.app");
    expect(database.rules.activeBuses[".write"]).toBe(false);
    expect(database.rules[".read"]).toBe(false);
  });

  it("makes CORS origins env-driven and fails closed in production (issue #39 D6)", () => {
    const server = workspaceFile("backend/src/server.ts");

    // No hardcoded project-specific origins; production refuses to start
    // without an explicit CORS_ORIGIN allowlist.
    expect(server).not.toContain("bustrack-be165");
    expect(server).toContain("CORS_ORIGIN must be set");
    expect(server).toContain("configuredCorsOrigins.length === 0");
    expect(server).toContain("process.env.CORS_ORIGIN");
    expect(server).not.toContain('"https://bustrack-be165.web.app"');
  });

  it("targets the Eki Firebase project for staging and deploys production explicitly (issue #39 M4)", () => {
    const firebaserc = JSON.parse(workspaceFile(".firebaserc"));
    const deploy = workspaceFile(".github/workflows/deploy.yml");

    // The single current Eki project is the safe default for staging.
    expect(firebaserc.projects.default).toBe("bustrack-be165");
    // Both environments deploy with an explicit --project.
    expect(deploy).toContain("--project bustrack-be165");
    expect(deploy).toContain("--project eki-production");
    // Production is approval-gated via a protected environment, not automated.
    expect(deploy).toContain("environment: production");
    expect(deploy).toContain("workflow_dispatch");

    // Audit #113: workflow_run deploys only follow successful same-repository
    // push runs on main, check out the exact head_sha, and manual dispatches
    // (staging AND production) require the main branch.
    expect(deploy).toContain("github.event.workflow_run.conclusion == 'success'");
    expect(deploy).toContain("github.event.workflow_run.event == 'push'");
    expect(deploy).toContain("github.event.workflow_run.head_branch == 'main'");
    expect(deploy).toContain("github.event.workflow_run.repository.full_name == github.repository");
    expect(deploy).toContain("github.event.workflow_run.head_sha");
    expect(deploy).toContain("github.ref == 'refs/heads/main'");
  });

  it("does not let the browser seed or take down hardware GNSS coordinates", () => {
    const operations = workspaceFile("frontend/src/components/admin/DashboardPanel.tsx");
    const passengerSource = loadPassengerSource();
    const passengerNormalizer = workspaceFile("frontend/src/lib/passengerLiveBus.ts");

    expect(operations).toContain("/api/shifts/start");
    expect(operations).not.toContain("updateDoc(");
    expect(passengerSource).toContain("passengerLiveBuses(");
    expect(passengerNormalizer).toContain(
      "hasValidBusCoordinates(candidate.lat, candidate.lng)",
    );
    expect(operations).toContain("assignedRouteIds(selectedBus)");
  });

  it("removes the driver workspace and keeps operations in the admin surface", () => {
    const root = resolve(__dirname, "../..");
    const adminPage = workspaceFile("frontend/src/app/admin/page.tsx");
    const homePage = workspaceFile("frontend/src/app/page.tsx");

    expect(existsSync(resolve(root, "frontend/src/app/driver"))).toBe(false);
    expect(existsSync(resolve(root, "frontend/src/components/driver"))).toBe(false);
    expect(adminPage).toContain('id: "operations"');
    expect(homePage).not.toContain('"/driver"');
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
    expect(telemetry).toContain("deviceRateLimitRetryAfterMs");
    expect(telemetry).toContain("DEVICE_RATE_LIMIT_PATH");
    expect(telemetry).toContain(".transaction((value)");
    expect(telemetry).toContain("credentialCacheKey(deviceId, suppliedDigest)");
    expect(telemetry).toContain("DEVICE_CREDENTIAL_VERSION_PATH");
    expect(devices).toContain("publishDeviceCredentialInvalidation(deviceId)");
    expect(telemetry).toContain("timingSafeEqual");
  });

  it("bounds authentication work and bypasses revocation cache for privileged claims", () => {
    const verifier = workspaceFile("backend/src/services/authTokenVerifier.ts");
    const requireAuth = workspaceFile("backend/src/middleware/requireAuth.ts");
    const requireAdmin = workspaceFile("backend/src/middleware/requireAdmin.ts");

    expect(verifier).toContain("AUTH_MAX_PENDING_VERIFICATIONS");
    expect(verifier).toContain("pendingVerifications.size >= pendingVerificationLimit()");
    expect(verifier).toContain("requiresFreshRevocationCheck(cached.decoded)");
    expect(requireAuth).toContain("AuthVerificationCapacityError");
    expect(requireAdmin).toContain("AuthVerificationCapacityError");
    expect(requireAuth).toContain('res.status(503)');
    expect(requireAdmin).toContain('res.status(503)');
  });

  it("shards in-memory rate limits across replicas and gates the backend image in CI (issue #28)", () => {
    const server = workspaceFile("backend/src/server.ts");
    const devices = workspaceFile("backend/src/routes/devices.ts");
    const shard = workspaceFile("backend/src/lib/rateLimitShard.ts");
    const envExample = workspaceFile("backend/.env.example");
    const workflow = workspaceFile(".github/workflows/ci.yml");

    // Every in-memory limiter divides its budget by the expected replica
    // count, so N replicas enforce the same aggregate budget as one instance;
    // the durable Firestore per-device budget needs no sharding.
    expect(shard).toContain("RATE_LIMIT_SHARD_FACTOR");
    expect(shard).toContain("Math.floor");
    expect(server).toContain("readRateLimitShardFactor()");
    expect(server).toContain("shardedLimit(200");
    expect(server).toContain("shardedLimit(30");
    expect(server).toContain("shardedLimit(10");
    expect(devices).toContain("shardedLimit(120");
    // Operators must set the factor to the deployed replica count.
    expect(envExample).toContain("RATE_LIMIT_SHARD_FACTOR");
    // The exact image that would be replicated builds and smoke-boots in CI.
    expect(workflow).toContain("backend-image");
    expect(workflow).toContain("docker build -f backend/Dockerfile");
    expect(workflow).toContain("eki-backend:ci");
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

  it("keeps user profiles and settings backend-authoritative", () => {
    const rules = workspaceFile("firestore.rules");
    const users = ruleBlock(rules, "match /users/{uid}");
    const settings = ruleBlock(rules, "match /settings/{document}");
    const usersRoute = workspaceFile("backend/src/routes/users.ts");
    const settingsRoute = workspaceFile("backend/src/routes/settings.ts");
    const authHook = workspaceFile("frontend/src/hooks/useAuth.ts");
    const settingsHook = workspaceFile("frontend/src/hooks/useSettings.ts");

    expect(users).toContain("allow read: if isOwner(uid);");
    expect(users).toContain("allow create: if false;");
    expect(users).toContain("allow update, delete: if false;");
    expect(settings).toContain("allow read: if isAuthenticated();");
    expect(settings).toContain("allow create, update, delete: if false;");
    expect(usersRoute).toContain('router.post("/bootstrap", requireAuth');
    expect(usersRoute).toContain('role: "passenger"');
    expect(usersRoute).toContain("transaction.create(userRef");
    expect(usersRoute).toContain("req.user?.email");
    expect(usersRoute).not.toContain("req.body");
    expect(usersRoute).toContain("ensurePassengerRoleClaim");
    expect(usersRoute).toContain('passengerClaims.role = "passenger"');
    expect(usersRoute).not.toContain('passengerClaims.role = "admin"');
    expect(settingsRoute).toContain('router.put("/", requireAdmin');
    expect(settingsRoute).toContain('"announcementActive"');
    // The frontend asks the backend instead of writing directly.
    expect(authHook).toContain("/api/users/bootstrap");
    expect(authHook).toContain("claimsUpdated === true");
    expect(authHook).toContain("firebaseUser.getIdToken(true)");
    expect(authHook).not.toContain("setDoc(userDocRef");
    expect(settingsHook).toContain("/api/settings");
    expect(settingsHook).not.toContain('setDoc(doc(db, "settings"');
  });

  it("allows the minimal reCAPTCHA Enterprise CSP surface required by App Check", () => {
    const cspBuild = workspaceFile("scripts/update-csp.mjs");

    expect(cspBuild).toContain('"https://www.google.com/recaptcha/"');
    expect(cspBuild).toContain('"https://recaptcha.google.com/recaptcha/"');
    expect(cspBuild).toContain("const frameSources");
    expect(cspBuild).toContain("/frame-src [^;]+;/");
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
    const firmwareConfig = workspaceFile("hardware/include/firmware_config.h");
    expect(firmware).toContain("tlsClient.setCACert(BACKEND_ROOT_CA)");
    expect(firmware).toContain("HTTPClient");
    expect(firmware).toContain("char authorizationHeader[");
    expect(firmware).toContain(
      "char authorizationHeader[eki::config::DEVICE_SECRET_MAX_LENGTH + 8]",
    );
    expect(firmware).toContain("constexpr size_t ENDPOINT_MAX_LENGTH");
    expect(firmware).toContain('"Device %s"');
    expect(firmware).not.toContain(
      'authorizationHeader = String("Device ")',
    );
    expect(firmware).toContain(
      'http.addHeader("Authorization", authorizationHeader)',
    );
    expect(firmware).not.toContain("HTTPClient::errorToString(responseCode)");
    expect(firmware).toContain('http.collectHeaders(responseHeaders, 1)');
    expect(firmware).toContain('#include "secrets.h"');
    expect(firmware).toContain("eki::config::validate(");
    expect(firmwareConfig).toContain("backendUrlUsesHttps");
    expect(firmwareConfig).toContain("backendRootCaIsValid");
    expect(firmware).not.toContain("Preferences");
    expect(firmware).not.toContain("Firebase_ESP_Client");
    expect(firmware).not.toContain("setInsecure(");
  });

  it("keeps routing identity outside the closed HTTPS payload", () => {
    const firmware = workspaceFile("hardware/src/main.cpp");
    const publisher = firmware.slice(
      firmware.indexOf("PublishResult publishFix"),
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
    const telemetryQueue = workspaceFile("hardware/include/telemetry_queue.h");
    const tripStateEngine = workspaceFile("backend/src/services/tripStateEngine.ts");

    expect(telemetryPolicy).toContain("STOPPED_HEARTBEAT_MS = 60000");
    expect(telemetryPolicy).toContain("motionStateChanged");
    expect(tripStateEngine).toContain("const STALE_BUS_MS = readIntervalMs");
    expect(telemetryPolicy).toContain("TELEMETRY_FRESHNESS_MARGIN_MS = 55000");
    expect(firmware).toContain("RTC_NOINIT_ATTR TelemetryQueue telemetryQueue");
    expect(firmware).toContain("xTaskCreatePinnedToCore");
    expect(telemetryQueue).toContain("dropOlderThan");
    expect(telemetryQueue).toContain("uint32_t overflowDrops;");
    expect(telemetryPolicy).toContain("HTTPS_RETRY_BASE_MS");
    expect(telemetryPolicy).toContain("HTTPS_RETRY_MAX_MS");
    expect(telemetryPolicy).toContain("retryAfterDelayMs");
    expect(telemetryPolicy).toContain("HttpResponseAction::DropSample");
    expect(firmware).toContain("httpsRetryIsPending()");
    expect(firmware).toContain("resetHttpsRetry()");
    expect(firmware).toContain("setRxBufferSize(GPS_RX_BUFFER_BYTES)");
    expect(tripStateEngine).not.toContain("snapshot.ref.remove().catch(console.error);");
  });

  it("keeps hardware clock, connectivity retry, and credential faults fail closed", () => {
    const firmware = workspaceFile("hardware/src/main.cpp");
    const clockPolicy = workspaceFile("hardware/include/clock_policy.h");
    const connectivityPolicy = workspaceFile("hardware/include/connectivity_policy.h");
    const telemetryPolicy = workspaceFile("hardware/include/telemetry_policy.h");
    const firmwareConfig = workspaceFile("hardware/include/firmware_config.h");
    const buildGate = workspaceFile("hardware/scripts/verify_secure_fleet.py");
    const platformConfig = workspaceFile("hardware/platformio.ini");
    const sdkConfig = workspaceFile("hardware/sdkconfig.defaults");

    expect(firmware).toContain("gps.date.isValid()");
    expect(firmware).toContain("gps.time.isValid()");
    expect(firmware).toContain("settimeofday(&tv, nullptr)");
    expect(firmware).toContain("std::numeric_limits<time_t>::max()");
    expect(firmware).toContain("NTP_CROSS_CHECK_INTERVAL_MS");
    expect(firmware).toContain("sntp_set_time_sync_notification_cb");
    expect(firmware).toContain("NTP/GNSS divergence=");
    expect(clockPolicy).toContain("utcToEpochMilliseconds");
    expect(clockPolicy).toContain("GNSS_CLOCK_CORRECTION_THRESHOLD_MS");

    expect(connectivityPolicy).toContain("WIFI_RETRY_MAX_MS");
    expect(connectivityPolicy).toContain("statusLedOn");
    expect(firmwareConfig).toContain("ValidationError validate(");
    expect(firmware).toContain("WiFi.persistent(false)");
    expect(firmware.indexOf("WiFi.persistent(false)")).toBeLessThan(
      firmware.indexOf("WiFi.mode(WIFI_STA)"),
    );
    expect(firmware).not.toContain("WIFI_AP");
    expect(firmware).not.toContain("WebServer");
    expect(buildGate).toContain("Application persistent storage is forbidden");
    expect(platformConfig).toContain("[env:esp32dev-secure]");
    expect(platformConfig).toContain("EKI_FLEET_BUILD=1");
    expect(sdkConfig).toContain("CONFIG_SECURE_BOOT_V2_ENABLED=y");
    expect(sdkConfig).toContain("CONFIG_SECURE_FLASH_ENCRYPTION_MODE_RELEASE=y");
    expect(sdkConfig).toContain("# CONFIG_ESP32_WIFI_NVS_ENABLED is not set");
    expect(firmware).toContain("esp_flash_encryption_enabled()");
    expect(firmware).toContain("esp_secure_boot_enabled()");
    expect(firmware).toContain(
      "EKI_FLEET_BUILD && (!flashEncryptionActive || !secureBootActive)",
    );

    expect(telemetryPolicy).toContain("HttpResponseAction::HaltCredentials");
    expect(firmware).toContain("credentialFaultActive = true");
    expect(firmware).toContain("WiFi.disconnect(true, false)");
    expect(firmware).toContain("WiFi.mode(WIFI_OFF)");
    expect(firmware).toContain("if (!credentialFaultActive)");
    expect(firmware).toContain("acknowledgeQueuedFix(fix.sequence)");
    expect(firmware).toContain("removeQueuedFix(fix.sequence)");
    expect(firmware).not.toContain("Preferences");
    expect(firmware).not.toContain("[Health]");
    expect(firmware).not.toContain("[Publisher] Started");
    expect(firmware).not.toContain("System time established from fresh GNSS UTC");
    expect(firmware).not.toContain("Eki asynchronous HTTPS telemetry");
    expect(firmware).not.toContain("[Watchdog] configure=");
    expect(firmware).toContain("result == PublishResult::CredentialFault");
  });

  it("routes all privileged route and delay mutations through the backend", () => {
    const rules = workspaceFile("firestore.rules");
    const routes = ruleBlock(rules, "match /routes/{routeId}");
    const sessions = ruleBlock(rules, "match /ride_sessions/{sessionId}");
    const routeEditor = workspaceFile("frontend/src/components/admin/RouteManagementPanel.tsx");
    const dashboard = workspaceFile("frontend/src/components/admin/DashboardPanel.tsx");

    expect(routes).toContain("allow create, update, delete: if false;");
    expect(sessions).toContain("allow create: if false;");
    expect(sessions).toContain("allow update: if false;");
    expect(sessions).not.toContain("resource.data.status in ['armed', 'active']");
    expect(routeEditor).toContain('method: "PUT"');
    expect(routeEditor).not.toContain("setDoc(");
    expect(routeEditor).not.toContain("updateDoc(");
    expect(dashboard).toMatch(
      /requestAdmin<\{ delayMinutes: number \}>\("\/api\/shifts\/delay",\s*\{\s*method: "PATCH"/,
    );
    expect(dashboard).not.toContain("Force Offline");
    expect(dashboard).not.toContain("Position Override");
    expect(dashboard).not.toContain("update(ref(rtdb");
  });

  it("removes the dead passenger-request client surface entirely", () => {
    const rules = workspaceFile("firestore.rules");
    const requests = ruleBlock(rules, "match /passenger_requests/{requestId}");

    // No client write surface: the collection is backend-authoritative via the
    // admin /api/requests route (issues #72 + #73). An explicit client create
    // rule with no consumer is a latent write surface with no retention.
    expect(requests).toBe("");
    expect(rules).not.toContain("match /passenger_requests");
  });

  it("gates passenger manifest self-join behind driver-issued proof and proximity", () => {
    const rules = workspaceFile("firestore.rules");
    const sessions = ruleBlock(rules, "match /ride_sessions/{sessionId}");
    const boarding = workspaceFile(
      "frontend/src/components/passenger/PassengerBoardingView.tsx",
    );
    const sessionsRoute = workspaceFile("backend/src/routes/sessions.ts");
    const boardingPolicy = workspaceFile("backend/src/services/boardingPolicy.ts");
    const operations = workspaceFile("frontend/src/components/admin/DashboardPanel.tsx");
    const cspBuild = workspaceFile("scripts/update-csp.mjs");
    const cspBackendOrigin = workspaceFile("scripts/csp-backend-origin.mjs");
    const server = workspaceFile("backend/src/server.ts");

    // Clients can never write ride_sessions; the manifest is backend-authoritative.
    expect(sessions).toContain("allow update: if false;");
    expect(sessions).toContain("allow delete: if false;");
    expect(sessions).not.toContain("affectedKeys().hasOnly(['passengers'])");
    // Boarding is issued by the backend join endpoint.
    expect(server).toContain('app.use("/api/sessions"');
    expect(sessionsRoute).toContain('router.post("/:sessionId/join", requireAuth');
    expect(sessionsRoute).toContain('router.post("/:sessionId/boarding-code", requireAuth');
    expect(sessionsRoute).toContain('user?.role === "admin"');
    expect(sessionsRoute).toContain("boardingCodesMatch");
    expect(sessionsRoute).toContain("validateLiveBoardingProjection");
    expect(sessionsRoute).toContain("db.runTransaction");
    expect(sessionsRoute).toContain('new FieldPath("passengers", user.uid)');
    expect(sessionsRoute).toContain("!requiresProximity && !passengerStillExists");
    expect(boardingPolicy).toContain("timingSafeEqual");
    expect(boardingPolicy).toContain("timestamp > now + MAX_JOIN_FIX_FUTURE_MS");
    expect(sessionsRoute).toContain("JOIN_RADIUS_M");
    expect(sessionsRoute).toContain("You must be near the bus to board");
    // The client asks the backend to board; it never writes the manifest.
    expect(boarding).toContain('/api/sessions/');
    expect(boarding).toContain('Authorization: `Bearer ${token}`');
    expect(boarding).toContain("position.coords.accuracy");
    expect(boarding).toContain("updatingExistingPassenger ? Promise.resolve(null)");
    expect(operations).toContain("/boarding-code");
    expect(cspBuild).toContain("backendOrigin");
    expect(cspBuild).toContain("const connectSources");
    expect(cspBuild).not.toContain("currentSources");
    expect(cspBackendOrigin).toContain('new Set(["http:", "https:"])');
    expect(cspBackendOrigin).toContain("!HTTP_PROTOCOLS.has(backendUrl.protocol)");
    expect(boarding).not.toContain('updateDoc');
    expect(boarding).not.toContain('setDoc');
  });

  it("uses backend-authoritative shift lifecycle endpoints", () => {
    const server = workspaceFile("backend/src/server.ts");
    const operations = workspaceFile("frontend/src/components/admin/DashboardPanel.tsx");
    const passengerBoarding = workspaceFile(
      "frontend/src/components/passenger/PassengerBoardingView.tsx",
    );
    const shifts = workspaceFile("backend/src/routes/shifts.ts");

    expect(server).toContain('app.use("/api/shifts"');
    expect(operations).toContain("/api/shifts/start");
    expect(operations).not.toContain("/api/shifts/stop");
    expect(operations).not.toContain("arrayUnion(");
    expect(operations).not.toContain("test_bus_1");
    expect(shifts).toContain("nodeRef.transaction");
    expect(shifts).toContain("final ordered stop");
    expect(shifts).toContain("STOP_GEOFENCE_M");
    expect(shifts).toContain("arrivedAtOrigin");
    expect(operations).toContain("It starts automatically at stop 1");
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
    expect(engine).not.toContain("forgetAfterWrite");
    expect(engine).toContain("persistOfflineFleetState");
    expect(engine).toContain('db.collection("_active_bus_locks")');
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

    const csp = headers.get("Content-Security-Policy") ?? "";
    expect(csp).toContain("default-src 'self'");
    const directives = new Map(csp.split(";").map((directive: string) => {
      const sources = directive.trim().split(/\s+/);
      return [sources[0], sources.slice(1)] as const;
    }));
    expect(directives.get("frame-src")).toEqual([
      "https://accounts.google.com",
      "https://*.firebaseapp.com",
      "https://www.google.com/recaptcha/",
      "https://recaptcha.google.com/recaptcha/",
    ]);
    expect(directives.get("connect-src")).toContain("https://www.google.com/recaptcha/");
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
