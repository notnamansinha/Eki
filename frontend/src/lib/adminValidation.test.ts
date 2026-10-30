import { describe, expect, it } from "vitest";
import {
  findPassengerStopTimeProblems,
  passengerStopTimeKey,
  validateOperatorInput,
  validatePassengerRouteSchedule,
  validateSettingsInput,
  validateVehicleInput,
} from "./adminValidation";
import { MAX_PASSENGER_ROUTES } from "./passengerRouteSchedule";

describe("admin form validation", () => {
  it("reports missing and malformed vehicle fields instead of silently doing nothing", () => {
    expect(validateVehicleInput("", "Bus one", [])).toBe("Vehicle ID is required.");
    expect(validateVehicleInput("bus one", "Bus one", [])).toContain("letters, numbers");
    expect(validateVehicleInput("bus_1", "   ", [])).toBe("Vehicle display name is required.");
    expect(validateVehicleInput(" bus_1 ", " Bus one ", ["route_1"])).toBeNull();
  });

  it("matches the operator API's ID, name, and Auth UID constraints", () => {
    expect(validateOperatorInput("drv_1", "Ravi", "")).toBe("Firebase Auth UID is required.");
    expect(validateOperatorInput("drv_1", "Ravi", "uid with spaces")).toContain("letters, numbers");
    expect(validateOperatorInput(" drv_1 ", " Ravi ", " uid_1 ")).toBeNull();
  });

  it("rejects Firestore-reserved __…__ vehicle and operator IDs that the API answers with 400", () => {
    expect(validateVehicleInput("__bus__", "Bus one", [])).toContain("two underscores");
    expect(validateOperatorInput("__drv__", "Ravi", "uid_1")).toContain("two underscores");
    expect(validateVehicleInput("__bus", "Bus one", [])).toBeNull();
  });

  it("matches the settings API's required fields and length limits", () => {
    const valid = {
      serviceStartTime: "8:00 am",
      noBusesMessage: "No buses running",
      noBusesSubMessage: "Service starts at {time}",
      announcementText: "",
    };
    expect(validateSettingsInput(valid)).toBeNull();
    expect(validateSettingsInput({ ...valid, noBusesMessage: " " })).toBe("No-buses headline is required.");
    expect(validateSettingsInput({ ...valid, announcementText: "x".repeat(501) })).toBe("Announcement text must be 500 characters or fewer.");
  });

  describe("passenger route schedule", () => {
    const routes = [
      { id: "r1", name: "1A", stops: [{ id: "s1", name: "Main Gate", shortName: "MG" }, { id: "s2", name: "", shortName: "LIB" }] },
      { id: "r2", name: "2B", stops: [{ id: "t1", name: "Stadium", shortName: "STA" }] },
      { id: "r3", name: "3C", stops: [] },
    ];

    it("accepts an empty selection, a stopless route, and fully timed routes", () => {
      expect(validatePassengerRouteSchedule({ routes: [] }, routes)).toBeNull();
      expect(validatePassengerRouteSchedule({ routes: [
        { routeId: "r3", stopTimes: {} },
        { routeId: "r1", stopTimes: { s1: "07:00", s2: "23:59" } },
      ] }, routes)).toBeNull();
    });

    it("names the first stop missing a time, falling back to its short name", () => {
      expect(validatePassengerRouteSchedule({ routes: [{ routeId: "r1", stopTimes: { s1: "07:00" } }] }, routes))
        .toBe('Set a time for "LIB" on 1A.');
      expect(validatePassengerRouteSchedule({ routes: [{ routeId: "r2", stopTimes: { t1: "" } }] }, routes))
        .toBe('Set a time for "Stadium" on 2B.');
    });

    it("rejects malformed times and summarises several problems", () => {
      expect(validatePassengerRouteSchedule({ routes: [{ routeId: "r2", stopTimes: { t1: "24:00" } }] }, routes))
        .toBe('"Stadium" on 2B has an invalid time. Use HH:mm.');
      expect(validatePassengerRouteSchedule({ routes: [
        { routeId: "r2", stopTimes: {} },
        { routeId: "r1", stopTimes: { s1: "7:00" } },
      ] }, routes)).toBe('3 stop times are missing or invalid, starting with "Stadium" on 2B. Set a time for every stop.');
    });

    it("flags each problem stop by route and stop", () => {
      const problems = findPassengerStopTimeProblems({ routes: [{ routeId: "r1", stopTimes: { s1: "7:00" } }] }, routes);
      expect([...problems]).toEqual([
        [passengerStopTimeKey("r1", "s1"), "invalid"],
        [passengerStopTimeKey("r1", "s2"), "missing"],
      ]);
      expect(passengerStopTimeKey("a", "b/c")).not.toBe(passengerStopTimeKey("a/b", "c"));
    });

    it("rejects deleted, duplicate, and too many routes", () => {
      expect(validatePassengerRouteSchedule({ routes: [{ routeId: "gone", stopTimes: {} }] }, routes)).toContain("no longer exists");
      expect(validatePassengerRouteSchedule({ routes: [{ routeId: "r3", stopTimes: {} }, { routeId: "r3", stopTimes: {} }] }, routes))
        .toContain("more than once");
      const many = Array.from({ length: MAX_PASSENGER_ROUTES + 1 }, (_, index) => ({ id: `x${index}`, name: `X${index}`, stops: [] }));
      expect(validatePassengerRouteSchedule({ routes: many.map(route => ({ routeId: route.id, stopTimes: {} })) }, many))
        .toBe(`Select at most ${MAX_PASSENGER_ROUTES} routes for passengers (${MAX_PASSENGER_ROUTES + 1} selected).`);
      expect(validatePassengerRouteSchedule({ routes: many.slice(1).map(route => ({ routeId: route.id, stopTimes: {} })) }, many)).toBeNull();
    });
  });
});
