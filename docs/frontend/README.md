# Eki frontend

Last updated: 2026-10-06 00:35 IST (UTC+05:30).

Next.js 16 App Router application with React 19, Firebase Auth and a static-export PWA. Passenger and administrator workspaces are protected; `/feedback` is an admin review view sharing the same panel as the Admin Feedback tab.

## Run from the repository root

```powershell
npm ci
Copy-Item frontend/env.production.example frontend/.env.local
```

Fill the Firebase/Maps values and set `NEXT_PUBLIC_BACKEND_URL=http://localhost:4000` for same-laptop development. Start the backend using [getting started](../GETTING_STARTED.md). Configure App Check before sign-in: use a valid provider key or registered local debug token; an explicit opt-out is allowed only in development with an unenforced Firebase project. See [configuration](../CONFIGURATION.md#local-app-check-and-auth-setup).

```powershell
npm run dev --workspace=frontend
```

Open `http://localhost:3000`. Restart after changing public environment variables; they are compiled into the client.

## Workflows

- Passenger: select a route, bus and destination; track live position; join an armed/active ride using the boarding code; view the timeline, messages, account and feedback.
- Passenger selectors: destination and bus controls stay inside the web app. Destination order follows the ride direction, falls back to the terminal stop, and carries into boarding as `alightingStopId`. Device-only presence supports planning but cannot grant boarding eligibility.
- Passenger boarding: Auth-token and location preparation each have a ten-second deadline, followed by a separate full ten-second API budget. Location denial, unavailable position and acquisition timeout are distinct; session changes and unmount cancel old work. Existing members may still correct stops without another location prompt. See [boarding request checks](../testing/BOARDING_REQUEST_BUDGETS.md).
- Administrator: use Live Ops, routes, fleet/personnel, history, feedback and settings. Only the active tab is mounted to limit listeners/maps/timers.
- Feedback review: load up to the latest 200 records through `GET /api/v2/feedback`; validate responses and acknowledge a status PATCH before updating the displayed list. Requests and results are tied to the current verified auth generation.
- Route editor: submit one versioned PUT with a stable `saveId`. A 202 or unknown write outcome is reconciled through the legacy save-operation GET for up to 35 seconds. Temporary network/read 503, `AUTH_BUSY` 503, generic 5xx and read-quota 429 failures back off using the server retry hint within that deadline; stored save failures and other 4xx stop immediately. Keep the same `saveId` and payload for any explicit retry after an unknown outcome.

## Runtime boundaries

| Module | Responsibility |
|---|---|
| `hooks/useAuth.ts`, `lib/authState.ts` | Wait for App Check and refreshed trusted role claims before publishing a user or opening protected listeners; share explicit access retries and invalidate pending work during account changes/sign-out |
| `lib/firebaseAppCheck.ts` | Valid token acquisition with a 10-second response deadline; retain one raw acquisition until settlement, force explicit recovery refresh, and leave protected access closed on failure |
| `lib/firebaseAuthDomain.ts` | Normalize the primary project's `web.app`/`firebaseapp.com` host to the current hostname; custom/secondary hosts use the explicitly configured auth domain |
| `lib/liveBusStore.ts` | One shared initial live-fleet sync, followed by RTDB child deltas and route-scoped delivery; dispose at zero subscribers |
| `hooks/useRTDBResume.ts`, `lib/liveBusRetry.ts` | Preserve healthy short-tab data; debounce confirmed disconnect/30-second suspension with cooldown and bounded independent retry jitter |
| `hooks/useCollection.ts`, `hooks/useSettings.ts` | Shared auth-ready Firestore configuration/session listeners and cache disposal |
| `components/maps/` | Stored directional geometry, current matched/raw position, honest freshness and local ETA math |
| `lib/apiClient.ts`, `lib/routeSaveClient.ts` | Firebase bearer-token HTTP calls, deadlines and Retry-After hints; bounded route-save reconciliation without duplicate poll-triggered writes |
| `components/ui/` | In-app listbox controls plus focus-contained alert/confirmation dialogs |
| `src/sw.js` | Static/public caching; Firebase, authenticated API and unknown requests are network-only |

`RoleGuard` handles presentation and routing. Backend middleware and Firebase rules enforce authorization. Sign-out closes readiness before awaiting Firebase, invalidates pending verification, and clears caches. Failed sign-out keeps protected content hidden and offers reload recovery.

Fleet/routes/driver **Retry** on a permission failure and verification **Try again**
refresh App Check and Auth together before reopening protected listeners. Admin
UI requires both trusted `role: "admin"` and `admin: true` claims. A Firestore
profile alone cannot grant access. If local enrollment is missing, repair the
ignored development configuration and restart the frontend; retries cannot
disable App Check enforcement. See the [recovery evidence](../testing/ADMIN_PERMISSION_RECOVERY.md).

Service-worker updates wait for existing tabs to close. Maps and decorative motion respect reduced-motion preferences; protected routes are no-index. Dialogs and listboxes support keyboard interaction and focus restoration.

Browser recovery uses a 30-second monotonic suspension threshold, 1–1.5 second
debounce and 5-second manual-handshake cooldown. Live listener retry windows
range from 0.5–1 second to 15–30 seconds with independent jitter. See the
[reconnect runbook](../operations/RTDB_RECONNECT_RECOVERY.md) for cache,
snapshot-readiness and actual-network acceptance limits.

## Verify and build

```powershell
npm run lint --workspace=frontend
npm run test --workspace=frontend
npm run test:e2e:admin
npm run build
```

The browser suite uses the actual admin/auth/feedback UI with synthetic Firebase dependencies at mobile and desktop widths. It does not prove live App Check enforcement. Root `build` includes backend/frontend output, Workbox injection and CSP generation; `build:production` additionally validates required public values and HTTPS origins. The standalone frontend build omits those root packaging steps. Serve production output through Firebase Hosting/static hosting; the configured `output: export` does not use `next start`.

See [LLD](../design/LOW_LEVEL_DESIGN.md), [data model](../data/FIREBASE_DATA_MODEL.md), [test strategy](../testing/TEST_STRATEGY.md) and [local phone testing](../operations/LOCAL_TESTING.md).
