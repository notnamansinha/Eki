# Google Map Reuse Decision

| Document ID | Version | Status | Last updated |
|---|---|---|---|
| EKI-ADR-004 | 1.0 | Current | 2026-10-30 |

## 1. Context

Decision date: 2026-10-29 (record last revised 15:35 IST). Pull request #394, branch `codex/issue-2-map-reuse`, based on `main` at `c4d47b3` and merged to `main` as `a8e28d9`.

Google bills the Dynamic Maps SKU per successful map load of the Maps JavaScript API [1], [2]. This record treats each construction of a `google.maps.Map` as one billed load and a reattached, already constructed map as no new load. The Cloud Console Dynamic Maps metric has not yet confirmed this (Section 4.2).

A Maps cost write-up, outside this repository, listed three issues:

| Write-up issue | Content | Scope here |
|---|---|---|
| 1 | How data reaches the panels | Excluded. Nothing in this decision touches Firestore, RTDB listeners or the live bus feed. |
| 2 | Maps loads are billed every time a map opens. Admin: the Live Ops and route editor maps are rebuilt on every open. Passenger: the map is re-created on open, close and reopen, route switch, direction change, a bus appearing, and tab switch. A full app restart costs the most. Cost grows with users multiplied by how often maps open. | Primary |
| 3 | Keep Google for administrators. For passengers, prefer a non-Google pre-rendered or SVG route view with the live bus drawn on top. If the Google map stays for passengers, keep one map open, change only overlays and turn on `reuseMaps`. Never cache or re-serve Google imagery. | Guidance; this decision applies its mitigation for a passenger Google map |

### 1.1 Causes

Verified in the application source and in `node_modules/@vis.gl/react-google-maps` 1.9.0 `dist/index.modern.mjs`:

| ID | Cause |
|---|---|
| RC1 | No instance reuse. `useMapInstance` takes a cached map only when `reuseMaps && CachedMapStack.has(cacheKey)`; otherwise it runs `new google.maps.Map(mapDiv, ...)`. On unmount it returns the map to the cache only when `reuseMaps` is set, and otherwise discards it with `clearInstanceListeners`. `reuseMaps` appeared nowhere in `frontend/src`. |
| RC2 | Passenger remount key. `frontend/src/components/maps/PassengerMap.tsx` keys `PassengerMapInner`, which contains the map, on `` `${route.id}:${route.rideDirection}:${preview ? "preview" : "ride"}:${selectedBusKey ?? "all"}` ``. The key changes when the route changes, when the direction resolves (`preview = !directedRoute` in `PassengerWorkspace.tsx`), and when the selected bus changes: a bus appears or disappears, goes offline, starts service, or the passenger picks another. |
| RC3 | Tracking gates. `PassengerWorkspace.tsx` mounts the map only for `visibleView === "tracking"` and `!endedMessage && mapRoute && targetStop`. Back, the Profile and Routes tabs and the end of a ride unmount it. |
| RC4 | Admin tabs. `app/admin/page.tsx` renders only the active panel inside `<AdminPanelErrorBoundary key={activeTab}>`. Each Live Ops visit (`DashboardPanel.tsx`) and each route editor open (`RouteManagementPanel.tsx`, `RouteEditor`) mounted a new map. |
| RC5 | Stale design statements. `config/maps.ts` said "APIProvider is mounted once at the root, so a user session counts as one map load", and `docs/design/LOW_LEVEL_DESIGN.md` said "Single Maps API provider/load per workspace". Both were false. |

These were checked and are not causes:

- The SDK script loads once per page, because the loader state is module-global. Remounting `APIProvider` does not reload it.
- Markers, polylines, camera moves and live GPS ticks never construct a map (measured 0).
- A map remount does not re-subscribe RTDB, because `PassengerWorkspace` holds the route-scoped live store.

## 2. Decision

Set `reuseMaps` on every `@vis.gl/react-google-maps` `Map` element, keep every React key and mount gate, correct the comments and documents, and guard the behaviour with map-construction counting tests and a source contract test. This is option J in Section 5.2.

1. The three map sites set `reuseMaps`: `<GoogleMap>` in `PassengerMapInner` (`frontend/src/components/maps/PassengerMap.tsx`), the Live Ops map (`frontend/src/components/admin/DashboardPanel.tsx`) and the route editor (`RouteEditor` in `frontend/src/components/admin/RouteManagementPanel.tsx`).
2. All three already share `mapId={MAPS_MAP_ID}` and spread `MAP_OPTIONS`, and set no `renderingType` or `colorScheme`. They therefore share one vis.gl cache key, `mapId:renderingType:colorScheme`, and reattach one cached instance within a page session, including when the user moves between them in the app. The cache is bounded by how many maps are mounted at once; the app mounts at most one.
3. On a remount, vis.gl takes the cached instance, moves its element into the new container, applies that mount's options (including its default centre and zoom) and forces a re-layout.
4. The keyed `PassengerMapInner` still remounts, so per-ride React state (buses, ETAs, `focusBus`, `inspectedStopId`, `repairedRoadPath`, camera stage) still resets. Only the Google instance is recycled.
5. Overlays detach on unmount (`setMap(null)` for `DirectionsRoute` polylines and `TrafficLayer`, marker cleanup, vis.gl listener removal), so nothing remains on a reused instance.
6. Per-map options stay in `MAP_OPTIONS` or are passed on every mount, because a reused instance keeps options that a later mount does not set again. Two maps are never mounted at once; a second simultaneous map would construct a new instance.
7. Comments in `config/maps.ts`, `MapProviders.tsx` and `PassengerTrackingMap.tsx` state this policy.

### 2.1 Changed files

| File | Change |
|---|---|
| `frontend/src/components/maps/PassengerMap.tsx` | `reuseMaps` on the passenger map, with an explanatory comment |
| `frontend/src/components/admin/DashboardPanel.tsx` | `reuseMaps` on the Live Ops map |
| `frontend/src/components/admin/RouteManagementPanel.tsx` | `reuseMaps` on the route editor map |
| `frontend/src/config/maps.ts` | Billing and reuse policy comment: constructions, the shared cache key, options kept in `MAP_OPTIONS` |
| `frontend/src/components/MapProviders.tsx`, `frontend/src/components/maps/PassengerTrackingMap.tsx` | Corrected comments |
| `frontend/src/test-support/fakeGoogleMapsSdk.ts` (test only) | Fake Maps SDK that hooks the real vis.gl script bootstrap and records constructions, reuses (element parent change on `setOptions`), teardowns, script loads, camera calls, overlay `setMap` history and listeners per map |
| `frontend/src/components/maps/PassengerMap.mapLoads.test.tsx` | First open builds 1 map and loads 1 script; reuse across bus, preview, direction and route changes; preview re-centre and refit; follow mode `panTo` and `setZoom(16)`; a GPS tick neither constructs nor reattaches |
| `frontend/src/components/passenger/PassengerWorkspace.mapLoads.test.tsx` | Back and reopen, Profile and Routes, route switch, direction resolution, bus disappearance and reappearance, service start, bus picker: 0 constructions, each reattaching the same instance |
| `frontend/src/components/admin/AdminMapLoads.test.tsx` | Live Ops, Routes, editor, cancel, editor, Live Ops, Fleet, Live Ops builds 1 map; traffic and route overlays and listeners detach from the cached instance |
| `frontend/src/config/maps.reuse.test.ts` | TypeScript AST contract: every vis.gl `Map` element, under any alias or namespace, sets `reuseMaps`, `mapId={MAPS_MAP_ID}` and `{...MAP_OPTIONS}` and no `renderingType` or `colorScheme`; at least 3 matches |
| `docs/design/LOW_LEVEL_DESIGN.md`, `docs/testing/TEST_STRATEGY.md` | Corrected `MapProviders` description; map-load counter entry stating that counts are constructions, not billing |
| `docs/design/GOOGLE_MAP_REUSE_DECISION.md` | This record |

## 3. Status

Accepted on 2026-10-29 and in force on `main` since `a8e28d9`. The administrator and desktop checks with the real Maps SDK (Section 4.2) and the billing confirmation remain open. Revisit this decision when the passenger view moves to a renderer that does not use Google Maps (Section 4.3).

## 4. Consequences

### 4.1 Effects

- Within one page session the app constructs at most one map. The passenger map, the Live Ops map and the route editor reattach it.
- The Maps script still loads once per page. The real SDK check saw the map setup requests (`api/js`, `mapConfigs:batchGet`, `gen_204`) once per page load.
- Firestore and RTDB traffic is unchanged (write-up issue 1).
- Live subscriptions, marker selection, smoothing, ETAs and progress are unchanged. The keyed inner component still resets per ride context, so no state from a previous route or session leaks into the next.
- One detached map instance stays in memory for the page lifetime. This bound is the cost of avoiding new loads.
- Unchanged: every React key and mount gate, `MAP_OPTIONS` and `mapId`, the service worker (Maps stays network-only, so no Google imagery is cached), the CSP and dependencies, the QA maps and existing test names.

Edge cases checked:

| Case | Result |
|---|---|
| Options left on a reused instance | All maps pass identical options, per-mount defaults are re-applied, and the contract test enforces both |
| Route editor click listener | vis.gl removes it on unmount |
| Traffic layer and polylines | Detached (test assertion) |
| Camera | Refits after reattach (tests and the real SDK check) |
| Blank tiles | None after reattach with the real SDK |
| Two maps mounted at once | Never happens today. A second map would construct a new instance, and the cache would stay bounded |
| React StrictMode in development | The double mount is expected to reuse the map instead of constructing 2. Not verified; production is unaffected |

### 4.2 Limits

- One map load remains for each page load, new tab or PWA launch per user, so cost still grows with users multiplied by launches. A single short visit costs the same as before. The [cost model](../cost/COST_MODEL.md#38-google-maps-platform) uses this rule.
- That a reattached instance is not billed is not verified on Google's side. Compare the Cloud Console Dynamic Maps metric before and after the staging deploy (acceptance case OBS07 treats construction counts as different from billing).
- Not checked with the real SDK: the administrator maps, reuse from the administrator workspace to the passenger workspace, and the desktop viewport. Before a release, check manually: Live Ops, route editor, Live Ops, **Passenger Panel**, open a route, at 390 x 844 and on desktop.
- Firestore and RTDB re-reads after a restart are not addressed (write-up issue 1). A Firestore persistent cache could address them later.

### 4.3 Path to a passenger view without Google Maps

Only the non-Google passenger view proposed in write-up issue 3 removes the remaining per-launch load. Its prerequisites, in order:

1. Move configured-geometry repair and the `onGeometryReady` road path out of `DirectionsRoute` into a hook that does not need a map.
2. Add an SVG `PassengerRouteDiagram` behind a renderer flag, with UX sign-off, environment and [configuration reference](../CONFIGURATION.md) updates, and rewrites of tests and QA maps.

## 5. Alternatives considered

### 5.1 Proposals

Five analyses ran independently. Four were read-only; the fifth measured in its own Git worktree.

| Analysis | Focus | Findings | Proposal |
|---|---|---|---|
| 1 | React and vis.gl lifecycle | RC1 to RC5; an `APIProvider` remount does not reload the script; overlays never recreate the map | Phase 1: `reuseMaps` on all 3 maps and hoisting `<GoogleMap>` above the keyed inner component. Phase 2: SVG passenger diagram behind a flag |
| 2 | Network and caching: SDK loader, Firestore and RTDB, service worker | The script is not refetched but map objects are rebuilt; no data duplication on remount; Firestore uses a memory-only cache, so a restart re-reads | SVG passenger view now, `reuseMaps` for administrators, Firestore persistence in a separate change |
| 3 | GPS and real-time pipeline to the map | Traced every live event that changes the key (bus appears, session start, direction, offline and online, store prune); listed the per-ride state that relies on the remount to reset | A: `reuseMaps` (lowest risk); B: narrower keys with explicit resets; D: extract the ETA pipeline, then SVG |
| 4 | Ownership and minimal change | The keys are a correctness mechanism (buses, ETAs, `focusBus`, `inspectedStopId`, `repairedRoadPath`, camera stage) | `reuseMaps` on all 3 maps, keep every key, fix comments and documents; SVG later, after moving geometry repair out of `DirectionsRoute` |
| 5 | Baseline measurement | Real vis.gl with a counting fake SDK: passenger test file 22 maps, Chromium session 8, admin 5. A temporary `reuseMaps` experiment brought these to 1, 1 and 1 | SVG for passengers and `reuseMaps` for administrators, or `reuseMaps` everywhere if SVG is rejected; listed the tests and QA maps an SVG change would break |

### 5.2 Scoring

Each candidate was scored from 0 to 10 per criterion, then weighted.

| Candidate | Correctness (30 %) | Load reduction (25 %) | Fit with issue 3 and existing behaviour (15 %) | Reliability (15 %) | Simplicity (10 %) | Testability (5 %) | Total out of 100 |
|---|---|---|---|---|---|---|---|
| A1: `reuseMaps` and hoisted map | 8 | 8 | 8 | 6 | 6 | 7 | 74.5 |
| A2: SVG now and administrator `reuseMaps` | 7 | 9 | 6 | 4 | 4 | 6 | 65.5 |
| A3: passenger `reuseMaps` only | 6 | 6 | 7 | 8 | 10 | 6 | 68.5 |
| A4: `reuseMaps` on all 3 maps, keys kept | 8 | 8 | 9 | 8.5 | 9 | 7 | 82.8 |
| A5: SVG and administrator `reuseMaps` (measured) | 7 | 9 | 6 | 4.5 | 4 | 9 | 67.8 |
| J: A4 with the A5 harness as regression tests | 8.5 | 8 | 9 | 9 | 9 | 9 | 86.0 |

### 5.3 Rejected options

| Option | Reason |
|---|---|
| SVG passenger view now (A2, A5) | Replacing the street basemap is a product and UX decision. Configured-geometry repair and the `onGeometryReady` road path that feeds ETAs run inside `DirectionsRoute`, which renders only as a child of a Google map, so swapping the renderer first would silently degrade ETAs. It would also rewrite about 35 `PassengerMap` tests, several end-to-end specs and test names referenced by the QA maps. |
| Hoisting the map above the key (A1) | Forces pointer-handling and overlay changes for no measured gain, because the key change already reattaches the cached map. |
| Keeping hidden panels mounted | Keeps the RTDB subscription, `watchPosition` and timers running off-screen. |
| Leaflet, MapLibre or OpenStreetMap tiles | Needs a new dependency, CSP and service worker changes, and tile hosting. The OpenStreetMap Foundation's public tile servers are best-effort, restrict heavy use and may withdraw access without notice [3]. |

## 6. Evidence

### 6.1 Construction counts

Conditions: the real `@vis.gl/react-google-maps` 1.9.0 `APIProvider` and `Map`; a fake Maps SDK that counts `new google.maps.Map` calls and script injections; the synthetic Firebase fixtures (`e2e/fixtures/state.ts`); Chromium against a Vite build of the fixture app, and the same flows in Vitest with jsdom; the same scripted steps before and after.

| Step (Chromium, one page session) | Before | After |
|---|---|---|
| Open route | 1 | 1 |
| Direction pending to forward | 1 | 0 |
| Direction forward to reverse | 1 | 0 |
| Back, reopen route | 1 | 0 |
| Routes tab, reopen | 1 | 0 |
| Bus disappears | 1 | 0 |
| Bus reappears | 1 | 0 |
| Switch to route B | 1 | 0 |
| Controls: same-session GPS tick, tab hidden and visible, Back alone | 0 | 0 |
| Total maps constructed | 8 | 1 (87.5 % fewer) |
| Full reload and open | 1 | 1 |
| Maps script requests | 1 per page load | 1 per page load |
| Console errors | 0 | 0 |

| Administrator session (Vitest, real `AdminPage`) | Before | After |
|---|---|---|
| Open, Live Ops, Routes, editor, cancel and reopen, Live Ops, Fleet, Live Ops | 5 | 1 |

These are construction counts, not Google billing (acceptance case OBS07).

### 6.2 Real Maps SDK check

Passenger view at a mobile viewport, 5 real map loads in total. One `.gm-style` element and one constructed map per page session across Back and reopen; pending to forward; forward to empty to forward; Profile to Routes and reopen; route A to B to A. After reattach the camera matched a fresh load: preview at zoom 15, follow mode at zoom 16 centred on the bus. Tiles rendered; 0 console errors. The temporary harness that used a real key was deleted afterwards. The administrator and desktop checks were not run.

### 6.3 Test results

An agent independent of the implementer ran the checks.

| Check | Command | Result |
|---|---|---|
| Lint | `npm run lint` | Pass: 0 errors (1 warning already present in an untouched file) |
| Type check | `npx tsc --noEmit -p frontend/tsconfig.json` | Pass |
| Frontend unit and integration | `npm run test --workspace=frontend` | Pass: 98 files, 944 tests (baseline 94 files, 933 tests, plus 4 files, 11 tests) |
| Backend, including the documentation mirror test | `npm run test --workspace=backend` | Pass: 136 files, 1471 tests |
| Documentation mirrors | `npm run docs:sync` | Pass: mirrors regenerated |
| QA maps | `npm run qa:check` | Pass (exit 0; no QA map edits) |
| Contracts | `verify:ui-contracts`, `verify:openapi`, `node --test scripts/*.test.mjs` | Pass (186 of 186) |
| Production build | `npm run build` | Pass. Needed a temporary `turbopack.root` because the worktree's `node_modules` is a junction (environment only, reverted); the generated `firebase.json` CSP change was reverted |
| Passenger progress end-to-end | Playwright | Pass: 10 of 10 |
| Passenger layout end-to-end | Playwright | Pass: 105 of 105 (2 mobile video-audit tests failed once under load and passed on rerun) |
| Admin access end-to-end | Playwright | Pass: 42 of 42 on rerun; upstream `main` shows the same intermittent timeouts |
| Production audit end-to-end | Playwright | Pass: 66 of 66 |
| Flakiness | 4 new files, 3 consecutive runs | Pass: 11 of 11 each time |
| Mutation | Remove `reuseMaps` from one map at a time | Every removal makes that map's load tests and the contract test fail: 8 failures for the passenger map, 3 each for the Live Ops and route editor maps |
| Real SDK, passenger | Temporary harness with the real key | Pass |
| Real SDK, administrator and desktop | None | Blocked: the opt-in `e2e/routing/live-maps` suite needs a Routes API artifact that would cost paid server-side calls |

During testing, two `PassengerWorkspace.mapLoads` tests depended on an earlier test having cached a map. They now create the cached map themselves when run alone.

### 6.4 Review

- Adversarial review, round 1: revise. The reviewer confirmed every cause in the library and application source and showed by its own experiment that a keyed remount reattaches the same instance, because React 19 runs the old map's cleanup (push to cache) before the new map's effect (pop). It confirmed that two maps are never mounted at once and that no test map stub spreads props onto the DOM. Required corrections: R1, tests prove reuse, not only zero constructions; R2, deterministic per-transition deltas; R3, a corrected camera fallback design; R4, a contract test that handles import aliases and multi-line JSX; R5, a test strategy entry stating that counts are constructions, not billing (OBS07); R6, accurate pull request wording; R7, JSX comment placement.
- Round 2: revise, on the test specification only. C1, detect reuse by the element's parent changing on `setOptions`; C2, run the refit test in preview mode and check follow mode with `panTo` and `setZoom(16)`; C3, assert on the reuse `setOptions` call; C4, the administrator overlay test uses the real `DirectionsRoute` with real polylines; C5, track listeners per map. The plan was approved with C1 to C5 applied.
- Final verification: an independent verifier reviewed the diff, the test report, the evidence files and this record. It re-ran the 4 new test files, `PassengerMap.test.tsx` and the administrator suite (12 files, 159 tests passed), ESLint on all changed frontend files, the documentation mirror test (38 of 38) and `git diff --check`. Its first verdict failed the documentation only (double-encoded non-ASCII characters, a byte-order mark in one test file, the timestamp, and the wording of the real SDK scope and StrictMode); these were fixed before commit.

### 6.5 Source repositories

- Upstream repository `notnamansinha/Eki`, base branch `main` at `c4d47b3`; the repository's usual integration branch is `testing`.
- Head repository: the fork `AryanPatelOnGIT/Eki`, branch `codex/issue-2-map-reuse`.
- Merged to `main` as `a8e28d9` through pull request #394.

## 7. References

[1] Google, "Maps JavaScript API usage and billing," https://developers.google.com/maps/documentation/javascript/usage-and-billing. Accessed: 2026-10-30.

[2] Google, "Google Maps Platform API usage details," https://developers.google.com/maps/billing-and-pricing/sku-details. Accessed: 2026-10-30.

[3] OpenStreetMap Foundation, "Tile Usage Policy," https://operations.osmfoundation.org/policies/tiles/. Accessed: 2026-10-30.
