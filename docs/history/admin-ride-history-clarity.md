# Make admin ride history readable and operationally truthful

Status (2026-08-08): implemented historical design record. Current behavior
and verification are documented in [LLD](../design/LOW_LEVEL_DESIGN.md) and
[Test strategy](../testing/TEST_STRATEGY.md); the commit below records the original design baseline.

Written against: bc0d320ff07a3fae1766737ef46bff87b35b055a

## Evidence chain

- Surface: `frontend/src/app/admin/page.tsx` → History tab → `frontend/src/components/admin/RideHistoryPanel.tsx`
- Problem: The passenger manifest exposes internal stop IDs, the ride card shows only an unlabeled start timestamp, legacy stop events can be rendered twice, and abandoned sessions use the same active treatment as a genuinely live ride.
- Design evidence: The existing admin fleet surface resolves bus, route, and driver IDs through `useBuses`, `useRoutes`, and `useDrivers`, and uses plain-language lifecycle labels such as “In Service” and “Completed”. The current history surface directly contradicts that presentation by showing raw storage identifiers and raw status strings during the same admin task.
- Owner: `frontend/src/components/admin/RideHistoryPanel.tsx`
- Scope and affected surfaces: Admin History cards, passenger rows, and route log only; backend lifecycle reconciliation supplies the terminal `interrupted` state and an accurate last-recorded timestamp.
- Uncertainty: None. Live-data inspection found 22 sessions marked active despite no canonical active ride and no live bus; the legacy stop arrays also contain duplicate stop-index records milliseconds apart.

## Design decision

Present every ride as an operational record: resolve fleet IDs to their display names, label start/end timing explicitly with seconds, replace passenger stop IDs with the human-readable arrival-stop name plus recorded passenger and destination-event times, deduplicate legacy stop events, and display an interrupted terminal session as “Ended early” with “Last recorded” rather than as active or completed.

## Reuse

- `useBuses`, `useDrivers`, and `useRoutes` for existing admin-facing names.
- Existing brand surface, border, status-chip, and compact metadata classes in `RideHistoryPanel`.
- Existing destructive-action confirmation pattern in `RouteManagementPanel` and `FleetManagementPanel`.
- Exemplar: `frontend/src/components/admin/FleetManagementPanel.tsx` resolves `ActiveBusEntry` IDs before rendering fleet cards and uses plain-language `TRIP_STATE_CONFIG` labels.

## Changes

1. `frontend/src/components/admin/RideHistoryPanel.tsx`
   - Change: Normalize Firestore number/Timestamp/date values; render the service-local date plus labeled Started and Ended/Last recorded times with seconds; map bus, route, and driver IDs to existing display names with a safe fallback.
   - Preserve: Current card hierarchy, expand/collapse interaction, passenger count, dark brand styling, and responsive layout.
   - Verify: An admin can identify the ride and understand its timing without seeing storage IDs or inferring what an unlabeled timestamp means.
2. `frontend/src/components/admin/RideHistoryPanel.tsx`
   - Change: Replace the passenger stop-ID arrow with “Arrival stop: <name>”, “Recorded”, and, when a matching reached-stop event exists, “Destination reached”; otherwise say the destination time was not recorded. Resolve the arrival name from the historical reached-stop record first, then from the current route stop catalog, and use “Arrival stop unavailable” rather than exposing an internal ID when neither source can resolve it. Deduplicate legacy stop events by authoritative stop index, retaining the earliest trustworthy event.
   - Preserve: Passenger name, passenger count, and route-log stop names.
   - Verify: The sample passenger row contains a readable arrival-stop name and times without internal IDs, and each reached stop appears once.
3. `frontend/src/components/admin/RideHistoryPanel.tsx`
   - Change: Map the durable `interrupted` status to “Ended early”, with a neutral warning treatment and a concise explanation that the final stop was not recorded.
   - Preserve: Active and completed status distinctions.
   - Verify: Reconciled test rides never appear active or completed.
4. `frontend/src/components/admin/RideHistoryPanel.tsx` and the admin shifts API
   - Change: Add a clearly destructive “Delete ride history” action to expanded terminal ride cards. On click, require confirmation that the passenger manifest, route log, and messages will be permanently removed. After confirmation, call an admin-only backend endpoint, disable the action while deleting, surface any failure inline, and let the Firestore listener remove the deleted card.
   - Preserve: Card expansion, all read-only history details, and the inability of clients to write or delete ride sessions directly.
   - Verify: Cancelling confirmation causes no request; confirming deletes a completed/interrupted/failed ride and its nested session data; active/pending/armed rides show no delete action and receive a conflict response if the endpoint is called directly.

## Scope

- Inherit: All ride-session cards loaded by the admin History tab; deletion is available only for terminal records.
- Verify: Numeric legacy timestamps, Firestore Timestamp values, missing end times, changed/deleted routes, duplicate legacy stop arrays, empty manifests, and narrow/mobile card layouts.
- Exclude: Passenger-facing ride UI, route editing, fleet assignment, and visual redesign of other admin tabs.

## Validation

- Product: Open Admin → History; confirm a completed ride, a live ride, and a reconciled ride each have accurate, distinct lifecycle copy and timings.
- Interface: Verify collapsed/expanded cards, a passenger with and without a recorded destination arrival, historical arrival-name fallback after a route edit, duplicate legacy stop records, missing catalog names, delete cancellation/success/failure/loading states, and mobile/desktop widths.
- System: Confirm the surface reuses the three fleet hooks and does not introduce a parallel catalog or status component.
- Repository: `npm run lint --workspace=frontend && npm run test --workspace=frontend && npm run build --workspace=frontend && npm run lint --workspace=backend && npm run test --workspace=backend && npm run build --workspace=backend` → all checks pass.

## Stop conditions

- Stop if ride-session reconciliation cannot distinguish a genuinely live session through canonical `active_rides`/RTDB state, if the stored passenger timestamp is found to represent physical boarding rather than record creation, or if the backend cannot guarantee active sessions are protected from deletion.

## Design documentation

- After acceptance and validation: none; this corrects a local contradiction in the admin history task without introducing a new design-system rule.
