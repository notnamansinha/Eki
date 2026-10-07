# Admin access browser regression checks

Last updated: 2026-10-06 00:35 IST (UTC+05:30).

Run `npx playwright test --config playwright.admin-access.config.ts` from the repository root. Install the matching Chromium with `npx playwright install chromium` if necessary.

These checks render the actual AuthProvider, App Check wrapper, RoleGuard, collection hook, feedback panel, API client and application CSS at mobile and desktop widths. The Firebase SDK transport and HTTP responses are synthetic adapters; no real credentials, console settings or Firebase data are used. They cover delayed verification, visible provider failure with in-place recovery, standalone and embedded API loading, denied-read retry, rejected and acknowledged status writes, account switching, and fresh verification of the same account. The metadata scenario injects denied fleet and route reads, requests both retries together, verifies one forced security refresh and no premature subscriptions, then observes recovered snapshots.

They do not attest production reCAPTCHA enrollment, deployed origins/CORS, revoked credentials against a real project, live browser quota behavior or hardware acceptance. Those remain #204/#245. Backend unit tests separately execute the actual admin middleware and feedback HTTP route against controlled verifier/database dependencies.

The `?resume` scenario additionally runs the actual RTDB resume hook,
active-bus hook and shared fleet store using synthetic SDK transport and
controlled browser time/visibility. A healthy short tab switch retains fleet
data and read/handshake counts; a 31-second suspension produces one delayed
handshake and a fresh snapshot. The complete suite has 16 mobile/desktop cases.
Actual network/PWA throttling and measured reconnect storms remain #245.
