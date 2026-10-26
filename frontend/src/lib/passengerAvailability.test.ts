import { describe, expect, it } from "vitest";
import { isPassengerBusSelectable } from "./passengerAvailability";
import { SIGNAL_LOST_MS } from "./liveBusFreshness";
const now = 1_000_000;
const fresh = { deviceState: "online", timestamp: now };
describe("new passenger bus selections", () => {
  it("accepts stationary fresh GPS without requiring movement or a direction", () => {
    expect(isPassengerBusSelectable(fresh, now)).toBe(true);
    expect(isPassengerBusSelectable({ ...fresh, timestamp: now - SIGNAL_LOST_MS }, now)).toBe(true);
  });
  it.each([undefined, { ...fresh, deviceState: "offline" }, { ...fresh, automaticServicePaused: true },
    { ...fresh, timestamp: now - SIGNAL_LOST_MS - 1 }, { ...fresh, timestamp: now + 10_001 },
    { ...fresh, timestamp: NaN }, { ...fresh, timestamp: now - 100_000, backendReceivedAt: now },
  ])("rejects unavailable telemetry while retaining the ride independently: %j", bus => {
    expect(isPassengerBusSelectable(bus, now)).toBe(false);
  });
});
