# Restore passenger destination selection before boarding

Written against: `388487543ed2ab911b457ed3cccf7fc5ff9b42f7`

## Evidence chain

- Surface: `/passenger` → `frontend/src/app/passenger/page.tsx` → `frontend/src/components/passenger/PassengerWorkspace.tsx`.
- Problem: When a bus has authenticated live telemetry but no `sessionId`, the tracking top bar renders the “Bus … is online / Live location is available” status box. The user cannot choose a destination in this state.
- Design evidence: The current passenger workflow requires a user to select a route and plan a trip between stops; joining already accepts an optional alighting stop (`docs/GETTING_STARTED.md`, Passenger workflow). `PassengerBoardingView` already uses the shared `CustomSelect` control for a destination-stop choice.
- Owner: `frontend/src/components/passenger/PassengerWorkspace.tsx` owns route selection, the tracking map target, and the telemetry-only fallback. `frontend/src/components/passenger/PassengerBoardingView.tsx` owns the destination submitted when joining.
- Scope and affected surfaces: Passenger tracking before an operator has armed a ride; passenger boarding form once a ride is armed; map/timeline target-stop state on `/passenger`.
- Uncertainty: Confirm whether a passenger’s destination may be changed after a successful boarding request. This plan preserves the existing server contract, which already accepts an optional `alightingStopId` on join.

## Design decision

Replace the telemetry-only online-status box with the same destination-station selection pattern used by the boarding form. Keep the live bus visible on the map, but make the selected station—not the selected boarding stop—the tracking map and timeline target. Before a ride starts, this gives a passenger a useful route-planning action; once a ride starts, the existing boarding form preserves the selected destination for the join request.

## Reuse

- `CustomSelect` from `frontend/src/components/ui/CustomSelect.tsx` for the destination field.
- Route stop ordering from `routeInRideDirection` in `frontend/src/lib/rideDirection.ts`.
- `RouteTimelineSheet` target behavior through `PassengerMap` / `PassengerTrackingMap`.
- Exemplar: the `Destination stop` selector in `frontend/src/components/passenger/PassengerBoardingView.tsx`.

## Changes

1. `frontend/src/components/passenger/PassengerWorkspace.tsx`
   - Change: Replace `selectedBoardingStopId` as the map target state with `selectedDestinationStopId`. Resolve `targetStop` from the valid selected destination, falling back to the last stop only when none is selected.
   - Change: In the `!hasSessionId(activeBusOnRoute)` tracking branch, replace the online-status card with a `CustomSelect` labelled “Destination station”, populated from the direction-ordered route stops. Selecting a stop must update `selectedDestinationStopId` and immediately update the map/timeline target.
   - Change: Reset the destination selection only when the selected route, selected bus, or ride direction makes it invalid; do not reset it merely because fresh telemetry arrives.
   - Preserve: Bus selection, back navigation, the live map marker, and the absence of boarding-code controls before a session exists. Do not render the screenshot’s “Bus is online” card.
   - Verify: A passenger can choose a station while the bus is online but pre-departure; the selected stop is highlighted/targeted on the map and timeline.

2. `frontend/src/components/passenger/PassengerBoardingView.tsx`
   - Change: Rename the parent callback to destination-specific semantics and invoke it from the existing `alightingStopId` selector, not from `boardingStopId`.
   - Change: Accept the currently chosen destination from the workspace as an initial/controlled value, so the selection made before the driver arms remains visible and is sent as `alightingStopId` after joining opens.
   - Preserve: Required boarding stop, eight-character boarding code, geolocation validation, join request body, and the optional destination API contract.
   - Verify: The join request still sends the selected station as `alightingStopId`; changing boarding stop no longer changes the passenger’s map destination.

3. `frontend/src/components/passenger/PassengerWorkspace.test.tsx` and `frontend/src/components/passenger/PassengerBoardingView.test.tsx`
   - Change: Add focused tests for the telemetry-only destination selector, selected-target propagation, persistence into the boarding form, and `alightingStopId` request submission.
   - Preserve: Existing live-bus subscription and route-direction behavior.
   - Verify: No test relies on the removed online-status copy; invalid selections fall back to the terminal stop.

## Scope

- Inherit: Passenger tracking map and route timeline receive the selected destination through the existing `targetStop` prop.
- Verify: Both forward and reverse ride directions, single/multiple buses on one route, no-session telemetry, pre-departure sessions, in-service sessions, and route changes.
- Exclude: Admin route operations, ESP telemetry, route geometry, messaging, boarding-code policy, and database schema changes.

## Validation

- Product: With a live bus that has no `sessionId`, open `/passenger`, select a destination station, and verify it replaces the online status card and becomes the map/timeline target.
- Interface: Check narrow mobile and desktop widths; select a bus with reverse direction; change routes/buses; arm the ride; verify the selected destination carries into the boarding form; join and verify the destination remains correct.
- System: Confirm the selector reuses `CustomSelect` and direction-ordered stops rather than creating a parallel control or stop order.
- Repository: `npm run test --workspace=frontend` → all frontend tests pass. `npm run lint --workspace=frontend` → no lint errors. `npm run build --workspace=frontend` → static export succeeds.

## Stop conditions

- Stop if the product requirement is to choose a boarding stop rather than a destination, or if the backend must make `alightingStopId` mandatory; either changes the user-visible contract and requires a separate decision.
- Stop if the destination must be editable after successful boarding but the current join API does not support an authenticated update.

## Design documentation

- After acceptance and validation: document that the passenger tracking target is the selected alighting/destination stop, with terminal-stop fallback, in `docs/GETTING_STARTED.md` under the Passenger workflow.
