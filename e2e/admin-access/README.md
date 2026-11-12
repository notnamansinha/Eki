# Admin Access Browser Checks

| Document ID | Version | Status | Last updated |
|---|---|---|---|
| EKI-PKG-007 | 2.3 | Current | 2026-11-12 |

## 1. Purpose

This fixture renders the real `AuthProvider`, `RoleGuard`, landing page, install page, admin collection hooks, `FeedbackPanel`, `DashboardPanel`, live fleet store and application CSS in Chromium, and serves the static files in `frontend/public`, such as the landing artwork. The Firebase SDK transport and HTTP responses are synthetic adapters, so the checks need no credentials, console settings or Firebase data. CI runs them in Production verification.

## 2. Run

From the repository root:

```powershell
npx playwright install chromium
npm run test:e2e:admin
```

`npm run test:e2e:admin` uses `playwright.admin-access.config.ts`. It starts the Vite fixture in this folder on `http://127.0.0.1:3105` and runs `e2e/admin-access.spec.ts` and every `e2e/admin-access/*.spec.ts` (`resilience.spec.ts`, `cold-open.spec.ts`, `landing-layout.spec.ts`, `public-reflow.spec.ts` and `non-latin-reflow.spec.ts`) in two projects: mobile (390 x 844) and desktop (1280 x 800). The default `playwright.config.ts` ignores these files.

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
| `?traceExport`, `?telemetryTrace=1` | Passenger, driver and admin each download their own tab's opt-in telemetry trace without a protected health request; traces record the browser online and reduced-motion state |
| `?restoreHang`, `?landing&restoreHang` | Cold open while a saved session is still restoring (`cold-open.spec.ts`, Section 3.1); the landing page fit (`landing-layout.spec.ts`, Section 3.2) |
| `?install` | The install page inside the root layout body flex column; public page reflow (`public-reflow.spec.ts`, Section 3.3) and non-Latin reflow (`non-latin-reflow.spec.ts`, Section 3.4) |

`resilience.spec.ts` races feedback reads and status writes against sign-out and account switches: a late result never reaches the next account, a dropped read recovers through Retry, and rapid offline and online flapping settles on one ready fleet.

### 3.1 Cold open

`?restoreHang` holds the synthetic first auth-state callback and `auth.authStateReady()` until **Finish restoration as signed out**, **Finish restoration as passenger** or **Finish restoration as admin** is clicked. `?landing` mounts the real landing page instead of a protected route; `next/image` is replaced by a stub (`nextImage.tsx`).

- Without a pending Google redirect, `getRedirectResult` is never called and **Continue with Google** is enabled at once. With one, `getRedirectResult` also stays pending and the button reads "Preparing sign-in…" until restoration finishes.
- Virtual time crosses the 8 s and 10 s marks. Sign-in stays usable, "Still checking your sign-in" (landing page) or "Still signing you in" (`RoleGuard`) replaces any access failure, no protected content mounts early, and the page recovers in place when restoration finishes.
- `window.qaAuthCalls` records each OAuth SDK call and whether it received the shared `popupRedirectResolver`; `window.qaRouterReplacements` records navigations.

`firebase/auth` resolves to `firebaseAuthSdk.ts`, which re-exports the same synthetic adapter from its own URL. Only the lazy sign-in code load in `useAuth` requests it, so the tests for a reconnect "while the sign-in code is still downloading" hold that response with `page.route`, fire `online` (a real `context.setOffline` drop and return, or dispatched events) and then release it. Exactly one load must run: `window.qaAuthObservers` (`registered` and `active` auth-state observers) stays at one, the restored admin is verified once (counted from the fixture's `qa-verification` events), and a pending Google redirect calls `getRedirectResult` once. **Try again** cannot be reached before the first load completes, so only the `online` retry is driven.

### 3.2 Landing layout

`landing-layout.spec.ts` opens `?landing&restoreHang` with a fixed virtual clock and waits for the transit artwork and the Google mark on **Continue with Google** to decode. At 1280 x 585, 1280 x 720, 1920 x 878 and 390 x 844 it checks that the heading, the introduction, the enabled **Continue with Google** button and the footer lie inside the viewport without scrolling or horizontal overflow, that no other element covers the centre of the button, and that the landing page renders no university logo image. The 1280 x 585 viewport is about what Chrome leaves on a 1920 x 1080 Windows display at 150 % scaling; a separate test runs it with a device scale factor of 1.5 and checks that the button and footer stay fully visible and the page does not scroll.

### 3.3 Public page reflow

`public-reflow.spec.ts` covers issue #521. At 320 x 800 and 360 x 800 it opens `?install` with desktop, Android, iPhone Safari and iPhone Chrome user agents (one per install branch) and `?landing&restoreHang`, removes the fixture controls, appends the 80-character token `Donaudampfschifffahrtselektrizitätenhauptbetriebswerkbauunterbeamtengesellschaft` to every heading, button, link, label, list item and paragraph that holds a single text node, and requires `scrollWidth - clientWidth` of the document to be 0 or less. Before the injection the install heading must still fit on one line. The `overflow-wrap: anywhere` rule on `.transit-landing` and `.public-page-shell` in `frontend/src/app/globals.css` provides the wrapping.

### 3.4 Non-Latin reflow

Eki ships English-only ([EKI-ADR-005](../../docs/design/LOCALE_SCOPE_DECISION.md)). `non-latin-reflow.spec.ts` runs in the `mobile` project only and sets a 320 x 640 viewport. For each sample in `e2e/fixtures/nonLatinText.ts` (Arabic, Hebrew, Hindi, Thai, Japanese, and German and Turkish with long words) it:

- replaces the copy of the landing page (`?landing&restoreHang`) and of the install page (`?install`, with an Android user agent so the three manual steps show) as a browser translation would: paragraphs and list items get a long sentence, headings, buttons and links a short one;
- serves the admin feedback list (`?embedded`) one entry whose passenger name and comment are in that script, and expands it.

Each test fails if the page scrolls sideways, or if a visible element holding the sample text leaves the viewport or clips its text horizontally, itself or through an ancestor that clips its overflow (`overflow-x` other than `visible`, or paint containment); a single line cut with an ellipsis by design, such as the feedback author's name, counts as fitting. Two negative controls (`overflow: hidden` and `overflow: clip`) load a 200 px paragraph inside a 100 px clipping ancestor and require the measurement to report it. The samples break at spaces or by the browser's Thai and Japanese rules; long tokens with no break point are covered by `public-reflow.spec.ts` (Section 3.3, [issue #521](https://github.com/notnamansinha/Eki/issues/521)). The document stays `lang="en"` and left to right, and the browser locale is not changed.

## 4. Boundaries

Admin feedback reads and status writes go through the Firestore SDK (`frontend/src/lib/feedbackStore.ts`). The fixture replaces that SDK transport with a test-only endpoint, `/__qa/firestore/feedback`, which the tests intercept. The checks therefore do not exercise Firestore rules, real revocation, deployed origins and CORS, browser quota behaviour, real network throttling or reconnect storms. The cold-open checks use a synthetic Firebase Auth; they do not load Google's sign-in frame or complete a real OAuth redirect. Firestore rules are covered by `npm run test:rules`; live and physical gates are tracked in [issue #351](https://github.com/notnamansinha/Eki/issues/351).
