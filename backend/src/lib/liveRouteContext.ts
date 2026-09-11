const LIVE_ROUTE_CONTEXT_FIELDS = [
  "activeRouteId",
  "activeRoutePolyline",
  "routeVersion",
  "routeSource",
  "routeDirection",
  "routeSessionId",
  "routeGeometryVersion",
  "routeState",
  "routeMatchHistory",
  "offRouteSampleCount",
  "mapMatchUpdatedAt",
  "matchConfidence",
  "distanceToActiveRoute",
  "matchedLocation",
  "rerouteRequestId",
  "lastRerouteAttemptAt",
  "rerouteError",
  "rerouteCompletedAt",
  "rerouteFailedAt",
] as const;

/** True when any direction-derived matching or rerouting state is present. */
export function hasLiveRouteContext(
  live: Record<string, unknown> | null,
): boolean {
  return Boolean(
    live && LIVE_ROUTE_CONTEXT_FIELDS.some((field) =>
      Object.prototype.hasOwnProperty.call(live, field)
    ),
  );
}

/**
 * Preserve physical telemetry and lifecycle data while removing every route
 * match/reroute field owned by the previous ride session.
 */
export function withoutLiveRouteContext(
  live: Record<string, unknown> | null,
): Record<string, unknown> {
  const next = { ...(live ?? {}) };
  for (const field of LIVE_ROUTE_CONTEXT_FIELDS) delete next[field];
  return next;
}
