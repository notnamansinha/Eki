# Story e01s01 — Represent missing ride direction as pending, never forward

> status: todo · bcps: 4 · risk: P0 · type: fix · context: frontend/backend shared
> delta: MODIFIED · source: issue #149 problem 1 · spec: e01s01-direction-pending.md

## Context

A device-only bus with no `sessionId`, no `direction`, `tripState: pre_departure` must not
appear as an active A → B service.

Verified facts on this branch (origin/main, no PR #153):

- `frontend/src/lib/rideDirection.ts`: `normalizeRideDirection(value)` returns `"reverse"` only
  for the literal `"reverse"`, else `"forward"` — missing direction silently becomes A → B.
- `backend/src/lib/rideDirection.ts`: same narrowing pattern (`isRideDirection`, `normalizeRideDirection`).
- Frontend consumers (`PassengerWorkspace.tsx`, `PassengerMap.tsx`, `DashboardPanel.tsx`,
  `directionLabel`) assume a binary `"forward" | "reverse"` direction and apply stop ordering,
  destination choices, progress, timeline, and ETA from it.

**Module purpose (zoom-out):** rideDirection.ts is the single normalization/derivation layer for
travel order. **Callers:** every passenger/admin surface that renders direction, destination,
progress, or ETA. **Contracts:** `RideDirection` union; `normalizeRideDirection`; `directionLabel`;
`routeInRideDirection`; backend `stopsInRideDirection`, `countRidesByDirection`. Changing the union
ripples to every caller — plan a grep-level blast-radius pass before editing types.

## Requirements

#### MODIFIED: Missing direction stays pending
**Before:** `normalizeRideDirection(undefined)` returns `"forward"`; a pre-departure bus renders as
an active A → B service with forward stop ordering, destination, progress, timeline, and ETA.
**After:** Missing direction normalizes to `"pending"` (or stays `null`/`unknown` per codebase
convention). All consumers gate ordering, destination choices, route progress, timeline, and ETA
on a resolved direction. A directionless bus displays "Direction pending".

#### ADDED: Passenger location never determines bus direction
**Before:** n/a (not implemented).
**After:** Direction derivation never reads passenger location input.

## Acceptance Criteria

- [ ] `normalizeRideDirection(undefined | null | "")` yields pending/unknown, never `"forward"`.
- [ ] A directionless bus displays "Direction pending" on passenger and admin surfaces.
- [ ] Forward stop ordering, destination choices, progress, timeline, and ETA are not computed
      while direction is pending.
- [ ] Passenger location has no code path into direction derivation.
- [ ] Existing directional rendering for resolved rides is unchanged (regression-green).

## Out of Scope

- Geofence inference behavior changes (e01s03).
- Device-vs-ride status labels (e01s10).

## Risks

- Binary-direction assumptions scattered across consumers. Mitigate: run
  `rg '"forward"|"reverse"|RideDirection' frontend/src backend/src` first; keep one shared helper.
- Persisted direction values (Firestore) must not be broken by a widened type — treat
  absent/malformed as pending at the read boundary only.

## Files

- `frontend/src/lib/rideDirection.ts` — widen normalization to a tri-state
- `frontend/src/components/passenger/PassengerWorkspace.tsx` — pending gates
- `frontend/src/components/maps/PassengerMap.tsx` — pending gates
- `frontend/src/components/admin/DashboardPanel.tsx` — pending label
- `backend/src/lib/rideDirection.ts` — normalize parity at the read boundary
- tests: `frontend/src/lib/rideDirection.test.ts`, `backend/src/lib/rideDirection.test.ts`

## Verification Script

1. Run `npm test --workspace=frontend -- src/lib/rideDirection.test.ts` (new pending cases green).
2. Run `npm test --workspace=backend -- src/lib/rideDirection.test.ts`.
3. Run `npm run verify` — full Preflight green.
4. Manual (UAT): start backend + `npm run dev`; open a device-only bus tile; confirm
   "Direction pending" and no A → B destination/ETA until a real direction resolves.
