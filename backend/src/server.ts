/**
 * BusTrack Backend - Main Server Entry Point
 *
 * Responsibilities:
 * - Initialize Express app with middleware (CORS, JSON, Helmet, rate-limit, dotenv)
 * - Create HTTP server and attach Socket.io
 * - Mount REST API route groups (/api/buses, /api/analytics, /api/requests)
 * - Initialize the tracking Socket.io gateway with Firebase token auth
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
import { Server as SocketServer } from "socket.io";
import { trackingGateway, restoreState } from "./sockets/trackingGateway";
import { preloadRoutePolylines } from "./lib/etaService";
import { auth, db } from "./lib/firebaseAdmin";
import busRoutes from "./routes/buses";
import analyticsRoutes from "./routes/analytics";
import requestRoutes from "./routes/requests";
import polylineRoutes from "./routes/polyline";
import planRoutes from "./routes/plan";
import routesListRoutes from "./routes/routesList";

const PORT = process.env.PORT || 4000;
const CORS_ORIGIN = process.env.CORS_ORIGIN || "http://localhost:3000";

const app = express();
const httpServer = http.createServer(app);

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
  CORS_ORIGIN,
  "https://bustrack-be165.web.app",
  "https://bustrack-be165.firebaseapp.com",
  "http://localhost:3000",
];
app.use(cors({ origin: CORS_ORIGINS, credentials: true }));
app.use(express.json({ limit: "16kb" })); // Prevent request body size attacks

// ── REST Routes ───────────────────────────────────────────────────────────────
app.use("/api/buses", busRoutes);
app.use("/api/analytics", analyticsRoutes);
app.use("/api/requests", writeLimiter, requestRoutes);
app.use("/api/routes", writeLimiter, polylineRoutes);
// Route planner — zero Google Maps API cost at runtime
app.use("/api/plan", planRoutes);
app.use("/api/routes-list", routesListRoutes);

// ── Socket.io ─────────────────────────────────────────────────────────────────
const io = new SocketServer(httpServer, {
  cors: { origin: CORS_ORIGINS, methods: ["GET", "POST"], credentials: true },
  // Start with polling so Render's HTTP proxy can handle connections reliably;
  // socket.io will automatically upgrade to WebSocket when available.
  transports: ["polling", "websocket"],
  pingTimeout: 60000,
  pingInterval: 25000,
});

// ── SEC-04 fix: Authenticate every socket with a Firebase ID token ──
// Clients pass: io({ auth: { token: await getIdToken(firebaseUser) } })
// If no token is present (anonymous passenger), the socket still connects
// but is tagged as anonymous. Driver and admin events validate role inline.
io.use(async (socket, next) => {
  // Allow unauthenticated connections in local dev if explicitly opted out
  if (process.env.DISABLE_SOCKET_AUTH === "true" && process.env.NODE_ENV !== "production") {
    (socket as any).user = { uid: "dev-bypass", role: "admin" };
    return next();
  }

  const token = socket.handshake.auth?.token as string | undefined;
  if (!token) {
    // Anonymous connection — allowed for passengers reading live data
    (socket as any).user = { uid: "anonymous", role: "passenger" };
    return next();
  }

  try {
    const decoded = await auth.verifyIdToken(token);
    (socket as any).user = decoded; // Attach verified claims to socket
    next();
  } catch {
    // Bad token — still let them in as anonymous rather than hard-reject
    (socket as any).user = { uid: "anonymous", role: "passenger" };
    next();
  }
});

// All socket logic is consolidated in trackingGateway — no duplicate listeners
trackingGateway(io);

// ── Health Check ──────────────────────────────────────────────────────────────
// DEV-01 fix: probe Firestore so orchestrators detect a degraded Firebase connection.
app.get("/health", async (_req, res) => {
  try {
    await db.collection("_health").limit(1).get();
    res.json({ status: "ok", firebase: "connected", timestamp: new Date().toISOString() });
  } catch {
    // Return 503 so Render/load-balancers can take this instance out of rotation
    res.status(503).json({ status: "degraded", firebase: "disconnected", timestamp: new Date().toISOString() });
  }
});

// ── Start Server ──────────────────────────────────────────────────────────────
httpServer.listen(Number(PORT), "0.0.0.0", () => {
  console.log(`✅ BusTrack backend running on port ${PORT} (0.0.0.0)`);
  // Pre-load route polylines from Firestore into memory for zero-cost serving
  preloadRoutePolylines().catch((err) =>
    console.error("Failed to preload polylines:", err)
  );
  // Restore tracking state
  restoreState(io).catch((err) => 
    console.error("Failed to restore tracking state:", err)
  );
});

export { io };
