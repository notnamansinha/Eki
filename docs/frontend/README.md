# Eki frontend

Last updated: 2026-10-27 12:00 IST (UTC+05:30).

Next.js 16 App Router application with React 19, Firebase Auth and a static-export PWA. Passenger and administrator workspaces are protected; `/feedback` is an admin review view sharing the same panel as the Admin Feedback tab.

## Run from the repository root

```powershell
npm ci
Copy-Item frontend/env.production.example frontend/.env.local
```

Fill the Firebase/Maps values and set `NEXT_PUBLIC_BACKEND_URL=http://localhost:4000` for same-laptop development. Start the backend using [getting started](../GETTING_STARTED.md). App Check is not required. See [Auth configuration](../CONFIGURATION.md#local-auth-setup).

```powershell
npm run dev --workspace=frontend
```

Open `http://localhost:3000`. Restart after changing public environment variables; they are compiled into the client.

## Workflows

- Passenger: select a route, bus and destination; track live position; join an armed/active ride after sign-in and a live-bus proximity check; view the timeline, messages, account and feedback.
- Passenger account deletion: **Profile → Delete Account** opens a confirmation explaining that feedback, passenger ride entries and messages are retained. A valid API acknowledgement opens **Deletion requested**; OK, Escape or backdrop dismissal signs the passenger out. Failed requests keep the passenger signed in. Sign-out confirms neither deletion completion nor a deadline; the backend worker processes the queue asynchronously. See [account deletion and recovery](../operations/PRIVACY_DELETION.md).
- Passenger selectors: destination and bus controls stay inside the web app. Destination order follows the ride direction, falls back to the terminal stop, and carries into boarding as `alightingStopId`. Device-only presence supports planning but cannot grant boarding eligibility.
- Passenger boarding: Auth-token and location preparation each have a ten-second deadline, followed by a separate full ten-second API budget. Location denial, unavailable position and acquisition timeout are distinct; session changes and unmount cancel old work. Existing members may still correct stops without another location prompt. See [boarding request checks](../testing/BOARDING_REQUEST_BUDGETS.md).
- Administrator: use Live Ops, routes, fleet/personnel, history, feedback and settings. Only the active tab is mounted to limit listeners/maps/timers. Switching sections with an unsaved route draft or settings edit asks for confirmation, and the browser warns before reload or close while a draft is dirty (fleet inline/registration forms are not covered).
- Admin failures: a failed route, vehicle or operator deletion, End ride early or Clear Messages closes its confirmation dialog so the reason is visible instead of hidden behind the backdrop.
- Fleet and settings: registration waits for the saved list and refuses an existing vehicle/operator ID instead of overwriting it (the check covers the loaded list of up to 250 records). Editing a vehicle stored with only the legacy `assignedRouteId` keeps that route selected. If stored settings fail to load, the settings form is replaced by the read error rather than showing editable defaults.
- Live Ops: delay changes are locked per ride, so one bus's pending change cannot unlock another's. The chat overlay follows the receiver's live entry and closes when the receiver goes offline or the ride's session changes. Ride history keeps the loaded rides on screen while **Load older rides** fetches the larger page.
- Panel switching: admins can open **Passenger Panel** beside the admin tabs and return through **Profile → Admin Panel**. Verified admins preload the destination route and its lazy UI without mounting private listeners. Links show **Opening…** while navigation is pending, followed by a loading screen if needed. Admin role verification, backend authorization and Firebase rules still apply; browser storage cannot grant access.
- Feedback review: load up to the latest 200 records with a Firestore server read (not the backend API); normalise each record field by field like the former backend list route (unknown status becomes `new`, a non-numeric rating or non-Firestore timestamp becomes `null`, non-string text falls back to a default), so one legacy or hand-edited document cannot blank the console, and confirm the status write before updating the displayed list. Requests and results are tied to the current verified auth generation.
- Feedback: submission, the latest 200 timestamp-ordered admin records, and status updates use Firestore directly, so the ngrok/backend tunnel can be offline. Transactions and Firestore rules enforce identity, completed-ride membership, comment/rating limits, the shared 24-hour cooldown and retry idempotency. The modal stores a server-reported cooldown locally so a refresh or reopen keeps Submit disabled, and caps any local cooldown at one day so a device clock running ahead cannot lock feedback for longer. Remaining time rounds up to whole minutes (the last minute shows `1m`, never `0m`) and Submit re-enables when the cooldown ends. The client cooldown estimate is skipped when the device clock is behind the stored server stamp, so the rules (server time only) decide; a rules denial with a recent cooldown stamp is shown as a cooldown, not as an access problem, and is not stored locally. Trimming a pasted comment to the word limit keeps its line breaks. Admin results remain tied to the current verified auth generation; Retry requests fresh server data and status changes appear only after the write succeeds. Deploy `firestore.rules` together with the frontend: run `npm run build:production` first so `firebase.json` carries a CSP that allows the backend origin, then `firebase deploy --only firestore:rules,hosting`; existing Firebase Auth, profiles and ride manifests are required. New-account bootstrap and ride boarding still require the backend.
- Route editor: submit one versioned PUT with a stable `saveId`. A 202 or unknown write outcome is reconciled through the legacy save-operation GET for up to 35 seconds. Temporary network/read 503, `AUTH_BUSY` 503, generic 5xx and read-quota 429 failures back off using the server retry hint within that deadline; stored save failures and other 4xx stop immediately. Keep the same `saveId` and payload for any explicit retry after an unknown outcome. A save that completes after the admin cancelled it closes only its own editor, so a newer draft stays open. A place search answered with a non-object body is reported as unavailable.

## Runtime boundaries

Passenger stop selectors display the map's shared, bus/session/direction/revision-bound estimates beside stop names. Missing direction, geometry or fresh telemetry produces an explicit unavailable label; a signal delay clears countdowns. Only server-published progress marks a stop passed. Passed map stops are grey; covered road is grey and all upcoming road is blue. A confident current match can split the active leg, bounded by the next required stop. Fleet views do not claim a single completed distance. The bus uses an upright vehicle glyph with a separate heading pointer; uncertain position removes that pointer; browser location is used internally for walking estimates without a separate map dot.

Run `npx playwright test --config playwright.passenger-progress.config.ts` from the repository root for mobile/desktop regression screenshots using the actual map, route renderer and boarding picker with synthetic SDK and realtime adapters. These checks do not attest Google Maps, live Firebase or physical GNSS accuracy.

Confirmation dialogs render through a portal into `document.body`, keeping them
above the page and outside transformed or scrolling profile containers. The
accepted-deletion popup has a single OK button; all dismissal paths sign out.

| Module | Responsibility |
|---|---|
| `hooks/useAuth.ts`, `lib/authState.ts` | Wait for refreshed trusted role claims before publishing a user or opening protected listeners; share explicit access retries and invalidate pending work during account changes/sign-out |
| `lib/firebaseAuthDomain.ts` | Normalize the primary project's `web.app`/`firebaseapp.com` host to the current hostname; custom/secondary hosts use the explicitly configured auth domain |
| `lib/liveBusStore.ts` | One shared initial live-fleet sync, followed by RTDB child deltas and route-scoped delivery; dispose at zero subscribers. Active rides are retained only with a non-empty `sessionId`, and a stale store's dispose never evicts its route successor |
| `hooks/useRTDBResume.ts`, `lib/liveBusRetry.ts` | Preserve healthy short-tab data; debounce confirmed disconnect/30-second suspension with cooldown and bounded independent retry jitter |
| `hooks/useCollection.ts`, `hooks/useSettings.ts` | Shared auth-ready Firestore configuration/session listeners and cache disposal |
| `components/maps/`, `lib/busEta.ts` | Stored directional geometry, current matched/raw position, honest freshness and local ETA math; unchanged buses retain marker identity and static stop projections are cached per route geometry/version/direction with edit and unmount invalidation |
| `lib/apiClient.ts`, `lib/routeSaveClient.ts` | Firebase bearer-token HTTP calls, deadlines and Retry-After hints; bounded route-save reconciliation without duplicate poll-triggered writes |
| `components/ui/` | In-app listbox controls plus focus-contained alert/confirmation dialogs |
| `src/sw.js` | Static/public caching; Firebase, authenticated API, Google Maps (loader, tiles, icons) and unknown requests are network-only, because opaque Maps responses cannot be told apart from upstream errors. Navigation HTML is cached once per path (query string ignored, at most 10 entries, 7 days). Activation deletes the previous deployment's cached navigation HTML and any legacy Maps cache, so offline fallback serves the current precached shell |

`RoleGuard` handles presentation and routing. Backend middleware and Firebase rules enforce authorization. Sign-out closes readiness before awaiting Firebase, invalidates pending verification, and clears caches. Failed sign-out keeps protected content hidden and offers reload recovery. Blocked or full browser storage does not stop verification or sign-out cleanup; the role hint and remembered workspace are optional. The landing page's access-error screen offers **Sign out** as well as **Try again**, so an account with a permanent access error can switch accounts. Without a role claim, an unrecognised legacy profile role is treated as passenger.

Fleet/routes/driver **Retry** on a permission failure and verification **Try again**
refresh Auth before reopening protected listeners. Admin
UI requires both trusted `role: "admin"` and `admin: true` claims. A Firestore
profile alone cannot grant access. If local Auth configuration is missing, repair the
ignored development configuration and restart the frontend; retries cannot
change Firebase product configuration. See the [recovery evidence](../testing/ADMIN_PERMISSION_RECOVERY.md).

Service-worker updates wait for existing tabs to close. Maps and decorative motion respect reduced-motion preferences; protected routes are no-index. Dialogs and listboxes support keyboard interaction and focus restoration.

Browser recovery uses a 30-second monotonic suspension threshold, 1–1.5 second
debounce and 5-second manual-handshake cooldown. Live listener retry windows
range from 0.5–1 second to 15–30 seconds with independent jitter. See the
[reconnect runbook](../operations/RTDB_RECONNECT_RECOVERY.md) for cache,
snapshot-readiness and actual-network acceptance limits.

Passenger map per-bus identity, marker and ETA projection behavior is described
in the [R18 synthetic evidence](../testing/PASSENGER_MAP_PER_BUS_WORK.md).
The moving-device render and road-confidence gates remain in #245.

## Verify and build

```powershell
npm run lint --workspace=frontend
npm run test --workspace=frontend
npm run test:e2e:admin
npm run build
```

The browser suite uses the actual admin/auth/feedback UI with synthetic Firebase dependencies at mobile and desktop widths. It uses synthetic SDK responses. Root `build` includes backend/frontend output, Workbox injection and CSP generation (which fails the build if a managed CSP directive cannot be written); `build:production` additionally validates required public values and HTTPS origins. CSP generation and the web/backend contract check read `NEXT_PUBLIC_BACKEND_URL` from the shell or `frontend/.env*`, the same way `next build` does, so the generated `connect-src` always includes the origin the bundle calls. The standalone frontend build omits those root packaging steps. Serve production output through Firebase Hosting/static hosting; the configured `output: export` does not use `next start`.

See [LLD](../design/LOW_LEVEL_DESIGN.md), [data model](../data/FIREBASE_DATA_MODEL.md), [test strategy](../testing/TEST_STRATEGY.md) and [local phone testing](../operations/LOCAL_TESTING.md).
