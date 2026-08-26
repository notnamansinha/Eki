import { describe, expect, it } from "vitest";
import { BUS_EXPIRY_MS } from "./liveBusFreshness";
import {
  filterActiveBusEntries,
  isActiveBusEntry,
  isLiveChatDeviceOnline,
} from "./activeBusEntries";

describe("isLiveChatDeviceOnline", () => {
  it("depends only on device presence, not ride status or motion", () => {
    expect(isLiveChatDeviceOnline({ deviceState: "online", status: "offline", motionState: "stopped" })).toBe(true);
    expect(isLiveChatDeviceOnline({ deviceState: "online", status: "active", motionState: "moving" })).toBe(true);
    expect(isLiveChatDeviceOnline({ deviceState: "offline", status: "active", motionState: "moving" })).toBe(false);
    expect(isLiveChatDeviceOnline(undefined)).toBe(false);
  });
});

describe("isActiveBusEntry", () => {
  const now = 2_000_000_000_000;

  it("rejects non-objects and missing identities", () => {
    expect(isActiveBusEntry(null, now)).toBe(false);
    expect(isActiveBusEntry("bus_1", now)).toBe(false);
    expect(isActiveBusEntry(undefined, now)).toBe(false);
    expect(isActiveBusEntry({}, now)).toBe(false);
    expect(isActiveBusEntry({ busId: "" }, now)).toBe(false);
  });

  it("accepts fresh telemetry and active rides", () => {
    expect(isActiveBusEntry({ busId: "bus_1", timestamp: now - 1_000 }, now)).toBe(true);
    expect(
      isActiveBusEntry(
        { busId: "bus_1", timestamp: now - BUS_EXPIRY_MS, status: "active", sessionId: "s1", tripState: "pre_departure" },
        now,
      ),
    ).toBe(true);
  });

  it("accepts a powered online bus before a ride session is armed", () => {
    expect(
      isActiveBusEntry(
        {
          busId: "Bus01",
          routeId: "route_1",
          timestamp: now - 1_000,
          deviceState: "online",
          tripState: "pre_departure",
          motionState: "moving",
        },
        now,
      ),
    ).toBe(true);
  });

  it("rejects stale telemetry outside a ride", () => {
    expect(isActiveBusEntry({ busId: "bus_1", timestamp: now - BUS_EXPIRY_MS }, now)).toBe(false);
  });

  it("rejects malformed optional fields before they reach renderers", () => {
    const malformed = [
      { busId: "bus_1", timestamp: now - 1_000, lat: "23.0" },
      { busId: "bus_1", timestamp: now - 1_000, lng: 181 },
      { busId: "bus_1", timestamp: now - 1_000, speed: Number.NaN },
      { busId: "bus_1", timestamp: now - 1_000, currentStopIndex: 1.5 },
      { busId: "bus_1", timestamp: now - 1_000, deviceState: "unknown" },
      { busId: "bus_1", timestamp: now - 1_000, motionState: "flying" },
      { busId: "bus_1", timestamp: now - 1_000, tripState: "paused" },
      { busId: "bus_1", timestamp: now - 1_000, status: "unknown" },
      { busId: "bus_1", timestamp: now - 1_000, routeId: 42 },
    ];

    for (const entry of malformed) {
      expect(isActiveBusEntry(entry, now)).toBe(false);
      expect(filterActiveBusEntries({ malformed: entry }, now)).toEqual([]);
    }
  });
});

describe("filterActiveBusEntries", () => {
  const now = 2_000_000_000_000;

  it("returns an empty list for null or empty snapshots", () => {
    expect(filterActiveBusEntries(null, now)).toEqual([]);
    expect(filterActiveBusEntries(undefined, now)).toEqual([]);
    expect(filterActiveBusEntries({}, now)).toEqual([]);
  });

  it("keeps an entry with fresh telemetry", () => {
    const entries = filterActiveBusEntries(
      {
        bus_1_route_1: {
          busId: "bus_1",
          routeId: "route_1",
          timestamp: now - 5_000,
          motionState: "moving",
        },
      },
      now,
    );
    expect(entries).toHaveLength(1);
    expect(entries[0].busId).toBe("bus_1");
  });

  it("drops stale telemetry that is not part of an active ride", () => {
    const entries = filterActiveBusEntries(
      {
        bus_1_route_1: {
          busId: "bus_1",
          timestamp: now - BUS_EXPIRY_MS,
        },
      },
      now,
    );
    expect(entries).toEqual([]);
  });

  it("keeps a stale node when it is part of an active ride", () => {
    const entries = filterActiveBusEntries(
      {
        bus_1_route_1: {
          busId: "bus_1",
          timestamp: now - BUS_EXPIRY_MS,
          status: "active",
          sessionId: "session_1",
          tripState: "in_service",
        },
      },
      now,
    );
    expect(entries).toHaveLength(1);
    expect(entries[0].sessionId).toBe("session_1");
  });

  it("drops a completed node even while its final telemetry is fresh", () => {
    const completed = {
      busId: "bus_1",
      status: "active",
      sessionId: "session_1",
      tripState: "completed" as const,
    };
    expect(
      filterActiveBusEntries(
        { bus_1_route_1: { ...completed, timestamp: now - 1_000 } },
        now,
      ),
    ).toEqual([]);
    expect(
      filterActiveBusEntries({ bus_1_route_1: { ...completed, timestamp: now - BUS_EXPIRY_MS } }, now),
    ).toEqual([]);
  });

  it("drops entries without a valid busId", () => {
    const entries = filterActiveBusEntries(
      {
        malformed: { timestamp: now - 1_000 },
        emptyId: { busId: "", timestamp: now - 1_000 },
        ok: { busId: "bus_1", timestamp: now - 1_000 },
      },
      now,
    );
    expect(entries.map((entry) => entry.busId)).toEqual(["bus_1"]);
  });

  it("rejects far-future timestamps beyond the clock-skew allowance", () => {
    const entries = filterActiveBusEntries(
      {
        bus_1_route_1: { busId: "bus_1", timestamp: now + 20_000 },
      },
      now,
    );
    expect(entries).toEqual([]);
  });
});
