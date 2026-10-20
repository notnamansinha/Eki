import * as base from "../fixtures/state";
export * from "../fixtures/state";
export const routeName = "Ahmedabad University Extended Campus and Science Research Shuttle";
export const originName = "Shilp Revanta Residential Campus Main Entrance";
export const destinationName = "Gate 12 Ahmedabad University Science and Engineering Campus";
base.route.name = routeName;
base.route.stops[0].name = originName;
base.route.stops[1].name = destinationName;
base.setScenario("forward");
export const auth = { currentUser: { getIdToken: async () => "synthetic-audit-token" } };
export function useBuses() { return { buses: [{ id: "qa-bus", name: "Synthetic bus" }] }; }
export function useDrivers() { return { drivers: [{ id: "qa-driver", name: "Synthetic operator" }] }; }
const sessions = ["manual_end_early", "abandoned_session_timeout", undefined, "future_reason"].map((reason, index) => ({
  id: `fixture-history-${index}`, busId: "qa-bus", driverId: "qa-driver", routeId: "qa-route",
  status: "interrupted", armedAt: 1_750_000_000_000, startTime: 1_750_000_001_000,
  endTime: 1_750_000_600_000, interruptionReason: reason, passengers: [], stopsReached: [],
}));
export function useCollection(path: string) {
  return { data: path === "ride_sessions" ? sessions : [], loading: false, error: null, retry: () => {} };
}
let sequence = 0;
let telemetryAge = 0;
export function setTelemetryAge(age: number) { telemetryAge = age; base.setScenario("forward"); }
export function advanceMotion() { sequence++; base.setScenario("forward"); }
function moving(snapshot: Record<string, unknown>) {
  if (telemetryAge) return Object.fromEntries(Object.entries(snapshot).map(([key, value]) => [key, {
    ...(value as object), timestamp: Date.now() - telemetryAge, backendReceivedAt: Date.now() - telemetryAge,
  }]));
  if (!sequence) return snapshot;
  return Object.fromEntries(Object.entries(snapshot).map(([key, value]) => [key, {
    ...(value as object), seq: sequence, lat: 23 + sequence * .00001, lng: 72 + sequence * .00001,
    heading: sequence * 4, speed: 18, motionState: "moving", timestamp: Date.now(), backendReceivedAt: Date.now(),
  }]));
}
export function subscribeLiveBusChanges(listener: (change: unknown) => void) {
  return base.subscribeLiveBusChanges(change => {
    const reset = change as { snapshot: Record<string, unknown> };
    listener({ ...reset, snapshot: moving(reset.snapshot) });
  });
}
export function subscribeLiveBusesByRoute(routeId: string, listener: (value: Record<string, unknown>) => void) {
  return base.subscribeLiveBusesByRoute(routeId, value => listener(moving(value)));
}
export function subscribeLiveBusChangesByRoute(routeId: string, listener: (change: unknown) => void, error?: (error: Error) => void) {
  return base.subscribeLiveBusChangesByRoute(routeId, change => {
    const reset = change as { snapshot: Record<string, unknown> };
    listener({ ...reset, snapshot: moving(reset.snapshot) });
  }, error);
}
