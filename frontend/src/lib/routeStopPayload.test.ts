import { describe, expect, it } from "vitest";
import { normalizeRouteStopPayload, routeIdFromName } from "./routeStopPayload";

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
});
