# Verify evidence — e01s02 directional geometry

Finding: e01s02 is ALREADY implemented on origin/main (merged #145/#147 #149 predates it).

Backend (backend/src/routes/polyline.ts):
- computeDirectionalPolylines() runs two independent Routes API calls: forward waypoints and reversed waypoints (B->A), then persists forwardPolyline + reversePolyline + per-direction distance/duration/polylineQuality.
- PUT /api/routes/:id stores ...geometry (both directions) and POST /:routeId/geometry serves cached directional geometry, repairing legacy single-geometry docs via the authenticated repair path.
- reversible-over-reverse bug: reversePolyline is a real B->A driving route, never the reversed A->B array.

Frontend (mapRouteGeometry + rideDirection):
- routeInRideDirection selects forwardPolyline/reversePolyline; mapRouteGeometry.decodeRoutePathForDisplay does NOT reverse a direction-specific reversePolyline (tested); only the gated legacy forward-only fallback reverses when no directional geometry exists (tested).

Residual gap decision: none found requiring new code. Optional deeper coverage: an emulator-backed backend test for the PUT/GET polyline routes (needs Firebase emulator + stubbed Routes API). Not added unless requested.

Frontend test status: mapRouteGeometry.test.ts covers forward order, no-reversal-with-reversePolyline, legacy-only reversal, active reroute, and stops fallback.
