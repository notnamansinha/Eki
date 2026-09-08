# Story e01s09 — Make route saves idempotent with endpoint-specific timeouts and structured errors

> status: todo · bcps: 4 · risk: P1 · type: fix · context: frontend + backend
> delta: MODIFIED · source: issue #149 problem 9 · spec: e01s09-route-save-reliability.md

## Context

The frontend API timeout is 10 s and the backend Google Routes request also has a 10 s timeout,
followed by Firestore work. Tunnel overhead makes the frontend abort first: users see "Failed to
save: The request timed out" while the backend may still save — an uncertain saved/not-saved state.

Verified facts:

- `frontend/src/lib/apiClient.ts`: single `API_TIMEOUT_MS = 10_000` for every request.
- `backend/src/lib/googleMaps.ts`: `ROUTE_GEOMETRY_TIMEOUT_MS` bounds the upstream routing call;
  polyline.ts then does Firestore persistence.
- `RouteManagementPanel` reports generic timeout failure (issue).

**Module purpose (zoom-out):** route save = editor request → validation → Google routing →
persistence. **Callers:** admin route editor. **Contracts:** save must be atomic-ish from the
client's perspective: either it definitely saved or the client learns the true phase of failure.

## Requirements

#### MODIFIED: Endpoint-specific timeout for route geometry saves
**Before:** One 10 s global timeout; geometry saves race the backend's own 10 s routing call.
**After:** Route-geometry saves use a longer, dedicated timeout (backend routing bound + persistence
margin); other endpoints keep the shorter default.

#### ADDED: Idempotent route saves
**Before:** Retrying a save can double-apply or interleave.
**After:** Route saves are idempotent (stable request key / route version guard) so a retry after
timeout cannot corrupt the record.

#### MODIFIED: No uncertain outcomes; structured phase errors
**Before:** Client timeout can report failure while the backend saves.
**After:** A save reports one of: validation failed, Google routing failed, persistence failed
(each structured and distinct), or succeeded — never an ambiguous abort-then-save.

## Acceptance Criteria

- [ ] Route-geometry saves use an endpoint-specific timeout > the backend routing + persistence
      budget; other endpoints keep the default.
- [ ] A save retried after a client timeout converges to one outcome (idempotent; no double work).
- [ ] Errors distinguish validation / Google routing / persistence phases and render distinctly.
- [ ] Metadata-only saves (e01s08) never hit the geometry timeout path.
- [ ] Frontend never reports failure when the backend later saves (or the retry reconciles it).

## Out of Scope

- e01s08 geometry-skip logic (this story hardens the geometry-save path it leaves behind).
- General API-client redesign beyond per-endpoint timeout + typed phase errors.

## Risks

- Raising one timeout globally would mask genuinely dead requests — scope the override to the save
  call only.
- Idempotency key must come from the route/version, not a random client id, or retries diverge.
- Structured errors must map 1:1 to UI messages; keep a shared error-type table in apiClient.

## Files

- `frontend/src/lib/apiClient.ts` — per-endpoint timeout override + typed phase errors
- `frontend/src/components/admin/RouteManagementPanel.tsx` — distinct failure UI
- `backend/src/routes/polyline.ts` — phase error responses + idempotency/version guard
- `backend/src/server.ts` — error handler passthrough
- tests: `frontend/src/lib/apiClient.test.ts`, `backend/src/routes/polyline.test.ts`

## Verification Script

1. Client tests: save timeout override applies only to save; each phase error maps to a distinct
   message; retry converges.
2. Backend tests: idempotent save, phase-tagged errors. `npm run verify`.
3. Manual (UAT): with throttled tunnel, save a geometry edit — either success or a clear phase
   error; retry after a simulated timeout converges without duplicate route work.
