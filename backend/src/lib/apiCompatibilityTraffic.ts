import type { RequestHandler } from "express";
import { metrics } from "@opentelemetry/api";
const counter = metrics.getMeter("eki-backend").createCounter("eki.api.compatibility.requests", {
  description: "Compatibility traffic by fixed operation and generation; no client identifiers.",
});
const operations: Array<[string, string, RegExp, RegExp | null]> = [
  ["catalog", "GET", /^\/api\/routes-list\/?$/, /^\/api\/v2\/routes\/?$/],
  ["route-save", "PUT", /^\/api\/routes\/[^/]+$/, /^\/api\/v2\/routes\/[^/]+$/],
  ["route-save-status", "GET", /^\/api\/routes\/[^/]+\/save-operations\/[^/]+$/, /^\/api\/v2\/routes\/[^/]+\/save-operations\/[^/]+$/],
  ["route-preview", "POST", /^\/api\/routes\/compute-polyline$/, /^\/api\/v2\/route-geometry-previews\/?$/],
  ["boarding", "POST", /^\/api\/sessions\/[^/]+\/join$/, null],
  ["boarding", "PUT", /^$/, /^\/api\/v2\/ride-sessions\/[^/]+\/passengers\/me$/],
  ["boarding-code", "POST", /^\/api\/sessions\/[^/]+\/boarding-code$/, /^\/api\/v2\/ride-sessions\/[^/]+\/boarding-code$/],
  ["chat", "POST", /^\/api\/sessions\/[^/]+\/messages$/, /^\/api\/v2\/ride-sessions\/[^/]+\/messages$/],
  ["route-geometry", "GET", /^\/api\/routes\/[^/]+\/geometry$/, null],
  ["plan", "POST", /^\/api\/plan\/?$/, null],
  ["plan", "GET", /^$/, /^\/api\/v2\/routes\/[^/]+\/segments$/],
  ["ride-history-delete", "DELETE", /^\/api\/shifts\/[^/]+\/history$/, /^\/api\/v2\/ride-sessions\/[^/]+$/],
  ["ride-messages-delete", "DELETE", /^\/api\/shifts\/[^/]+\/messages$/, /^\/api\/v2\/ride-sessions\/[^/]+\/messages$/],
  ["shift-start", "POST", /^\/api\/shifts\/start$/, /^\/api\/v2\/ride-sessions\/?$/],
  ["shift-delay", "PATCH", /^\/api\/shifts\/delay$/, /^\/api\/v2\/ride-sessions\/[^/]+$/],
  ["shift-stop", "POST", /^\/api\/shifts\/stop$/, null],
  ["settings", "PUT", /^\/api\/settings\/?$/, null],
  ["settings", "PATCH", /^$/, /^\/api\/v2\/settings\/global$/],
  ["feedback-status", "PATCH", /^\/api\/feedback\/[^/]+\/status$/, /^\/api\/v2\/feedback\/[^/]+$/],
  ["privacy", "POST", /^\/api\/privacy\/deletion-request$/, /^\/api\/v2\/privacy-deletion-requests\/?$/],
];
const traffic = new Map<string, { requests: number; successful: number; lastSeenAt: string }>();
export function apiCompatibilityStatus() { return Object.fromEntries([...traffic].map(([key, value]) => [key, { ...value }])); }
export function createApiCompatibilityTraffic(): RequestHandler {
  return (req, res, next) => {
    const path = req.path.replace(/\/+$/, "") || "/";
    const match = operations.find(([, method, legacy, modern]) => method === req.method && (legacy.test(path) || modern?.test(path)));
    if (match) {
      const [operation, , legacy] = match; const generation = legacy.test(path) ? "legacy" : "v2";
      res.once("finish", () => {
        const key = `${operation}:${generation}`; const current = traffic.get(key) ?? { requests: 0, successful: 0, lastSeenAt: "" };
        current.requests++; if (res.statusCode >= 200 && res.statusCode < 300) current.successful++;
        current.lastSeenAt = new Date().toISOString(); traffic.set(key, current);
        counter.add(1, { operation, generation, status_class: `${Math.floor(res.statusCode / 100)}xx` });
      });
    }
    next();
  };
}
