import { metrics, type Attributes, type ObservableResult } from "@opentelemetry/api";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import type { BackgroundFailureSnapshot } from "./backgroundFailureTracker";
import type { HealthSnapshot } from "./healthState";
import type { HttpsTelemetryStatus, LatencySummary } from "../services/deviceTelemetryService";

const meter = metrics.getMeter("eki-backend");
const requestCount = meter.createCounter("http.server.request.count", {
  description: "Completed HTTP server requests.",
});
const requestDuration = meter.createHistogram("http.server.request.duration", {
  description: "HTTP server request duration.",
  unit: "s",
});
const activeRequests = meter.createUpDownCounter("http.server.active_requests", {
  description: "Currently active HTTP server requests.",
});
const authAttempts = meter.createCounter("eki.auth.attempts", {
  description: "Authentication outcomes without user identifiers.",
});
const backgroundFailureCount = meter.createCounter("eki.background.failures", {
  description: "Background task failures by bounded source name.",
});
const workerRuns = meter.createCounter("eki.worker.runs", {
  description: "Background worker run outcomes.",
});

let workerLeader = 0;
meter.createObservableGauge("eki.worker.leader", {
  description: "One when this instance currently owns the worker lease.",
}).addCallback(result => result.observe(workerLeader));
meter.createObservableGauge("eki.process.heap.used", {
  description: "JavaScript heap currently used by this backend process.",
  unit: "By",
}).addCallback(result => result.observe(process.memoryUsage().heapUsed));

function routeLabel(req: Request): string {
  const routePath = (req.route as { path?: unknown } | undefined)?.path;
  if (typeof routePath === "string") return `${req.baseUrl || ""}${routePath}` || "/";
  return req.path
    .replace(/\/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, "/:id")
    .replace(/\/[A-Za-z0-9_-]{16,}(?=\/|$)/g, "/:id")
    .replace(/\/\d+(?=\/|$)/g, "/:id");
}

export function createHttpMetricsMiddleware(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.path === "/health") {
      next();
      return;
    }
    const started = performance.now();
    const activeAttributes: Attributes = { "http.request.method": req.method };
    activeRequests.add(1, activeAttributes);
    res.once("finish", () => {
      activeRequests.add(-1, activeAttributes);
      const attributes: Attributes = {
        "http.request.method": req.method,
        "http.route": routeLabel(req),
        "http.response.status_code": res.statusCode,
        "http.response.status_class": `${Math.floor(res.statusCode / 100)}xx`,
      };
      requestCount.add(1, attributes);
      requestDuration.record((performance.now() - started) / 1_000, attributes);
    });
    next();
  };
}

export function recordAuthAttempt(outcome: "success" | "missing" | "denied" | "capacity" | "error"): void {
  authAttempts.add(1, { outcome });
}

export function recordBackgroundFailureMetric(source: string): void {
  backgroundFailureCount.add(1, { source });
}

export function setWorkerLeadership(isLeader: boolean): void {
  workerLeader = isLeader ? 1 : 0;
}

export function recordWorkerRun(worker: string, outcome: "success" | "failure"): void {
  workerRuns.add(1, { worker, outcome });
}

function observeLatency(
  result: ObservableResult,
  stage: string,
  summary: LatencySummary,
): void {
  const statistics = {
    average: summary.average,
    p50: summary.p50,
    p95: summary.p95,
    p99: summary.p99,
  };
  for (const [statistic, value] of Object.entries(statistics)) {
    if (value !== null) result.observe(value, { stage, statistic });
  }
}

let operationalMetricsRegistered = false;

export function registerOperationalMetrics(readers: {
  health: () => HealthSnapshot;
  telemetry: () => HttpsTelemetryStatus;
  background: () => BackgroundFailureSnapshot;
}): void {
  if (operationalMetricsRegistered) return;
  operationalMetricsRegistered = true;

  meter.createObservableGauge("eki.dependency.ready", {
    description: "Dependency readiness by backend store.",
  }).addCallback(result => {
    const health = readers.health();
    result.observe(health.firestore === "connected" ? 1 : 0, { dependency: "firestore" });
    result.observe(health.rtdb === "connected" ? 1 : 0, { dependency: "rtdb" });
  });

  meter.createObservableCounter("eki.device.telemetry.accepted", {
    description: "Cumulative accepted device telemetry samples.",
  }).addCallback(result => result.observe(readers.telemetry().accepted));
  meter.createObservableCounter("eki.device.telemetry.rejected", {
    description: "Cumulative rejected device telemetry samples.",
  }).addCallback(result => result.observe(readers.telemetry().rejected));
  meter.createObservableGauge("eki.device.credential_cache.hit_ratio", {
    description: "Device credential cache hit ratio.",
  }).addCallback(result => {
    const value = readers.telemetry().credentialCacheHitRate;
    if (value !== null) result.observe(value);
  });
  meter.createObservableGauge("eki.device.telemetry.latency", {
    description: "Device telemetry latency summaries by processing stage.",
    unit: "ms",
  }).addCallback(result => {
    const telemetry = readers.telemetry();
    observeLatency(result, "processing", telemetry.processingLatencyMs);
    observeLatency(result, "device_queue", telemetry.deviceQueueLatencyMs);
    observeLatency(result, "network", telemetry.networkLatencyMs);
    observeLatency(result, "device_to_server", telemetry.deviceToServerLatencyMs);
    observeLatency(result, "rtdb_write", telemetry.rtdbWriteLatencyMs);
  });

  meter.createObservableCounter("eki.background.failures.total", {
    description: "Cumulative tracked background task failures.",
  }).addCallback(result => result.observe(readers.background().totalFailures));
  meter.createObservableGauge("eki.background.sustained_sources", {
    description: "Number of background sources currently failing persistently.",
  }).addCallback(result => result.observe(readers.background().sustainedSources.length));
}
