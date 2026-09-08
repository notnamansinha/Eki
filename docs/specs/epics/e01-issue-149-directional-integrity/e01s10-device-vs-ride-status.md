# Story e01s10 — Separate device presence from ride-service state in the UI

> status: todo · bcps: 3 · risk: P1 · type: fix · context: frontend
> delta: MODIFIED · source: issue #149 problem 10 · spec: e01s10-device-vs-ride-status.md

## Context

The UI conflates "device is online and talking" with "this bus is an active A → B service".
Recordings show `deviceState: online`, `signalState: connected`, `motionState: moving`,
`status: offline`, `tripState: pre_departure`, `hasDepartedOrigin: false` while the UI says
"1 BUS LIVE".

Verified facts:

- `frontend/src/lib/activeBusEntries.ts` carries both `status?: "active" | "offline"` and
  `deviceState?: "online" | "offline"`; predicates at lines ~216/223 treat both as "bus is live".
- Dashboard counts "live" buses from these conflated predicates; a device-only bus appears as an
  active A → B service (compounded by e01s01's forward default).

**Module purpose (zoom-out):** activeBusEntries derives the fleet roster rows and their derived
state. **Callers:** passenger + admin fleet views. **Contracts:** bus entry shape with
device/ride/motion/trip fields; live counts. Gap: no separate derived "ride-service" label.

## Requirements

#### MODIFIED: Device presence and ride-service state are separate concepts
**Before:** `online` device presence can imply an active in-service bus; labels like "1 BUS LIVE"
mix the two.
**After:** Each bus shows device state and ride-service state independently with clear labels:
device online, direction pending, ride not armed, in service, completed.

#### MODIFIED: A device-only bus is not an active service
**Before:** A pre-departure, device-only bus can display as a live A → B service.
**After:** It renders as device online + ride not armed (or direction pending), never as an active
service, and is excluded from active-service counts.

## Acceptance Criteria

- [ ] UI labels device state and ride-service state separately (device online / direction pending /
      not armed / in service / completed).
- [ ] "1 BUS LIVE"-style counts count active services only; device-only buses never inflate them.
- [ ] Labels agree with e01s01 (pending direction shown) and e01s03 (resolution timing).
- [ ] Existing online/offline fleet behavior for genuinely active buses is unchanged.

## Out of Scope

- Backend status computation (already carries the separate fields; this story is presentation).
- Turnaround lifecycle (unchanged).

## Risks

- Renaming derived labels ripples through passenger + admin surfaces and tests; grep all consumers
  of `bus.status`/`deviceState` first and keep a single derivation helper.
- The count predicate must be shared, not re-inlined per view, or views will drift.

## Files

- `frontend/src/lib/activeBusEntries.ts` — shared derivation helper (service state vs device state)
- `frontend/src/components/passenger/PassengerWorkspace.tsx`,
  `frontend/src/components/admin/DashboardPanel.tsx` — labels + counts
- tests: `frontend/src/lib/activeBusEntries.test.ts`, passenger/admin component tests

## Verification Script

1. `npm test --workspace=frontend -- src/lib/activeBusEntries.test.ts` — new cases for the
   pre_departure device-only bus (not counted, correct labels).
2. `npm run verify`.
3. Manual (UAT): with a device-only bus broadcasting, confirm the fleet shows device online +
   "ride not armed"/"direction pending" and the live count excludes it; then arm a ride and confirm
   the same bus flips to in service and counts.
