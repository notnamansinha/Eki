import { describe, expect, it } from "vitest";
import { routeLegPaths } from "./routeLegPaths";

const point = (x: number, y = 0) => ({ lat: 23 + y * .001, lng: 72 + x * .001 });
describe("ordered road leg geometry", () => {
  it.each([2, 26])("cuts every leg of a %i-stop road without coloring future legs", count => {
    const stops = Array.from({ length: count }, (_, i) => point(i * 2));
    const road = stops.flatMap((stop, i) => i === count - 1 ? [stop] : [stop, point(i * 2 + 1, .2)]);
    for (const ordered of [stops, [...stops].reverse()]) {
      const path = ordered === stops ? road : [...road].reverse();
      const legs = routeLegPaths(path, ordered);
      expect(legs.size).toBe(count - 1);
      for (let i = 1; i < count; i++) {
        expect(legs.get(i)).toHaveLength(3);
        expect(legs.get(i)![0].lat).toBeCloseTo(ordered[i - 1].lat, 8);
        expect(legs.get(i)![0].lng).toBeCloseTo(ordered[i - 1].lng, 8);
        expect(legs.get(i)!.at(-1)!.lng).toBeCloseTo(ordered[i].lng, 8);
        expect(path).toContainEqual(legs.get(i)![1]);
      }
    }
  });
  it("projects a stop between road vertices without replacing the road by a chord", () => {
    const path = [point(0), point(2), point(2, 2), point(4, 2)];
    const legs = routeLegPaths(path, [point(0), point(2, 1), point(4, 2)]);
    expect(legs.get(1)![1]).toEqual(path[1]);
    expect(legs.get(2)![1]).toEqual(path[2]);
    expect(legs.get(1)!.at(-1)!.lat).toBeCloseTo(point(2, 1).lat, 8);
  });
  it("preserves stop order through a repeated crossing and terminal", () => {
    const path = [point(0), point(2), point(2, 2), point(0), point(-2), point(0)];
    const legs = routeLegPaths(path, [point(0), point(2, 2), point(-2), point(0)]);
    expect(legs.get(2)).toEqual([point(2, 2), point(0), point(-2)]);
    expect(legs.get(3)).toEqual([point(-2), point(0)]);
  });
  it("keeps legal endpoint detours when the road revisits a terminal coordinate", () => {
    const road = [point(.2), point(2), point(0), point(0, 2), point(4, 2), point(4), point(6), point(8, 1), point(6, .2)];
    const legs = routeLegPaths(road, [point(0), point(4), point(6)]);
    expect(legs.get(1)![0]).toEqual(road[0]);
    expect(legs.get(2)!.at(-1)).toEqual(road.at(-1));
    expect(legs.get(2)).toContainEqual(point(8, 1));
  });
  it("binds a remaining-stop reroute to its original next-stop boundary", () => {
    const stops = [point(0), point(2), point(4), point(6)];
    const path = [point(3, 1), point(4, 1), point(4), point(5, .2), point(6)];
    const legs = routeLegPaths(path, stops, 2);
    expect(legs.has(1)).toBe(false);
    expect(legs.get(2)).toEqual(path.slice(0, 3));
    expect(legs.get(3)).toEqual(path.slice(2));
  });
  it("leaves unavailable, missing and invalid itinerary geometry unhighlighted", () => {
    expect(routeLegPaths([], [point(0), point(2)]).size).toBe(0);
    expect(routeLegPaths([point(0), point(2)], [point(0), point(200)]).size).toBe(0);
    expect(routeLegPaths([point(0), point(2)], [point(0), point(2)], -1).size).toBe(0);
  });
});
