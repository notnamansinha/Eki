# Verify evidence — e01s07 swap A/B

- Pure helper swapEndpoints() in routeStopPayload.ts: swaps exactly-two-stop
  routes preserving stop IDs; returns null for 0/1/3+ stops or undefined.
- RouteManagementPanel: "Swap A & B" button in the Stops header, gated on
  stops.length === 2; clears polyline so saving recomputes BOTH directional
  geometries (via e01s02) and persists through the e01s09-hardened save.
- No new dependency added (decision: swap button over drag-and-drop).
- Tests: swapEndpoints unit suite (ID preservation, only-two-stops gate).
- Gates: frontend vitest 175; frontend next build exit 0; lint clean;
  backend vitest 365 (after docs:sync); backend tsc clean.
