import { afterEach, describe, expect, it, vi } from "vitest";

describe("browser telemetry trace activation", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it.each([
    [{ receivedAt: 2_000 }, 2_000],
    [{ rtdbCommittedAt: 1_000 }, 1_000],
    [{ receivedAt: 2_000, rtdbCommittedAt: 1_000 }, 2_000],
    [{ receivedAt: 2_000, rtdbCommittedAt: "retired-invalid-alias" }, 2_000],
  ])("exports commit timing compatibly for %j", async (timing, expected) => {
    const browserWindow = { location: { search: "?telemetryTrace=1" } } as unknown as Window & typeof globalThis;
    vi.stubGlobal("window", browserWindow);
    const trace = await import("./telemetryTrace");
    trace.recordTelemetryListenerDelivery("bus_1_route_1", { busId: "bus_1", ...timing });
    expect(browserWindow.__ekiTelemetryTrace!.snapshot().records[0].rtdbCommittedAtMs).toBe(expected);
  });

  it("enables after an auth redirect adds the trace query parameter", async () => {
    const browserWindow = {
      location: { search: "?next=%2Fadmin" },
    } as unknown as Window & typeof globalThis;
    vi.stubGlobal("window", browserWindow);

    const trace = await import("./telemetryTrace");
    expect(trace.telemetryTraceEnabled()).toBe(false);

    browserWindow.location.search = "?telemetryTrace=1";
    expect(trace.telemetryTraceEnabled()).toBe(true);

    trace.recordTelemetryListenerDelivery("bus_1_route_1", {
      busId: "bus_1",
      routeId: "route_1",
      timestamp: 1_000,
      seq: 1,
    });
    expect(browserWindow.__ekiTelemetryTrace?.snapshot().records).toHaveLength(1);
  });

  it("does not inspect realtime payloads when tracing is disabled", async () => {
    vi.stubGlobal("window", { location: { search: "" } });
    const trace = await import("./telemetryTrace");
    const serialize = vi.fn(() => "private content");
    trace.recordRealtimePayload("messages", { toJSON: serialize });
    expect(serialize).not.toHaveBeenCalled();
    expect(trace.beginMessageWriteTrace("session")).toBeNull();
  });

  it("records visibility, network hints and page lifecycle without retaining page content", async () => {
    const browserWindow = Object.assign(new EventTarget(), {
      location: { search: "?telemetryTrace=1" },
      matchMedia: () => ({ matches: true }),
    }) as unknown as Window & typeof globalThis;
    const browserDocument = Object.assign(new EventTarget(), { visibilityState: "visible", title: "private title" });
    const browserNavigator = { onLine: true };
    vi.stubGlobal("window", browserWindow);
    vi.stubGlobal("document", browserDocument);
    vi.stubGlobal("navigator", browserNavigator);
    const trace = await import("./telemetryTrace");
    trace.recordRealtimeConnection(true);
    const api = browserWindow.__ekiTelemetryTrace!;
    expect(api.snapshot().records[0]).toMatchObject({ browserVisibilityState: "visible", browserOnline: true, browserReducedMotion: true });
    browserDocument.visibilityState = "hidden";
    browserDocument.dispatchEvent(new Event("visibilitychange"));
    browserNavigator.onLine = false;
    browserWindow.dispatchEvent(new Event("offline"));
    browserWindow.dispatchEvent(Object.assign(new Event("pagehide"), { persisted: true }));
    const records = api.snapshot().records;
    expect(records.slice(1).map(record => record.trigger)).toEqual(["visibilitychange", "offline", "pagehide"]);
    expect(records[1]).toMatchObject({ event: "browser_lifecycle", browserVisibilityState: "hidden", browserOnline: true });
    expect(records[2]).toMatchObject({ browserOnline: false });
    expect(records[3]).toMatchObject({ persisted: true });
    expect(records.every(record => typeof record.browserWallAtMs === "number" && typeof record.browserMonotonicAtMs === "number")).toBe(true);
    expect(JSON.stringify(api.snapshot())).not.toContain("private");
    const originalRun = api.snapshot().runId;
    api.clear();
    browserDocument.visibilityState = "visible";
    browserDocument.dispatchEvent(new Event("visibilitychange"));
    browserWindow.dispatchEvent(Object.assign(new Event("pageshow"), { persisted: true }));
    expect(api.snapshot().runId).not.toBe(originalRun);
    expect(api.snapshot().records.map(record => record.eventId)).toEqual([1, 2]);
    expect(api.snapshot().records[1]).toMatchObject({ trigger: "pageshow", persisted: true });
  });

  it("leaves unavailable browser context explicit and installs no observers when disabled", async () => {
    const browserWindow = { location: { search: "" }, addEventListener: vi.fn() } as unknown as Window & typeof globalThis;
    vi.stubGlobal("window", browserWindow);
    vi.stubGlobal("document", undefined);
    vi.stubGlobal("navigator", undefined);
    const trace = await import("./telemetryTrace");
    expect(browserWindow.addEventListener).not.toHaveBeenCalled();
    expect(browserWindow.__ekiTelemetryTrace).toBeUndefined();
    browserWindow.location.search = "?telemetryTrace=1";
    trace.recordRealtimeConnection(true);
    expect(browserWindow.__ekiTelemetryTrace!.snapshot().records[0]).toMatchObject({ browserVisibilityState: "unknown", browserOnline: null, browserReducedMotion: null });
  });

  it("exports UTF-8 byte estimates and timing without message content", async () => {
    const browserWindow = { location: { search: "?telemetryTrace=1" } } as unknown as Window & typeof globalThis;
    vi.stubGlobal("window", browserWindow);
    const trace = await import("./telemetryTrace");
    const payload = { text: "private message é", token: "private token" };
    trace.recordRealtimePayload("messages", payload);
    trace.recordRealtimeWatch("messages", true);
    trace.recordRealtimeConnection(true);
    const start = trace.beginMessageWriteTrace("session");
    trace.recordMessageWriteTrace("session", "opaque-id", start, 201);
    trace.recordMessageListenerTrace("session", "opaque-id");
    const exported = browserWindow.__ekiTelemetryTrace!.snapshot();
    expect(exported.records[0].bytes).toBe(new TextEncoder().encode(JSON.stringify(payload)).byteLength);
    expect(JSON.stringify(exported)).not.toContain("private");
    expect(exported.records.map(record => record.event)).toEqual([
      "realtime_payload", "realtime_watch", "realtime_connection", "message_attempt", "message_write", "message_listener",
    ]);
  });
});
