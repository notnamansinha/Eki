import type { ActiveBusEntry } from "./activeBusEntries";
import type { ActiveRouteGeometry } from "./activeRouteGeometry";
import type { ActiveRouteDisplay } from "./mapRouteGeometry";
import { directionsMatch, type RideDirection } from "./rideDirection";
import type { LatLng } from "./polyline";

export function sharedRerouteGeometry(
  buses: ReadonlyMap<string, ActiveBusEntry>,
  geometries: ReadonlyMap<string, ActiveRouteGeometry>,
  direction: RideDirection,
): ActiveRouteDisplay | null {
  let shared: ActiveRouteDisplay | null = null;
  for (const [id, bus] of buses) {
    const geometry = geometries.get(id);
    if (bus.routeSource !== "dynamic-reroute" || !directionsMatch(bus.routeDirection, direction) || !geometry) return null;
    if (shared && shared.polyline !== geometry.polyline) return null;
    shared = { polyline: geometry.polyline, version: bus.routeVersion ?? 0 };
  }
  return shared;
}

/** ETA never falls back to a shared presentation overlay belonging to another bus. */
export function busEtaPath(
  busId: string,
  geometries: ReadonlyMap<string, ActiveRouteGeometry>,
  configuredPath: LatLng[],
): LatLng[] {
  return geometries.get(busId)?.path ?? configuredPath;
}
