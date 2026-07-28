import { describe, expect, it } from "vitest";
import {
  computeETAFromPolyline,
  ETA_SPEED_FLOOR_KMH,
} from "./lib/etaService";

const start = { lat: 23.02, lng: 72.55 };
const middle = { lat: 23.025, lng: 72.55 };
const destination = { lat: 23.03, lng: 72.55 };
const path = [start, middle, destination];

describe("computeETAFromPolyline", () => {
  it("uses the shared urban speed floor for stopped buses", () => {
    const stopped = computeETAFromPolyline(start, destination, path, 0);
    const fallback = computeETAFromPolyline(
      start,
      destination,
      path,
      ETA_SPEED_FLOOR_KMH,
    );

    expect(stopped).toEqual(fallback);
    expect(stopped.etaSeconds).toBeGreaterThan(0);
  });

  it("applies the same floor to unrealistically low positive speeds", () => {
    expect(computeETAFromPolyline(start, destination, path, 5)).toEqual(
      computeETAFromPolyline(start, destination, path, ETA_SPEED_FLOOR_KMH),
    );
  });

  it("preserves faster live speeds", () => {
    const floor = computeETAFromPolyline(
      start,
      destination,
      path,
      ETA_SPEED_FLOOR_KMH,
    );
    const fast = computeETAFromPolyline(start, destination, path, 50);

    expect(fast.etaSeconds).toBeLessThan(floor.etaSeconds);
    expect(fast.distanceMeters).toBe(floor.distanceMeters);
  });
});
