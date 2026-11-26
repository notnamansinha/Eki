import type { RouteData } from "@/hooks/useRoutes";
import type { LiveBusChange } from "./createLiveBusStore";
import type { LiveBusSnapshot } from "./liveBusSnapshot";
import type { LiveBusDeliverySource } from "./liveBusDelivery";
import { createRideScript, createSimulatedRide, type RideScript, type SimulatedRide } from "./rideSimulation";

/*
 * The app tour's ride: a scripted bus on a real route published to passengers,
 * the Vaishnodevi route when it is published, so the tour shows the app as it
 * looks on a normal day. The tour lists it as a live route under its own id,
 * with the route's real name, stops and road. It runs in this browser only
 * while the tour is open: nothing is read from or written to RTDB or the
 * backend, and boarding needs no location.
 */

export const TOUR_ROUTE_ID = "tour-ride";
const TOUR_BUS_ID = "bus_01";

export function isTourRouteId(routeId: unknown): boolean {
  return routeId === TOUR_ROUTE_ID;
}

/**
 * The routes the tour may use: only those published to passengers
 * (`settings/passengerRoutes`, the Routes tab's list), so the tour never shows
 * a route document passengers cannot find, such as an unpublished duplicate.
 * A Vaishnodevi route comes first, then the published order.
 */
export function tourRouteCandidates(configured: readonly RouteData[], publishedRouteIds: readonly string[]): RouteData[] {
  const byId = new Map(configured.map(route => [route.id, route]));
  const published = publishedRouteIds.flatMap(id => byId.get(id) ?? []);
  const rank = (route: RouteData) => /vaishno/i.test(route.name ?? "") ? 0 : 1;
  // Array sort is stable, so routes of equal rank keep their published order.
  return published.sort((a, b) => rank(a) - rank(b));
}

export interface TourRide {
  /** The configured route, under the tour's id, listed and tracked while the tour runs. */
  route: RouteData;
  /** The configured route's own id, for its row in Routes and its card in Live routes. */
  baseRouteId: string;
  script: RideScript;
}

/**
 * Three stops before the terminus, part-way along, so there are stops ahead
 * of the bus to choose and a few minutes before it reaches them.
 */
function scriptFor(route: RouteData): RideScript | null {
  return createRideScript(route, {
    routeId: TOUR_ROUTE_ID,
    busId: TOUR_BUS_ID,
    speedKmh: 40,
    dwellMs: 20_000,
    terminusDwellMs: 20_000,
    completedMs: 4_000,
    firstNextStop: Math.max(1, (route.stops?.length ?? 0) - 3),
    startFraction: 0.6,
  });
}

/**
 * The tour's ride on the first candidate route whose road can carry one, or
 * null when no published route can (the tour then skips the ride steps).
 */
export function chooseTourRide(configured: readonly RouteData[], publishedRouteIds: readonly string[]): TourRide | null {
  for (const candidate of tourRouteCandidates(configured, publishedRouteIds)) {
    const script = scriptFor(candidate);
    if (script) return { route: { ...candidate, id: TOUR_ROUTE_ID }, baseRouteId: candidate.id, script };
  }
  return null;
}

// Shaped like a ride session id.
const sessionIdFor = (count: number, now: number) =>
  `${Math.floor(now).toString(36)}${count.toString(36)}`.slice(-10).padStart(10, "0");
let ride: SimulatedRide | null = null;

/** Start a fresh tour ride on the chosen route. */
export function startTourRide(script: RideScript): void {
  if (ride) ride.setScript(script);
  else ride = createSimulatedRide(script, sessionIdFor);
}

/** Same contract as `subscribeLiveBusesByRoute` for the tour's route; empty until the tour starts a ride. */
export function subscribeTourRide(next: (snapshot: LiveBusSnapshot | null, source: LiveBusDeliverySource) => void): () => void {
  if (ride) return ride.subscribe(next);
  next(null, "listener");
  return () => {};
}

/** Same contract as `subscribeLiveBusChangesByRoute` for the tour's route. */
export function subscribeTourRideChanges(next: (change: LiveBusChange) => void): () => void {
  if (ride) return ride.subscribeChanges(next);
  next({ type: "reset", snapshot: null, source: "listener" });
  return () => {};
}

/** Test seam: forget the ride and stop its timer. */
export function resetTourRideForTests(): void {
  ride?.reset();
  ride = null;
}
