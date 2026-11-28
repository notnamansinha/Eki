import { afterEach, describe, expect, it, vi } from "vitest";
import type { RouteData } from "@/hooks/useRoutes";
import { decodePolyline, type LatLng } from "./polyline";
import { createRideScript } from "./rideSimulation";
import {
  TOUR_ROUTE_ID,
  chooseTourRide,
  isTourRouteId,
  resetTourRideForTests,
  startTourRide,
  subscribeTourRide,
  subscribeTourRideChanges,
  tourRouteCandidates,
} from "./tourRide";

afterEach(() => {
  resetTourRideForTests();
  vi.useRealTimers();
});

/** Google's encoded polyline format, as routes store their road. */
function encodePolyline(points: LatLng[]): string {
  let previous = { lat: 0, lng: 0 };
  let encoded = "";
  const encodeValue = (value: number) => {
    let rest = value < 0 ? ~(value << 1) : value << 1;
    while (rest >= 0x20) { encoded += String.fromCharCode((0x20 | (rest & 0x1f)) + 63); rest >>= 5; }
    encoded += String.fromCharCode(rest + 63);
  };
  for (const point of points) {
    const lat = Math.round(point.lat * 1e5), lng = Math.round(point.lng * 1e5);
    encodeValue(lat - previous.lat);
    encodeValue(lng - previous.lng);
    previous = { lat, lng };
  }
  return encoded;
}
const stop = (id: string, lat: number, lng = 72.53) => ({ id, name: id, shortName: id, lat, lng });
const route = (id: string, name: string, stops = [stop(`${id}-a`, 23.1), stop(`${id}-b`, 23.08), stop(`${id}-c`, 23.06), stop(`${id}-d`, 23.04)]): RouteData =>
  ({ id, name, color: "#801214", waypoints: [], stops });

describe("tour route", () => {
  it("offers only published routes, a Vaishnodevi route first, then the published order", () => {
    const routes = [
      route("loop", "Campus Loop"), route("route_01", "Vaishnodevi Circle"), route("express", "Express"),
      route("Route-1", "Vaishnodevi to Campus"), route("unlisted", "Unlisted"),
    ];
    // Route-1 is an unpublished duplicate of the Vaishnodevi route: never offered.
    expect(tourRouteCandidates(routes, ["express", "loop", "route_01"]).map(entry => entry.id)).toEqual(["route_01", "express", "loop"]);
    // A published id without a route document is skipped.
    expect(tourRouteCandidates(routes, ["gone", "loop"]).map(entry => entry.id)).toEqual(["loop"]);
    expect(tourRouteCandidates(routes, [])).toEqual([]);
  });

  it("rides the published route under the tour's id, keeping its name, stops and road", () => {
    const vaishnodevi = route("route_01", "Vaishnodevi Circle");
    const ride = chooseTourRide([route("loop", "Campus Loop"), route("Route-1", "Vaishnodevi to Campus"), vaishnodevi], ["loop", "route_01"])!;
    expect(ride.baseRouteId).toBe("route_01");
    expect(ride.route).toMatchObject({ id: TOUR_ROUTE_ID, name: "Vaishnodevi Circle", stops: vaishnodevi.stops });
    expect(isTourRouteId(ride.route.id)).toBe(true);
    // Three stops before the terminus: one stop behind the bus here.
    expect(ride.script.firstNextStop).toBe(1);
  });

  it("skips a route whose road cannot carry a ride, and gives none when no route can", () => {
    const oneStop = route("route_01", "Vaishnodevi Circle", [stop("only", 23.1)]);
    expect(chooseTourRide([oneStop, route("loop", "Campus Loop")], ["route_01", "loop"])?.baseRouteId).toBe("loop");
    expect(chooseTourRide([oneStop], ["route_01"])).toBeNull();
    // A route that could carry a ride but is not published gives none.
    expect(chooseTourRide([route("loop", "Campus Loop")], [])).toBeNull();
    expect(chooseTourRide([], [])).toBeNull();
  });

  it("publishes nothing until the tour starts a ride, then a live bus that does not call itself a demo", () => {
    vi.useFakeTimers({ now: Date.UTC(2026, 10, 26, 9, 0, 0) });
    const before = vi.fn();
    subscribeTourRide(before)();
    expect(before).toHaveBeenCalledWith(null, "listener");

    startTourRide(chooseTourRide([route("route_01", "Vaishnodevi Circle")], ["route_01"])!.script);
    const changes = vi.fn();
    const stop = subscribeTourRideChanges(changes);
    const { snapshot } = changes.mock.lastCall![0];
    const [bus] = Object.values(snapshot) as Record<string, unknown>[];
    expect(bus).toMatchObject({ routeId: TOUR_ROUTE_ID, tripState: "in_service", direction: "forward", currentStopIndex: 1 });
    expect(bus).not.toHaveProperty("demo");
    stop();
  });
});

describe("ride script on a configured road", () => {
  const options = {
    routeId: TOUR_ROUTE_ID, busId: "bus_01", speedKmh: 40, dwellMs: 20_000, terminusDwellMs: 20_000,
    completedMs: 4_000, firstNextStop: 1, startFraction: 0.5,
  };

  it("finds stops between the road's points, as on a long straight stretch of a stored polyline", () => {
    // Two road points 4.4 km apart; the middle stop sits on the road, 2.2 km from either point.
    const road = encodePolyline([{ lat: 23.1, lng: 72.53 }, { lat: 23.06, lng: 72.53 }]);
    expect(decodePolyline(road)).toEqual([{ lat: 23.1, lng: 72.53 }, { lat: 23.06, lng: 72.53 }]);
    const script = createRideScript({ ...route("long", "Long road", [stop("a", 23.1), stop("b", 23.08), stop("c", 23.06)]), forwardPolyline: road }, options);
    expect(script).not.toBeNull();
    const atMiddle = script!.timeline.find(phase => phase.kind === "dwell" && phase.stopIndex === 1)!;
    const bus = script!.busAt({ sessionId: "s", elapsedMs: atMiddle.startMs + 1, seq: 1, now: 0 });
    expect(Math.abs((bus.lat as number) - 23.08)).toBeLessThan(0.0001);
  });

  it("refuses a road its stops are far from, or stops out of travel order", () => {
    const road = encodePolyline([{ lat: 23.1, lng: 72.53 }, { lat: 23.06, lng: 72.53 }]);
    const far = { ...route("far", "Far", [stop("a", 23.1), stop("b", 23.08, 72.56), stop("c", 23.06)]), forwardPolyline: road };
    expect(createRideScript(far, options)).toBeNull();
    const backwards = { ...route("back", "Back", [stop("a", 23.08), stop("b", 23.1), stop("c", 23.06)]), forwardPolyline: road };
    expect(createRideScript(backwards, options)).toBeNull();
  });
});
