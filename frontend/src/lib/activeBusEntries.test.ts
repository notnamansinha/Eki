import { describe, expect, it } from "vitest";
import { BUS_EXPIRY_MS } from "./liveBusFreshness";
import {
  countActiveServices,
  devicePresence,
  filterActiveBusEntries,
  isActiveBusEntry,
  isActiveService,
  isLiveChatDeviceOnline,
  rideServiceState,
  type ActiveBusEntry,
} from "./activeBusEntries";

describe("isLiveChatDeviceOnline", () => {
  it("depends only on device presence, not ride status or motion", () => {
    expect(isLiveChatDeviceOnline({ deviceState: "online", status: "offline", motionState: "stopped" })).toBe(true);
    expect(isLiveChatDeviceOnline({ deviceState: "online", status: "active", motionState: "moving" })).toBe(true);
    expect(isLiveChatDeviceOnline({ deviceState: "offline", status: "active", motionState: "moving" })).toBe(false);
    expect(isLiveChatDeviceOnline(undefined)).toBe(false);
  });
});

describe("devicePresence", () => {
  it("reports offline only on an explicit offline deviceState", () => {
    expect(devicePresence({ deviceState: "offline" })).toBe("offline");
    expect(devicePresence({ deviceState: "online" })).toBe("online");
    expect(devicePresence({})).toBe("online");
    expect(devicePresence(undefined)).toBe("online");
  });
});

describe("rideServiceState", () => {
  it("keeps a directionless, device-only bus as direction_pending", () => {
    // Device-only: no session, no direction, pre_departure.
    expect(
      rideServiceState({ tripState: "pre_departure", sessionId: undefined, direction: undefined }),
    ).toBe("direction_pending");
  });

  it("marks a pre-departure bus with known direction as not_armed", () => {
    expect(
      rideServiceState({ tripState: "pre_departure", sessionId: undefined, direction: "forward" }),
    ).toBe("not_armed");
  });

  it("marks an armed pre-departure ride (has session) as armed_pending_departure", () => {
    expect(
      rideServiceState({ tripState: "pre_departure", sessionId: "s1", direction: "forward" }),
    ).toBe("armed_pending_departure");
  });

  it("reports in_service and completed from tripState", () => {
    expect(rideServiceState({ tripState: "in_service", sessionId: "s1" })).toBe("in_service");
    expect(rideServiceState({ tripState: "completed", sessionId: "s1" })).toBe("completed");
  });

  it("treats null/undefined as not_armed", () => {
    expect(rideServiceState(undefined)).toBe("not_armed");
    expect(rideServiceState(null)).toBe("not_armed");
  });
});

describe("isActiveService / countActiveServices", () => {
  const now = 2_000_000_000_000;
  const deviceOnly: ActiveBusEntry = {
    busId: "Bus01",
    timestamp: now - 1_000,
    deviceState: "online",
    tripState: "pre_departure",
    motionState: "stopped",
  };
  const inService: ActiveBusEntry = {
    busId: "Bus02",
    timestamp: now - 1_000,
    deviceState: "online",
    tripState: "in_service",
    motionState: "moving",
    sessionId: "s2",
    direction: "forward",
  };
  const awaiting: ActiveBusEntry = {
    busId: "Bus03",
    timestamp: now - 1_000,
    deviceState: "online",
    tripState: "pre_departure",
    motionState: "stopped",
    sessionId: "s3",
    direction: "forward",
  };

  it("only in-service entries are active services", () => {
    expect(isActiveService(deviceOnly)).toBe(false);
    expect(isActiveService(awaiting)).toBe(false);
    expect(isActiveService(inService)).toBe(true);
  });

  it("the live count excludes device-only and awaiting buses", () => {
    expect(countActiveServices([deviceOnly, awaiting, inService])).toBe(1);
    expect(countActiveServices([deviceOnly])).toBe(0);
    expect(countActiveServices([])).toBe(0);
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

  it("accepts independently observable raw and matched route positions", () => {
    expect(isActiveBusEntry({
      busId: "Bus01",
      timestamp: now - 1_000,
      lat: 23,
      lng: 72,
      routeVersion: 2,
      routeState: "ON_NEW_ROUTE",
      routeSource: "dynamic-reroute",
      rawLocation: {
        lat: 23.0001,
        lng: 72.0001,
        speed: 20,
        heading: 90,
        motionState: "moving",
        seq: 10,
        sampledAt: now - 1_000,
      },
      matchedLocation: {
        lat: 23,
        lng: 72,
        segmentIndex: 4,
        segmentFraction: 0.5,
        alongRouteDistanceM: 500,
        distanceToRouteM: 8,
        headingDifference: 3,
        matchConfidence: 0.9,
        seq: 10,
        sampledAt: now - 1_000,
        routeVersion: 2,
      },
    }, now)).toBe(true);
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
      { busId: "bus_1", timestamp: now - 1_000, routeState: "TELEPORTING" },
      { busId: "bus_1", timestamp: now - 1_000, matchConfidence: 2 },
      { busId: "bus_1", timestamp: now - 1_000, matchedLocation: { lat: 23, lng: 72 } },
    ];

    for (const entry of malformed) {
      expect(isActiveBusEntry(entry, now)).toBe(false);
      expect(filterActiveBusEntries({ malformed: entry }, now)).toEqual([]);
    }
  });

  it("rejects NaN and Infinity in nested telemetry metrics", () => {
    const base = {
      busId: "bus_1",
      timestamp: now - 1_000,
      motionState: "moving",
    };
    const nonFinite = [
      { ...base, rawLocation: { lat: 23, lng: 72, speed: 5, heading: 90, gpsHdop: Number.NaN, motionState: "moving", seq: 1, sampledAt: now - 1_000 } },
      { ...base, rawLocation: { lat: 23, lng: 72, speed: Number.POSITIVE_INFINITY, heading: 90, gpsHdop: 4, motionState: "moving", seq: 1, sampledAt: now - 1_000 } },
      { ...base, matchedLocation: { lat: 23, lng: 72, segmentIndex: 0, segmentFraction: Number.NaN, alongRouteDistanceM: 100, distanceToRouteM: 5, matchConfidence: 0.9, seq: 1, sampledAt: now - 1_000, routeVersion: 2 } },
      { ...base, matchedLocation: { lat: 23, lng: 72, segmentIndex: 0, segmentFraction: 0.5, alongRouteDistanceM: Number.POSITIVE_INFINITY, distanceToRouteM: 5, matchConfidence: 0.9, seq: 1, sampledAt: now - 1_000, routeVersion: 2 } },
      { ...base, matchedLocation: { lat: 23, lng: 72, segmentIndex: 0, segmentFraction: 0.5, alongRouteDistanceM: 100, distanceToRouteM: Number.NEGATIVE_INFINITY, matchConfidence: 0.9, seq: 1, sampledAt: now - 1_000, routeVersion: 2 } },
    ];
    for (const entry of nonFinite) {
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
