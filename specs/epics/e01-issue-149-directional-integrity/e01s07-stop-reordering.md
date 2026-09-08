# Story e01s07 — Make stop reordering usable and persistent via a Swap A/B action

> status: todo · bcps: 4 · risk: P1 · type: feat · context: frontend (+ save path)
> delta: MODIFIED · source: issue #149 problem 7 · spec: e01s07-stop-reordering.md
> depends_on: e01s02 · decision: Swap A/B button, no drag-and-drop dependency (user-approved)

## Context

The stop list shows a grip icon but drag-and-drop is not implemented; only small up/down controls
reorder stops, and backend save failures prevent reordered stops persisting. For two-endpoint
routes the issue accepts a "Swap A and B" button as the fix.

Verified facts:

- `frontend/src/components/admin/RouteManagementPanel.tsx` owns the route editor and the save flow
  (per issue, saving always calls Google Routes — see e01s08).
- Swapping endpoints is a **geometry-affecting** change: both directional geometries must be
  recomputed (e01s02 plumbing) — this is not a metadata-only save (contrast e01s08).

**Module purpose (zoom-out):** RouteManagementPanel edits route/stops/geometry and persists.
**Callers:** admin route editor. **Contracts:** route record with ordered stops + directional
geometry; save must be atomic and idempotent (e01s09). Gap: no usable two-endpoint swap control and
no persistence guarantee under failure.

## Requirements

#### ADDED: Swap A and B action for two-endpoint routes
**Before:** Reordering a two-stop route requires the grip icon that does nothing, or fiddly up/down
clicks.
**After:** A clear "Swap A and B" button reverses the two endpoints, preserving stop IDs, then saves.

#### MODIFIED: Reorder persists
**Before:** Backend save failures can drop a reordered stop list.
**After:** Reorder persists through the (e01s09-hardened) save path; stop IDs are preserved across
the swap; failure shows the structured error instead of a silent drop.

#### MODIFIED: Surfaces refresh after swap
**Before:** (varies — verify)
**After:** Map, stop labels, destination choices, timeline, progress, and ETAs refresh from the
recomputed directional geometry.

## Acceptance Criteria

- [ ] Two-endpoint routes show "Swap A and B"; clicking swaps A/B and preserves stop IDs.
- [ ] Swap triggers dual-direction geometry recompute (e01s02) and persists.
- [ ] Map, labels, destination choices, timeline, progress, and ETA reflect the swap.
- [ ] Save failure surfaces the structured error and leaves the editor consistent (no silent drop).
- [ ] Routes with 3+ stops keep the up/down controls (unchanged) and are out of this story's UX.

## Out of Scope

- Drag-and-drop reordering for 3+ stop routes (future story; decision recorded in ADR-0001).
- Rename-only saves (e01s08).

## Risks

- Swap is only meaningful for exactly two stops; gate the button on `stops.length === 2`.
- Swapped stops must not change stop IDs (route references and ride state depend on IDs).
- Persistence depends on e01s09 reliability — implement s07 after s09 lands or coordinate.

## Files

- `frontend/src/components/admin/RouteManagementPanel.tsx`
- stop/route payload helpers (swap is order-only at the payload level)
- tests: `frontend/src/components/admin/RouteManagementPanel.test.tsx`,
  `frontend/src/lib/adminValidation.test.ts`, `frontend/src/lib/routeStopPayload.test.ts`

## Verification Script

1. Component tests green (swap toggles order, IDs stable, save called once).
2. `npm run verify`.
3. Manual (UAT): open a two-stop route, click "Swap A and B", confirm map geometry flips to the
   reverse carriageway, labels/destination/ETA follow, and reload keeps the swapped order.
