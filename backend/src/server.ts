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
import fleetRoutes from "./routes/fleet";
import privacyRoutes from "./routes/privacy";

const PORT = process.env.PORT || 4000;
const configuredCorsOrigins = (process.env.CORS_ORIGIN || "")
  .split(",")
  .map(origin => origin.trim())
  .filter(Boolean);

const app = express();
if (process.env.NODE_ENV === "production") {
  app.set("trust proxy", 1);
}
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

function isDeviceTelemetryRequest(req: express.Request): boolean {
  return (
    req.method === "POST" &&
    /^\/api\/devices\/[A-Za-z0-9_-]{1,128}\/telemetry$/.test(req.path)
  );
}

// Global HTTP rate limiter — prevents DoS on all REST endpoints
const globalLimiter = rateLimit({
  windowMs: 60 * 1000,  // 1 minute window
  max: 200,             // Max 200 requests per IP per minute
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please slow down." },
  skip: isDeviceTelemetryRequest,
});
app.use(globalLimiter);

// Tighter limit for write-heavy mutation endpoints
const writeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Write rate limit exceeded." },
});

// ── CORS ──────────────────────────────────────────────────────────────────────
const CORS_ORIGINS = [...new Set([
  ...configuredCorsOrigins,
  "https://bustrack-be165.web.app",
  "https://bustrack-be165.firebaseapp.com",
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
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Route computation rate limit exceeded." },
});
const routePlanLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
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
    req.method === "POST" && /\/telemetry$/.test(req.path)
      ? next()
      : writeLimiter(req, res, next),
  devicesRoutes,
);
app.use("/api/places", placesRoutes);
app.use("/api/shifts", writeLimiter, shiftsRoutes);
app.use("/api/fleet", writeLimiter, fleetRoutes);
app.use("/api/privacy", writeLimiter, privacyRoutes);

// ── Health Check ──────────────────────────────────────────────────────────────
let firebaseReady = false;
let lastHealthProbeAt: string | null = null;
async function probeFirebase(): Promise<void> {
  try {
    await Promise.all([
      db.collection("_health").limit(1).get(),
      rtdb.ref(".info/connected").once("value"),
    ]);
    firebaseReady = true;
  } catch {
    firebaseReady = false;
  }
  lastHealthProbeAt = new Date().toISOString();
}
void probeFirebase();
const healthProbeTimer = setInterval(() => void probeFirebase(), 30_000);
healthProbeTimer.unref();

// Return cached readiness so a public health-check flood cannot amplify into
// billable Firestore/RTDB reads on every request.
app.get("/health", (_req, res) => {
  const telemetry = getHttpsTelemetryStatus();
  const ready = firebaseReady;
  res.status(ready ? 200 : 503).json({
    status: ready ? "ok" : "degraded",
    firebase: firebaseReady ? "connected" : "disconnected",
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
    checkedAt: lastHealthProbeAt,
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
