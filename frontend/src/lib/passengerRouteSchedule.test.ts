import { describe, expect, it } from "vitest";
import type { RouteData } from "@/hooks/useRoutes";
import {
  EMPTY_PASSENGER_ROUTE_CONFIG,
  buildPassengerRouteSchedules,
  formatStopTime,
  isValidStopTime,
  normalizePassengerRouteConfig,
  normalizeRouteUsage,
} from "./passengerRouteSchedule";

function route(id: string, stopIds: string[], extra: Partial<RouteData> = {}): RouteData {
  return {
    id, name: `Route ${id}`, color: "#3B82F6", waypoints: [],
    stops: stopIds.map((stopId, index) => ({ id: stopId, name: `Stop ${stopId}`, shortName: stopId.toUpperCase(), lat: 23 + index / 1000, lng: 72 })),
    ...extra,
  };
}

describe("buildPassengerRouteSchedules", () => {
  const routes = [route("a", ["a1", "a2"]), route("b", ["b1"]), route("c", ["c1", "c2", "c3"])];
  const ids = (schedules: { routeId: string }[]) => schedules.map(schedule => schedule.routeId);

  it("returns every route, approved or not, and skips approvals for deleted routes", () => {
    const schedules = buildPassengerRouteSchedules({ routes: [
      { routeId: "c", stopTimes: { c1: "09:00" } },
      { routeId: "deleted", stopTimes: { x: "08:00" } },
    ] }, routes);
    expect(ids(schedules)).toEqual(["c", "a", "b"]);
    expect(schedules.find(schedule => schedule.routeId === "a")!.stops.map(stop => stop.time)).toEqual([null, null]);
  });

  it("puts the most-ridden route first", () => {
    const schedules = buildPassengerRouteSchedules(EMPTY_PASSENGER_ROUTE_CONFIG, routes, { a: 3, b: 40, c: 12 });
    expect(ids(schedules)).toEqual(["b", "c", "a"]);
    expect(schedules.map(schedule => schedule.completedRides)).toEqual([40, 12, 3]);
  });

  it("breaks ties by approval order, then by name", () => {
    const named = [route("x", [], { name: "Route 10" }), route("y", [], { name: "Route 9" }), route("z", [], { name: "Night" })];
    const schedules = buildPassengerRouteSchedules({ routes: [{ routeId: "x", stopTimes: {} }] }, named, { x: 5, y: 5, z: 5 });
    expect(ids(schedules)).toEqual(["x", "z", "y"]);
  });

  it("treats a route without a published count as unridden", () => {
    const schedules = buildPassengerRouteSchedules({ routes: [
      { routeId: "c", stopTimes: {} }, { routeId: "a", stopTimes: {} },
    ] }, routes, { b: 1 });
    expect(ids(schedules)).toEqual(["b", "c", "a"]);
    expect(schedules.find(schedule => schedule.routeId === "a")!.completedRides).toBeNull();
  });

  it("orders stops by the route document and ignores times for deleted stops", () => {
    const schedule = buildPassengerRouteSchedules({ routes: [
      { routeId: "c", stopTimes: { c3: "09:30", gone: "06:00", c1: "09:00" } },
    ] }, routes).find(entry => entry.routeId === "c")!;
    expect(schedule.stops).toEqual([
      { id: "c1", name: "Stop c1", time: "09:00" },
      { id: "c2", name: "Stop c2", time: null },
      { id: "c3", name: "Stop c3", time: "09:30" },
    ]);
  });

  it("treats an invalid stored time as unset", () => {
    const schedule = buildPassengerRouteSchedules({ routes: [
      { routeId: "a", stopTimes: { a1: "7:05", a2: "24:00" } },
    ] }, routes).find(entry => entry.routeId === "a")!;
    expect(schedule.stops.map(stop => stop.time)).toEqual([null, null]);
  });

  it("falls back to the route id and stop short name when names are blank", () => {
    const blank = route("d", ["d1"], { name: "" });
    blank.stops[0].name = "";
    const [schedule] = buildPassengerRouteSchedules(EMPTY_PASSENGER_ROUTE_CONFIG, [blank]);
    expect(schedule.name).toBe("d");
    expect(schedule.stops[0].name).toBe("D1");
  });

  it("keeps a route that has no stops", () => {
    const [schedule] = buildPassengerRouteSchedules(EMPTY_PASSENGER_ROUTE_CONFIG, [route("e", [])]);
    expect(schedule.stops).toEqual([]);
  });
});

describe("normalizeRouteUsage", () => {
  it("returns no counts for missing or malformed documents", () => {
    for (const value of [undefined, null, "x", {}, { completedRides: [] }, { completedRides: "5" }]) {
      expect(normalizeRouteUsage(value)).toEqual({});
    }
  });

  it("keeps only whole, non-negative counts", () => {
    expect(normalizeRouteUsage({ completedRides: { a: 4, b: 0, c: -1, d: 1.5, e: "7", f: Number.NaN, g: 2 ** 60 } }))
      .toEqual({ a: 4, b: 0 });
  });
});

describe("normalizePassengerRouteConfig", () => {
  it("returns the empty config for missing or malformed documents", () => {
    for (const value of [undefined, null, "routes", 42, {}, { routes: "a" }, { routes: {} }]) {
      expect(normalizePassengerRouteConfig(value)).toEqual(EMPTY_PASSENGER_ROUTE_CONFIG);
    }
  });

  it("drops malformed and duplicate entries and invalid times", () => {
    expect(normalizePassengerRouteConfig({ routes: [
      null,
      "a",
      { routeId: "" },
      { routeId: 7, stopTimes: {} },
      { routeId: "a", stopTimes: { s1: "07:05", s2: "7:05", s3: 705, s4: "23:59", s5: "24:00" } },
      { routeId: "a", stopTimes: { s1: "10:00" } },
      { routeId: "b", stopTimes: ["07:05"] },
      { routeId: "c" },
    ] })).toEqual({ routes: [
      { routeId: "a", stopTimes: { s1: "07:05", s4: "23:59" } },
      { routeId: "b", stopTimes: {} },
      { routeId: "c", stopTimes: {} },
    ] });
  });
});

describe("stop time formatting", () => {
  it.each([
    ["00:00", "12:00 am"],
    ["07:05", "7:05 am"],
    ["11:59", "11:59 am"],
    ["12:00", "12:00 pm"],
    ["12:30", "12:30 pm"],
    ["13:05", "1:05 pm"],
    ["23:59", "11:59 pm"],
  ])("formats %s as %s", (time, expected) => {
    expect(formatStopTime(time)).toBe(expected);
  });

  it("returns an invalid value unchanged", () => {
    expect(formatStopTime("25:00")).toBe("25:00");
  });

  it("accepts only 24-hour HH:mm strings", () => {
    expect(isValidStopTime("00:00")).toBe(true);
    expect(isValidStopTime("23:59")).toBe(true);
    for (const value of ["24:00", "7:05", "07:60", "07:05:00", " 07:05", null, 705]) {
      expect(isValidStopTime(value)).toBe(false);
    }
  });
});
