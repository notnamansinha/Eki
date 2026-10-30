import { useSyncExternalStore, useState, useEffect } from "react";
import { isPassengerBusSelectable } from "../../frontend/src/lib/passengerAvailability";
const subscribers = new Set<() => void>();
export const route = {
  id: "qa-route", name: "QA route", color: "#3B82F6", duration: "600s", waypoints: [],
  stops: [{ id: "a", name: "Alpha", shortName: "A", lat: 23, lng: 72 }, { id: "b", name: "Beta", shortName: "B", lat: 23.01, lng: 72.01 }],
};
export function fixtureBus(direction: string | null = null, sessionId = "qa-session", busId = "qa-bus") {
  return { busId, routeId: route.id, sessionId, driverId: "qa-driver", lat: 23, lng: 72, timestamp: Date.now(), backendReceivedAt: Date.now(), seq: 1, deviceState: "online", status: "active", tripState: "in_service", direction, directionState: direction ? "resolved" : "pending", motionState: "stopped", speed: 0 };
}
let snapshot: Record<string, unknown> = { bus: fixtureBus() };
const liveSubscribers = new Set<(change: unknown) => void>();
let scenario = "pending";
const subscribe = (fn: () => void) => { subscribers.add(fn); return () => { subscribers.delete(fn); }; };
export function setScenario(next: string) {
  scenario = next;
  const bus = fixtureBus(next === "pending" || next === "reconnecting" ? null : next === "reverse" ? "reverse" : "forward");
  snapshot = next === "empty" ? {} : next === "device" ? { bus: { busId: bus.busId, routeId: bus.routeId, deviceState: "online", status: "offline", timestamp: Date.now(), lat: 23.004, lng: 72.004, heading: 0, speed: 0, motionState: "stopped" } } : next === "multiple" ? { bus, second: fixtureBus("reverse", "qa-session-2", "qa-bus-2") } : { bus };
  if (next === "completed") snapshot = { bus: { ...bus, tripState: "completed" } };
  if (next === "stale") snapshot = { bus: { ...bus, timestamp: Date.now() - 120_000, backendReceivedAt: Date.now() - 120_000 } };
  if (next === "offline") snapshot = { bus: { ...bus, deviceState: "offline" } };
  if (next === "multiple-stale") snapshot = {
    bus: { ...bus, timestamp: Date.now() - 120_000, backendReceivedAt: Date.now() - 120_000 },
    second: fixtureBus("reverse", "qa-session-2", "qa-bus-2"),
  };
  if (next === "two-routes") snapshot = { bus, second: { ...fixtureBus("reverse", "qa-session-B", "qa-bus-B"), routeId: "qa-route-2" } };
  if (next === "mixed") snapshot = { bus, second: {
    busId: "qa-bus-2", routeId: route.id, deviceState: "online", timestamp: Date.now(),
    lat: 23.007, lng: 72.007, speed: 0, motionState: "stopped", status: "offline",
  } };
  subscribers.forEach(fn => fn());
  liveSubscribers.forEach(fn => fn({ type: "reset", snapshot, source: "listener" }));
}
export function useScenario() { return useSyncExternalStore(subscribe, () => scenario); }
export function subscribeLiveBusChanges(fn: (change: unknown) => void) {
  liveSubscribers.add(fn);
  fn({ type: "reset", snapshot, source: "listener" });
  return () => { liveSubscribers.delete(fn); };
}
const fixtureRole = typeof location === "undefined" ? null : new URLSearchParams(location.search).get("role");
export const qaUser = fixtureRole === "admin"
  ? { uid: "qa-admin", displayName: "QA Admin", role: "admin" }
  : { uid: "qa-passenger", displayName: "QA Passenger", role: "passenger" };
export function useAuth() { return { user: qaUser, loading: false, roleError: null, loginReady: true, loginLoading: false, loginError: null, loginFallbackAvailable: false, loginWithGoogle: async () => {}, loginWithGoogleRedirect: async () => {}, logout: async () => {} }; }
// A published-schedule-only route: it has no live catalog entry, so it never
// appears on the live map list, only in the passenger Routes (schedule) tab.
// Opt-in with `?schedule=demo` so existing route-count assertions are unchanged;
// without it the Campus Loop approval below points at a missing route and is skipped.
const scheduleDemo = typeof location !== "undefined" && new URLSearchParams(location.search).get("schedule") === "demo";
export const scheduleRoute = {
  id: "qa-campus-loop", name: "Campus Loop", color: "#10B981", duration: "900s", waypoints: [],
  stops: [
    { id: "gate", name: "Main Gate", shortName: "GATE", lat: 23, lng: 72 },
    { id: "library", name: "Central Library", shortName: "LIB", lat: 23.002, lng: 72.002 },
    { id: "hostel", name: "Girls Hostel Block C (North Wing)", shortName: "HOS", lat: 23.004, lng: 72.004 },
    { id: "sports", name: "Sports Complex", shortName: "SPT", lat: 23.006, lng: 72.006 },
    { id: "admin", name: "Administrative Building", shortName: "ADM", lat: 23.008, lng: 72.008 },
  ],
};
export function useRoutes() {
  useScenario();
  const routes = scenario === "two-routes" ? [route, { ...route, id: "qa-route-2", name: "QA route B", color: "#F59E0B" }] : [route];
  return { routes: scheduleDemo ? [...routes, scheduleRoute] : routes, error: null, retry: () => {} };
}
// Synthetic `settings/passengerRoutes`: approval order Campus Loop, QA route; QA route B is never approved.
let passengerRouteConfig = { routes: [
  { routeId: scheduleRoute.id, stopTimes: { gate: "07:30", library: "07:38", hostel: "07:45", admin: "08:05" } },
  { routeId: route.id, stopTimes: { a: "12:00", b: "12:15" } },
] };
export function usePassengerRouteConfig() {
  const current = useSyncExternalStore(subscribe, () => passengerRouteConfig);
  return { config: current, loading: false, error: null, saveConfig: async (next: typeof passengerRouteConfig) => {
    passengerRouteConfig = next;
    subscribers.forEach(fn => fn());
  } };
}
let settings = { noBusesMessage: "No buses running", noBusesSubMessage: "Service starts at {time}", serviceStartTime: "8:00 am", announcementActive: false, announcementText: "" };
export function useSettings() {
  const current = useSyncExternalStore(subscribe, () => settings);
  return { settings: current, loading: false, saveSettings: async (partial: Partial<typeof settings>) => {
    settings = { ...settings, ...partial };
    subscribers.forEach(fn => fn());
  } };
}
const markSnapshotReceived = () => {};
export function useRTDBResume() { const current = useScenario(); return { isConnected: current !== "reconnecting", isResuming: current === "reconnecting", resumeGeneration: 0, connectionGeneration: current === "reconnecting" ? 1 : 0, markSnapshotReceived }; }

export function subscribeLiveBusesByRoute(routeId: string, listener: (value: Record<string, unknown>) => void) {
  return subscribeLiveBusChanges((change: unknown) => {
    const reset = change as { snapshot: Record<string, { routeId?: string }> };
    listener(Object.fromEntries(Object.entries(reset.snapshot).filter(([, bus]) => bus.routeId === routeId)));
  });
}
const emptyGeometry = new Map();
export function useDynamicRouteGeometries() { return emptyGeometry; }

export function subscribeLiveBusChangesByRoute(routeId: string, listener: (change: unknown) => void, error?: (error: Error) => void) {
  return subscribeLiveBusChanges((change: unknown) => {
    const reset = change as { snapshot: Record<string, { routeId?: string }> };
    if (scenario === "detail-denied") { error?.(new Error("QA synthetic detail PERMISSION_DENIED")); return; }
    listener({ ...reset, snapshot: Object.fromEntries(Object.entries(reset.snapshot).filter(([, bus]) => bus.routeId === routeId)) });
  });
}
export function useLiveRouteCatalog() {
  useScenario();
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const buses = Object.values(snapshot) as Record<string, unknown>[];
  return { catalog: Object.fromEntries([route.id, "qa-route-2"].map(routeId => [routeId, { active: buses.filter(bus => bus.routeId === routeId && bus.sessionId && bus.tripState !== "completed" && isPassengerBusSelectable(bus, now)).length,
    available: buses.filter(bus => bus.routeId === routeId && !bus.sessionId && isPassengerBusSelectable(bus, now)).length, freshestAt: Date.now() }])), projectionReady: scenario !== "projection-unready", catalogReady: scenario !== "catalog-denied", error: scenario === "catalog-denied" ? "QA synthetic route catalog PERMISSION_DENIED. Retry after checking permissions." : scenario === "projection-unready" ? "QA synthetic projection unavailable: worker backfill/schema is not ready." : null, retry: () => setScenario("two-routes") };
}
export function getJoinedRideStatus(sessionId: string) { return Promise.resolve({ sessionId, busId: "qa-bus", routeId: route.id, status: "completed" }); }
export function getAuthVerificationGeneration() { return 1; }
export function invalidateLiveBusCache() { setScenario(scenario === "detail-denied" ? "two-routes" : scenario); }
