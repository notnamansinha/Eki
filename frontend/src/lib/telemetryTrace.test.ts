import { afterEach, describe, expect, it, vi } from "vitest";

describe("browser telemetry trace activation", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
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
});
