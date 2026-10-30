# Eki Frontend

| Document ID | Version | Status | Last updated |
|---|---|---|---|
| EKI-PKG-002 | 2.0 | Current | 2026-10-30 |

## 1. Purpose

`frontend/` is the Eki web client. It is a Next.js 16 App Router application that `next build` exports as static files, served by Firebase Hosting as an installable progressive web app (PWA). It contains the passenger workspace, the administrator workspace and the feedback console.

This guide covers building, running, data access, sign-in, the service worker and the Content Security Policy (CSP). Colours, screens and components are described in the [UI design system](../docs/design/UI_DESIGN_SYSTEM.md). Environment variables are listed in the [configuration reference](../docs/CONFIGURATION.md).

`AGENTS.md` and `CLAUDE.md` in this folder hold the constraints for coding agents. `next dev` writes the rules block in `AGENTS.md`; leave that block as generated.

## 2. Prerequisites

| Requirement | Detail |
|---|---|
| Node.js | Version 24, the version CI uses (`.github/workflows/ci.yml`). |
| Dependencies | Installed from the repository root with `npm ci`. The root `package.json` declares `frontend` and `backend` as npm workspaces with one `package-lock.json`. |
| Firebase project | Authentication with the Google provider, Firestore and Realtime Database (RTDB). |
| Google Maps | A browser API key for the Maps JavaScript API and a Map ID. |
| Backend | Required for profile bootstrap, boarding, chat and every administrator action. See [getting started](../docs/GETTING_STARTED.md). |

Locked versions in `package-lock.json`:

| Package | Version |
|---|---|
| `next` | 16.4.3 |
| `react`, `react-dom` | 19.2.4 |
| `firebase` | 12.16.0 |
| `@vis.gl/react-google-maps` | 1.9.0 |
| `lucide-react` | 1.27.0 |
| `tailwindcss`, `@tailwindcss/postcss` | 4.2.2 |
| `workbox-build` | 7.4.1 |
| `vitest` | 4.1.12 |
| `typescript` | 5.9.3 |

## 3. Run the development server

1. From the repository root, run `npm ci`. Expected result: one `node_modules/` folder at the root.
2. Create `frontend/.env.local` with the `NEXT_PUBLIC_*` values from the [frontend variables](../docs/CONFIGURATION.md#4-frontend-variables). `frontend/env.production.example` lists every public variable. For a backend on the same computer, set `NEXT_PUBLIC_BACKEND_URL=http://localhost:4000`.
3. Run `npm run dev --workspace=frontend`, or `npm run dev` to start the frontend and backend together. Expected result: Next.js listens on port 3000 on all interfaces.
4. Open `http://localhost:3000`. Expected result: the landing page with **Sign In with Google**.

Next.js compiles `NEXT_PUBLIC_*` values into the client bundle. Restart the development server after changing one. To open the app from a phone on the same network, see [local testing](../docs/operations/LOCAL_TESTING.md).

## 4. Scripts

Scripts in `frontend/package.json`, run with `npm run <script> --workspace=frontend`:

| Script | Command | Use |
|---|---|---|
| `dev` | `cross-env NODE_OPTIONS=--max-old-space-size=4096 next dev --hostname 0.0.0.0` | Development server with a 4 GB Node heap, reachable from the local network. |
| `build` | `next build` | Static export to `frontend/out/`. It does not generate the service worker or the CSP. |
| `start` | `next start` | Not usable: Next.js refuses `next start` with `output: "export"`. |
| `lint` | `eslint` | ESLint flat config in `eslint.config.mjs`. |
| `test` | `vitest run src` | Unit and component tests (`*.test.ts`, `*.test.tsx`) beside the source. |

Root scripts that build or check the frontend:

| Script | Effect on the frontend |
|---|---|
| `npm run build` | Backend build, `next build`, `scripts/generate-sw.mjs`, `scripts/update-csp.mjs`, `scripts/verify-web-backend-contract.mjs`. |
| `npm run build:production` | `npm run build` with `EKI_STRICT_PRODUCTION_BUILD=true`. See [Section 11](#11-static-export-and-hosting). |
| `npm run verify:ui-contracts` | Source checks in `scripts/verify-ui-contracts.mjs`, for example that the passenger map uses the shared stop-label helper. |
| `npm run test:e2e:admin` | Playwright admin, auth and feedback suite with synthetic Firebase dependencies. |

Test suites and their viewports are described in the [test strategy](../docs/testing/TEST_STRATEGY.md).

## 5. Routes

| Route | Source | Access | Content |
|---|---|---|---|
| `/` | `src/app/page.tsx` | Public | Landing page and Google sign-in. A signed-in user is redirected to a workspace. |
| `/passenger` | `src/app/passenger/` | `RoleGuard` roles `passenger`, `driver`, `admin` | Passenger workspace with the bottom tabs Map (live routes and tracking), Routes (published route schedules) and Profile. |
| `/admin` | `src/app/admin/` | `RoleGuard` role `admin` | Administrator workspace with the tabs Live Ops, Routes, Fleet & People, History, Feedback and Settings. |
| `/feedback` | `src/app/feedback/` | `RoleGuard` role `admin` | Standalone feedback console. The admin Feedback tab renders the same `FeedbackPanel`. |
| `/manifest.webmanifest` | `src/app/manifest.ts` | Public | PWA manifest. |
| `/robots.txt`, `/sitemap.xml` | `src/app/robots.ts`, `src/app/sitemap.ts` | Public | When `NEXT_PUBLIC_SITE_INDEXING` is not `false`, robots disallows `/admin`, `/passenger`, `/feedback` and `/api/`, and the sitemap lists `/`. Otherwise robots disallows everything. |

There is no driver route. A user with the `driver` role opens `/passenger`. The protected layouts also set `robots: { index: false, follow: false }`.

After sign-in, `/` opens the workspace saved in `localStorage` key `eki:last-workspace` when the role allows it, otherwise `/admin` for administrators and `/passenger` for everyone else. `RoleGuard` writes that key whenever an allowed workspace renders.

## 6. Source layout

| Path | Contents |
|---|---|
| `src/app/` | Routes, root layout, `globals.css`, metadata routes, `icon.png` and `apple-icon.png`. |
| `src/components/admin/` | Live Ops dashboard, route editor, fleet and personnel, ride history, feedback console, settings with the passenger route schedule editor (`PassengerRoutesSettings`), and `AdminPanelErrorBoundary`. |
| `src/components/passenger/` | `PassengerWorkspace`, boarding card, account tab, route schedule tab (`RoutesTab`), route timeline, layout constants (`passengerFrame.ts`) and loading shell. `ui/` holds `BottomSheet` and `RouteCarousel`. |
| `src/components/maps/` | Passenger map, road polylines (`DirectionsRoute`), bus glyph, traffic layer. |
| `src/components/shared/` | Components used by both roles: `RoleGuard`, chat (`MessagingPanel`), `FeedbackModal`, workspace links, prefetch and loading. |
| `src/components/ui/` | `ConfirmModal`, `AlertModal`, `InAppSelect` (listbox) and `CustomSelect` (native select). |
| `src/components/*.tsx` | `Providers`, `MapProviders`, `ServiceWorkerRegistrar`, `TelemetryTraceControls`. |
| `src/hooks/` | Auth, Firestore collections, settings, passenger route schedules, live route catalog, RTDB reconnect, live-health clock, marker smoothing, dialog focus. |
| `src/lib/` | Code without React: Firebase clients, API client, live bus store, bus health, stop progress, ETAs, route geometry, feedback store. |
| `src/config/` | `maps.ts` (Maps key, Map ID, default centre, map options) and `passenger.ts` (default service start time, feedback word limit of 200). |
| `src/sw.js` | Service worker source. |
| `public/` | Manifest icons, logos and hero images. |

Imports use the alias `@/` for `src/` (`tsconfig.json`, `vitest.config.mts`).

## 7. Data access

The browser reads live and configuration data directly from Firebase and sends every privileged or validated write to the backend. Firestore listeners, the live bus store and the route catalog wait for `waitForAuth()` (`lib/authState.ts`) and discard results from an earlier sign-in generation. Collection and document shapes are defined in the [Firebase data model](../docs/data/FIREBASE_DATA_MODEL.md).

### 7.1 Firebase reads

| Data | Location | Mechanism | Code |
|---|---|---|---|
| Live buses of one route | RTDB `publicRouteBuses/route:<routeId>/buses` | One snapshot, then child deltas. One shared store per route, disposed when the last subscriber leaves. | `lib/liveBusStore.ts`, `lib/createLiveBusStore.ts` |
| Live fleet (admin) | RTDB `publicRouteBuses` | Same store in fleet scope. | same |
| Route availability | RTDB `liveRouteCatalog/values`, `clientProjectionStatus/public` | `onValue` | `hooks/useLiveRouteCatalog.ts` |
| Reroute geometry | RTDB `activeRouteGeometry/<node>/<version>` | Read once per geometry version. | `lib/activeRouteGeometry.ts` |
| Connection and server clock | RTDB `.info/connected`, `.info/serverTimeOffset` | `onValue` | `hooks/useRTDBResume.ts`, `lib/serverClockSync.ts` |
| Routes, buses, last known locations, ride sessions | Firestore `routes`, `buses`, `bus_locations`, `ride_sessions` | `onSnapshot` through one shared cache per query. | `hooks/useCollection.ts` |
| Operators | Firestore `drivers` (administrators: up to 250; others: their own record) | `onSnapshot` | `hooks/useDrivers.ts` |
| Global settings | Firestore `settings/global` | `onSnapshot` | `hooks/useSettings.ts` |
| Passenger route schedules | Firestore `settings/passengerRoutes`, joined with `routes` | `onSnapshot`; malformed entries are dropped and deleted routes and stops skipped (`lib/passengerRouteSchedule.ts`) | `hooks/usePassengerRouteConfig.ts` |
| Chat | Firestore `ride_sessions/<id>/messages` | `onSnapshot` | `components/shared/MessagingPanel.tsx` |
| Role fallback | Firestore `users/<uid>` | `getDoc` | `hooks/useAuth.ts` |

The browser writes to Firestore only for feedback (`lib/feedbackStore.ts`): a transaction that creates the `feedbacks` record and the `feedbackCooldowns` stamp, a server read of the latest 200 records for administrators, and a status update. It never writes to RTDB. Reconnect timing is described in the [RTDB reconnect runbook](../docs/operations/RTDB_RECONNECT_RECOVERY.md).

### 7.2 HTTP calls

`lib/apiClient.ts` sends requests to `NEXT_PUBLIC_BACKEND_URL` with a Firebase ID token as `Authorization: Bearer`. It applies a 10 s default timeout, validates the response shape and honours `Retry-After`. It rejects a backend URL that uses `http:` on a non-local host or contains credentials, a query or a fragment. For ngrok hosts it adds the `ngrok-skip-browser-warning` header.

| Caller | Request |
|---|---|
| Sign-in | `POST /api/users/bootstrap` |
| Boarding | `POST /api/sessions/<id>/join`; restore with `GET /api/sessions/<id>/status` |
| Chat | `POST /api/sessions/<id>/messages` |
| Passenger map | `GET /api/routes/<id>/geometry` when stored geometry is missing |
| Account deletion | `POST /api/v2/privacy-deletion-requests` |
| Route editor | `PUT /api/routes/<id>`, save-operation polling, `DELETE /api/routes/<id>`, `/api/places/search` |
| Fleet | `PUT` and `DELETE /api/fleet/buses/<id>` and `/api/fleet/drivers/<id>` |
| Live Ops | `POST /api/shifts/stop`, `PATCH /api/shifts/delay`, `DELETE /api/shifts/<id>/messages`, `POST /api/v2/ride-sessions`, `POST /api/sessions/<id>/boarding-code` |
| History and settings | `DELETE /api/shifts/<id>/history`, `PATCH /api/v2/settings/global`, `PUT /api/v2/settings/passenger-routes` |

The [HTTP contract](../docs/api/HTTP_CONTRACT.md) and the [API reference](../backend/API.md) define each endpoint.

## 8. Authentication flow

1. The root layout mounts `AuthProvider` (`hooks/useAuth.ts`). It imports the sign-in code (Firebase Auth) after first paint, one attempt at a time. A failed download is retried after 2, 5, 10, 20 and then every 30 s, or at once when the browser goes `online`; meanwhile the page shows "Sign-in could not load. Check your connection; retrying automatically." A Firebase Auth setup error such as `auth/invalid-api-key` is not retried and asks for a reload.
2. `lib/firebaseAuth.ts` initialises Auth with persistence in this order: local storage, IndexedDB, session storage. On `<project>.web.app` or `<project>.firebaseapp.com`, the auth domain is the current host (`lib/firebaseAuthDomain.ts`); on other hosts it is `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`. It installs Firebase's popup and redirect resolver at startup only on popup platforms or while the tab returns from a Google redirect, because with the resolver installed Firebase loads Google's sign-in frame before it reports the first auth state. Redirect sign-in passes the resolver per call.
3. Google is the only provider. Sign-in uses a popup, or a full-page redirect when the auth domain equals the page host and the device is a phone or tablet or the app runs standalone (`lib/googleSignInFlow.ts`). When the popup takes longer than 8 s or fails with an error that permits it, the page offers **Continue with full-page Google sign-in**.
4. **Sign In with Google** becomes usable as soon as the sign-in code loads, while Firebase may still be restoring a saved session. Only while a Google redirect is pending (the app's `eki:google-redirect-pending` marker or Firebase's `firebase:pendingRedirect:<apiKey>:[DEFAULT]` flag in session storage) does the button read "Preparing sign-in…" until the redirect result settles. On a phone, a tap during restoration waits for the restored state. On every platform, a tap while a restored account is being verified finishes that verification instead of opening Google again. A redirect that fails before leaving the page clears both pending flags.
5. Until Firebase reports its first auth state, the user state is unknown, not signed out: protected views stay closed. After 8 s the landing page shows "Still checking your sign-in. The connection looks slow; this continues on its own." and `RoleGuard` shows "Still signing you in." with the same explanation; both offer **Reload**. `RoleGuard` also shows that screen after 10 s of loading.
6. On every Auth state change, `beginAuthVerification()` closes the readiness gate and the client refreshes the ID token (10 s timeout). A `role` claim of `passenger`, `driver` or `admin` is accepted. `role: "admin"` also requires `admin: true`; otherwise the user sees "Your administrator access is not synchronized". A transient failure is retried after 1, 2, 4, 8, 16 and 30 s; during these timer retries the error stays on screen with "retrying automatically" ([RTDB reconnect runbook](../docs/operations/RTDB_RECONNECT_RECOVERY.md)).
7. Without a role claim, the client reads `users/<uid>` and calls `POST /api/users/bootstrap`. A driver or admin profile role must then appear in the refreshed claims. An unknown profile role becomes `passenger`.
8. `notifyAuthReady()` opens the gate, and data hooks start their listeners.
9. Sign-out closes the gate, removes `eki:role:<uid>` and `eki:last-workspace`, and clears the collection, settings and live bus caches.

`RoleGuard` only controls presentation and navigation. The backend and the Firebase security rules enforce authorization; see [privileged database authorization](../docs/security/PRIVILEGED_DATABASE_AUTHORIZATION.md).

## 9. PWA and service worker

`src/app/manifest.ts` produces the manifest. Its colours and icons are listed in the [UI design system](../docs/design/UI_DESIGN_SYSTEM.md#9-pwa-manifest-and-map-styling).

`scripts/generate-sw.mjs` runs after `next build`. It uses Workbox `injectManifest` to bundle `src/sw.js` into `frontend/out/sw.js`. The precache holds every exported HTML file, `manifest.webmanifest`, `icon*.png`, `apple-icon.png`, and every `/_next/static` JavaScript or CSS file that an exported HTML file references. The build fails if one file exceeds 1 MB or the precache exceeds 2 MB. When the inputs are unchanged, the script reuses the `sw.js` cached in `frontend/.next/cache/sw/`.

| Requests | Strategy | Cache |
|---|---|---|
| Page navigations | Network first. When Hosting has not answered within 2.5 s, the worker serves the HTML shell precached with this worker (whose chunks are precached too), or else the cached copy, while the network response keeps updating the cache; with nothing readable it keeps waiting. When the fetch fails, it serves the route's precached shell or `/index.html`. A cache read that fails counts as a miss. One entry per path with the query string removed; at most 10 entries for 7 days. | `eki-navigations` |
| Same-origin `/_next/static/` | Cache first, at most 120 entries for 30 days. | `eki-next-static` |
| Same-origin images | Cache first, at most 100 entries for 30 days. | `eki-images` |
| Google Fonts CSS and files | Stale-while-revalidate and cache first, readable responses only. The app loads no web fonts today. | `eki-google-fonts-css`, `eki-google-fonts-woff` |
| Google Maps loader, tiles and icons | Network only. | none |
| Google Auth helpers, RTDB, Identity Toolkit, Secure Token | Network only. | none |
| Everything else, including the backend API | Network only. | none |

`ServiceWorkerRegistrar` registers `/sw.js` after the `load` event with scope `/` and `updateViaCache: "none"`. It checks for updates every 15 minutes and when the tab becomes visible. A new worker waits until every tab of the app is closed. On activation it deletes the caches `eki-firebase-sdk`, `eki-navigations` and `eki-google-maps`. In development the registrar unregisters any worker instead. The reasons no account-scoped response is cached are given in [security architecture](../docs/security/SECURITY_ARCHITECTURE.md#63-service-worker).

## 10. Content Security Policy

The policy is the `Content-Security-Policy` header for source `**` in `firebase.json`. After the service worker step, `scripts/update-csp.mjs` hashes every inline script in the exported HTML and rewrites `script-src`, `connect-src`, `img-src` and `frame-src`; `connect-src` receives the origin of `NEXT_PUBLIC_BACKEND_URL`. The generated sources and the fixed directives are listed in [security architecture](../docs/security/SECURITY_ARCHITECTURE.md#62-content-security-policy-generation).

For work on this package:

- The script reads `frontend/.env*` through `@next/env`, as `next build` does, so a backend URL set only in `frontend/.env.local` still reaches the policy.
- It fails when it finds no inline script or when a managed directive is missing.
- `scripts/verify-web-backend-contract.mjs` then checks that `connect-src` contains the backend origin. In a production build a missing `NEXT_PUBLIC_BACKEND_URL` fails the build.
- `npm run build` edits the tracked `firebase.json`. Commit changed hashes with the change that caused them, but not a local backend origin or RTDB host taken from `frontend/.env.local`; the tracked policy carries neither.

## 11. Static export and hosting

`next.config.ts` sets:

| Setting | Value and effect |
|---|---|
| `output` | `"export"`: `next build` writes static HTML, JavaScript and CSS to `frontend/out/`. There is no Node.js server, middleware or proxy at runtime. |
| `generateBuildId` | SHA-256 hash of the build inputs (source, `public/`, configuration and the root lockfile), truncated to 32 hexadecimal characters. Unchanged source gives an identical `out/`. |
| `images.unoptimized` | `true`: no image optimisation server. The landing page uses a `<picture>` element for WebP with a JPEG fallback. |
| `productionBrowserSourceMaps` | `true`. The service worker does not precache `.map` files. |
| `experimental.optimizePackageImports` | `["lucide-react"]`. |
| `devIndicators` | Shown only when `EKI_DEVTOOLS=true`. |

With `EKI_STRICT_PRODUCTION_BUILD=true`, which `npm run build:production` sets, `next.config.ts` fails if any required `NEXT_PUBLIC_*` value is missing, or if `NEXT_PUBLIC_FIREBASE_DATABASE_URL` or `NEXT_PUBLIC_BACKEND_URL` is not a non-local HTTPS URL.

Firebase Hosting serves `frontend/out` with `cleanUrls: true`. HTML routes are sent with `Cache-Control: no-cache, no-store, must-revalidate`, `/_next/static/**` as immutable for one year, and images for 30 days with one day of stale-while-revalidate. `/sw.js` is never cached and carries `Service-Worker-Allowed: /`. The release procedure is in [CI/CD and releases](../docs/operations/CI_CD_AND_RELEASES.md).

## 12. Next.js 16 specifics

The installed version is described by its own guides in `node_modules/next/dist/docs/`. Read the relevant guide before changing framework code, as `AGENTS.md` requires.

| Behaviour | Where it shows in this package |
|---|---|
| Turbopack is the default bundler for `next dev` and `next build`. | No custom webpack configuration exists; adding one would fail `next build`. |
| `next lint` was removed. | The `lint` script runs the ESLint CLI with `eslint-config-next/core-web-vitals` and `eslint-config-next/typescript`. |
| Next.js no longer overrides `scroll-behavior` during navigation. | The root `<html>` sets `data-scroll-behavior="smooth"` to keep the override. |
| `catchError` from `next/error` creates an error boundary component. | `AdminPanelErrorBoundary` keeps a crash inside one admin tab and offers **Try again**. |
| `useLinkStatus` from `next/link` reports a pending navigation. | `WorkspaceLink` shows **Opening…** and falls back to a full page load after 5 s. |
| Metadata routes in a static export must be static. | `manifest.ts`, `robots.ts` and `sitemap.ts` export `dynamic = "force-static"`. |
| Client-only modules load with `next/dynamic` and `ssr: false`. | The passenger workspace, every admin panel, the feedback panel and the passenger map. |

Google Maps loads only where a map renders. The admin layout mounts `MapProviders` for the whole workspace; the passenger workspace mounts it only while a route is tracked. The landing page and `/feedback` never load the Maps SDK. The SDK script loads once per page. Every map element sets `reuseMaps` with the shared `MAPS_MAP_ID` and `MAP_OPTIONS` (`src/config/maps.ts`), so leaving and reopening tracking, changing route, direction or bus, and switching admin tabs or the route editor reattach one cached map instead of constructing a new, billed one. Keep per-map options in `MAP_OPTIONS`, never mount two maps at once, and keep `src/config/maps.reuse.test.ts` passing; the decision is [EKI-ADR-004](../docs/design/GOOGLE_MAP_REUSE_DECISION.md).

## 13. Verification

Run from the repository root:

```powershell
npm run lint --workspace=frontend
npm run test --workspace=frontend
npm run verify:ui-contracts
npm run build
```

Expected result: lint and tests pass, `frontend/out/sw.js` exists, and the build prints `Updated CSP with <n> inline-script hashes.`

## 14. Troubleshooting

| Symptom | Cause | Action |
|---|---|---|
| A changed `NEXT_PUBLIC_*` value has no effect. | The value is compiled into the bundle. | Restart `next dev`, or rebuild. |
| Every API call fails with "Backend URL is invalid or not configured." | `NEXT_PUBLIC_BACKEND_URL` is missing, uses `http:` on a non-local host, or has credentials, a query or a fragment. | Correct the value and restart. |
| A deployed site loads, but the browser blocks every backend request. | The build ran without `NEXT_PUBLIC_BACKEND_URL`, so `connect-src` lacks the backend origin. A plain `npm run build` only skips the check. | Build with `npm run build:production`, which fails when the value is missing. |
| `npm run start --workspace=frontend` exits with an error. | `next start` does not support `output: "export"`. | Serve `frontend/out` with Firebase Hosting or another static server. |
| An administrator sees "Your administrator access is not synchronized". | The ID token has `role: "admin"` without `admin: true`. | Synchronize the claims; see [admin permission recovery](../docs/testing/ADMIN_PERMISSION_RECOVERY.md). |
| An installed app still shows the previous release. | The new service worker waits until every tab closes. | Close all tabs and windows of the app, then reopen it. |
| The sign-in button reads "Preparing sign-in…". | The sign-in code has not loaded, or a Google redirect is still being completed. After 10 s without a message the page shows "Sign-in is still loading." with **Reload**; a failed download shows "Sign-in could not load" and retries on its own. | Wait or reload. If it persists, check the network and the Firebase values in `frontend/.env.local`. |
| "Still checking your sign-in" or "Still signing you in". | Firebase has not restored the saved session within 8 s, usually on a slow network. | Wait; the page recovers in place when restoration finishes. **Reload** starts again. |
