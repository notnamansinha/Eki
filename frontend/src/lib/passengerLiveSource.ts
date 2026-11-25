import { subscribeLiveBusChangesByRoute, subscribeLiveBusesByRoute } from "@/lib/liveBusStore";
import { isDemoRouteId, subscribeDemoRide, subscribeDemoRideChanges } from "@/lib/demoRide";
import { isTourRouteId, subscribeTourRide, subscribeTourRideChanges } from "@/lib/tourRide";

/**
 * Live buses for one passenger route. The demo ride and the app tour's ride
 * are simulated in this browser; every other route reads the RTDB projection
 * through the shared store. All deliver the same snapshot and change shapes.
 */
export const subscribeRouteBuses: typeof subscribeLiveBusesByRoute = (routeId, next, error) =>
  isDemoRouteId(routeId) ? subscribeDemoRide(next)
    : isTourRouteId(routeId) ? subscribeTourRide(next)
    : subscribeLiveBusesByRoute(routeId, next, error);

export const subscribeRouteBusChanges: typeof subscribeLiveBusChangesByRoute = (routeId, next, error) =>
  isDemoRouteId(routeId) ? subscribeDemoRideChanges(next)
    : isTourRouteId(routeId) ? subscribeTourRideChanges(next)
    : subscribeLiveBusChangesByRoute(routeId, next, error);
