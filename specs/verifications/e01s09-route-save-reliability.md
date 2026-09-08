# Verify evidence — e01s09 route-save reliability

- apiClient: added ApiRequestError with failure phase (validation/routing/
  persistence/timeout); per-request timeoutMs override; ROUTE_SAVE_TIMEOUT_MS=30s
  for route saves. New tests: phase attribution, per-request timeout phase.
- RouteManagementPanel: save uses ROUTE_SAVE_TIMEOUT_MS; sends stable saveId
  (content hash); renders distinct per-phase messages (no generic timed-out);
  idempotent retry is safe.
- backend/polyline.ts PUT: structured phase errors for validation/routing/
  persistence (split geometry vs write try/catch); idempotent replay when the
  client saveId matches stored saveId (retry after timeout converges without
  recomputing Google or rewriting); routeVersion bumped on each applied save.
- Gates: backend vitest 365 passed; frontend 173; lint clean; backend tsc
  clean; frontend next build exit 0.
