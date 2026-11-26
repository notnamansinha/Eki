import type { RouteData } from "@/hooks/useRoutes";
import { createRideScript, createSimulatedRide, type RideFrame } from "./rideSimulation";
import {
  DEMO_RIDE_FORWARD_POLYLINE,
  DEMO_RIDE_LENGTH_M,
  DEMO_RIDE_REVERSE_POLYLINE,
  DEMO_RIDE_STOPS,
} from "./demoRideRoute";

/*
 * The demo ride is a scripted bus on a fixed route that runs entirely in this
 * browser, so anyone can try choosing stops and boarding when no real bus is
 * running. It publishes the same live-bus shape the backend writes to RTDB, so
 * the route list, map, arrival estimates and boarding card treat it like a
 * real ride. Nothing here reads or writes Firebase or calls the backend, and
 * boarding never asks for the passenger's location.
 */

export const DEMO_ROUTE_ID = "demo-ride";
export const DEMO_BUS_ID = "DEMO";

/** 45 km/h: an off-peak bus on Drive-in Road. Arrival estimates use this speed. */
export const DEMO_SPEED_KMH = 45;
/** Doors open at each intermediate stop, long enough to board in the demo. */
export const DEMO_DWELL_MS = 20_000;
/** Doors open at the terminus before the ride completes. */
export const DEMO_TERMINUS_DWELL_MS = 20_000;
/** How long the completed ride is published before the next demo ride starts. */
export const DEMO_COMPLETED_MS = 4_000;
/** One packet a second, like a healthy tracker. */
export { RIDE_TICK_MS as DEMO_TICK_MS } from "./rideSimulation";
/** Simulated boarding check: long enough to show progress, short enough to feel live. */
export const DEMO_BOARDING_MS = 1_200;
/** Three stops are behind the bus when a ride starts, as in the approved concept. */
export const DEMO_FIRST_NEXT_STOP = 3;

/** Only `true` lists the demo ride (recordings, fixtures); unset hides it. */
export function isDemoRideEnabled(): boolean {
  return process.env.NEXT_PUBLIC_DEMO_RIDE?.trim().toLowerCase() === "true";
}

export function isDemoRouteId(routeId: unknown): boolean {
  return routeId === DEMO_ROUTE_ID;
}

/** The demo route, shaped like a configured route document. */
export const demoRoute: RouteData = {
  id: DEMO_ROUTE_ID,
  name: "Demo ride",
  color: "#801214",
  waypoints: [],
  stops: [...DEMO_RIDE_STOPS],
  polyline: DEMO_RIDE_FORWARD_POLYLINE,
  forwardPolyline: DEMO_RIDE_FORWARD_POLYLINE,
  reversePolyline: DEMO_RIDE_REVERSE_POLYLINE,
  polylineQuality: "HIGH_QUALITY",
  distanceMeters: DEMO_RIDE_LENGTH_M,
  forwardDistanceMeters: DEMO_RIDE_LENGTH_M,
  reverseDistanceMeters: DEMO_RIDE_LENGTH_M,
  // The time a whole run of the line takes at the demo speed and dwell.
  duration: `${Math.round(DEMO_RIDE_LENGTH_M / (DEMO_SPEED_KMH / 3.6) + (DEMO_RIDE_STOPS.length - 2) * DEMO_DWELL_MS / 1000)}s`,
  configVersion: 1,
  geometryVersion: 1,
};

/** Ride start: 40% of the way from the third stop to the fourth. */
const script = createRideScript(demoRoute, {
  routeId: DEMO_ROUTE_ID,
  busId: DEMO_BUS_ID,
  speedKmh: DEMO_SPEED_KMH,
  dwellMs: DEMO_DWELL_MS,
  terminusDwellMs: DEMO_TERMINUS_DWELL_MS,
  completedMs: DEMO_COMPLETED_MS,
  firstNextStop: DEMO_FIRST_NEXT_STOP,
  startFraction: 0.4,
  extra: { demo: true },
})!;

/** The whole scripted ride, in milliseconds from its start. */
export const DEMO_TIMELINE = script.timeline;
export const DEMO_RIDE_DURATION_MS = script.durationMs;

export type DemoRideFrame = RideFrame;

/**
 * The live-bus record for one moment of a demo ride, in the RTDB shape the
 * backend publishes. Pure, so tests can step through the whole ride.
 */
export const demoRideBus = (frame: RideFrame): Record<string, unknown> => script.busAt(frame);

// ── The shared ride, shared by every view in this tab ────────────────────────

const ride = createSimulatedRide(script, (count, now) => `demo-${count}-${Math.floor(now).toString(36)}`);

/** Same contract as `subscribeLiveBusesByRoute` for the demo route. */
export const subscribeDemoRide = ride.subscribe;
/** Same contract as `subscribeLiveBusChangesByRoute` for the demo route. */
export const subscribeDemoRideChanges = ride.subscribeChanges;
/** Start a fresh demo ride now, so a passenger opening it finds the bus approaching. */
export const restartDemoRide = ride.restart;

/** Boarding in the demo: a short pause instead of a location check and join request. */
export function boardDemoRide(signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = setTimeout(resolve, DEMO_BOARDING_MS);
    signal?.addEventListener("abort", () => {
      clearTimeout(done);
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
    }, { once: true });
  });
}

/** Test seam: forget the shared ride and stop its timer. */
export const resetDemoRideForTests = ride.reset;
