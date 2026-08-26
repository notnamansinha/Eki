import { describe, expect, it } from "vitest";
import { telemetryMarkerPosition } from "./telemetryMarkerPosition";

describe("telemetry marker position", () => {
  it("preserves an off-route GNSS fix exactly", () => {
    const fix = { lat: 23.031807, lng: 72.552326 };

    expect(telemetryMarkerPosition(fix)).toEqual(fix);
  });
});
