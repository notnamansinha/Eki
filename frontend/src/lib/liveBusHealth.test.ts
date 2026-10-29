import { describe, expect, it } from "vitest";
import { BUS_EXPIRY_MS, LIVE_DELAYED_MS, SIGNAL_LOST_MS } from "./liveBusFreshness";
import { describeLiveBusHealth, formatUpdateAge, liveBusHealth, nextLiveBusHealthChangeAt } from "./liveBusHealth";
import { isPassengerBusSelectable } from "./passengerAvailability";

const now = 1_800_000_000_000;
const bus = (ageMs: number, extra: Record<string, unknown> = {}) => ({
  deviceState: "online", motionState: "moving", timestamp: now - ageMs, backendReceivedAt: now - ageMs, ...extra,
});

describe("live bus health (field ride, 29 Oct 2026)", () => {
  it("degrades within seconds of silence instead of 90 s: a 1 Hz bus is delayed after ~12 s and lost by 30 s", () => {
    expect(LIVE_DELAYED_MS).toBeLessThanOrEqual(15_000);
    expect(SIGNAL_LOST_MS).toBeLessThanOrEqual(30_000);
    expect(liveBusHealth(bus(1_000), now).state).toBe("live");
    expect(liveBusHealth(bus(LIVE_DELAYED_MS), now).state).toBe("live");
    expect(liveBusHealth(bus(LIVE_DELAYED_MS + 1), now).state).toBe("delayed");
    expect(liveBusHealth(bus(SIGNAL_LOST_MS), now).state).toBe("delayed");
    expect(liveBusHealth(bus(SIGNAL_LOST_MS + 1), now).state).toBe("lost");
    expect(liveBusHealth(bus(BUS_EXPIRY_MS + 1), now).state).toBe("lost");
  });

  it("reports a GNSS-loss packet at once, even though it is a fresh packet, and keeps reporting it through the silence that follows", () => {
    expect(liveBusHealth(bus(500, { signalState: "gnss_lost", motionState: "uncertain" }), now))
      .toMatchObject({ state: "gnss_lost", ageMs: 500 });
    expect(liveBusHealth(bus(120_000, { signalState: "gnss_lost", motionState: "uncertain" }), now).state).toBe("gnss_lost");
    // A held implausible jump is also an untrustworthy position.
    expect(liveBusHealth(bus(500, { motionState: "uncertain" }), now).state).toBe("gnss_lost");
  });

  it("puts an offline device above everything else and treats missing or future time as lost", () => {
    expect(liveBusHealth(bus(0, { deviceState: "offline", signalState: "gnss_lost" }), now).state).toBe("offline");
    expect(liveBusHealth({ deviceState: "online" }, now).state).toBe("lost");
    expect(liveBusHealth(bus(-10_001), now).state).toBe("lost");
    expect(liveBusHealth(bus(-10_001), now).ageMs).toBeUndefined();
    expect(describeLiveBusHealth(liveBusHealth(bus(-10_001), now)).detail).not.toContain("just now");
  });

  it("keeps a valid stationary bus live: stationary fixes still arrive at 1 Hz", () => {
    expect(liveBusHealth(bus(900, { motionState: "stopped", signalState: "connected" }), now).state).toBe("live");
  });

  it("schedules the next re-evaluation at the exact threshold crossing, so no snapshot is needed to degrade", () => {
    const last = now - 2_000;
    const live = { ...bus(2_000) };
    expect(nextLiveBusHealthChangeAt(live, now)).toBe(last + LIVE_DELAYED_MS + 1);
    expect(nextLiveBusHealthChangeAt(live, last + LIVE_DELAYED_MS + 1)).toBe(last + SIGNAL_LOST_MS + 1);
    expect(nextLiveBusHealthChangeAt(live, last + SIGNAL_LOST_MS + 1)).toBe(last + BUS_EXPIRY_MS);
    expect(nextLiveBusHealthChangeAt(live, last + BUS_EXPIRY_MS)).toBeUndefined();
    expect(nextLiveBusHealthChangeAt({ deviceState: "offline" }, now)).toBeUndefined();
  });

  it("formats the age a passenger can act on", () => {
    expect(formatUpdateAge(undefined)).toBe("unknown");
    expect(formatUpdateAge(3_000)).toBe("just now");
    expect(formatUpdateAge(14_400)).toBe("14 s ago");
    expect(formatUpdateAge(59_999)).toBe("59 s ago");
    expect(formatUpdateAge(61_000)).toBe("1 min ago");
    expect(formatUpdateAge(2 * 3_600_000)).toBe("over an hour ago");
  });

  it("describes each state without guessing which component failed", () => {
    expect(describeLiveBusHealth({ state: "live", ageMs: 1_000 })).toMatchObject({ tone: "live", title: "Live" });
    expect(describeLiveBusHealth({ state: "delayed", ageMs: 14_000 })).toMatchObject({ tone: "warning", title: "Updates delayed",
      detail: expect.stringContaining("14 s ago") });
    expect(describeLiveBusHealth({ state: "gnss_lost", ageMs: 5_000 })).toMatchObject({ tone: "warning", title: "GPS signal lost" });
    expect(describeLiveBusHealth({ state: "lost", ageMs: 45_000 })).toMatchObject({ tone: "danger", title: "Live tracking lost",
      detail: expect.stringContaining("45 s ago") });
    expect(describeLiveBusHealth({ state: "lost", ageMs: 45_000 }).detail).not.toMatch(/backend|server|receiver/i);
    expect(describeLiveBusHealth({ state: "offline" })).toMatchObject({ tone: "danger", title: "Bus offline" });
    // The map notice sits under the ride card: one short line, never a repeat of its paragraph.
    for (const state of ["delayed", "gnss_lost", "lost", "offline"] as const) {
      const description = describeLiveBusHealth({ state, ageMs: 20_000 });
      expect(description.summary.length).toBeLessThan(description.detail.length);
      expect(description.summary).toMatch(/not live|late/);
    }
  });
});

describe("passenger selectability agrees with backend boarding", () => {
  it("is not selectable while GNSS is lost or uncertain, matching validateLiveBoardingProjection", () => {
    expect(isPassengerBusSelectable(bus(500), now)).toBe(true);
    expect(isPassengerBusSelectable(bus(500, { motionState: "uncertain" }), now)).toBe(false);
    expect(isPassengerBusSelectable(bus(500, { signalState: "gnss_lost" }), now)).toBe(false);
    expect(isPassengerBusSelectable(bus(SIGNAL_LOST_MS + 1), now)).toBe(false);
  });
});
