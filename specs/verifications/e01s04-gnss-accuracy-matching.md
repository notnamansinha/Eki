# Verify evidence — e01s04 GNSS accuracy + directional matching

Finding: e01s04 is ALREADY implemented end-to-end on origin/main (merged
#145/#147 live-routing work predates issue #149 p4).

HDOP/accuracy:
- firmware writes gpsHdop (HDOP_REJECT_THRESHOLD=4.0) into the payload
  (hardware/src/main.cpp).
- backend telemetryPayload validates gpsHdop (0..99); deviceTelemetryService
  stores it on rawLocation.gpsHdop.
- frontend activeBusEntries validates and DashboardPanel renders it.

Directional confidence matching:
- backend telemetryRouteService decodes forwardPolyline/reversePolyline and
  maps the fix against the resolved direction's geometry
  (live.routeDirection === direction gate), producing matchedLocation with
  segmentIndex, alongRouteDistanceM (monotonic), headingDifference,
  distanceToRouteM, matchConfidence.
- frontend snapToPolyline accepts maxDistanceM, preferredSegmentIndex
  (continuity), maxSegmentJump, headingDegrees.
- liveBusMarkerPosition: uses matched only when routeState is ON_ROUTE/
  ON_NEW_ROUTE AND matchConfidence >= 0.45 AND seq/sampledAt/routeVersion
  match; otherwise falls back to authenticated raw telemetry (no blind snap,
  raw fix shown with HDOP indicator).

Never matches opposite-direction geometry: matcher is scoped to the route's
resolved direction (direction gate at telemetryRouteService).

Decision: verified-done (no new code warranted). Live UAT on a device is still
recommended to observe the marker on a divided road.
