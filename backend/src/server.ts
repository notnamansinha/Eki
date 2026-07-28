/**
 * BusTrack Backend - Main Server Entry Point
 *
 * Responsibilities:
 * - Initialize Express app with middleware (CORS, JSON, Helmet, rate-limit, dotenv)
 * - Create the HTTP server and mount protected REST API route groups
 * - Initialize Firebase-backed trip-state and ETA services
 * - Start the server and listen on PORT from .env
 *
 * Security notes:
 * - Socket connections require a valid Firebase ID token in socket.handshake.auth.token
 * - unauthenticated sockets are rejected before any event handlers run
 */

import "dotenv/config";

import express from "express";
import http from "http";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { preloadRoutePolylines } from "./lib/etaService";
import { db, rtdb } from "./lib/firebaseAdmin";
import { getMqttIngestStatus } from "./services/mqttIngestor";
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
httpServer.headersTimeout = 10_000;
httpServer.keepAliveTimeout = 5_000;
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

// Global HTTP rate limiter — prevents DoS on all REST endpoints
const globalLimiter = rateLimit({
  windowMs: 60 * 1000,  // 1 minute window
  max: 200,             // Max 200 requests per IP per minute
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please slow down." },
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
const CORS_ORIGINS = [
  ...configuredCorsOrigins,
  "https://bustrack-be165.web.app",
  "https://bustrack-be165.firebaseapp.com",
  ...(process.env.NODE_ENV === "production" ? [] : ["http://localhost:3000"]),
];
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
app.use(express.json({ limit: "16kb" })); // Prevent request body size attacks

// ── REST Routes ───────────────────────────────────────────────────────────────
app.use("/api/buses", writeLimiter, busRoutes);
app.use("/api/analytics", analyticsRoutes);
app.use("/api/requests", writeLimiter, requestRoutes);
app.use("/api/routes", routeComputeLimiter, polylineRoutes);
// Route planner — zero Google Maps API cost at runtime
app.use("/api/plan", routePlanLimiter, planRoutes);
app.use("/api/routes-list", routesListRoutes);
app.use("/api/devices", writeLimiter, devicesRoutes);
app.use("/api/places", placesRoutes);
app.use("/api/shifts", writeLimiter, shiftsRoutes);
app.use("/api/fleet", writeLimiter, fleetRoutes);
app.use("/api/privacy", writeLimiter, privacyRoutes);

// Socket.IO has been removed in favor of native Firebase streams.

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
  const mqtt = getMqttIngestStatus();
  const ready = firebaseReady && (
    process.env.NODE_ENV !== "production" ||
    process.env.WORKER_ENABLED === "false" ||
    mqtt.connected
  );
  res.status(ready ? 200 : 503).json({
    status: ready ? "ok" : "degraded",
    firebase: firebaseReady ? "connected" : "disconnected",
    mqtt: mqtt.configured ? (mqtt.connected ? "connected" : "disconnected") : "not_configured",
    checkedAt: lastHealthProbeAt,
  });
});

// ── Start Server ──────────────────────────────────────────────────────────────
let stopWorkers: (() => void) | null = null;
httpServer.listen(Number(PORT), "0.0.0.0", () => {
  console.log(`✅ BusTrack backend running on port ${PORT} (0.0.0.0)`);
  // Pre-load route polylines from Firestore into memory for zero-cost serving
  preloadRoutePolylines().catch((err) =>
    console.error("Failed to preload polylines:", err)
  );
  stopWorkers = startWorkerCoordinator();
});

function shutdown(signal: string) {
  console.log(`[Server] ${signal} received; shutting down.`);
  stopWorkers?.();
  httpServer.close((error) => {
    process.exit(error ? 1 : 0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));

export {};
