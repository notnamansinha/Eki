# Google sign-in recovery (#356)

Last updated: 2026-10-27 12:00 IST (UTC+05:30).

## Production incident, 21 October 2026

The merged OAuth lifecycle tests in #358 mock Firebase. They do not cover the
production service worker or Hosting CSP. Successful CI and deployment of
#358/#359/#362 therefore do not establish live sign-in, API availability or
end-to-end transit operation.

On the deployed `bustrack-be165.web.app` app, popup and redirect sign-in returned
`auth/internal-error` in the in-app browser, including after selecting an
existing Google account. A Chrome visit completed sign-in and opened the Admin
profile and Admin Panel, but live data showed unavailable. This is not a claim
that all browsers or subsequent sign-ins work.

Workbox intercepts `apis.google.com` scripts and uses `fetch()`. The deployed
worker's CSP allowed that origin in `script-src` but omitted it from
`connect-src`. Thus a controlled page can fail to load the Auth helper even
though a first, uncontrolled visit works. A local browser fixture using the
actual bundled Eki worker reproduced a blocked real Google helper with the old
policy. The corrected-policy fixture was started, but browser access was
disabled before its final result could be inspected; no passing live OAuth
result is claimed for this patch.

The repair permits exactly `https://apis.google.com` in `connect-src` in both
the checked-in policy and its build generator. Auth helpers now use NetworkOnly;
activation removes only the obsolete `eki-firebase-sdk` cache. Changing worker
bytes also ensures a worker update installs the corrected policy. The update
still waits for existing clients to close, preserving active-session behavior.

The live CSP also referenced a backend tunnel whose hostname did not resolve.
The locally configured alternative returned HTTP 503 with degraded readiness;
neither is evidence of a working production backend. Deployment now checks
healthy JSON readiness and browser CORS/preflight before publishing Hosting or
rules. This is a read-only gate, not a backend repair or uptime guarantee.

Before release, the deployment owner must restore a healthy backend and set the
matching `NEXT_PUBLIC_BACKEND_URL` deployment secret and backend CORS origins.
This PR does not change cloud secrets, deploy, grant roles or relax Firebase
rules. After deployment, close all Eki tabs and installed-app windows, reopen,
then repeat login/logout/redirect and live-data checks below. The original
64 field/deployed acceptance gates in #351 remain pending.

The landing copy now describes routes and available bus locations and explicitly
conditions arrival estimates on live service data; it no longer promises
seamless or effortless travel.

### Deployment readiness follow-up

Deploy run `39600983201` stopped before publication because the staging backend
secret still referenced an expired Cloudflare Quick Tunnel (DNS `ENOTFOUND`).
The assigned ngrok endpoint reached the backend but initially reported HTTP 503.
Firestore reads succeeded; the idle RTDB SDK had not opened its transport.

Reading `.info/connected` alone returns local metadata and does not establish
a database connection. The backend readiness probe now first reads the `_health`
sentinel, then checks the real connection flag. It never reads the root or
writes sentinel data. Existing probe deadlines, stalled-flight coalescing and
readiness expiry still apply; denied or stalled reads remain unhealthy. A live
read-only diagnostic observed false → true connectivity and a successful
authenticated RTDB read. This resolves idle readiness, not general backend
availability or provider acceptance.

For this laptop-hosted deployment, keep the assigned ngrok tunnel and backend
running and use its exact origin in the staging `NEXT_PUBLIC_BACKEND_URL`
secret. Both `/health` and the authenticated-request OPTIONS preflight must pass
from the Hosting origin before retrying deployment. These runtime configuration
steps do not require a frontend source rebuild commit; the deployment workflow
rebuilds with the current secret on retry.

Mobile browsers (including iPad desktop mode) and installed PWAs use full-page
Google sign-in when Firebase's `authDomain` matches the application host.
Desktop browsers retain popups. Cross-origin/local development configurations
retain popups because redirect recovery requires access to the Auth helper's
storage. This follows Firebase's [mobile sign-in guidance](https://firebase.google.com/docs/auth/web/google-signin)
and [redirect configuration requirements](https://firebase.google.com/docs/auth/web/redirect-best-practices).

The primary project's Firebase Hosting domains already resolve to the current
hostname. For custom/secondary Hosting domains, configure the frontend hostname
as `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`, authorize the domain in Firebase Auth,
and authorize `https://<frontend-host>/__/auth/handler` in the Google OAuth client.
See [configuration](../CONFIGURATION.md#local-auth-setup).

The sign-in button waits for redirect processing. A tab-scoped pending marker
detects a return without a session and shows a retry message; it never grants
access. Successful popup and redirect results enter the same trusted-role
verification as the Auth observer, coalescing pending work and reusing completed
verification. This also handles a delayed observer in an existing app runtime.
Sign-out and account changes continue to invalidate stale verification.

No recovery path may end at a disabled sign-in button with no explanation:

- Closing the Google popup (`auth/popup-closed-by-user` or
  `auth/cancelled-popup-request`) is a cancellation, not a failure. It clears
  the "taking longer than usual" notice and the full-page fallback, whether it
  happens before or after the 8 s slow-popup timer.
- Pressing Back on Google's page after starting a full-page sign-in can restore
  the frozen page from the browser's back/forward cache. A `pageshow` event with
  `persisted: true` ends that attempt, clears the tab's pending-redirect marker
  and re-enables the button.
- Until Firebase reports its first auth state (or settles the redirect result),
  a null current user means "unknown", not "signed out". "Try again" and
  "Sign out" on the restoration-timeout screen keep the reload guidance
  ("Sign-in is still restoring…") instead of publishing a signed-out state; a
  queued sign-out still completes once Firebase finishes restoring.
- If the landing page's sign-in button stays unavailable for 10 s with no other
  message, it shows "Sign-in is still loading." with a Reload button.

## Automated coverage

Run from the repository root:

```powershell
npm exec --workspace=frontend -- vitest run src/hooks/useAuth.test.tsx src/lib/googleSignInFlow.test.ts src/lib/firebaseAuth.test.ts src/lib/firebaseAuthDomain.test.ts src/app/page.test.tsx src/components/shared/RoleGuard.test.tsx --maxWorkers=2
```

Coverage uses mocked Firebase OAuth and claims: mobile/PWA flow selection,
logout followed by login, repeated desktop login with the same/different
accounts, delayed observer delivery, redirect/refresh restoration, missing
sessions, errors, popup fallback, popup cancellation after the slow-popup
timer, back/forward-cache restoration, retry/sign-out before restoration
finishes, and role-gated dashboard routing. It does not
certify live Google OAuth or physical Android/iOS behavior.

## Deployment acceptance

After deploying the frontend, verify on Android Chrome, iOS Safari, the installed
PWA, and a desktop browser:

1. Sign in, confirm the account's permitted dashboard, then refresh it.
2. Sign out and sign in again with the same account without clearing site data.
3. Repeat with another Google account and verify the matching dashboard/profile.
4. Repeat for passenger and administrator accounts.
5. Cancel Google sign-in or interrupt the network, then retry from the displayed
   recovery state.

Google account selection and real browser storage behavior require these live
checks; unit tests cannot replace them. Worker updates continue to wait for old
tabs to close, so close existing app windows and reopen to load a new deployment.
