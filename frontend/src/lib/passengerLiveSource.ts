import { subscribeLiveBusChangesByRoute, subscribeLiveBusesByRoute } from "@/lib/liveBusStore";
import { isDemoRouteId, subscribeDemoRide, subscribeDemoRideChanges } from "@/lib/demoRide";
import { isTourRouteId, subscribeTourRide, subscribeTourRideChanges } from "@/lib/tourRide";

/**
 * Live buses for one passenger route. The demo ride and the app tour's ride
 * are simulated in this browser; every other route reads the RTDB projection
 * through the shared store. All deliver the same snapshot and change shapes.
 */
const simulatedSources = [
  { owns: isDemoRouteId, subscribe: subscribeDemoRide, subscribeChanges: subscribeDemoRideChanges },
  { owns: isTourRouteId, subscribe: subscribeTourRide, subscribeChanges: subscribeTourRideChanges },
];
const simulatedSource = (routeId: unknown) => simulatedSources.find(source => source.owns(routeId));

/** A ride simulated in this browser (the demo ride or the app tour's ride): one bus, no RTDB, no backend. */
export function isSimulatedRouteId(routeId: unknown): boolean {
  return simulatedSource(routeId) !== undefined;
}

export const subscribeRouteBuses: typeof subscribeLiveBusesByRoute = (routeId, next, error) =>
  simulatedSource(routeId)?.subscribe(next) ?? subscribeLiveBusesByRoute(routeId, next, error);

export const subscribeRouteBusChanges: typeof subscribeLiveBusChangesByRoute = (routeId, next, error) =>
  simulatedSource(routeId)?.subscribeChanges(next) ?? subscribeLiveBusChangesByRoute(routeId, next, error);
