# Admin access browser regression checks

Last updated: 2026-10-29 14:47 IST (UTC+05:30).

Run `npx playwright test --config playwright.admin-access.config.ts` from the repository root. Install the matching Chromium with `npx playwright install chromium` if necessary.

These checks render the actual AuthProvider, RoleGuard, collection hook, feedback panel, API client and application CSS at mobile and desktop widths. The Firebase SDK transport and HTTP responses are synthetic adapters; no real credentials, console settings or Firebase data are used. They cover delayed verification, visible role-verification failure with in-place recovery, standalone and embedded API loading, denied-read retry, rejected and acknowledged status writes, account switching, and fresh verification of the same account. The metadata scenario injects denied fleet and route reads, requests both retries together, verifies one forced security refresh and no premature subscriptions, then observes recovered snapshots.

They do not attest production reCAPTCHA enrollment, deployed origins/CORS, revoked credentials against a real project, live browser quota behavior or hardware acceptance. Those remain #204/#245. Backend unit tests separately execute the actual admin middleware and feedback HTTP route against controlled verifier/database dependencies.

The `?resume` scenario additionally runs the actual RTDB resume hook,
active-bus hook and shared fleet store using synthetic SDK transport and
controlled browser time/visibility. A healthy short tab switch retains fleet
data and read/handshake counts; a 31-second suspension produces one delayed
handshake and a fresh snapshot. The complete suite has 60 mobile/desktop cases,
including the 10 in `resilience.spec.ts`: feedback status writes and slow reads
held across sign-out and account switches never reach the next account, a
dropped read recovers through Retry, and offline/online flapping settles on one
fleet. The default `playwright.config.ts` ignores this folder because it targets
the developer server.
Actual network/PWA throttling and measured reconnect storms remain #245.

The `?recovery` scenario rejects trusted verification with a synthetic network
error. It uses browser offline/online events and ten minutes of virtual time
to verify automatic recovery without reload or sign-in. Protected HTTP reads
remain absent until a new trusted role result is approved. This runs the actual
AuthProvider/RoleGuard, with synthetic Firebase and intercepted feedback HTTP;
it does not simulate a real Firebase provider outage.

The `?dashboard` scenario runs the actual DashboardPanel and CSS with a
synthetic map surface and fleet transport. At 390 × 844 and desktop sizes,
Details must remain reachable below the service form, open its dialog and close
back to a visible fleet control. This guards mobile scroll clipping; it does
not certify Google Maps rendering, which was checked separately in live Chrome.

The `?restoreHang` scenario (`cold-open.spec.ts`) models a cold open whose
persisted session is still restoring: the synthetic first auth-state callback
and `auth.authStateReady()` stay pending until "Finish restoration as signed
out / passenger / admin" is clicked. Without a pending Google redirect,
`getRedirectResult` is never called and the sign-in button is enabled at once.
With one, `getRedirectResult` also stays pending and the button remains in
"Preparing sign-in" until restoration finishes. `?landing` mounts the
actual landing page (`next/image` is stubbed). Virtual time crosses the 8 s and
10 s marks: sign-in must stay usable, a "Still checking your sign-in" status
(landing) or "Still signing you in" (RoleGuard) replaces any access failure, no
protected content mounts early, and the page recovers in place once restoration
finishes. `window.qaAuthCalls` records OAuth SDK calls and whether they received
the shared `popupRedirectResolver`; `window.qaRouterReplacements` records
navigations. Set `EKI_ADMIN_ACCESS_SRC` to another checkout's `frontend/src`
(with `node_modules` reachable from it) to run the same checks against a
committed revision for an A/B baseline.

`firebase/auth` resolves to `firebaseAuthSdk.ts`, which re-exports the same
synthetic adapter from its own URL. Only the lazy sign-in code load in
`useAuth` requests it, so the "while the sign-in code is still downloading"
cases hold that response with `page.route`, fire `online` (a real
`context.setOffline` drop and return, or dispatched events) and then release it.
Exactly one load must run: `window.qaAuthObservers` (`registered` / `active`
auth-state observers) stays at one, the restored admin is verified once (counted
from the fixture's `qa-verification` events) and a pending Google redirect calls
`getRedirectResult` once. "Try again" is not reachable before the first load
completes, so only the `online` retry is driven.
