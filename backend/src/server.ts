/**
 * BusTrack Backend - Main Server Entry Point
 *
 * Responsibilities:
 * - Initialize Express app with middleware (CORS, JSON, Helmet, rate-limit, dotenv)
 * - Create the HTTP server and mount protected REST API route groups
 * - Initialize Firebase-backed trip-state and recovery services
 * - Start the server and listen on PORT from .env
 *
 * Security notes:
 * - Authenticated API routes require a valid Firebase ID token
 */

import "dotenv/config";

import express from "express";
import http from "http";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { deleteApp } from "firebase-admin/app";
import { db, firebaseAdminApp, rtdb } from "./lib/firebaseAdmin";
import { getHttpsTelemetryStatus } from "./services/deviceTelemetryService";
import { backgroundFailures } from "./lib/backgroundFailureTracker";
import { createHealthState } from "./lib/healthState";
import { createIdentityAwareLimiter } from "./lib/rateLimitIdentity";
import { readRateLimitShardFactor, shardedLimit } from "./lib/rateLimitShard";
import { requireAdmin } from "./middleware/requireAdmin";
import { assertRetentionConfiguration } from "./services/retentionSweeper";
import { startWorkerCoordinator } from "./services/workerCoordinator";
import busRoutes from "./routes/buses";
import analyticsRoutes from "./routes/analytics";
import requestRoutes from "./routes/requests";
import polylineRoutes from "./routes/polyline";
import planRoutes from "./routes/plan";
import routesListRoutes from "./routes/routesList";
import devicesRoutes from "./routes/devices";
import placesRoutes from "./routes/places";
import shiftsRoutes from "./routes/shifts";
import sessionsRoutes from "./routes/sessions";
import feedbackRoutes from "./routes/feedback";
import usersRoutes from "./routes/users";
import settingsRoutes from "./routes/settings";
import fleetRoutes from "./routes/fleet";
import privacyRoutes from "./routes/privacy";

const PORT = process.env.PORT || 4000;
// Expected replica count behind the load balancer. Every in-memory limiter
// divides its budget by this factor so N replicas enforce the same aggregate
// budget as one instance (issue #28); the edge LB/WAF stays the authoritative
// global cap. Default 1 keeps single-instance behavior unchanged.
const RATE_LIMIT_SHARD_FACTOR = readRateLimitShardFactor();
const configuredCorsOrigins = (process.env.CORS_ORIGIN || "")
  .split(",")
  .map(origin => origin.trim())
  .filter(Boolean);

const app = express();
if (process.env.NODE_ENV === "production") {
  app.set("trust proxy", 1);
  // Fail closed (issue #39 D6): a production API with no configured browser
  // origin is misconfigured. Refuse to start rather than serve with an empty
  // allowlist. CORS is not an auth boundary, but the missing env var almost
  // always means the deploy forgot the frontend origin.
  if (configuredCorsOrigins.length === 0) {
    throw new Error("CORS_ORIGIN must be set (comma-separated) in production.");
  }
}
assertRetentionConfiguration(
  process.env.RETENTION_SWEEPER_ENABLED,
  process.env.NODE_ENV,
);
const httpServer = http.createServer(app);
httpServer.requestTimeout = 15_000;
httpServer.headersTimeout = 70_000;
httpServer.keepAliveTimeout = 65_000;
httpServer.maxRequestsPerSocket = 100;

// ── Security Middleware ───────────────────────────────────────────────────────
// Helmet sets safe HTTP headers (X-Content-Type-Options, X-Frame-Options, etc.)
// SEC-08 fix: enable a minimal CSP for this pure JSON API server.
// (Frontend CSP for Google Maps/Firebase is handled via firebase.json headers.)
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'none'"],
      scriptSrc:  ["'none'"],
      objectSrc:  ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

function isDeviceIngressRequest(req: express.Request): boolean {
  return (
    req.method === "POST" &&
    /^\/api\/devices\/[A-Za-z0-9_-]{1,128}\/(telemetry|diagnostics)$/.test(req.path)
  );
}

// Global HTTP rate limiter — prevents DoS on all REST endpoints. Buckets are
// keyed by the authenticated uid when a Bearer token is presented and by IP
// for anonymous traffic: on campus many browsers share one NAT egress IP, so
// an IP-only budget would 429 an entire lecture demo (issue #74).
const globalLimiter = createIdentityAwareLimiter({
  windowMs: 60 * 1000,  // 1 minute window
  limit: shardedLimit(200, RATE_LIMIT_SHARD_FACTOR), // 200/identity/minute ÷ replicas
  message: { error: "Too many requests, please slow down." },
  skip: isDeviceIngressRequest,
});
app.use(globalLimiter);

// Tighter limit for write-heavy mutation endpoints, keyed the same way.
const writeLimiter = createIdentityAwareLimiter({
  windowMs: 60 * 1000,
  limit: shardedLimit(30, RATE_LIMIT_SHARD_FACTOR),
  message: { error: "Write rate limit exceeded." },
});

// ── CORS ──────────────────────────────────────────────────────────────────────
// Browser origins come exclusively from the CORS_ORIGIN env var (issue #39
// D6): no hardcoded project-specific defaults. Production fails closed above.
const CORS_ORIGINS = [...new Set([
  ...configuredCorsOrigins,
  ...(process.env.NODE_ENV === "production" ? [] : ["http://localhost:3000"]),
])];
app.use(cors({ origin: CORS_ORIGINS, credentials: false }));
app.use((req, res, next) => {
  if (req.method === "TRACE" || req.method === "CONNECT") {
    res.status(405).json({ error: "Method not allowed." });
    return;
  }
  next();
});

// Route computation calls a billable upstream API. The admin-only route editor
// normally sends one request per save, so this guard leaves normal use ample
// headroom while limiting accidental loops and compromised admin sessions.
const routeComputeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: shardedLimit(10, RATE_LIMIT_SHARD_FACTOR),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Route computation rate limit exceeded." },
});
const routePlanLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: shardedLimit(30, RATE_LIMIT_SHARD_FACTOR),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Route planning rate limit exceeded." },
});
// Enforce the hardware contract against the original request bytes before the
// broader API parser runs. This prevents whitespace or duplicate-key payloads
// from bypassing the 512-byte telemetry limit after JSON normalization.
app.use(
  "/api/devices/:deviceId/telemetry",
  express.json({ limit: "512b", strict: true }),
);
app.use(
  "/api/devices/:deviceId/diagnostics",
  express.json({ limit: "1kb", strict: true }),
);
app.use(express.json({ limit: "16kb", strict: true })); // Prevent request body size attacks

// ── REST Routes ───────────────────────────────────────────────────────────────
app.use("/api/buses", writeLimiter, busRoutes);
app.use("/api/analytics", analyticsRoutes);
app.use("/api/requests", writeLimiter, requestRoutes);
app.use("/api/routes", routeComputeLimiter, polylineRoutes);
// Route planner — zero Google Maps API cost at runtime
app.use("/api/plan", routePlanLimiter, planRoutes);
app.use("/api/routes-list", routesListRoutes);
app.use(
  "/api/devices",
  (req, res, next) =>
    req.method === "POST" && /\/(telemetry|diagnostics)$/.test(req.path)
      ? next()
      : writeLimiter(req, res, next),
  devicesRoutes,
);
app.use("/api/places", placesRoutes);
app.use("/api/shifts", writeLimiter, shiftsRoutes);
app.use("/api/sessions", writeLimiter, sessionsRoutes);
app.use("/api/feedback", writeLimiter, feedbackRoutes);
app.use("/api/users", writeLimiter, usersRoutes);
app.use("/api/settings", writeLimiter, settingsRoutes);
app.use("/api/fleet", writeLimiter, fleetRoutes);
app.use("/api/privacy", writeLimiter, privacyRoutes);

// ── Health Check ──────────────────────────────────────────────────────────────
const health = createHealthState();
const probeFirestore = () => db.collection("_health").limit(1).get();
const probeRtdb = () => rtdb.ref(".info/connected").once("value");
void health.probe(probeFirestore, probeRtdb);
const healthProbeTimer = setInterval(() => {
  void health.probe(probeFirestore, probeRtdb);
}, 30_000);
healthProbeTimer.unref();

// Return only cached readiness publicly, so load balancers can probe the
// service without learning internal dependency, telemetry, or failure data.
app.get("/health", (_req, res) => {
  const state = health.snapshot();
  res.status(state.ready ? 200 : 503).json({
    status: state.ready ? "ok" : "degraded",
  });
});

// Detailed diagnostics are operationally sensitive and admin-only. This uses
// the same cached probes as /health, so monitoring cannot amplify billable
// Firebase reads.
app.get("/api/health", requireAdmin, (_req, res) => {
  const telemetry = getHttpsTelemetryStatus();
  const backgroundTasks = backgroundFailures.snapshot();
  const state = health.snapshot();
  res.status(state.ready ? 200 : 503).json({
    status: state.ready ? "ok" : "degraded",
    firestore: state.firestore,
    rtdb: state.rtdb,
    telemetry: {
      transport: "https",
      accepted: telemetry.accepted,
      rejected: telemetry.rejected,
      lastAcceptedAt: telemetry.lastAcceptedAt,
      lastRejectedAt: telemetry.lastRejectedAt,
      credentialCacheHitRate: telemetry.credentialCacheHitRate,
      processingLatencyMs: telemetry.processingLatencyMs,
      deviceToServerLatencyMs: telemetry.deviceToServerLatencyMs,
      rtdbWriteLatencyMs: telemetry.rtdbWriteLatencyMs,
    },
    // Fire-and-forget write health (issue #38): counts plus a sustained-failure
    // flag so an external monitor can alert without scraping logs. Kept out of
    // the readiness bit on purpose — one flapping background write must not
    // take the whole probe down (see healthState.ts).
    backgroundTasks: {
      totalFailures: backgroundTasks.totalFailures,
      sustainedSources: backgroundTasks.sustainedSources,
      sources: backgroundTasks.sources,
    },
    checkedAt: state.checkedAt,
  });
});

app.use((
  error: unknown,
  _req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) => {
  const parserError = error as { type?: unknown; status?: unknown };
  if (
    parserError?.type === "entity.too.large" ||
    parserError?.type === "entity.parse.failed"
  ) {
    if (res.headersSent) {
      next(error);
      return;
    }
    res.status(parserError.type === "entity.too.large" ? 413 : 400).json({
      error:
        parserError.type === "entity.too.large"
          ? "Request body is too large."
          : "Invalid JSON body.",
    });
    return;
  }
  next(error);
});

app.use((
  error: unknown,
  _req: express.Request,
  res: express.Response,
  _next: express.NextFunction,
) => {
  void _next;
  console.error("[Server] Unhandled request error:", error);
  res.status(500).json({ error: "Internal server error." });
});

// ── Start Server ──────────────────────────────────────────────────────────────
let stopWorkers: (() => Promise<void>) | null = null;
httpServer.listen(Number(PORT), "0.0.0.0", () => {
  console.log(`✅ BusTrack backend running on port ${PORT} (0.0.0.0)`);
  stopWorkers = startWorkerCoordinator();
});

let shuttingDown = false;
/** Drains network, worker, and Firebase resources within the platform grace period. */
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[Server] ${signal} received; shutting down.`);
  const shutdownBackstop = setTimeout(() => {
    console.error("[Server] Forced exit after 10-second shutdown timeout.");
    httpServer.closeAllConnections();
    process.exit(1);
  }, 10_000);

  clearInterval(healthProbeTimer);
  const closeServer = new Promise<void>((resolve, reject) => {
    httpServer.close((error) => error ? reject(error) : resolve());
    httpServer.closeIdleConnections();
  });
  const stopBackgroundWorkers = stopWorkers?.() ?? Promise.resolve();
  const [serverResult, workerResult] = await Promise.allSettled([
    closeServer,
    stopBackgroundWorkers,
  ]);
  const firebaseResult = await deleteApp(firebaseAdminApp).then(
    () => ({ status: "fulfilled" as const }),
    (reason: unknown) => ({ status: "rejected" as const, reason }),
  );
  clearTimeout(shutdownBackstop);

  const failures = [serverResult, workerResult, firebaseResult].filter(
    (result) => result.status === "rejected",
  );
  for (const failure of failures) {
    if (failure.status === "rejected") {
      console.warn("[Server] Shutdown task failed:", failure.reason);
    }
  }
  process.exitCode = failures.length > 0 ? 1 : 0;
}
process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));

export {};
