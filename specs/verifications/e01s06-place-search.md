# Verify evidence — e01s06 place search error taxonomy

- backend/routes/places.ts: every failure maps to a distinct code —
  invalid_query (400), not_configured (503), upstream_error (502),
  upstream_timeout (504, detected via timedOut flag on abort),
  rate_limited (429 via the limiter message). Success returns results + count.
- apiClient: ApiRequestError now carries an optional code (parsed from
  responses) alongside phase/status.
- RouteManagementPanel PlacesSearchBox: renders one distinct message per
  failure mode (not configured / timed out / rate limited / invalid query /
  upstream unavailable / auth 401-403 / no results) via placeSearchMessage().
- Integration-style test (backend/src/routes/places.test.ts): drives the
  GET /search handler with a mocked upstream — invalid_query, not_configured,
  upstream_error, upstream_timeout (fake timers + AbortController),
  and success mapping + count.
- Gates: backend vitest incl. places suite; frontend build/lint clean;
  docs mirrors re-synced.
