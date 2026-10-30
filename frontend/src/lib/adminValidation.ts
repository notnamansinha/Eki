import { isValidStopTime, MAX_PASSENGER_ROUTES, type PassengerRouteConfig } from "@/lib/passengerRouteSchedule";

const SAFE_ID =/^[A-Za-z0-9_-]{1,128}$/;
// Vehicle and operator IDs become Firestore document IDs, which reject this form.
const RESERVED_DOCUMENT_ID = /^__.*__$/;
const RESERVED_ID_MESSAGE = "cannot both start and end with two underscores.";

export function validateVehicleInput(id: string, name: string, assignedRoutes: string[]): string | null {
  if (!id.trim()) return "Vehicle ID is required.";
  if (!SAFE_ID.test(id.trim())) return "Vehicle ID may contain only letters, numbers, hyphens, and underscores (max 128 characters).";
  if (RESERVED_DOCUMENT_ID.test(id.trim())) return `Vehicle ID ${RESERVED_ID_MESSAGE}`;
  if (!name.trim()) return "Vehicle display name is required.";
  if (name.trim().length > 100) return "Vehicle display name must be 100 characters or fewer.";
  if (assignedRoutes.length > 50) return "A vehicle can be assigned to at most 50 routes.";
  return null;
}

export function validateOperatorInput(id: string, name: string, authUid: string): string | null {
  if (!id.trim()) return "Operator ID is required.";
  if (!SAFE_ID.test(id.trim())) return "Operator ID may contain only letters, numbers, hyphens, and underscores (max 128 characters).";
  if (RESERVED_DOCUMENT_ID.test(id.trim())) return `Operator ID ${RESERVED_ID_MESSAGE}`;
  if (!name.trim()) return "Operator display name is required.";
  if (name.trim().length > 100) return "Operator display name must be 100 characters or fewer.";
  if (!authUid.trim()) return "Firebase Auth UID is required.";
  if (!SAFE_ID.test(authUid.trim())) return "Firebase Auth UID may contain only letters, numbers, hyphens, and underscores (max 128 characters).";
  return null;
}

export function validateSettingsInput(settings: {
  serviceStartTime: string;
  noBusesMessage: string;
  noBusesSubMessage: string;
  announcementText: string;
}): string | null {
  const fields: Array<[string, string, number, boolean]> = [
    ["Service start time", settings.serviceStartTime, 64, true],
    ["No-buses headline", settings.noBusesMessage, 200, true],
    ["No-buses subtext", settings.noBusesSubMessage, 300, true],
    ["Announcement text", settings.announcementText, 500, false],
  ];
  for (const [label, value, limit, required] of fields) {
    if (required && !value.trim()) return `${label} is required.`;
    if (value.length > limit) return `${label} must be ${limit} characters or fewer.`;
  }
  return null;
}

/** Route shape the passenger schedule validator needs; `RouteData` satisfies it. */
export interface PassengerScheduleRouteInput {
  id: string;
  name?: string;
  stops?: readonly { id: string; name?: string; shortName?: string }[];
}

export type PassengerStopTimeProblem = "missing" | "invalid";

/** Stable key for one stop of one route (IDs may contain any characters). */
export function passengerStopTimeKey(routeId: string, stopId: string): string {
  return JSON.stringify([routeId, stopId]);
}

function routeStops(route: PassengerScheduleRouteInput) {
  return Array.isArray(route.stops) ? route.stops : [];
}

/**
 * Every stop of every selected route that lacks a valid "HH:mm" time, keyed by
 * `passengerStopTimeKey`. Stops are reported in selection then travel order.
 */
export function findPassengerStopTimeProblems(
  draft: PassengerRouteConfig,
  routes: readonly PassengerScheduleRouteInput[],
): Map<string, PassengerStopTimeProblem> {
  const byId = new Map(routes.map(route => [route.id, route]));
  const problems = new Map<string, PassengerStopTimeProblem>();
  for (const approval of draft.routes) {
    const route = byId.get(approval.routeId);
    if (!route) continue;
    for (const stop of routeStops(route)) {
      const time = approval.stopTimes[stop.id];
      if (time === undefined || time === "") problems.set(passengerStopTimeKey(route.id, stop.id), "missing");
      else if (!isValidStopTime(time)) problems.set(passengerStopTimeKey(route.id, stop.id), "invalid");
    }
  }
  return problems;
}

/**
 * Mirrors the passenger-routes API: at most MAX_PASSENGER_ROUTES distinct,
 * existing routes, each with a valid time for every one of its stops.
 * Returns the first problem as a user-facing message, or null when valid.
 */
export function validatePassengerRouteSchedule(
  draft: PassengerRouteConfig,
  routes: readonly PassengerScheduleRouteInput[],
): string | null {
  if (draft.routes.length > MAX_PASSENGER_ROUTES) {
    return `Select at most ${MAX_PASSENGER_ROUTES} routes for passengers (${draft.routes.length} selected).`;
  }
  const byId = new Map(routes.map(route => [route.id, route]));
  const seen = new Set<string>();
  for (const approval of draft.routes) {
    if (seen.has(approval.routeId)) return "A route is selected more than once. Reload and try again.";
    seen.add(approval.routeId);
    if (!byId.has(approval.routeId)) return "A selected route no longer exists. Reload and try again.";
  }
  const problems = findPassengerStopTimeProblems(draft, routes);
  if (problems.size === 0) return null;
  const [firstKey, firstProblem] = problems.entries().next().value as [string, PassengerStopTimeProblem];
  const [routeId, stopId] = JSON.parse(firstKey) as [string, string];
  const route = byId.get(routeId)!;
  const stop = routeStops(route).find(candidate => candidate.id === stopId);
  const stopName = stop?.name || stop?.shortName || stopId;
  const where = `"${stopName}" on ${route.name || route.id}`;
  if (problems.size > 1) return `${problems.size} stop times are missing or invalid, starting with ${where}. Set a time for every stop.`;
  return firstProblem === "missing" ? `Set a time for ${where}.` : `${where} has an invalid time. Use HH:mm.`;
}
