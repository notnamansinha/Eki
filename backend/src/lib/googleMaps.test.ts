import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  computeRouteGeometry,
  ROUTE_GEOMETRY_TIMEOUT_MS,
} from "./googleMaps";

const validRouteResponse = {
  routes: [
    {
      polyline: { encodedPolyline: "abc123" },
      distanceMeters: 1234,
      duration: "123s",
    },
  ],
};

function fetchResponse(body: unknown) {
  return { ok: true, json: async () => body } as Response;
}

describe("computeRouteGeometry", () => {
  beforeEach(() => {
    vi.stubEnv("GOOGLE_MAPS_API_KEY", "test-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("aborts the upstream request when it exceeds the timeout", async () => {
    vi.useFakeTimers();
    let capturedSignal: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, options: RequestInit) => {
        capturedSignal = options.signal;
        return new Promise((_resolve, reject) => {
          capturedSignal?.addEventListener("abort", () =>
            reject(new DOMException("The operation was aborted.", "AbortError")),
          );
        });
      }),
    );

    const pending = computeRouteGeometry(
      { lat: 23, lng: 72 },
      { lat: 23.1, lng: 72.1 },
    );
    // Register the rejection handler before firing the abort so the mock's
    // rejection is never momentarily unhandled.
    const aborted = expect(pending).rejects.toThrow("aborted");
    await vi.advanceTimersByTimeAsync(ROUTE_GEOMETRY_TIMEOUT_MS);
    await aborted;
    expect(capturedSignal?.aborted).toBe(true);
  });

  it("returns the geometry when the upstream responds in time", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => fetchResponse(validRouteResponse)));

    const result = await computeRouteGeometry(
      { lat: 23, lng: 72 },
      { lat: 23.1, lng: 72.1 },
    );

    expect(result).toEqual({
      encodedPolyline: "abc123",
      distanceMeters: 1234,
      duration: "123s",
    });
  });

  it("clears the timeout after a successful response", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn(async () => fetchResponse(validRouteResponse)));

    await computeRouteGeometry(
      { lat: 23, lng: 72 },
      { lat: 23.1, lng: 72.1 },
    );

    expect(vi.getTimerCount()).toBe(0);
  });
});
