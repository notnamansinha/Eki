# Story e01s06 — Make admin place search work with distinct per-failure messages

> status: todo · bcps: 5 · risk: P1 · type: fix · context: backend + frontend (+ ops config)
> delta: MODIFIED · source: issue #149 problem 6 · spec: e01s06-place-search.md

## Context

The route editor's place search returns no usable results or fails. Verified facts on this branch:

- `backend/src/routes/places.ts`: `GET /search` is rate-limited (20/min), `requireAdmin`,
  5-minute in-memory cache, upstream Google Places call aborts at 5 s (AbortController seen in the
  file), typed `PlaceResult`.
- `frontend/src/lib/apiClient.ts`: single global `API_TIMEOUT_MS = 10_000` (per e01s09, but note
  search has its own 5 s upstream bound).
- Issue lists possible causes across deployment config: stale tunnel, stale compiled backend URL,
  CSP origin mismatch, CORS mismatch, Places API disabled/restricted, upstream timeout.

**Module purpose (zoom-out):** places.ts proxies authenticated Google Places search to admins.
**Callers:** RouteManagementPanel place picker. **Contracts:** `/api/places/search?q=` returns
`PlaceResult[]`; admin-only; rate-limited. Gaps: upstream failure modes are not distinguished, and
no authenticated integration test exists.

## Requirements

#### MODIFIED: Place search returns results or a distinct, truthful error
**Before:** Failures collapse into "no results"/generic errors; causes (backend down, auth, API not
configured, rate limit, upstream timeout, no results) are indistinguishable.
**After:** Each failure mode maps to a distinct user-facing message: backend unavailable,
authentication failure, Places API not configured, rate limit, upstream timeout, no results.

#### ADDED: Authenticated integration test for /api/places/search
**Before:** n/a.
**After:** An authenticated integration test covers success and each failure taxonomy (mocked
upstream), plus a CORS/CSP-origin consistency assertion.

#### MODIFIED: One backend origin everywhere
**Before:** CSP, CORS, and the compiled frontend can disagree about the backend origin.
**After:** Verified: `firebase.json` CSP, backend CORS allow-list, and the deployed frontend build
use the same origin. (Config verification + one consistency test/check; fixes applied if mismatched.)

## Acceptance Criteria

- [ ] Place search returns authenticated results when configured.
- [ ] Distinct messages render for backend-unavailable, auth failure, API-not-configured, rate
      limit, upstream timeout, and no-results.
- [ ] Authenticated integration test exists and passes for success + each failure mode.
- [ ] CSP, CORS, and the frontend build reference the same backend origin (checked, not assumed).
- [ ] Search stays rate-limited (20/min) with a truthful rate-limit message.

## Out of Scope

- Changing the Places provider or the rate-limit budget itself.
- The 5 s upstream bound (reuse; tune only if the integration test proves it wrong).

## Risks

- Some listed causes are deployment-state issues (tunnel up?, correct env build?) that code cannot
  fix — encode them as a repeatable origin/config check + runbook note, not as dead code.
- Google Places API key restriction mistakes must surface as "API not configured / auth failure",
  never as a silent no-results.

## Files

- `backend/src/routes/places.ts` — error taxonomy
- `backend/src/server.ts` (error handler), `backend/src/lib/apiClient.ts` — typed errors
- `frontend/src/components/admin/RouteManagementPanel.tsx` — distinct messages
- `firebase.json`, deploy/CSP scripts — origin consistency
- tests: `backend/src/routes/places.test.ts` (add authenticated integration),
  `frontend/src/lib/apiClient.test.ts`

## Verification Script

1. Backend integration test green (success + failure taxonomy, mocked upstream).
2. Origin-consistency check passes for `firebase.json` CSP vs CORS allow-list vs build.
3. `npm run verify`.
4. Manual (UAT): with tunnel up, search returns results; kill the tunnel → "backend unavailable";
   revoke the key → auth/not-configured message; hit 20/min → rate-limit message.
