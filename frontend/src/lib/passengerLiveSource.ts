import { subscribeLiveBusChangesByRoute, subscribeLiveBusesByRoute } from "@/lib/liveBusStore";
import { isDemoRouteId, subscribeDemoRide, subscribeDemoRideChanges } from "@/lib/demoRide";

/**
 * Live buses for one passenger route. The demo ride is simulated in this
 * browser; every other route reads the RTDB projection through the shared
 * store. Both deliver the same snapshot and change shapes.
 */
export const subscribeRouteBuses: typeof subscribeLiveBusesByRoute = (routeId, next, error) =>
  isDemoRouteId(routeId) ? subscribeDemoRide(next) : subscribeLiveBusesByRoute(routeId, next, error);

export const subscribeRouteBusChanges: typeof subscribeLiveBusChangesByRoute = (routeId, next, error) =>
  isDemoRouteId(routeId) ? subscribeDemoRideChanges(next) : subscribeLiveBusChangesByRoute(routeId, next, error);
