import { describe, expect, it } from "vitest";
import { passengerRerouteNotice } from "./passengerRouteStatus";

describe("passenger reroute status", () => {
  it("prioritizes an active reroute and clears after recovery", () => {
    expect(passengerRerouteNotice(["OFF_ROUTE", "REROUTING"])).toContain("Updating");
    expect(passengerRerouteNotice(["OFF_ROUTE"])).toContain("Live location");
    expect(passengerRerouteNotice(["ON_ROUTE", "ON_NEW_ROUTE"])).toBeNull();
  });
  it("does not announce an unconfirmed or ambiguous match as leaving the route", () => {
    expect(passengerRerouteNotice(["POSSIBLE_OFF_ROUTE"])).toBeNull();
    expect(passengerRerouteNotice(["POSSIBLE_OFF_ROUTE", "ON_ROUTE"])).toBeNull();
  });
});
