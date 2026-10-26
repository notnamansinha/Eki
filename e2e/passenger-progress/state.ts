import { positionAlongPolyline, preparePolylineDistanceIndex } from "../../frontend/src/lib/polylineDistance";
import { useSyncExternalStore } from "react";
import { encodePolyline } from "../../backend/src/lib/polylineUtils";
import { reduceTripState } from "../../backend/src/services/tripStateReducer";
import { inferDepartureDirection } from "../../backend/src/services/departureDirection";
import { routeInRideDirection } from "../../frontend/src/lib/rideDirection";
import { getDistanceMeters } from "../../frontend/src/lib/mapUtils";

const query = new URLSearchParams(window.location.search);
const direction = query.get("direction") === "reverse" ? "reverse" : "forward";
const standardRoute = { id: "synthetic-progress", name: "Synthetic campus route", waypoints: [], color: "#22c55e",
  configVersion: 1, geometryVersion: 1, polylineQuality: "HIGH_QUALITY" as const,
  polyline: "_ekkC_omvLgEgEgEgEgEgE", stops: ["Alpha", "Beta", "Gamma", "Delta"].map((name, index) => ({
    id: name.toLowerCase(), name, shortName: name[0], lat: 23 + index * 0.001, lng: 72 + index * 0.001 })) };
const loopPath = [{ lat: 23, lng: 72 }, { lat: 23.001, lng: 72 }, { lat: 23.001, lng: 72.001 },
  { lat: 23, lng: 72.001 }, { lat: 23, lng: 72 }, { lat: 23.001, lng: 72 }, { lat: 23.002, lng: 72 }];
const configuredRoute = query.has("loop") ? { ...standardRoute,
  stops: [0, 1, 3, 5, 6].map((index, visit) => ({ ...loopPath[index],
    id: `visit-${visit}`, name: ["Origin", "First visit", "Turn", "Second visit", "End"][visit], shortName: `${visit}` })) } : standardRoute;
const path = query.has("loop") ? loopPath : configuredRoute.stops;
Object.assign(configuredRoute, { forwardPolyline: encodePolyline(path), reversePolyline: encodePolyline([...path].reverse()) });
export const route = routeInRideDirection(configuredRoute, direction);
const listeners = new Set<(snapshot: Record<string, unknown>) => void>();
const changeListeners = new Set<(change: unknown) => void>();
const storeListeners = new Set<() => void>();
let revision = 0;
function liveBus(index: number, point = query.has("loop") ? { lat: 23.0005, lng: 72 } : { lat: 23.0015, lng: 72.0015 }) {
  const now = Date.now();
  const alongRouteDistanceM = positionAlongPolyline(point, preparePolylineDistanceIndex(route.stops)) ?? 0;
  return { busId: "synthetic-bus", routeId: route.id, sessionId: "synthetic-session", driverId: "synthetic-driver",
    ...point, timestamp: now, backendReceivedAt: now, seq: 1, deviceState: "online", status: "active", tripState: "in_service",
    direction, directionState: "resolved", routeDirection: direction, routeVersion: 1, routeGeometryVersion: 1,
    currentStopIndex: index, routeSource: "configured", routeState: "ON_ROUTE", motionState: "moving", speed: 20, heading: query.has("loop") ? 0 : direction === "forward" ? 43 : 223,
    mapMatchSeq: 1, mapMatchSampledAt: now,
    rawLocation: { ...point, speed: 20, heading: 43, motionState: "moving", seq: 1, sampledAt: now },
    matchedLocation: { ...point, seq: 1, sampledAt: now, routeVersion: 1, matchConfidence: 0.99, distanceToRouteM: 0,
      segmentIndex: 1, segmentFraction: 0.5, alongRouteDistanceM } };
}
let snapshot: Record<string, unknown> = { bus: query.has("pending")
  ? { ...liveBus(0), direction: null, directionState: "pending", tripState: "pre_departure" }
  : liveBus(query.has("arrival") || query.has("loop") ? 1 : 2) };
function emit(bus: ReturnType<typeof liveBus> | Record<string, unknown>) {
  snapshot = { bus }; revision++;
  listeners.forEach(listener => listener(snapshot));
  changeListeners.forEach(listener => listener({ type: "reset", snapshot, source: "listener" }));
  storeListeners.forEach(listener => listener());
}
export function publish(index: number) { dynamicGeometry = new Map(); emit(liveBus(index)); }
export function publishUncertainFix() {
  const bus = liveBus(2);
  emit({ ...bus, matchedLocation: { ...bus.matchedLocation, matchConfidence: 0.1 } });
}
export function publishDetour(ready = true) {
  const point = { lat: 23.0015, lng: 72.0008 };
  const detour = [point, { lat: 23.002, lng: 72.0008 }, ...route.stops.slice(2)];
  dynamicGeometry = ready ? new Map([["synthetic-bus", { polyline: encodePolyline(detour), firstStopIndex: 2 }]]) : new Map();
  const bus = liveBus(2, point);
  emit({ ...bus, routeSource: "dynamic-reroute", routeVersion: 2, routeState: "ON_ROUTE",
    matchedLocation: { ...bus.matchedLocation, routeVersion: 2, alongRouteDistanceM: 0 } });
}
export function publishArrival(distance: number) {
  const point = { lat: route.stops[1].lat + distance / 111_195, lng: route.stops[1].lng };
  const state = reduceTripState({ ...point, stops: route.stops, motionState: "moving", currentTripState: "in_service",
    currentStopIndex: 1, hasDepartedOrigin: true, now: Date.now(), timestamp: Date.now() });
  emit(liveBus(state.currentStopIndex, point));
}
export function publishDeparture() {
  const [start, next] = route.stops;
  const length = getDistanceMeters(start, next);
  const point = (metres: number) => ({ lat: start.lat + (next.lat - start.lat) * metres / length,
    lng: start.lng + (next.lng - start.lng) * metres / length });
  const now = Date.now();
  const resolved = inferDepartureDirection({ samples: [20, 40, 38, 60].map((metres, i) => ({ ...point(metres), timestamp: now - 12_000 + i * 4_000 })),
    stops: configuredRoute.stops, forwardPath: configuredRoute.stops, reversePath: [...configuredRoute.stops].reverse(), now });
  if (resolved !== direction) throw new Error("Departure replay failed to establish travel direction");
  const departed = reduceTripState({ ...point(110), stops: route.stops, currentTripState: "pre_departure", currentStopIndex: 0,
    hasDepartedOrigin: false, motionState: "moving", now, timestamp: now });
  emit(liveBus(departed.currentStopIndex, point(110)));
}
export function subscribeLiveBusesByRoute(_id: string, listener: (snapshot: Record<string, unknown>) => void) {
  listeners.add(listener); listener(snapshot); return () => { listeners.delete(listener); };
}
let dynamicGeometry = new Map();
export function useDynamicRouteGeometries() { return dynamicGeometry; }
export const auth = { currentUser: { uid: "synthetic-passenger", getIdToken: async () => "synthetic-token" } };
export function getAuthVerificationGeneration() { return 1; }
const subscribe = (listener: () => void) => { storeListeners.add(listener); return () => { storeListeners.delete(listener); }; };
const user = { uid: "synthetic-passenger", displayName: "Synthetic passenger", role: "passenger", isAnonymous: false };
export function useAuth() { return { user }; }
export function useRoutes() { useSyncExternalStore(subscribe, () => revision); return { routes: [configuredRoute], error: null, retry() {} }; }
export function useSettings() { return { settings: { announcementActive: false, serviceStartTime: "8:00 am" } }; }
const markSnapshotReceived = () => {};
export function useRTDBResume() { return { isConnected: true, isResuming: false, resumeGeneration: 0, connectionGeneration: 0, markSnapshotReceived }; }
export function useLiveRouteCatalog() { useSyncExternalStore(subscribe, () => revision); return {
  catalog: { [route.id]: { active: 1, available: 0 } }, projectionReady: true, catalogReady: true, error: null, retry() {} }; }
export function subscribeLiveBusChangesByRoute(_id: string, listener: (change: unknown) => void) {
  changeListeners.add(listener); listener({ type: "reset", snapshot, source: "listener" }); return () => { changeListeners.delete(listener); };
}
export async function getJoinedRideStatus() { throw new Error("No joined ride in this disposable fixture"); }
