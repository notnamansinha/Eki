# Story e01s08 — Skip Google Routes for metadata-only route saves

> status: todo · bcps: 3 · risk: P2 · type: fix · context: frontend + backend
> delta: MODIFIED · source: issue #149 problem 8 · spec: e01s08-metadata-only-saves.md
> depends_on: e01s02

## Context

Renaming a stop (or changing route names/colors) invalidates nothing geometric, yet saving always
calls Google Routes before persisting — slow, quota-burning, and failure-prone.

Verified facts: `RouteManagementPanel` save flow calls the geometry computation (polyline route)
before persisting; `backend/src/routes/polyline.ts` gates storage on computed `DirectionalRouteGeometry`
(per e01s02). No metadata-only persistence path exists.

**Module purpose (zoom-out):** route save flow = editor → validation → geometry → persist.
**Callers:** RouteManagementPanel. **Contracts:** geometry change needs dual recompute (e01s02);
metadata change needs none. The story adds a branch: detect geometry-affecting edits
(coordinates, add/remove, order) vs metadata-only (names, color).

## Requirements

#### MODIFIED: Metadata-only saves skip Google Routes
**Before:** Renaming a stop triggers full Google Routes computation before saving.
**After:** Route and stop metadata (names, short names, colors) save without calling Google Routes.

#### ADDED: Geometry recompute is scoped to geometric changes
**Before:** Recompute trigger is "any save".
**After:** Geometry (both directions) recomputes only when coordinates change, stops are added or
removed, or stop order changes.

## Acceptance Criteria

- [ ] Renaming a stop makes zero Google Routes calls and persists.
- [ ] Coordinate/order/add/remove changes still recompute both directional geometries.
- [ ] Backend enforces the same split (a metadata-only write cannot silently drop geometry).
- [ ] Existing save behavior for real geometry edits is unchanged (regression-green).

## Out of Scope

- The e01s09 save-timeout/idempotency hardening (coordinate; this story only stops wasted routing).
- Swap-A/B behavior (e01s07) — a swap IS geometric and still recomputes.

## Risks

- Client-side "did geometry change?" detection must be deterministic (compare coordinate+order
  fingerprints); a false negative would skip a needed recompute. Put the fingerprint in shared lib
  code with tests, not ad-hoc in the component.
- Backend must reject a claimed-geometry write whose payload has no geometry, and accept
  metadata-only writes — define the request contract explicitly.

## Files

- `frontend/src/components/admin/RouteManagementPanel.tsx` — split save path
- `frontend/src/lib/adminValidation.ts` / `routeStopPayload.ts` — geometry fingerprint helper
- `backend/src/routes/polyline.ts` — metadata-only write support
- tests: `frontend/src/lib/adminValidation.test.ts`, `frontend/src/components/admin/RouteManagementPanel.test.tsx`,
  `backend/src/routes/polyline.test.ts`

## Verification Script

1. Component test: rename → assert zero geometry calls (mock), save persists.
2. Backend tests green; `npm run verify`.
3. Manual (UAT): rename a stop; confirm instant save with no route-recompute wait; then move a stop
   and confirm both directional routes recompute.
