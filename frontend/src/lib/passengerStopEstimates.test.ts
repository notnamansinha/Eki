import { expect, it } from "vitest";
import { stopEstimateContext, stopEstimateLabel } from "./passengerStopEstimates";
import { routeInRideDirection } from "./rideDirection";
import { route } from "../../../e2e/fixtures/state";

it("labels every upcoming stop and preserves authoritative passage during a signal delay", () => {
  const estimates = { context: "bus", minutes: { a: 0, b: 3 }, nextStopIndex: 1 };
  expect(stopEstimateLabel(estimates, "a", 0)).toBe("Passed");
  expect(stopEstimateLabel(estimates, "b", 1)).toBe("3 min");
  expect(stopEstimateLabel({ ...estimates, unavailable: "Signal delayed" }, "b", 1)).toBe("Signal delayed");
  expect(stopEstimateLabel({ ...estimates, unavailable: "Signal delayed" }, "a", 0)).toBe("Passed");
  expect(stopEstimateLabel(undefined, "b", 1)).toBe("Calculating");
});
it("invalidates estimates on bus, session, direction, revision or coordinate changes", () => {
  const directed = routeInRideDirection(route, "forward");
  const context = stopEstimateContext(directed, "session:first");
  expect(stopEstimateContext(directed, "session:second")).not.toBe(context);
  expect(stopEstimateContext(directed, "session:first", 2)).not.toBe(context);
  expect(stopEstimateContext({ ...directed, configVersion: 2 }, "session:first")).not.toBe(context);
  expect(stopEstimateContext(routeInRideDirection(route, "reverse"), "session:first")).not.toBe(context);
  expect(stopEstimateContext({ ...directed, stops: directed.stops.map(stop => ({ ...stop, lat: stop.lat + 0.001 })) }, "session:first")).not.toBe(context);
});
it("says the bus is at a stop on arrival and keeps an unobserved pass distinct from an arrival", () => {
  const estimates = { context: "bus", minutes: { c: 2 }, nextStopIndex: 3, atStopIndex: 2, unobservedStopIndices: [1] };
  expect(stopEstimateLabel(estimates, "a", 0)).toBe("Passed");
  expect(stopEstimateLabel(estimates, "b", 1)).toBe("Passed · not confirmed");
  expect(stopEstimateLabel(estimates, "c", 2)).toBe("Bus is here");
  // At the origin the stop is both "at" and not yet passed.
  expect(stopEstimateLabel({ context: "bus", minutes: {}, nextStopIndex: 0, atStopIndex: 0 }, "a", 0)).toBe("Bus is here");
});
