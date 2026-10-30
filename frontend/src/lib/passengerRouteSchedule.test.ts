import { describe, expect, it } from "vitest";
import type { RouteData } from "@/hooks/useRoutes";
import {
  EMPTY_PASSENGER_ROUTE_CONFIG,
  buildPassengerRouteSchedules,
  formatStopTime,
  isValidStopTime,
  normalizePassengerRouteConfig,
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

  it("returns only approved routes, skipping approvals for deleted routes", () => {
    const schedules = buildPassengerRouteSchedules({ routes: [
      { routeId: "c", stopTimes: {} },
      { routeId: "deleted", stopTimes: { x: "08:00" } },
    ] }, routes);
    expect(schedules.map(schedule => schedule.routeId)).toEqual(["c"]);
  });

  it("returns nothing when no route is approved", () => {
    expect(buildPassengerRouteSchedules(EMPTY_PASSENGER_ROUTE_CONFIG, routes)).toEqual([]);
  });

  it("follows approval order, not route collection order", () => {
    const schedules = buildPassengerRouteSchedules({ routes: [
      { routeId: "c", stopTimes: {} }, { routeId: "a", stopTimes: {} },
    ] }, routes);
    expect(schedules.map(schedule => schedule.routeId)).toEqual(["c", "a"]);
  });

  it("orders stops by the route document and ignores times for deleted stops", () => {
    const [schedule] = buildPassengerRouteSchedules({ routes: [
      { routeId: "c", stopTimes: { c3: "09:30", gone: "06:00", c1: "09:00" } },
    ] }, routes);
    expect(schedule.stops).toEqual([
      { id: "c1", name: "Stop c1", time: "09:00" },
      { id: "c2", name: "Stop c2", time: null },
      { id: "c3", name: "Stop c3", time: "09:30" },
    ]);
  });

  it("treats an invalid stored time as unset", () => {
    const [schedule] = buildPassengerRouteSchedules({ routes: [
      { routeId: "a", stopTimes: { a1: "7:05", a2: "24:00" } },
    ] }, routes);
    expect(schedule.stops.map(stop => stop.time)).toEqual([null, null]);
  });

  it("falls back to the route id and stop short name when names are blank", () => {
    const blank = route("d", ["d1"], { name: "" });
    blank.stops[0].name = "";
    const [schedule] = buildPassengerRouteSchedules({ routes: [{ routeId: "d", stopTimes: {} }] }, [blank]);
    expect(schedule.name).toBe("d");
    expect(schedule.stops[0].name).toBe("D1");
  });

  it("keeps an approved route that has no stops", () => {
    const [schedule] = buildPassengerRouteSchedules({ routes: [{ routeId: "e", stopTimes: {} }] }, [route("e", [])]);
    expect(schedule.stops).toEqual([]);
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
