import { describe, expect, it } from "vitest";
import {
  normalizeRouteStopPayload,
  prepareRouteSavePayload,
  reorderRouteStops,
  ROUTE_SAVE_MAX_BODY_BYTES,
  routeIdFromName,
  swapRouteEndpoints,
} from "./routeStopPayload";

describe("route stop save payload", () => {
  it("normalizes an old verbose search result and serialized dragged coordinates", () => {
    const verboseName = `Campus Gate — ${"Long formatted address ".repeat(8)}`;

    const result = normalizeRouteStopPayload({
      id: " stop-123 ",
      name: `  ${verboseName}  `,
      lat: "23.0335",
      lng: "72.5566",
    });

    expect(result.id).toBe("stop-123");
    expect(result.name).toHaveLength(100);
    expect(result.shortName).toBe("Campus Gate — Long formatted add");
    expect(result.lat).toBe(23.0335);
    expect(result.lng).toBe(72.5566);
  });

  it("generates a safe route ID from the display name", () => {
    expect(routeIdFromName("  Ahmedabad University → Club O7  ")).toBe(
      "route-ahmedabad-university-club-o7",
    );
  });

  it("builds a valid save request for searched, manually placed, and dragged stops", () => {
    const result = prepareRouteSavePayload({
      mode: "create",
      routeId: "",
      name: "  Shilp House to Club O7  ",
      color: "#3B82F6",
      stops: [
        { id: "stop-search", name: "Shilp House", lat: 23.0278, lng: 72.5067 },
        { id: "stop-map", name: "Club O7", lat: 22.991234, lng: 72.471234 },
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.value).toEqual({
      routeId: "route-shilp-house-to-club-o7",
      body: {
        mode: "create",
        name: "Shilp House to Club O7",
        color: "#3B82F6",
        stops: [
          { id: "stop-search", name: "Shilp House", shortName: "Shilp House", lat: 23.0278, lng: 72.5067 },
          { id: "stop-map", name: "Club O7", shortName: "Club O7", lat: 22.991234, lng: 72.471234 },
        ],
      },
    });
  });

  it.each([null, undefined, "", "   "])("rejects a missing coordinate represented as %p", (lat) => {
    const result = prepareRouteSavePayload({
      mode: "create",
      routeId: "route-test",
      name: "Test route",
      color: "#10B981",
      stops: [
        { id: "stop-a", name: "A", lat, lng: 72.5 },
        { id: "stop-b", name: "B", lat: 23, lng: 72.6 },
      ],
    });

    expect(result).toEqual({ ok: false, error: "Each stop needs a name and valid map coordinates." });
  });

  it("rejects duplicate stop IDs before calling the API", () => {
    const result = prepareRouteSavePayload({
      mode: "edit",
      routeId: "route-test",
      name: "Test route",
      color: "#10B981",
      stops: [
        { id: "same", name: "A", lat: 23, lng: 72.5 },
        { id: "same", name: "B", lat: 23.1, lng: 72.6 },
      ],
    });

    expect(result).toEqual({ ok: false, error: "Each stop must be added only once." });
  });

  it("rejects Firestore-reserved __…__ route IDs before calling the API", () => {
    const result = prepareRouteSavePayload({
      mode: "create",
      routeId: "__main__",
      name: "Main",
      color: "#10B981",
      stops: [
        { id: "__a__", name: "A", lat: 23, lng: 72.5 },
        { id: "stop-b", name: "B", lat: 23.1, lng: 72.6 },
      ],
    });

    expect(result).toEqual({
      ok: false,
      error: "Route ID may contain only letters, numbers, hyphens, and underscores (max 128 characters), and cannot both start and end with two underscores.",
    });
  });

  const maximumStops = (name: string) => Array.from({ length: 100 }, (_, index) => ({
    id: `${String(index).padStart(3, "0")}${"x".repeat(125)}`,
    name: name.repeat(100),
    lat: -23.123456789012345,
    lng: -172.12345678901234,
  }));

  it("accepts 100 maximum-length multi-byte stops within the route-save body limit", () => {
    const result = prepareRouteSavePayload({
      mode: "edit", routeId: "r".repeat(128), name: "क".repeat(100), color: "#10B981", stops: maximumStops("क"),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    const bytes = new TextEncoder().encode(JSON.stringify({ ...result.value.body, saveId: "s".repeat(128), expectedVersion: 1 })).length;
    expect(bytes).toBeGreaterThan(16 * 1024);
    expect(bytes).toBeLessThanOrEqual(ROUTE_SAVE_MAX_BODY_BYTES);
  });

  it("explains an over-limit route instead of letting the server reject it with 413", () => {
    // Control characters escape to six JSON bytes each.
    const result = prepareRouteSavePayload({
      mode: "edit", routeId: "route-test", name: "Test route", color: "#10B981", stops: maximumStops("\u0001"),
    });

    expect(result).toEqual({ ok: false, error: "Route is too large to save; shorten stop names or remove stops." });
  });

  it("swaps endpoints twice without changing stable stop identities", () => {
    const stops = [{ id: "origin" }, { id: "destination" }];
    const swapped = swapRouteEndpoints(stops);
    expect(swapped.map((stop) => stop.id)).toEqual(["destination", "origin"]);
    expect(swapRouteEndpoints(swapped)).toEqual(stops);
    expect(swapped[0]).toBe(stops[1]);
  });

  it("reorders a longer route without cloning or regenerating stops", () => {
    const stops = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const reordered = reorderRouteStops(stops, 2, 0);
    expect(reordered.map((stop) => stop.id)).toEqual(["c", "a", "b"]);
    expect(reordered[0]).toBe(stops[2]);
  });
});
