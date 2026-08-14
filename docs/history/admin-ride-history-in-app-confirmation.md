# Keep ride-history deletion confirmation inside the web app

Status (2026-08-08): implemented historical design record. The confirmation
now uses the shared focus-contained dialog behavior described in
[LLD](../design/LOW_LEVEL_DESIGN.md); the commit below records the original design baseline.

Written against: bc0d320ff07a3fae1766737ef46bff87b35b055a

## Evidence chain

- Surface: `frontend/src/app/admin/page.tsx` → History → expanded terminal card in `frontend/src/components/admin/RideHistoryPanel.tsx`
- Problem: The delete action currently calls `window.confirm`, which hands confirmation to a browser/OS-owned popup instead of keeping the administrator in the product interface.
- Design evidence: `frontend/src/components/passenger/AccountTab.tsx` already implements a product-owned confirmation with explanatory copy and separate Cancel/Confirm buttons.
- Owner: `frontend/src/components/admin/RideHistoryPanel.tsx`
- Scope and affected surfaces: Ride-history deletion confirmation only.
- Uncertainty: None; the user explicitly selected an in-web-app reconfirmation button.

## Design decision

Use a two-step, in-app destructive action. The existing “Delete ride history” button opens a product-owned confirmation surface. No request occurs until the administrator clicks “Permanently delete”; Cancel closes the confirmation without a request. Remove every `window.confirm` dependency from this flow.

## Reuse

- Existing red danger styling and loading/error treatment in `RideHistoryPanel`.
- Exemplar: `frontend/src/components/passenger/AccountTab.tsx` sign-out confirmation composition.

## Changes

1. `frontend/src/components/admin/RideHistoryPanel.tsx`
   - Change: Replace browser confirmation with local confirmation state and an in-app warning containing explicit permanent-deletion copy, Cancel, and “Permanently delete” buttons. Disable both actions during the request and preserve inline failure feedback.
   - Preserve: Terminal-only availability, backend authorization/status protections, deletion scope, expanded-card context, and Firestore listener removal after success.
   - Verify: First click opens only the web-app confirmation; Cancel closes it without a request; “Permanently delete” sends exactly one request; no browser confirmation is called.
2. `frontend/src/lib/rideHistory.ts` and focused tests
   - Change: Retain reusable confirmation copy if useful, but remove the browser-callback confirmation helper and replace its tests with state/action assertions that do not invoke browser APIs.
   - Preserve: `canDeleteRideHistory` and all timestamp/stop-name behavior.
   - Verify: Tests prove terminal gating and that the network handler is invoked only by the explicit confirm action.

## Scope

- Inherit: Completed, interrupted, and failed ride-history cards.
- Verify: Open, cancel, confirm, request-in-progress, request-error, and card-removal states on mobile and desktop.
- Exclude: Backend deletion behavior, route/fleet confirmation dialogs, account deletion, and unrelated documentation changes.

## Validation

- Product: Admin → History → expand a terminal ride → Delete ride history; all reconfirmation remains visibly inside the app.
- Interface: Verify explicit warning copy, Cancel, Permanently delete, keyboard focusability, loading disablement, and inline error recovery.
- System: Confirm no `window.confirm` or global `confirm` remains in the ride-history flow.
- Repository: `npm run lint --workspace=frontend && npm run test --workspace=frontend && npm run build --workspace=frontend` → all checks pass.

## Stop conditions

- Stop if deletion can be triggered without the second in-app action or if implementing the surface would change backend deletion scope.

## Design documentation

- After acceptance and validation: none; this is a local interaction refinement.

## Current reference

This file remains a historical decision record rather than the current source
of truth. For current behavior and acceptance status, use the [getting started
guide](../GETTING_STARTED.md), [data model](../data/FIREBASE_DATA_MODEL.md),
[API reference](../../backend/API.md), and [test strategy](../testing/TEST_STRATEGY.md).
