import { describe, expect, it } from "vitest";
import { journeyLocation, newerJourneyLocation } from "./journeyLocation";
describe("historical last GNSS location", () => {
  it("uses raw accepted telemetry rather than the matched/display position", () => {
    expect(journeyLocation({ lat: 24, lng: 73, timestamp: 100, seq: 2, backendReceivedAt: 105,
      rawLocation: { lat: 23, lng: 72, sampledAt: 100, seq: 2 } })).toEqual({ lat: 23, lng: 72, sampledAt: 100, seq: 2, receivedAt: 105 });
  });
  it("rejects invalid coordinates and never replaces a newer fix with delayed evidence", () => {
    expect(journeyLocation({ lat: NaN, lng: 72, timestamp: 100 })).toBeNull();
    expect(journeyLocation({ lat: 23, lng: 181, timestamp: 100 })).toBeNull();
    expect(journeyLocation({ lat: 23, lng: 72 })).toBeNull();
    expect(newerJourneyLocation({ lat: 23, lng: 72, timestamp: 100 }, { sampledAt: 101 })).toBeNull();
  });
});
