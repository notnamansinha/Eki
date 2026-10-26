import { describe, expect, it } from "vitest";
import { routeProgressPaths } from "./routeProgressPaths";
import { routeLegPaths } from "./routeLegPaths";
import { preparePolylineDistanceIndex } from "./polylineDistance";

const path = [{ lat: 23, lng: 72 }, { lat: 23.001, lng: 72 }, { lat: 23.001, lng: 72.001 },
  { lat: 23.002, lng: 72.001 }, { lat: 23.003, lng: 72.001 }];
const stops = [path[0], path[2], path[4]];
describe("covered, active and future route sections", () => {
  it.each([false, true])("retains road bends and splits the accepted active leg (reverse=%s)", reverse => {
    const road = reverse ? [...path].reverse() : path;
    const orderedStops = reverse ? [...stops].reverse() : stops;
    const cumulative = preparePolylineDistanceIndex(road).cumulative;
    const sections = routeProgressPaths(road, routeLegPaths(road, orderedStops), 1, cumulative[1]);
    expect(sections.completed).toEqual(road.slice(0, 2));
    expect(sections.matchedDistanceM).toBe(cumulative[1]);
    expect(sections.active).toEqual(road.slice(1, 3));
    expect(sections.active.at(-1)).not.toEqual(road.at(-1)); // future geometry stays on the blue base
  });
  it("uses published progress without a match and refuses a match beyond the next stop", () => {
    const legs = routeLegPaths(path, stops);
    expect(routeProgressPaths(path, legs, 2).completed).toEqual(path.slice(0, 3));
    expect(routeProgressPaths(path, legs, 1, 100_000).completed).toEqual([]);
    expect(routeProgressPaths(path, legs, 1, 100_000)).not.toHaveProperty("matchedDistanceM");
    expect(routeProgressPaths(path, legs, 99)).toEqual({ completed: [], active: [] });
  });
});
