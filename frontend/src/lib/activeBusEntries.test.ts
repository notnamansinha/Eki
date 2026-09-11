import { describe, expect, it } from "vitest";
import { BUS_EXPIRY_MS } from "./liveBusFreshness";
import {
  filterActiveBusEntries,
  countActiveServices,
  devicePresence,
  isActiveService,
  isActiveBusEntry,
  isLiveChatDeviceOnline,
  rideServiceState,
} from "./activeBusEntries";

describe("isLiveChatDeviceOnline", () => {
  const now = 2_000_000_000_000;
  it("depends only on device presence, not ride status or motion", () => {
    expect(isLiveChatDeviceOnline({ deviceState: "online", timestamp: now - 1_000 }, now)).toBe(true);
    expect(isLiveChatDeviceOnline({ deviceState: "online", timestamp: now - BUS_EXPIRY_MS }, now)).toBe(false);
    expect(isLiveChatDeviceOnline({ deviceState: "offline", timestamp: now - 1_000 }, now)).toBe(false);
    expect(isLiveChatDeviceOnline(undefined, now)).toBe(false);
  });
});

describe("presence and passenger service state", () => {
  const now = 2_000_000_000_000;

  it("keeps device presence independent from ride state", () => {
    expect(devicePresence({ deviceState: "online", timestamp: now - 1_000 }, now)).toBe("online");
    expect(devicePresence({ deviceState: "offline", timestamp: now - 1_000 }, now)).toBe("offline");
    expect(devicePresence({ timestamp: now - 1_000 }, now)).toBe("unknown");
    expect(devicePresence({ deviceState: "online", timestamp: now - BUS_EXPIRY_MS }, now)).toBe("unknown");
  });

  it("distinguishes not armed, direction pending, pre-departure, service, and completed", () => {
    expect(rideServiceState({ tripState: "in_service" })).toBe("not_armed");
    expect(rideServiceState({ status: "active", sessionId: "s1", direction: null, directionState: "pending", tripState: "pre_departure" }))
      .toBe("direction_pending");
    expect(rideServiceState({ status: "active", sessionId: "s1", direction: "forward", tripState: "pre_departure" }))
      .toBe("pre_departure");
    expect(rideServiceState({ status: "active", sessionId: "s1", direction: "reverse", tripState: "in_service" }))
      .toBe("in_service");
    expect(rideServiceState({ status: "active", sessionId: "s1", direction: "forward", tripState: "completed" }))
      .toBe("completed");
  });

  it("does not let an in_service string or online device bypass service eligibility", () => {
    expect(isActiveService({ tripState: "in_service", direction: "forward" })).toBe(false);
    expect(isActiveService({ status: "active", tripState: "in_service", direction: "forward" })).toBe(false);
    expect(isActiveService({ status: "active", sessionId: "s1", tripState: "in_service", direction: null })).toBe(false);
    expect(isActiveService({ status: "active", sessionId: "s1", tripState: "in_service", direction: "forward" })).toBe(true);
  });

  it("counts unique eligible sessions, not online device-only nodes", () => {
    expect(countActiveServices([
      { busId: "device-only", deviceState: "online", timestamp: now - 1_000 },
      { busId: "pending", status: "active", sessionId: "pending", direction: null, directionState: "pending", tripState: "pre_departure" },
      { busId: "a", status: "active", sessionId: "service", direction: "forward", tripState: "in_service" },
      { busId: "a-duplicate", status: "active", sessionId: "service", direction: "forward", tripState: "in_service" },
    ])).toBe(1);
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

  it.each([undefined, null, "", "sideways", 123])(
    "keeps a fresh bus visible while direction %p remains pending",
    (direction) => {
      const entries = filterActiveBusEntries({
        pending: {
          busId: "Bus01",
          routeId: "route_1",
          timestamp: now - 1_000,
          direction,
        },
      }, now);
      expect(entries).toHaveLength(1);
      expect(entries[0].direction).toBe(direction);
    },
  );

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
