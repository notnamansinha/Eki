# Historical movement and passenger tracking audit: 25 October 2026

| Document ID | Version | Status | Last updated |
|---|---|---|---|
| EKI-EVD-015 | 1.0 | Historical | 2026-10-25 |

PR: https://github.com/notnamansinha/Eki/pull/381. Base: `5e089cc773bcc7287def26e73ab28cfddd763ebf`. Application fixes are in `16f4e9612ca662f08def86850e5f5469493ac793`; the subsequent acceptance mapping correction is `80563eb1415a8302fde3998effd6c61eca522053`.

Software checks described below pass within their stated scopes. Production sign-off remains incomplete: moving hardware, real infrastructure experiments, deployed authenticated acceptance of these changes, and exhaustive interaction coverage remain separate gates. This PR has not been merged or deployed by this audit.

## Verified changes

1. Upcoming live road is blue throughout. Confirmed traveled road is gray. Route-editor previews retain the administrator's selected color.
2. A selected bus's dynamic detour replaces the old configured future road. Confirmed partial progress stays gray while detour geometry loads. Missing geometry withholds route ETA; the matching detour restores it. Session and geometry changes discard retained progress. Fleet views retain configured geometry for other buses.
3. Explicitly poor GNSS quality cannot advance departure or intermediate stop passage, even when a payload says `moving`. The worker retains prior-fix quality so a later valid fix cannot turn an unreliable previous position into stop-crossing evidence. The existing legacy schema compatibility remains; terminal arrival still requires known good HDOP and distinct stopped fixes spanning two seconds.

Each behavior was reproduced before its fix. Palette/detour tests first produced two failures. Quality tests produced six failures in the reducer and real ingestion/listener integration. The affected integration group then passed all 63 assertions. A test-only detour clock reset was separately corrected after the next arrival case exposed backdated capture times. The real Maps test now distinguishes the blue base road from the blue active overlay by actual SDK z-index.

## Archive provenance and replay

`EKI_MASTER_AUDIT_AND_TESTING_ARCHIVE.zip` SHA-256: `b9df9204004790336c5fa4adcfb789c9fe8719bbc6e9ea29e3fcdff65227fb9c`.

The outer archive contains 2,926 files. CRC validation passed, paths were checked, and all 2,925 manifest entries matched actual member sizes. The manifest contains no cryptographic member hashes. Nested archives were not individually validated, and the historical credentials archive was excluded. Historical audit instructions and claimed results were treated as untrusted evidence; archive scripts were not executed.

The selected cloud trace contains 3,551 raw snapshots and 1,782 distinct fixes: 1,213 moving and 569 stationary, covering approximately 13 km over 43.2 minutes. Browser export files largely contain cumulative timing events rather than coordinates. The replay uses actual GNSS capture times and removes duplicate snapshots before processing.

Coordinates and geometry were translated to an anonymous origin, identities replaced, and clocks rebased. The maximum adjacent-distance projection difference was 0.061 m; exact independent spherical coordinates were used for the 2.5 m boundary assertions. Original coordinates, raw logs, credentials and private fixtures remain in ignored local artifacts and are excluded from the PR.

The full trace passed through the actual payload parser, telemetry reducer, trip reducer and route matcher for both main and candidate. All recorded-fix ingress and map-matching decisions agreed. Candidate ingestion held two implausible moving samples and rejected all 1,782 duplicate deliveries. Configured-road classifications were 1,606 ON_ROUTE, 112 POSSIBLE_OFF_ROUTE and 64 OFF_ROUTE; this offline replay did not call a routing provider.

The historical journey correctly remained active at next-stop index 2. Its closest recorded approach to that next stop was 3.71 m, outside the specified 2.5 m arrival circle. Recorded movement is not evidence that every stop was reached. The injected poor-HDOP fault advanced the stop on main and was correctly rejected by the candidate.

Simulation stayed in pure functions and owned `demo-eki-qa` Firebase emulators. It never overwrote the connected GNSS, production bus coordinates, live service, ngrok configuration or cloud database. Accelerated offline replay is not a physical moving-receiver or real-time latency test.

## Executed checks

| Scope | Observation |
| --- | --- |
| Primary automated suites | 159 script tests, 1,273 backend tests, 788 frontend tests: 2,220 passed. The 73 emulator cases skipped by the unit command ran separately. |
| Historical/fault replay | 19 passed, including all 1,782 ingress and road-matching comparisons, duplicate rejection, exact arrival boundaries, stale/future fixes, parallel-road and jump rejection, ordered stops and reliable terminal confirmation. |
| Seeded GNSS campaign | Three seeds; 15 observed tests per seed, with 400 generated runs per property where configured. |
| Reviewed unit/integration evidence | 594 passed; includes the real ingestion/listener quality regression with in-memory datastore adapters. |
| Firebase integration and rules | 73 passed against actual loopback Auth/Firestore/RTDB emulators. Includes current admin authorization, lifecycle fencing, lock recovery and projection ordering. |
| Protected HTTP authorization | 8 passed, recording 179 HTTP requests across role, payload and context partitions. |
| Authenticated device-to-passenger browser flow | 44 mobile/desktop executions. Includes real device HTTP ingestion, versioned detour publication, preserved next stop, public projection and destination ETA. Maps/Routes responses are synthetic in this suite. |
| Passenger progress browser suite | 10 passed: forward/reverse arrival boundaries, destination dropdown ETAs, gray/blue road, detour pending/ready/rejoin, silence and recovery. |
| Additional browser suites | 32 admin, 27 production-audit fixture, 9 passenger layout and 2 shared marker executions passed. Includes narrow screens, CPU throttling and unavailable/recovering data. |
| Real Google Maps SDK | 2 passed: phone controls, actual tiles, directional road geometry, marker placement, camera behavior, stop progression and old-revision rejection. Uses cached two-direction provider geometry and current SDK/tiles; no new live Routes request was claimed. |
| Full Next production export | Strict build, TypeScript, service worker and CSP/backend contract passed with CI placeholder configuration. Six mobile/desktop guest-boot checks passed for home, passenger and admin; this is separate from authenticated cloud acceptance. |
| Firmware native suite | 85 passed; no physical receiver reset, flashing, battery or radio experiment. |
| Selective mutation | Payload module: 266 mutants; 257 killed, 9 survived, no timeout or uncovered mutant. Score 96.62%, above configured threshold. The nine survivors remove redundant type checks that downstream finite/integer or set-membership checks still enforce. This is a selective module result. |
| Bounded admission workload | Five independent trials, 1,250,000 total submissions; FIFO, recovery and retained-heap bounds passed. This is not an hours-long endurance or fleet-latency test. |
| Static and dependency gates | Lint, OpenAPI/UI contracts, acceptance catalog, changed-source coverage budget, runtime and complete dependency audits passed; both dependency audits reported zero vulnerabilities. |

All six required campaigns were accepted at clean source `80563eb1415a8302fde3998effd6c61eca522053`. The combined software harness gate passed. Its complete acceptance-plan ledger contains 150 PARTIAL, 6 NOT_RUN and 243 NOT_COVERED cases, with no failed or blocked executed sub-oracles; it explicitly retains NOT_RELEASE_READY. The separate browser suites total 132 executions across the environments above.

Evidence snapshots carry their actual source revisions. Browser and performance checks of unchanged modules may precede the final mapping-only commit; no later application change is inferred from a documentation/comment commit. Counts from overlapping reviewed/property suites are not added to the 2,220 primary-test total.

## A/B scope

The main/candidate comparison is a paired engineering replay, not a randomized user-traffic experiment. An additional AB01 run exercised the actual smoothing hook in eight counterbalanced pairs at 16/33/50/80 ms frame intervals. A 120 ms candidate settled sooner than 250 ms with no overshoot or callbacks retained after unmount. Production smoothing remains 250 ms because field jitter and perceived comfort were not established.

For AB06, the actual publisher emulator workload compared 20 identical fixes in fleet versus selected-route streams: 78,611 decoded application bytes across 80 fleet events versus 14,734 bytes across 40 selected-route events, an 81.26% reduction in this workload. Unrelated-route isolation also passed. Protocol overhead, independent-client sampling, confidence intervals and real network cost are not inferred from this workload.

AB02 batching has bounded queue/load evidence but no locked candidate-versus-control experiment. AB03 geographic region migration, AB05 radio cadence/battery, and real-user power/MDE analysis were not run. AB04 geometry-cache, AB07 Places-cache and AB08 route-save experiments have functional/fault evidence, but their complete causal performance protocols remain unexecuted. No experiment changed production traffic, infrastructure region, radio cadence or smoothing settings.

## Remaining release gates

- A moving physical GNSS road test: field accuracy inside a 2.5 m circle, sustained movement, real road departure/detour/rejoin, receiver interruption/reacquisition and terminal dwell. Stationary GNSS cannot prove these conditions.
- Authenticated acceptance after merging/deploying this version, including the actual laptop/ngrok backend, real Maps/Routes quota and billing behavior, and mobile network/offline conditions. The previously owner-confirmed visibility on localhost and hosted passenger views predates these changes.
- Complete the per-control interaction matrix. The fresh AST census found 173 candidates in 42 JSX/TSX files. The strict ledger reconciles every candidate with zero evidence errors; four detailed browser records pass, while 170 candidates lack individual action records. Broad flow suite results are listed separately. The coverage gate remains incomplete.
- Real infrastructure A/B protocols, physical radio/battery testing, long-duration endurance, deployment security/App Check and remaining acceptance-plan partitions. A green software campaign does not certify all 351 feature cases, 40 matrix cases and eight experiment protocols.

The device's canonical assigned route determines automatic service admission. Proximity governs road matching and ordered stop passage; a detour does not silently reassign the bus to another catalog route.

Private reproducibility artifacts are under `artifacts/qa/historical-motion-audit/`, with suite reports under `artifacts/qa/`. They include archive integrity/provenance, anonymized replay, exact source comparisons, red/green logs, A/B measurements, browser screenshots, control census and the incomplete coverage ledger.
