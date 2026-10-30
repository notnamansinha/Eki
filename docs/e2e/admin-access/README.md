# Admin Access Browser Checks

| Document ID | Version | Status | Last updated |
|---|---|---|---|
| EKI-PKG-007 | 2.0 | Current | 2026-10-30 |

## 1. Purpose

This fixture renders the real `AuthProvider`, `RoleGuard`, landing page, admin collection hooks, `FeedbackPanel`, `DashboardPanel`, live fleet store and application CSS in Chromium. The Firebase SDK transport and HTTP responses are synthetic adapters, so the checks need no credentials, console settings or Firebase data. CI runs them in Production verification.

## 2. Run

From the repository root:

```powershell
npx playwright install chromium
npm run test:e2e:admin
```

`npm run test:e2e:admin` uses `playwright.admin-access.config.ts`. It starts the Vite fixture in this folder on `http://127.0.0.1:3105` and runs `e2e/admin-access.spec.ts` and every `e2e/admin-access/*.spec.ts` (`resilience.spec.ts` and `cold-open.spec.ts`) in two projects: mobile (390 x 844) and desktop (1280 x 800). The default `playwright.config.ts` ignores these files.

To run the same checks against another revision for an A/B baseline, set `EKI_ADMIN_ACCESS_SRC` to that checkout's `frontend/src`, with its `node_modules` reachable from it.

## 3. Scenarios

The fixture selects a scenario from the query string.

| Query | Checks |
|---|---|
| (none), `?embedded` | Protected data waits for role verification; status updates appear only after acknowledgement; verification errors show recovery controls without mounting feedback; Firestore read denial is retried and a failed write is rejected; an account switch hides previous data and waits for fresh verification; the same account re-verifying reloads feedback |
| `?metadata` | Denied fleet and route reads, retried together, share one fresh verification and do not resubscribe before it completes |
| `?recovery` | A role verification network failure recovers after ten minutes of virtual offline time on the browser `online` event, without reload or sign-in, and no protected read happens before verification |
| `?resume` | The real RTDB resume hook and shared fleet store: a short healthy tab switch keeps fleet data with no new handshake or read; a 31 s suspension produces one debounced handshake and a fresh snapshot |
| `?projection` | Route projection freshness in preview and catalog, silent expiry, and coalesced return completion hidden during re-verification |
| `?dashboard`, `?dashboard&fleet` | Live fleet details stay reachable below the service controls on a short screen; End ride early stays reachable by wheel scrolling among several expanded rides on desktop and is offered in the live details drawer (`/api/shifts/stop` is intercepted) |
| `?traceExport` | Passenger, driver and admin each download their own tab's opt-in telemetry trace without a protected health request; traces record the browser online and reduced-motion state |
| `?restoreHang`, `?landing&restoreHang` | Cold open while a saved session is still restoring (`cold-open.spec.ts`, Section 3.1) |

`resilience.spec.ts` races feedback reads and status writes against sign-out and account switches: a late result never reaches the next account, a dropped read recovers through Retry, and rapid offline and online flapping settles on one ready fleet.

### 3.1 Cold open

`?restoreHang` holds the synthetic first auth-state callback and `auth.authStateReady()` until **Finish restoration as signed out**, **Finish restoration as passenger** or **Finish restoration as admin** is clicked. `?landing` mounts the real landing page instead of a protected route; `next/image` is replaced by a stub (`nextImage.tsx`).

- Without a pending Google redirect, `getRedirectResult` is never called and **Sign In with Google** is enabled at once. With one, `getRedirectResult` also stays pending and the button reads "Preparing sign-in…" until restoration finishes.
- Virtual time crosses the 8 s and 10 s marks. Sign-in stays usable, "Still checking your sign-in" (landing page) or "Still signing you in" (`RoleGuard`) replaces any access failure, no protected content mounts early, and the page recovers in place when restoration finishes.
- `window.qaAuthCalls` records each OAuth SDK call and whether it received the shared `popupRedirectResolver`; `window.qaRouterReplacements` records navigations.

`firebase/auth` resolves to `firebaseAuthSdk.ts`, which re-exports the same synthetic adapter from its own URL. Only the lazy sign-in code load in `useAuth` requests it, so the tests for a reconnect "while the sign-in code is still downloading" hold that response with `page.route`, fire `online` (a real `context.setOffline` drop and return, or dispatched events) and then release it. Exactly one load must run: `window.qaAuthObservers` (`registered` and `active` auth-state observers) stays at one, the restored admin is verified once (counted from the fixture's `qa-verification` events), and a pending Google redirect calls `getRedirectResult` once. **Try again** cannot be reached before the first load completes, so only the `online` retry is driven.

## 4. Boundaries

Admin feedback reads and status writes go through the Firestore SDK (`frontend/src/lib/feedbackStore.ts`). The fixture replaces that SDK transport with a test-only endpoint, `/__qa/firestore/feedback`, which the tests intercept. The checks therefore do not exercise Firestore rules, real revocation, deployed origins and CORS, browser quota behaviour, real network throttling or reconnect storms. The cold-open checks use a synthetic Firebase Auth; they do not load Google's sign-in frame or complete a real OAuth redirect. Firestore rules are covered by `npm run test:rules`; live and physical gates are tracked in [issue #351](https://github.com/notnamansinha/Eki/issues/351).
