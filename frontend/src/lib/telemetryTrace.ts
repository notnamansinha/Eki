"use client";

import type { ActiveBusEntry } from "./activeBusEntries";

const TRACE_QUERY_PARAMETER = "telemetryTrace";
const MAX_TRACE_RECORDS = 25_000;

type TraceScenario = "unclassified" | string;
type TraceRecord = Record<string, string | number | boolean | null>;

interface TraceState {
  runId: string;
  scenario: TraceScenario;
  records: TraceRecord[];
  nextEventId: number;
  firebaseServerTimeOffsetMs: number | null;
}

export interface TelemetryTraceExport {
  version: 1;
  runId: string;
  exportedAt: string;
  firebaseServerTimeOffsetMs: number | null;
  records: TraceRecord[];
}

export interface TelemetryTraceBrowserApi {
  clear: () => void;
  download: (filename?: string) => void;
  downloadHealth: (filename?: string) => Promise<void>;
  setScenario: (scenario: string) => void;
  snapshot: () => TelemetryTraceExport;
}

declare global {
  interface Window {
    __ekiTelemetryTrace?: TelemetryTraceBrowserApi;
  }
}

let state: TraceState | null = null;
let traceEnabledForSession = false;

function wallClockNow(): number {
  return Date.now();
}

function monotonicNow(): number {
  return typeof performance !== "undefined" ? performance.now() : 0;
}

function newRunId(): string {
  return `${wallClockNow()}-${Math.random().toString(36).slice(2, 10)}`;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function createState(): TraceState {
  return {
    runId: newRunId(),
    scenario: "unclassified",
    records: [],
    nextEventId: 1,
    firebaseServerTimeOffsetMs: null,
  };
}

export function telemetryTraceEnabled(): boolean {
  if (typeof window === "undefined") return false;
  // Auth and App Router transitions can load this module before the final URL
  // contains the trace flag. Keep checking until tracing is enabled, then keep
  // it active for the tab so a later navigation cannot truncate the capture.
  traceEnabledForSession ||=
    new URLSearchParams(window.location.search).get(TRACE_QUERY_PARAMETER) === "1";
  return traceEnabledForSession;
}

function traceExport(current: TraceState): TelemetryTraceExport {
  return {
    version: 1,
    runId: current.runId,
    exportedAt: new Date().toISOString(),
    firebaseServerTimeOffsetMs: current.firebaseServerTimeOffsetMs,
    records: current.records.map((record) => ({ ...record })),
  };
}

function downloadJson(value: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(value, null, 2)], {
    type: "application/json",
  });
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.href = url;
  link.download = filename;
  link.click();
  // Keep the object URL alive through the browser's click/navigation task.
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function installBrowserApi(): void {
  if (typeof window === "undefined" || window.__ekiTelemetryTrace) return;
  window.__ekiTelemetryTrace = {
    clear: () => {
      const serverOffset = state?.firebaseServerTimeOffsetMs ?? null;
      state = createState();
      state.firebaseServerTimeOffsetMs = serverOffset;
    },
    setScenario: (scenario: string) => {
      const normalized = scenario.trim().toLowerCase();
      if (!/^[a-z0-9_-]{1,40}$/.test(normalized)) {
        throw new Error("Scenario must use 1-40 lowercase letters, numbers, underscores, or hyphens.");
      }
      const active = ensureState();
      active.scenario = normalized;
      appendRecord(active, {
        event: "browser_scenario",
        scenario: normalized,
      });
    },
    snapshot: () => traceExport(ensureState()),
    download: (filename?: string) => {
      const active = ensureState();
      downloadJson(
        traceExport(active),
        filename?.trim() || `eki-telemetry-${active.runId}.json`,
      );
    },
    downloadHealth: async (filename?: string) => {
      const [{ auth }, { apiRequest }] = await Promise.all([
        import("./firebaseAuth"),
        import("./apiClient"),
      ]);
      const currentUser = auth.currentUser;
      if (!currentUser) throw new Error("Sign in as an administrator first.");
      const token = await currentUser.getIdToken();
      const health = await apiRequest<unknown>("/api/health", {
        headers: { Authorization: `Bearer ${token}` },
        fallbackError: "Unable to capture backend health.",
      });
      downloadJson(
        health,
        filename?.trim() || `eki-telemetry-health-${wallClockNow()}.json`,
      );
    },
  };
  const lifecycle = (trigger: string, persisted: boolean | null = null) => {
    appendRecord(ensureState(), {
      event: "browser_lifecycle",
      trigger,
      persisted,
      browserMonotonicAtMs: monotonicNow(),
    });
  };
  if (typeof document !== "undefined") {
    document.addEventListener?.("visibilitychange", () => lifecycle("visibilitychange"));
  }
  window.addEventListener?.("pagehide", event => lifecycle("pagehide", event.persisted));
  window.addEventListener?.("pageshow", event => lifecycle("pageshow", event.persisted));
  window.addEventListener?.("online", () => lifecycle("online"));
  window.addEventListener?.("offline", () => lifecycle("offline"));
}

function ensureState(): TraceState {
  state ??= createState();
  installBrowserApi();
  return state;
}

function appendRecord(
  current: TraceState,
  record: Omit<TraceRecord, "eventId" | "runId" | "scenario">,
): void {
  if (current.records.length >= MAX_TRACE_RECORDS) current.records.shift();
  current.records.push({
    version: 1,
    eventId: current.nextEventId,
    runId: current.runId,
    scenario: current.scenario,
    browserWallAtMs: wallClockNow(),
    ...record,
    browserVisibilityState: typeof document !== "undefined" &&
      ["visible", "hidden"].includes(document.visibilityState) ? document.visibilityState : "unknown",
    // This browser hint is not proof that Firebase, the backend or Maps is reachable.
    browserOnline: typeof navigator !== "undefined" && typeof navigator.onLine === "boolean"
      ? navigator.onLine : null,
    browserReducedMotion: typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches : null,
  });
  current.nextEventId += 1;
}

function liveTimingFields(
  nodeKey: string,
  value: Record<string, unknown>,
): TraceRecord {
  const raw = value.rawLocation && typeof value.rawLocation === "object"
    ? value.rawLocation as Record<string, unknown>
    : null;
  const matched = value.matchedLocation && typeof value.matchedLocation === "object"
    ? value.matchedLocation as Record<string, unknown>
    : null;
  return {
    nodeKey,
    busId: readString(value.busId),
    routeId: readString(value.routeId),
    sessionId: readString(value.sessionId),
    seq: readNumber(raw?.seq) ?? readNumber(value.seq),
    matchedSeq: readNumber(matched?.seq),
    motionState: readString(raw?.motionState) ?? readString(value.motionState),
    routeState: readString(value.routeState),
    sampledAtDeviceMs: readNumber(raw?.sampledAt) ?? readNumber(value.timestamp),
    deviceSentAtDeviceMs: readNumber(value.deviceSentAt),
    backendReceivedAtMs: readNumber(value.backendReceivedAt),
    // Keep the export schema stable and accept historical alias-only captures.
    rtdbCommittedAtMs: readNumber(value.receivedAt) ?? readNumber(value.rtdbCommittedAt),
  };
}

export function setTelemetryServerTimeOffset(value: unknown): void {
  if (!telemetryTraceEnabled()) return;
  const current = ensureState();
  current.firebaseServerTimeOffsetMs = readNumber(value);
}

export function recordTelemetryListenerDelivery(
  nodeKey: string,
  value: Record<string, unknown>,
): void {
  if (!telemetryTraceEnabled()) return;
  const current = ensureState();
  const browserWallAtMs = wallClockNow();
  const serverOffset = current.firebaseServerTimeOffsetMs;
  appendRecord(current, {
    event: "browser_listener",
    ...liveTimingFields(nodeKey, value),
    browserWallAtMs,
    browserMonotonicAtMs: monotonicNow(),
    firebaseServerTimeOffsetMs: serverOffset,
    browserEstimatedServerAtMs:
      serverOffset === null ? null : browserWallAtMs + serverOffset,
  });
}

export function recordTelemetryRender(
  entry: ActiveBusEntry,
  consumer: "admin" | "passenger",
  displayKind: "matched" | "raw" | "held" | "none",
  event: "browser_render" | "browser_marker_settled" = "browser_render",
): void {
  if (!telemetryTraceEnabled()) return;
  const current = ensureState();
  const browserWallAtMs = wallClockNow();
  const serverOffset = current.firebaseServerTimeOffsetMs;
  const routeId = entry.routeId ?? "unknown-route";
  appendRecord(current, {
    event,
    ...(event === "browser_marker_settled" ? { markerToleranceMeters: 0.05 } : {}),
    consumer,
    displayKind,
    ...liveTimingFields(
      `${entry.busId}_${routeId}`,
      entry as unknown as Record<string, unknown>,
    ),
    browserWallAtMs,
    browserMonotonicAtMs: monotonicNow(),
    firebaseServerTimeOffsetMs: serverOffset,
    browserEstimatedServerAtMs:
      serverOffset === null ? null : browserWallAtMs + serverOffset,
  });
}

type RealtimeSource = "active_buses" | "messages";

function recordRealtime(event: string, fields: TraceRecord): void {
  if (!telemetryTraceEnabled()) return;
  const current = ensureState();
  appendRecord(current, { event, browserMonotonicAtMs: monotonicNow(), ...fields });
}

/** Logical application watch groups, not physical Firebase connections. */
export function recordRealtimeWatch(source: RealtimeSource, attached: boolean): void {
  recordRealtime("realtime_watch", { source, attached });
}

/** Application JSON size only: never store payload values or claim wire/billed bytes. */
export function recordRealtimePayload(source: RealtimeSource, value: unknown, fromCache = false): void {
  if (!telemetryTraceEnabled()) return;
  let bytes: number | null = null;
  try { bytes = new TextEncoder().encode(JSON.stringify(value)).byteLength; } catch { /* Missing estimate stays explicit. */ }
  recordRealtime("realtime_payload", { source, bytes, fromCache });
}

export function recordRealtimeConnection(connected: boolean): void {
  recordRealtime("realtime_connection", { connected });
}

export function beginMessageWriteTrace(sessionId: string): number | null {
  if (!telemetryTraceEnabled()) return null;
  const startedAtMs = monotonicNow();
  recordRealtime("message_attempt", { sessionId, startedAtMs });
  return startedAtMs;
}

export function recordMessageWriteTrace(sessionId: string, messageId: unknown, startedAtMs: number | null, status: number): void {
  if (startedAtMs === null) return;
  recordRealtime("message_write", { sessionId, messageId: readString(messageId), startedAtMs, status });
}

export function recordMessageListenerTrace(sessionId: string, messageId: string): void {
  recordRealtime("message_listener", { sessionId, messageId });
}

if (telemetryTraceEnabled()) ensureState();
