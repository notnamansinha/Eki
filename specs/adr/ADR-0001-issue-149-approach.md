# ADR-0001 — Issue #149 approach decisions

## Status

Accepted (2026-09-08)

## Context

Issue #149 (P0/P1) lists 10 direction, geometry, GNSS, and admin-editor problems. PR #153 already
exists on the upstream repo with overlapping scope. We decided to build a fresh fix on a new branch
and needed explicit choices where the issue itself offered alternatives.

## Decisions

1. **Fresh branch, no PR #153 reuse.** Branch `Issue#149` cuts from `origin/main` (af6e372) so the
   diff contains only new work. PR #153's branch and commits are intentionally not an ancestor.
2. **Missing direction is pending.** `normalizeRideDirection` gains a tri-state; a directionless bus
   renders "Direction pending" and never forward A → B (e01s01).
3. **Two independent Google driving geometries.** Forward and reverse routes are computed and
   stored separately; reversing an encoded polyline is never served as valid reverse geometry
   (e01s02).
4. **Inference is geofence-only and continuous.** Direction resolves only from fresh, stopped GPS
   inside exactly one endpoint geofence; pending resolves from later telemetry for unarmed buses;
   active rides stay immutable (e01s03).
5. **e01s04 includes firmware.** GNSS accuracy/HDOP joins the telemetry payload end to end, plus a
   confidence-gated directional matcher in the frontend. User-approved.
6. **e01s07 uses a "Swap A and B" button.** No drag-and-drop dependency for two-endpoint routes;
   drag-and-drop for 3+ stop routes stays a future story. User-approved.
7. **e01s05 is measure-first.** Backend measures device clock offset separately from transport
   latency and drives freshness from server receipt time. Firmware NTP audit is deferred to a
   tracked follow-up. User-approved.
8. **Status semantics split.** Device presence (online) and ride-service state (not armed /
   in service / completed / direction pending) are separate UI concepts; live counts count active
   services only (e01s10).

## Consequences

- Branch `Issue#149` carries one chore commit (agent conventions seed) + the plan artifacts.
- Build order follows WSJF with dependency edges: e01s01/e01s02 foundations feed e01s03/e01s04/
  e01s07/e01s08.
- Deferred firmware NTP audit and drag-and-drop remain open follow-ups recorded in specs/.
