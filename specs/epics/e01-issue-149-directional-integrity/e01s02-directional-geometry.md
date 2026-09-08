# Story e01s02 — Compute and store forward and reverse driving geometries independently

> status: todo · bcps: 8 · risk: P0 · type: fix · context: backend + frontend
> delta: MODIFIED · source: issue #149 problem 2 · spec: e01s02-directional-geometry.md
> depends_on: (none) · required_by: e01s04, e01s07, e01s08

## Context

On divided roads, A → B and B → A are different driving problems (carriageway, turns, U-turns,
entrances/exits, distance, duration). Reversing one encoded polyline is not a valid reverse route.

Verified facts on this branch (origin/main, no PR #153):

- `backend/src/routes/polyline.ts` already defines `DirectionalRouteGeometry` with
  `polyline`, `forwardPolyline`, `reversePolyline`, per-direction `distanceMeters`/`duration`,
  and `polylineQuality: "HIGH_QUALITY"`; an in-memory `geometryComputations` map de-dupes inflight
  computations; `STORED_POLYLINE_QUALITY = "HIGH_QUALITY"`.
- `frontend/src/hooks/useRoutes.ts` carries optional `forwardPolyline`/`reversePolyline` and
  `polylineQuality`; `frontend/src/lib/rideDirection.ts::routeInRideDirection` already selects the
  directional polyline when both exist, and forces a "geometry repair" path for legacy records
  lacking directional geometry.
- Issue problem 2 observed the bus travelling west while the route stayed on the eastbound
  carriageway — evidence some records/paths still fall back to a single geometry or a reversed
  array.

**Module purpose (zoom-out):** polyline.ts owns route-geometry computation and persistence.
**Callers:** route save flows (admin), ride/trip state, frontend map + ETA. **Contracts:**
route record geometry fields; `DirectionalRouteGeometry` shape; Google Routes request (A→B and
B→A must both be requested); Firestore route records. Gap to close: guarantee every
geometry-affecting write stores both directions computed independently, and every read/fallback
path refuses reversed-array geometry as a reverse route.

## Requirements

#### MODIFIED: Reverse geometry is a real B → A driving route
**Before:** Some route records carry a single A → B geometry; reverse travel uses reversed stop
order or a reversed coordinate array, which is not a valid B → A driving route.
**After:** Forward and reverse Google driving geometries are computed and stored independently for
every route that has a direction. Records expose forward/reverse polyline, distance, and duration.

#### MODIFIED: All ride surfaces follow the resolved direction
**Before:** Polyline, stops, timeline, destination choices, progress, and ETAs can disagree about
direction.
**After:** They all consume the same backend-issued ride direction and the matching stored geometry.

#### ADDED: Reversal is never disguised as routing
**Before:** Reversing an encoded A → B polyline could be served as B → A.
**After:** Reversed arrays are never treated as valid driving geometry; only stored directional
geometry (or the authenticated repair path) may be served.

## Acceptance Criteria

- [ ] Geometry computation for a route issues two independent Google Routes calls (A→B and B→A)
      and stores both.
- [ ] `decode(reversePolyline)` is not the reverse of `decode(forwardPolyline)` for a divided-road
      fixture route.
- [ ] Stops, destination choices, timeline, progress, and ETA use the same resolved direction as
      the map polyline.
- [ ] No code path serves a reversed coordinate array as B → A geometry.
- [ ] Legacy single-geometry records trigger the authenticated geometry repair flow, not reversal.

## Out of Scope

- Route-planning algorithms or schedules.
- The repair endpoint's auth design (existing; only fallback wiring changes here).

## Risks

- Backend route records already in Firestore lack directional fields. Handle via the existing
  repair path + a data migration check, not silent reversal.
- Google Routes quota: two calls per geometry change. The in-flight `geometryComputations` map must
  stay intact to avoid duplicate billing.
- Circular routes (`ROUTE_TYPES` includes "circular") have no direction — they must keep a single
  geometry and stay excluded from dual computation.

## Files

- `backend/src/routes/polyline.ts` — dual computation + storage guarantees
- `backend/src/lib/googleMaps.ts` — request/response per direction (timeout constant exists)
- `frontend/src/lib/rideDirection.ts` / `frontend/src/lib/mapRouteGeometry.ts` /
  `frontend/src/lib/routeDisplayPath.ts` — directional selection
- `frontend/src/components/maps/DirectionsRoute.tsx`, `PassengerMap.tsx`
- tests: `backend/src/routes/polyline.test.ts` (if absent, add), `frontend/src/lib/routeDisplayPath.test.ts`

## Verification Script

1. Unit tests: dual-call assertion and no-reversal assertion green.
2. `npm run verify` green.
3. Manual (UAT): admin saves a divided-road route; verify A → B and B → A polylines differ and
   hug the correct carriageways; run a reverse session and confirm map/ETA match the bus.
