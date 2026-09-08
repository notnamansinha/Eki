# Story e01s03 — Infer direction only from fresh GPS inside exactly one endpoint geofence

> status: todo · bcps: 5 · risk: P0 · type: fix · context: backend
> delta: MODIFIED · source: issue #149 problem 3 · spec: e01s03-geofenced-direction-inference.md
> depends_on: e01s01

## Context

Direction inference today runs when `/api/shifts/start` is called. It is not continuously resolved
from later telemetry for an unarmed/device-only bus, and the example in the issue (bus 257 m from B,
~918 m from A) must NOT yield a guess.

Verified facts on this branch:

- `backend/src/lib/automaticRideDirection.ts`: `inferRideDirectionAtEndpoint(stops, position,
  radiusMeters = DIRECTION_INFERENCE_RADIUS_M = 75)` returns null unless the bus is inside exactly
  one endpoint radius — but the default radius (75 m) is wider than the geofence the rest of the
  trip-state engine uses (`STOP_GEOFENCE_M = 20` in `tripStateReducer.ts`).
- `backend/src/routes/shifts.ts:335` calls it with `STOP_GEOFENCE_M` at shift start and rejects
  otherwise; a `direction_pending` lifecycle value does not exist yet.
- `tripStateEngine.ts`/`tripStateReducer.ts` own the geofence + motion state transitions and the
  safe completion/dwell turnaround lifecycle.
- Existing active ride direction is intentionally immutable (issue requirement).

**Module purpose (zoom-out):** automaticRideDirection derives ride direction from position only.
**Callers:** shifts/start (explicit) and — after this story — the telemetry/trip-state engine for
unarmed buses. **Contracts:** `inferRideDirectionAtEndpoint`, `oppositeRideDirection`,
`STOP_GEOFENCE_M`; ride lifecycle states (pre_departure → armed → active → turnaround). Must not
break `e01s01` pending semantics or the turnaround lifecycle.

## Requirements

#### MODIFIED: Direction resolution follows a pending lifecycle
**Before:** Inference runs once at shift start; no `direction_pending` lifecycle; an out-of-geofence
bus can be misread downstream.
**After:** A new ride stays `direction_pending` until resolved. Direction resolves only from fresh,
stopped bus GPS inside exactly one endpoint geofence — A → B at A, B → A at B.

#### ADDED: Continuous resolution for unarmed/device-only buses
**Before:** Later telemetry for an unarmed bus never resolves direction.
**After:** Later fresh, stopped in-geofence telemetry resolves a pending direction for a
device-only bus.

#### MODIFIED: No closest-endpoint guessing
**Before:** Closest-endpoint logic outside the configured radius can imply a direction.
**After:** No direction is inferred outside the endpoint geofence; the 75 m constant is reconciled
with the 20 m `STOP_GEOFENCE_M` so a single geofence rule applies.

#### MODIFIED: Active rides never silently change direction
**Before:** (unchanged invariant — verify it holds)
**After:** Once a ride is active, its direction is immutable; reversal only through the existing
safe completion/dwell turnaround lifecycle.

## Acceptance Criteria

- [ ] A fresh ride can remain in `direction_pending`.
- [ ] Direction is inferred only from fresh, stopped GPS inside exactly one endpoint geofence.
- [ ] A → B is inferred at A; B → A is inferred at B; nothing at 257 m from B.
- [ ] Later telemetry resolves a pending direction for an unarmed/device-only bus.
- [ ] Closest-endpoint outside the radius never yields a direction.
- [ ] Active ride direction never changes silently; turnaround uses the safe lifecycle.
- [ ] `e01s01` pending display integrates (backend exposes pending, frontend shows it).

## Out of Scope

- Passenger-location input (banned — see e01s01).
- The turnaround lifecycle itself (preserved, not redesigned).

## Risks

- Widening inference into the telemetry engine touches hot-path state transitions. Keep the change
  additive (a resolver consulted only while `tripState: pre_departure` and no active session).
- Stopped-detection needs a freshness bound; reuse existing motion/age constants
  (`TURNAROUND_TELEMETRY_MAX_AGE_MS` exists) — do not invent a new staleness policy.

## Files

- `backend/src/lib/automaticRideDirection.ts` — geofence reconciliation + freshness
- `backend/src/routes/shifts.ts` — start uses the shared resolver
- `backend/src/services/tripStateEngine.ts` / `tripStateReducer.ts` — continuous resolution hook
- tests: `backend/src/lib/automaticRideDirection.test.ts` (exists per grep — extend),
  `backend/src/routes/shifts.test.ts`, `backend/src/services/tripStateEngine.lifecycle.test.ts`

## Verification Script

1. `npm test --workspace=backend -- src/lib/automaticRideDirection.test.ts src/routes/shifts.test.ts src/services/tripStateEngine.lifecycle.test.ts`
2. `npm run verify`.
3. Manual (UAT): start an unarmed bus 257 m from B; confirm it stays "Direction pending";
   drive it inside the B geofence and stop; confirm direction resolves to B → A only then.
