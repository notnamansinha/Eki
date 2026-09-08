# Verify evidence — e01s08 metadata-only saves skip Google Routes

- backend/src/lib/routeGeometry.ts: routeGeometrySignature() + geometryIsUnchanged()
  compare ordered id + quantized (1e-6) coordinates. Metadata (name/color) never
  changes the signature; reorder/swap/add/remove/coordinate change does.
- backend/src/routes/polyline.ts PUT: on edit, if the stored route has
  directional geometry and geometryIsUnchanged(incoming, stored), reuse the
  cached directional geometry and skip computeDirectionalPolylines. Returns
  recomputed:false. Real geometry changes still recompute both directions.
- frontend RouteManagementPanel.renameStop: no longer clears polyline
  (renaming is metadata-only; map geometry stays). updateRouteName already
  preserved geometry.
- Idempotent saveId replay (e01s09) and routeVersion bump preserved.
- New tests: routeGeometry.test.ts (signature ignores name; detects reorder/
  add/remove/move; float-noise robust).
- Gates: backend vitest + routeGeometry suite green; frontend build exit 0;
  lint clean; backend/frontend tsc clean (docs:sync applied for mirrors).
