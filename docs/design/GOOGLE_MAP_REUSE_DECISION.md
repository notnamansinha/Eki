# Issue #2: reuse Google Map instances across passenger and admin remounts

Last updated: 2026-10-29 15:35 IST (UTC+05:30).

## 1. Executive summary

Google bills a Maps JavaScript "map load" every time a `google.maps.Map` is constructed. Before this change the app constructed a new map on almost every UI transition. On the passenger side that meant opening a route, Back and reopen, switching route, the ride direction resolving, a bus appearing or disappearing, choosing another bus, and switching tabs. On the admin side it meant every Live Ops visit and every route-editor open.

The cause is that none of the three `<GoogleMap>` elements set `@vis.gl/react-google-maps`'s `reuseMaps` option. Every React unmount or key change therefore threw the instance away and built a new one.

This change adds `reuseMaps` to all three maps. It keeps every React key and mount gate, because those still reset per-ride state correctly. The library now reattaches one cached instance per page session instead of constructing another.

Measured with the real vis.gl library against a counting fake Maps SDK:

| Session | Maps constructed before | After |
|---|---|---|
| Scripted passenger session in Chromium | 8 | 1 |
| Scripted admin session | 5 | 1 |

A real Google SDK check of the passenger view, at a mobile viewport, confirmed one map per page session, the camera matching a fresh load, tiles rendering, and no console errors.

This is the "if the Google Map stays for passengers" mitigation listed in Issue #3, not the full non-Google passenger view. One map load per page load or PWA launch remains (§13).

## 2. Requirements

- **Issue #2 (primary).** Google Maps loads are billed every time a map opens.
  - Admin: Dashboard and Route Management maps are rebuilt on every open.
  - Passenger: the map is re-created on open, close/reopen, route switch, direction change, a bus appearing, and tab switch.
  - A full app restart costs the most.
  - Cost grows with users × how often maps open.
- **Issue #3 (guidance).** Keep Google for admins.
  - For passengers, it prefers a non-Google pre-rendered or SVG route view with the live bus drawn on top.
  - If the Google Map stays for passengers, its mitigations are to keep one map open, change only overlays, and turn on `reuseMaps`.
  - Google imagery must not be cached or re-served.
- **Issue #1** (how data reaches the panels) was **excluded**. Nothing in this change touches Firestore, RTDB listeners or the live-bus feed.

## 3. Root cause analysis

Verified in source and in `node_modules/@vis.gl/react-google-maps` 1.9.0 `dist/index.modern.mjs`:

- **RC1: no instance reuse.**
  - In `useMapInstance`, a cached map is popped only when `reuseMaps && CachedMapStack.has(cacheKey)`. Otherwise it runs `new google.maps.Map(mapDiv, …)`.
  - On unmount the map is pushed back to the cache only when `reuseMaps` is set. Otherwise it is discarded with `clearInstanceListeners`.
  - `reuseMaps` appeared nowhere in `frontend/src`.
- **RC2: passenger remount key.**
  - `frontend/src/components/maps/PassengerMap.tsx` keys `PassengerMapInner` on `` `${route.id}:${route.rideDirection}:${preview ? "preview" : "ride"}:${selectedBusKey ?? "all"}` ``, and that subtree contains the `<GoogleMap>`.
  - The key changes when:
    - the route changes;
    - the direction resolves (`preview = !directedRoute` in `PassengerWorkspace.tsx`);
    - the selected bus changes, i.e. a bus appears or disappears, goes offline, starts service, or the passenger picks another.
- **RC3: tracking gates.** `PassengerWorkspace.tsx` mounts the map only for `visibleView === "tracking"` and `!endedMessage && mapRoute && targetStop`. Back, the Profile/Routes tabs and ride end all unmount it.
- **RC4: admin tabs.** `app/admin/page.tsx` renders only the active panel inside `<AdminPanelErrorBoundary key={activeTab}>`. Each Live Ops visit (`DashboardPanel.tsx`) and each route-editor open (`RouteManagementPanel.tsx`, `RouteEditor`) mounted a new map.
- **RC5: stale design statements.**
  - `config/maps.ts` said "APIProvider is mounted once at the root, so a user session counts as one map load".
  - `docs/design/LOW_LEVEL_DESIGN.md` said "Single Maps API provider/load per workspace".
  - Both were false.

Things that are **not** causes:
- The SDK script loads once per page, because the loader state is module-global. Remounting `APIProvider` does not reload it.
- Markers, polylines, camera moves and live GPS ticks never construct a map (measured 0).
- A map remount does not re-subscribe RTDB, because `PassengerWorkspace` holds the route-scoped live store.

## 4. Five-agent investigation

Five independent analysis agents ran concurrently. Agents 1–4 were read-only. Agent 5 had its own isolated git worktree so it could measure.

| Agent | Focus | Key findings | Proposal |
|---|---|---|---|
| 1. Frontend and map lifecycle | React and vis.gl lifecycle | RC1–RC5; `APIProvider` remount doesn't reload the script; overlays never recreate the map | Phase 1: `reuseMaps` on all 3 maps, plus hoisting `<GoogleMap>` above the keyed inner component. Phase 2: SVG passenger diagram behind a flag |
| 2. Network and caching | SDK loader, Firestore/RTDB, service worker | The script isn't refetched but map objects are; no data duplication on remount; Firestore uses a memory-only cache (restart re-reads) | SVG passenger view now, `reuseMaps` for admin, Firestore persistence as a separate PR |
| 3. GPS and real-time | Live pipeline → map | Traced every live event that flips the key (bus appears, session start, direction, offline↔online, store prune); listed the per-ride state that relies on the remount to reset | A: `reuseMaps` (lowest risk); B: narrower keys with explicit resets; D: extract the ETA pipeline, then SVG |
| 4. Architecture and state | Ownership, minimal change | The keys are a correctness mechanism (buses, ETAs, `focusBus`, `inspectedStopId`, `repairedRoadPath`, camera stage) | `reuseMaps` on all 3 maps, **keep every key**, fix comments and docs; SVG later, after moving geometry repair out of `DirectionsRoute` |
| 5. Performance and testing | Baseline measurement | Real vis.gl with a counting fake SDK: passenger file 22 maps, Chromium session 8, admin 5. A temporary `reuseMaps` experiment brought these to 1 / 1 / 1 | SVG for passengers plus `reuseMaps` for admin, or `reuseMaps` everywhere if SVG is rejected; listed the tests and QA maps an SVG change would break |

## 5. Judge decision

Each candidate was scored 0–10 per criterion, then weighted.

| Candidate | Correctness (30%) | Load reduction (25%) | Fit with #3 and existing behaviour (15%) | Reliability (15%) | Simplicity (10%) | Testability (5%) | Total /100 |
|---|---|---|---|---|---|---|---|
| A1: `reuseMaps` + hoist map | 8 | 8 | 8 | 6 | 6 | 7 | 74.5 |
| A2: SVG now + admin `reuseMaps` | 7 | 9 | 6 | 4 | 4 | 6 | 65.5 |
| A3: passenger `reuseMaps` only | 6 | 6 | 7 | 8 | 10 | 6 | 68.5 |
| A4: `reuseMaps` ×3, keep keys | 8 | 8 | 9 | 8.5 | 9 | 7 | 82.8 |
| A5: SVG + admin `reuseMaps` (measured) | 7 | 9 | 6 | 4.5 | 4 | 9 | 67.8 |
| **J: A4 + A5's harness as regression tests** | 8.5 | 8 | 9 | 9 | 9 | 9 | **86.0** |

**Selected: J.** It means `reuseMaps` on the three `<GoogleMap>` sites, every React key and mount gate kept, the stale comments and docs corrected, and counting regression tests plus a source contract test.

Why the others were not chosen:
- **SVG now (A2/A5).**
  - Replacing the street basemap is a product and UX decision.
  - It hides a correctness trap: configured-geometry repair and the `onGeometryReady` road path that feeds ETAs run inside `DirectionsRoute`, which only renders as a child of a Google map. Swapping the renderer first would silently degrade ETAs.
  - It would also rewrite about 35 `PassengerMap` tests, several e2e specs and test names referenced by the QA maps.
- **Hoisting the map above the key (A1).** It forces pointer-handling and overlay changes for zero measured gain, because the key change already reattaches the cached map.
- **Keeping hidden panels mounted.** It would keep the RTDB subscription, `watchPosition` and timers running off-screen.
- **Leaflet/MapLibre/OSM.** These need a new dependency, CSP and service-worker changes, and tile hosting. Public OSM tiles are disallowed by their usage policy.

## 6. Adversarial verification

- **Round 1: REVISE.**
  - The verifier confirmed every root-cause claim in the library and app source.
  - It ran its own experiment: a keyed remount reattaches the same instance, because React 19 runs the old map's cleanup (push to cache) before the new map's effect (pop).
  - It confirmed no two maps are ever mounted at once, and that none of the e2e/vitest map stubs spread props onto the DOM, so there are no unknown-prop warnings.
  - Corrections required:
    - R1: tests must prove reuse, not just "0 constructed";
    - R2: deterministic per-transition deltas;
    - R3: the camera fallback design was wrong;
    - R4: the contract test must handle import aliases and multi-line JSX;
    - R5: a `TEST_STRATEGY.md` entry stating these are construction counts, not billing (OBS07);
    - R6: honest PR wording;
    - R7: JSX comment placement.
- **Round 2: REVISE**, on the test spec only:
  - C1: detect reuse by the div's parent changing on `setOptions`;
  - C2: run the refit test in preview mode, and check follow mode with `panTo` + `setZoom(16)`;
  - C3: assert on the reuse `setOptions` call;
  - C4: the admin overlay test must use the real `DirectionsRoute` with real polylines;
  - C5: listeners must be tracked per map.
  - The verifier said no third round was needed once these were applied.
- **Final plan:** approved with C1–C5 applied.

## 7. Implementation details

- `reuseMaps` was added to `PassengerMap.tsx` (`<GoogleMap>` in `PassengerMapInner`), `DashboardPanel.tsx` and `RouteManagementPanel.tsx` (`RouteEditor`).
- All three already share `mapId={MAPS_MAP_ID}` and spread `MAP_OPTIONS`. They set no `renderingType` or `colorScheme`, so they share one vis.gl cache key.
- On remount, vis.gl pops the cached instance, moves its div into the new container, re-applies options (including that mount's default centre and zoom), and forces a re-layout.
- The keyed `PassengerMapInner` still remounts, so per-ride React state still resets. Only the Google instance is recycled.
- Overlays already detach themselves on unmount (`setMap(null)` for `DirectionsRoute` polylines and `TrafficLayer`; marker cleanup; vis.gl removes event listeners), so nothing leaks onto a reused instance.
- Comments now state the real policy, in `config/maps.ts`, `MapProviders.tsx` and `PassengerTrackingMap.tsx`.

## 8. Files changed

| File | Reason |
|---|---|
| `frontend/src/components/maps/PassengerMap.tsx` | `reuseMaps` on the passenger map, plus an explanatory comment |
| `frontend/src/components/admin/DashboardPanel.tsx` | `reuseMaps` on the Live Ops map |
| `frontend/src/components/admin/RouteManagementPanel.tsx` | `reuseMaps` on the route-editor map |
| `frontend/src/config/maps.ts` | Corrected billing and reuse policy comment (constructions; shared cache key; keep options in `MAP_OPTIONS`) |
| `frontend/src/components/MapProviders.tsx`, `frontend/src/components/maps/PassengerTrackingMap.tsx` | Corrected comments |
| `frontend/src/test-support/fakeGoogleMapsSdk.ts` (new, test-only) | Fake Maps SDK that hooks vis.gl's real script bootstrap and records constructions, reuses (div parent change on `setOptions`), teardowns, script loads, camera calls, overlay `setMap` history and per-map listeners |
| `frontend/src/components/maps/PassengerMap.mapLoads.test.tsx` (new) | First open = 1 map and 1 script; reuse across bus, preview, direction and route changes; preview re-centre and refit; follow mode `panTo` + `setZoom(16)`; a GPS tick neither constructs nor reattaches |
| `frontend/src/components/passenger/PassengerWorkspace.mapLoads.test.tsx` (new) | Back/reopen, Profile/Routes, route switch, direction resolution, bus disappearance/reappearance, service start, bus picker: 0 constructions, each reattaching the same instance |
| `frontend/src/components/admin/AdminMapLoads.test.tsx` (new) | Live Ops → Routes → editor → cancel → editor → Live Ops → Fleet → Live Ops builds 1 map; traffic and route overlays and listeners detach from the cached instance |
| `frontend/src/config/maps.reuse.test.ts` (new) | Contract test using the TypeScript AST: every vis.gl `Map` element (any alias or namespace) sets `reuseMaps`, `mapId={MAPS_MAP_ID}` and `{...MAP_OPTIONS}`, with no `renderingType` or `colorScheme`; at least 3 matches |
| `docs/design/LOW_LEVEL_DESIGN.md` | Corrected the `MapProviders` row |
| `docs/testing/TEST_STRATEGY.md` | Added the map-load counter entry (construction counts, not billing) |
| `summary.md`, `docs/repository/summary.md` | This document and its generated mirror |

## 9. Map performance optimization

- **What caused the unnecessary loading:** every React unmount or key change of a `<GoogleMap>` constructed a new instance (RC1–RC4).
- **What changed:** with `reuseMaps`, an unmount pushes the instance to vis.gl's module-level cache, and the next mount with the same cache key pops it. This happens instead of `new google.maps.Map`.
- **How repeated initialization is avoided:**
  - The cache key `mapId:renderingType:colorScheme` is the same for all three maps.
  - So the passenger map, the Live Ops map and the route editor all reattach one instance within a page session, including when navigating between them in the app.
  - The cache is bounded by how many maps are mounted at once. The app mounts at most one.
- **Redundant requests:** the Maps script was already loaded only once per page and remains so.
  - A reattached map avoids map initialisation.
  - The real-SDK check saw the map setup requests (`api/js`, `mapConfigs:batchGet`, `gen_204`) once per page load.
  - Firestore and RTDB traffic is unchanged; that is Issue #1 territory.
- **GPS accuracy:** live subscriptions, marker selection, smoothing, ETAs and progress are untouched. The keyed inner component still resets per ride context, so no state from a previous route or session leaks through.
- **Resource cleanup:**
  - Overlays and listeners detach on unmount; the admin test asserts this against real polylines and a real traffic layer.
  - One detached map instance stays in memory for the page lifetime. This is bounded, and it is the price of avoiding new loads.

## 10. Before/after performance

**Test conditions.**
- Real `@vis.gl/react-google-maps` 1.9.0 `APIProvider`/`Map`.
- A fake Maps SDK that counts `new google.maps.Map` calls and script injections.
- Synthetic Firebase fixtures (`e2e/fixtures/state.ts`).
- Chromium against a Vite build of the fixture app, and the same flows in vitest/jsdom.
- The same scripted steps before and after.

| Step (Chromium, one page session) | Before | After |
|---|---|---|
| Open route | 1 | 1 |
| Direction pending → forward | 1 | 0 |
| Direction forward → reverse | 1 | 0 |
| Back, reopen route | 1 | 0 |
| Routes tab, reopen | 1 | 0 |
| Bus disappears | 1 | 0 |
| Bus reappears | 1 | 0 |
| Switch to route B | 1 | 0 |
| Same-session GPS tick, tab hidden/visible, Back alone (controls) | 0 | 0 |
| **Total maps constructed** | **8** | **1 (−87.5%)** |
| Full reload + open | 1 | 1 |
| Maps script requests | 1 per page load | 1 per page load |
| Console errors | 0 | 0 |

| Admin (vitest, real `AdminPage`) | Before | After |
|---|---|---|
| Open, Live Ops → Routes → editor → cancel/reopen → Live Ops → Fleet → Live Ops | 5 | 1 |

**Real Google SDK check (passenger, mobile viewport, 5 real map loads in total).**
- 1 `.gm-style` element and 1 map constructed per page session across:
  - Back/reopen
  - pending → forward
  - forward → empty → forward
  - Profile → Routes → reopen
  - route A → B → A
- After reattach the camera matches a fresh load: preview at zoom 15; follow mode at zoom 16, centred on the bus.
- Tiles rendered; 0 console errors.

**Limitations.**
- These are construction counts, not Google billing (OBS07). Confirm with the Cloud Console Dynamic Maps metric after deploying.
- The admin real-SDK check and the desktop viewport were not run (§13).

## 11. Testing report

The test agent was independent of the implementer.

| Check | Command | Result |
|---|---|---|
| Lint | `npm run lint` | PASS: 0 errors (1 warning already present in an untouched file) |
| Typecheck | `npx tsc --noEmit -p frontend/tsconfig.json` | PASS |
| Frontend unit and integration | `npm run test --workspace=frontend` | PASS: 98 files / 944 tests (baseline 94 / 933, plus 4 files / 11 tests) |
| Backend, including the docs mirror test | `npm run test --workspace=backend` | PASS: 136 files / 1471 tests |
| Docs mirrors | `npm run docs:sync` | PASS: mirrors regenerated |
| QA maps | `npm run qa:check` | PASS (exit 0; no QA map edits) |
| Contracts | `verify:ui-contracts`, `verify:openapi`, `node --test scripts/*.test.mjs` | PASS (186/186) |
| Production build | `npm run build` | PASS: needed a temporary `turbopack.root` because the worktree's `node_modules` is a junction (environment only, reverted); the generated `firebase.json` CSP churn was reverted |
| e2e passenger-progress | Playwright | PASS 10/10 |
| e2e passenger-layout | Playwright | PASS 105/105 (2 mobile video-audit tests failed once under load; passed on rerun) |
| e2e admin-access | Playwright | PASS 42/42 on rerun; upstream `main` shows the same intermittent timeouts |
| e2e production-audit | Playwright | PASS 66/66 |
| Flakiness | 4 new files, 3 consecutive runs | PASS: 11/11 each time |
| Mutation proof | Remove `reuseMaps` from one map at a time | Every removal makes that map's load tests and the contract test fail. Passenger removal: 8 failures. Dashboard or editor removal: 3 failures each |
| Real SDK, passenger | Temporary harness with the real key (since deleted) | PASS |
| Real SDK, admin and desktop | — | **BLOCKED**: the opt-in `e2e/routing/live-maps` suite needs a Routes API artifact that would cost paid server-side calls |

**Fix during testing.** The testing agent found that two `PassengerWorkspace.mapLoads` tests depended on the first test having cached a map. They now create the cached map themselves when run alone.

## 12. Reliability and compatibility

Unchanged:
- every React key and mount gate;
- `MAP_OPTIONS` and `mapId`;
- the service worker (Maps stays network-only, so no Google imagery is cached);
- CSP and dependencies;
- QA maps and existing test names.

Edge cases checked:
- **Options left over on a reused instance.** All maps pass identical options; per-mount defaults are re-applied; the contract test enforces it.
- **Route-editor click listener.** vis.gl removes it on unmount.
- **Traffic layer and polylines.** They detach (test asserted).
- **Camera.** It refits after reattach (tests plus the real-SDK check).
- **Blank tiles.** None after reattach with the real SDK.
- **Two maps mounted at once.** Never happens today. If it did, the second would construct a new map, and the cache would stay bounded.
- **StrictMode in development.** The double mount is expected to reuse the map instead of constructing 2 (not verified; production is unaffected).

## 13. Known limitations

- **Remaining cost.** One map load per page load, new tab or PWA launch per user, so cost still grows with users × launches. A single short visit costs the same as before.
  - Only Issue #3's non-Google passenger view removes this. Prerequisites, in order:
    1. move configured-geometry repair and the `onGeometryReady` road path out of `DirectionsRoute` into a hook that doesn't need a map;
    2. an SVG `PassengerRouteDiagram` behind a renderer flag, with UX sign-off, env/`docs/CONFIGURATION.md` updates and test/QA-map rewrites.
- **Not addressed:** Firestore and RTDB re-reads on restart (Issue #1 territory; a Firestore persistent cache is possible later).
- **Billing.** That a reattached instance is not billed is not verified on Google's side. Compare the Dynamic Maps metric before and after the staging deploy.
- **Not checked with the real SDK:** admin maps, admin → passenger reuse, and the desktop viewport. Do a manual check before release: Live Ops → route editor → Live Ops → Passenger Panel → open route, at 390×844 and on desktop.

## 14. Final verification

An independent final verifier reviewed the diff, the testing report, the evidence files and this document.

- It re-ran the 4 new test files, `PassengerMap.test.tsx` and the admin suite (12 files / 159 tests passed), eslint on all changed frontend files, the docs mirror test (38/38) and `git diff --check`.
- It found Issue #2 addressed as claimed, Issue #3's mitigation applied, Issue #1 untouched, the code matching the approved design, every performance number backed by an evidence file, and no secrets or debug code.
- **First verdict: FAIL**, on documentation only. Non-ASCII characters in this file had been double-encoded. It also raised minor items: a byte-order mark in one test file, the timestamp, and two wording points (the real-SDK scope and StrictMode).
- All of those were fixed before commit.

## 15. GitHub details

- Feature branch: `codex/issue-2-map-reuse`, based on upstream `notnamansinha/Eki` `main` at `c4d47b3`.
- Upstream repository: `notnamansinha/Eki`; PR base branch: `main`, as the task requested. The repository's usual integration branch is `testing`.
- Head repository: the fork `AryanPatelOnGIT/Eki`.
- The commit hash and PR URL are reported in the pull request and the final hand-off; they cannot be known while this file is being committed.
- Status: implemented and tested. The admin and desktop real-SDK checks remain manual.
