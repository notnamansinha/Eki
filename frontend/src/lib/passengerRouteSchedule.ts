/**
 * Passenger route schedules — admin-approved routes with per-stop times.
 *
 * Stored at Firestore `settings/passengerRoutes` (backend-written via
 * PUT /api/v2/settings/passenger-routes). The document only holds approvals
 * and stop-ID → time maps; route names and stop order always come from the
 * route documents themselves, so there is no parallel copy of route data.
 */
import type { RouteData } from "@/hooks/useRoutes";

/** 24-hour "HH:mm", the value an `<input type="time">` produces. */
export const STOP_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
export const MAX_PASSENGER_ROUTES = 50;

export interface PassengerRouteApproval {
  routeId: string;
  /** stopId → "HH:mm". Stops without an entry have no configured time. */
  stopTimes: Record<string, string>;
}

export interface PassengerRouteConfig {
  routes: PassengerRouteApproval[];
}

export interface PassengerScheduleStop {
  id: string;
  name: string;
  /** "HH:mm", or null when the admin has not set a valid time for this stop. */
  time: string | null;
}

export interface PassengerRouteSchedule {
  routeId: string;
  name: string;
  color: string;
  stops: PassengerScheduleStop[];
}

export const EMPTY_PASSENGER_ROUTE_CONFIG: PassengerRouteConfig = { routes: [] };

export function isValidStopTime(value: unknown): value is string {
  return typeof value === "string" && STOP_TIME_PATTERN.test(value);
}

/** Coerce an untrusted Firestore payload; malformed entries are dropped, never thrown. */
export function normalizePassengerRouteConfig(value: unknown): PassengerRouteConfig {
  const data = value && typeof value === "object" ? value as Record<string, unknown> : {};
  if (!Array.isArray(data.routes)) return EMPTY_PASSENGER_ROUTE_CONFIG;
  const seen = new Set<string>();
  const routes: PassengerRouteApproval[] = [];
  for (const entry of data.routes) {
    if (!entry || typeof entry !== "object") continue;
    const { routeId, stopTimes } = entry as Record<string, unknown>;
    if (typeof routeId !== "string" || !routeId || seen.has(routeId)) continue;
    seen.add(routeId);
    const times: Record<string, string> = {};
    if (stopTimes && typeof stopTimes === "object" && !Array.isArray(stopTimes)) {
      for (const [stopId, time] of Object.entries(stopTimes)) {
        if (isValidStopTime(time)) times[stopId] = time;
      }
    }
    routes.push({ routeId, stopTimes: times });
  }
  return { routes };
}

/**
 * Join approvals with live route documents. Only approved routes that still
 * exist are returned, in approval order; stops follow the route's own order,
 * and times for deleted stops are ignored.
 */
export function buildPassengerRouteSchedules(
  config: PassengerRouteConfig,
  routes: readonly RouteData[],
): PassengerRouteSchedule[] {
  const byId = new Map(routes.map(route => [route.id, route]));
  const schedules: PassengerRouteSchedule[] = [];
  for (const approval of config.routes) {
    const route = byId.get(approval.routeId);
    if (!route) continue;
    schedules.push({
      routeId: route.id,
      name: route.name || route.id,
      color: route.color,
      stops: (Array.isArray(route.stops) ? route.stops : []).map(stop => ({
        id: stop.id,
        name: stop.name || stop.shortName || stop.id,
        time: isValidStopTime(approval.stopTimes[stop.id]) ? approval.stopTimes[stop.id] : null,
      })),
    });
  }
  return schedules;
}

/** "07:05" → "7:05 am", matching the lowercase style of the service-start copy. */
export function formatStopTime(time: string): string {
  if (!isValidStopTime(time)) return time;
  const [hours, minutes] = time.split(":").map(Number);
  const suffix = hours < 12 ? "am" : "pm";
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${hour12}:${String(minutes).padStart(2, "0")} ${suffix}`;
}
