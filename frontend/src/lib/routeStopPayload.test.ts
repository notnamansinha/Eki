import { describe, expect, it } from "vitest";
import { normalizeRouteStopPayload, prepareRouteSavePayload, routeIdFromName } from "./routeStopPayload";

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
      type: "circular",
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
        type: "circular",
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
      type: "up",
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
      type: "down",
      stops: [
        { id: "same", name: "A", lat: 23, lng: 72.5 },
        { id: "same", name: "B", lat: 23.1, lng: 72.6 },
      ],
    });

    expect(result).toEqual({ ok: false, error: "Each stop must be added only once." });
  });
});
