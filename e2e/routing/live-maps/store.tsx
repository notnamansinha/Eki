import { useSyncExternalStore } from "react";
import probe from "virtual:eki-route-fixture";
import { PREDEFINED_ROUTES } from "@/lib/predefinedRoutes";
import { decodePolyline } from "@/lib/polyline";
import type { ActiveBusEntry } from "@/lib/activeBusEntries";
import type { RouteData } from "@/hooks/useRoutes";
const preset = PREDEFINED_ROUTES.find(route => route.id === probe.fixture)!;
export const route: RouteData = { ...preset,
  waypoints: preset.waypoints.map(([lng, lat]) => ({ lat, lng })),
  polyline: probe.directions[0].encodedPolyline,
  forwardPolyline: probe.directions[0].encodedPolyline,
  reversePolyline: probe.directions[1].encodedPolyline,
  polylineQuality: "HIGH_QUALITY", configVersion: 1, geometryVersion: 1,
};
export const paths = { forward: decodePolyline(route.forwardPolyline!), reverse: decodePolyline(route.reversePolyline!) };
type State = { direction: "forward" | "reverse"; index: number; bus: ActiveBusEntry; entries: ActiveBusEntry[] };
const listeners = new Set<() => void>();
let seq = 0;
function create(direction: State["direction"], index: number, reliable = true, version?: number, nextStopIndex = 1): State {
  const path = paths[direction], point = path[index], next = path[Math.min(index + 1, path.length - 1)];
  const heading = (Math.atan2(next.lng - point.lng, next.lat - point.lat) * 180 / Math.PI + 360) % 360;
  const now = Date.now(), revision = version ?? (direction === "forward" ? 4 : 5);
  const bus: ActiveBusEntry = { busId: "SIMULATED-BUS", routeId: route.id, driverId: "simulated-driver",
    sessionId: `simulated-${direction}`, direction, directionState: "resolved", routeDirection: direction,
    routeVersion: revision, routeSource: "configured", routeState: "ON_ROUTE",
    activeRouteId: `${route.id}:configured:${direction}`, status: "active", tripState: "in_service",
    deviceState: "online", motionState: "moving", currentStopIndex: nextStopIndex,
    lat: point.lat, lng: point.lng + (reliable ? 0 : .0002), speed: 20, heading,
    timestamp: now, backendReceivedAt: now, seq: ++seq,
    rawLocation: { lat: point.lat, lng: point.lng + .0002, speed: 20, heading, gpsHdop: 2,
      motionState: "moving", seq, sampledAt: now }, mapMatchSeq: seq, mapMatchSampledAt: now,
    ...(reliable ? { matchedLocation: { ...point, segmentIndex: index, segmentFraction: 0,
      alongRouteDistanceM: index * 20, distanceToRouteM: 20, matchConfidence: .95,
      seq, sampledAt: now, routeVersion: revision } } : {}),
  };
  return { direction, index, bus, entries: [bus] };
}
let current = create("forward", 20);
export function publish(direction = current.direction, index = current.index, reliable = true, version?: number, nextStopIndex = direction === current.direction ? current.bus.currentStopIndex : 1) {
  current = create(direction, index, reliable, version, nextStopIndex); listeners.forEach(listener => listener());
}
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const useSimulation = () => useSyncExternalStore(subscribe, () => current);
export const useActiveBuses = () => useSimulation().entries;
export function subscribeLiveBusesByRoute(_id: string, listener: (value: Record<string, unknown>) => void) {
  const emit = () => listener({ simulated: current.bus });
  const unsubscribe = subscribe(emit); queueMicrotask(emit); return unsubscribe;
}
const routes = [route], buses = [{ id: "SIMULATED-BUS", name: "SIMULATED-BUS", assignedRoutes: [route.id] }];
export const useRoutes = () => ({ routes, loading: false, error: null, retry() {} });
export const useBuses = () => ({ buses, loading: false, error: null, retry() {} });
export const useDrivers = () => ({ drivers: [], loading: false, error: null, retry() {} });
export const useAuth = () => ({ user: { uid: "simulated-admin" } });
export const useRTDBResume = () => ({ isResuming: false, connectionGeneration: 0, resumeGeneration: 0, markSnapshotReceived() {} });
export const auth = { currentUser: null }, rtdb = {}, db = {};
export const waitForAuth = async () => null;
export const ref = (_db: unknown, path: string) => path;
export const get = async () => ({ val: () => null });
