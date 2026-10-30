# Passenger GPS progress regression

| Document ID | Version | Status | Last updated |
|---|---|---|---|
| EKI-EVD-033 | 1.0 | Historical | 2026-10-21 |

Implementation base: `testing` at `371eb7d9d07c8a2e43c42125a53cbc12115d28a4`.

## Result

The destination and boarding selectors receive the map's ETA publication, scoped to route coordinates/revisions, bus/session, direction and active bus route version. Every stop has either an estimate or an explicit unavailable label. Server-confirmed passed stops display `Passed` and are grey on the map. Switching buses invalidates estimates immediately; telemetry silence clears countdowns and fresh delivery restores them.

The configured road remains green ahead of the active leg. Covered road is grey and the active section blue. Partial-leg coverage uses a confident accepted match on the same geometry and cannot pass the server's next required stop. Dynamic reroutes retain the configured route's confirmed covered prefix. Unknown or fleet-wide progress never certifies a shared completed distance.

The passenger map renders one positional glyph per visible bus. The passenger-location dot and bus-status dot are removed; browser location remains available internally for walking estimates. The map pane has its own stacking context so notices cannot cover an open stop selector.

A pending ride can resolve a missed stopped-endpoint fix from sustained credible moving evidence on the first directed road leg. The backend requires three or more fresh samples spanning at least 30 metres, ordered progress, good HDOP, close road alignment and exactly one qualifying travel direction. Proof is bounded, session/revision scoped and cleared on poor evidence. The existing durable direction transaction and ordered stop/terminal-dwell engine remain authoritative.

## Reproduce

From the repository root:

```powershell
npm run verify
npm run test:rules
npm run test:e2e:admin
npx playwright test --config playwright.passenger-progress.config.ts
npx playwright test --config playwright.passenger-layout.config.ts
npx playwright test --config playwright.production-audit.config.ts
```

The new progress browser regression mounts the production `PassengerMap`, `DirectionsRoute`, `PassengerBoardingView` and `InAppSelect`. Realtime delivery and Google Maps constructors are synthetic adapters. It observes ETA text, passed labels, the three road colours, marker count, dropdown occlusion, telemetry silence and fresh-fix recovery at mobile and desktop sizes. Separate workspace regression checks ensure that map estimates reach boarding and disappear when switching buses.

The backend regression uses actual authenticated ingestion, direction processing and trip lifecycle code with in-memory Firebase adapters. An armed pending session receives three moving first-leg fixes, resolves direction, departs, then records the intermediate stop once and publishes the terminal as the next required stop. Additional tests reject stale/out-of-order samples, jitter, jumps, competing directions and an unobserved intermediate stop.

## Observed verification

| Check | Observation |
|---|---|
| Lint | Frontend and backend passed. |
| Repository script/contract tests | 146 passed; OpenAPI and UI source contracts passed. |
| Backend suite | 1,246 passed; 59 opt-in tests skipped in the default unit run. |
| Frontend suite | 713 passed with `--maxWorkers=2 --testTimeout=15000`; latest affected component regressions also passed separately. |
| Production build | Strict build with CI placeholder configuration passed, including export, service-worker generation, CSP generation and web/backend CSP contract. |
| Runtime dependency audit | Zero vulnerabilities with `--omit=dev --omit=optional`. |
| Passenger progress browser regression | Both mobile and desktop passed. |
| Passenger layout browser regression | Six passed across narrow, mobile and desktop viewports, including dropdown occlusion checks. |
| Admin access browser regression | 24 passed. |
| Existing production-audit browser regression | All 27 unique project cases observed passing; mobile was rerun successfully after an initial timing failure during concurrent verification. |
| Targeted Firebase persistence regression | Actual SDK/emulator test for pending departure passed; four unrelated tests in that file were intentionally excluded by the name filter. |
| Broad emulator campaign | Blocked by the fixed local runner deadline; it also hit a 30-second aggregation-test timeout. This is not a passing full-emulator claim. |

Windows verification initially encountered Java's Unix-domain selector socket failure. A process-local `jdk.net.unixdomain.tmpdir` pointing to an absent directory made the JDK fall back to working TCP loopback sockets; no machine-wide settings or application Java configuration were changed. The successful targeted test used copied rules, disposable demo emulators and the repository's network guard. Earlier concurrent frontend campaigns hit five-second timing limits in unrelated admin tests; the final suite used the explicit worker and timeout settings above, without changing production timeouts.

## Screenshots

These use synthetic coordinates and adapters, not field captures or the Google Maps SDK.

![Mobile destination estimates and covered road](assets/passenger-gps-progress/mobile.png)

![Desktop destination estimates and covered road](assets/passenger-gps-progress/desktop.png)

## Limits

This does not establish live provider/network recovery or physical GNSS accuracy. Starts after an unobserved intermediate stop and ambiguous geometry remain pending; return to an endpoint instead of manufacturing stop history. Existing active-ride route-edit guards still apply. No firmware was flashed and no application deployment or physical ride was performed.
