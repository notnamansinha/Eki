// Adversarial probes for the live-health / stop-progress / catalog rules.
import { afterEach, describe, expect, it } from "vitest";
import {
  BUS_EXPIRY_MS, CATALOG_RECEIPT_BUCKET_MS, LIVE_DELAYED_MS, SIGNAL_LOST_MS, isCatalogReceiptLost,
} from "./liveBusFreshness";
import { describeLiveBusHealth, liveBusHealth, nextLiveBusHealthChangeAt } from "./liveBusHealth";
import { stopProgress } from "./stopProgress";
import { stopEstimateLabel } from "./passengerStopEstimates";
import { setServerTimeOffset } from "./serverClock";

const now = 1_800_000_000_000;
const bus = (ageMs: number, extra: Record<string, unknown> = {}) => ({
  deviceState: "online", motionState: "moving", timestamp: now - ageMs, backendReceivedAt: now - ageMs, ...extra,
});
afterEach(() => setServerTimeOffset(0));

describe("live bus health thresholds", () => {
  it("a 1 Hz bus with realistic jitter never leaves 'live'", () => {
    for (let age = 0; age <= 3_000; age += 137) expect(liveBusHealth(bus(age), now).state).toBe("live");
  });

  it("never schedules a deadline at or before now (no tight timer loop)", () => {
    for (const age of [-10_000, -1, 0, 1, LIVE_DELAYED_MS, LIVE_DELAYED_MS + 1, SIGNAL_LOST_MS, SIGNAL_LOST_MS + 1, BUS_EXPIRY_MS - 1, BUS_EXPIRY_MS]) {
      const next = nextLiveBusHealthChangeAt(bus(age), now);
      if (next !== undefined) expect(next).toBeGreaterThan(now);
    }
  });

  it("a receipt >10 s in the viewer's future is not described as updated 'just now' while called lost", () => {
    // e.g. offset estimate wrong by 11 s: state 'lost', ageMs clamps to 0.
    const health = liveBusHealth(bus(-11_000), now);
    expect(health.state).toBe("lost");
    expect(describeLiveBusHealth(health).detail).not.toMatch(/just now/);
  });

  it("server offset moves health as expected (viewer clock 40 s fast, offset known)", () => {
    setServerTimeOffset(-40_000);
    const t = Date.now() - 40_000; // server time
    expect(liveBusHealth({ deviceState: "online", motionState: "moving", timestamp: t, backendReceivedAt: t }).state).toBe("live");
  });
});

describe("catalog receipt buckets", () => {
  it("a 1 Hz bus never drops out of the route count at a bucket boundary", () => {
    // Receipts are floor(at / 30 s) * 30 s and the next bucket is written ~1-3 s
    // after the boundary. Sweep a few minutes of wall-clock.
    for (let t = now; t < now + 180_000; t += 250) {
      const latency = 3_000;
      const lastProcessed = t - latency;
      const receipt = Math.floor(lastProcessed / CATALOG_RECEIPT_BUCKET_MS) * CATALOG_RECEIPT_BUCKET_MS;
      expect(isCatalogReceiptLost(receipt, t)).toBe(false);
    }
  });

  it("after silence the count drops within 60 s, never later", () => {
    for (let last = now; last < now + 30_000; last += 1_000) {
      const receipt = Math.floor(last / CATALOG_RECEIPT_BUCKET_MS) * CATALOG_RECEIPT_BUCKET_MS;
      expect(isCatalogReceiptLost(receipt, last + 60_001)).toBe(true);
    }
  });
});


describe("stop progress edge cases", () => {
  it("terminal confirmation with a stale origin-at value does not mark the origin", () => {
    expect(stopProgress(4, { currentStopIndex: 3, atStopIndex: 0 })?.atStopIndex).toBeUndefined();
  });
  it("one-stop route at origin", () => {
    expect(stopProgress(1, { currentStopIndex: 0, atStopIndex: 0 })).toEqual({ states: ["at"], atStopIndex: 0 });
  });
  it("unobserved list containing the at-stop still shows the bus there", () => {
    expect(stopProgress(4, { currentStopIndex: 2, atStopIndex: 1, unobservedStopIndices: [1] })?.states)
      .toEqual(["passed", "at", "next", "upcoming"]);
  });
  it("huge / sparse unobserved arrays are bounded by the itinerary", () => {
    const sparse: unknown[] = []; sparse[1_000_000] = 1;
    expect(stopProgress(3, { currentStopIndex: 2, unobservedStopIndices: sparse })?.states).toEqual(["passed", "unobserved", "next"]);
  });
  it("an at-stop index is not called 'Bus is here' when ETAs are unavailable", () => {
    // stopEstimateLabel trusts atStopIndex even when estimates say tracking is lost.
    expect(stopEstimateLabel({ context: "c", minutes: {}, nextStopIndex: 2, atStopIndex: 1, unavailable: "Live tracking lost" }, "b", 1))
      .not.toBe("Bus is here");
  });
});

