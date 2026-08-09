# Test strategy and failure matrix

## Quality gates

Run from the repository root:

```powershell
npm run verify
& "$env:USERPROFILE\.platformio\penv\Scripts\platformio.exe" test -d hardware -e native
& "$env:USERPROFILE\.platformio\penv\Scripts\platformio.exe" run -d hardware
```

`verify` executes frontend/backend ESLint, Vitest, backend TypeScript, Next static production build, Workbox injection, CSP hash regeneration and `npm audit --omit=dev --omit=optional`. The firmware command compiles the real ESP32 target. A production release additionally runs `npm run build:production` with actual deployment variables; it intentionally fails closed when required public configuration is missing.

Last verified 2026-08-09 on the PR #53 candidate: 143 backend tests passed with six emulator-only cases skipped in the normal run, 43 frontend tests passed, and the Java-backed Firestore/RTDB emulator run passed all 149 backend tests. The normal backend/frontend production build and generated CSP passed, and the production dependency audit reported zero vulnerabilities. Firmware evidence is recorded separately after building the exact candidate commit. Re-run rather than trusting these historical numbers.

## Test layers

| Layer | Existing coverage | What it proves |
|---|---|---|
| Pure backend units | telemetry schema, scrypt/auth header, latency summaries, route direction/via, reducer/geofence, lifecycle normalization/draining, abandoned decision, deletion | Deterministic correctness and boundaries |
| Backend lifecycle mocks | worker listener recovery, missing-route cache, completion/shutdown | Async orchestration without cloud dependency |
| Static security/deployment checks | rules/headers/routes/cache/cleanup patterns | Critical configuration does not silently regress |
| Firebase emulator integration | Firestore/RTDB allow/deny matrix | Actual rule evaluation when Java/emulators are available |
| Pure frontend units | freshness/expiry, singleton RTDB store, resume state, snapping/distance, history, feedback eligibility | Map/live-data behavior independent of React/browser network |
| Builds/type/lint | TS, React hooks/a11y-relevant lint, static export, SW/CSP | Integration and packaging consistency |
| Dependency audit | production npm graph | Known registry advisories in shipped required packages |
| Firmware native units | shared telemetry policy | Distance/heading math, hysteresis, retry cap, change floor/thresholds and heartbeats |
| Firmware compile | pinned PlatformIO ESP32 target | API/library compatibility, binary size |
| Physical acceptance | runbooks below | Radio, GNSS, power, TLS, public path and human workflows |

## Automated backend cases

### Device ingestion

- Authorization accepts only `Device ` and a 20–512 character secret.
- Secret hashing is salted scrypt, nondeterministic, plaintext-free and mismatch-safe.
- Body is at most 512 bytes, exact six fields, finite/ranged coordinate/speed/heading, enumerated motion, and fresh timestamp.
- Duplicate/older RTDB timestamp is idempotent; new timestamp commits.
- Invalid/disabled/unknown device and invalid bus/route binding fail.
- Positive/negative credential caches and device/IP limits are bounded.
- Durable ride restore coalesces work and does not delay accepted HTTP response.
- Rolling latency summary handles empty/unsorted values and nearest-rank percentiles.

### Lifecycle and concurrency

- Pre-departure does not start away from origin.
- Origin activation requires ordered geofence evidence.
- Only the next stop advances; downstream visits cannot skip.
- Segment crossing detects a pass between two fixes.
- GNSS uncertain does not advance lifecycle.
- Final stop yields completed exactly once.
- Timestamp normalization handles Firestore, dates, seconds and milliseconds.
- Stale reconciliation preserves recent/mismatched/unknown-activity sessions and interrupts only rechecked stale sessions.
- Completion and cleanup compare `sessionId`; old handlers cannot overwrite a newer RTDB session or delete its recovery/lock.
- Start uses deterministic `_active_bus_locks/{busId}` to serialize same-bus routes. This needs an emulator/API concurrency test in CI in addition to code/unit checks.
- Shutdown drains queues and immediately runs pending completion retirement.

### Routes, privacy and retention

- Stored route segment works forward/reverse, orders stops, rejects coincident endpoints and rejects an out-of-segment via.
- Terminal history deletion deduplicates projections and rejects active status.
- Retention is disabled for missing/false/misspelled values and enabled only by explicit `true`.
- Privacy collection-group queries/rules/indexes are checked; emulator verifies users cannot reach backend-only collections.

## Automated frontend cases

- Live timestamps reject missing, too-old and implausibly future samples.
- Active sessions remain visible while stale non-active locations expire.
- One RTDB listener fans out to subscribers, prunes on the nearest expiry, and tears down at zero subscribers.
- Visibility/online resume state signals reconnect and clears after a snapshot.
- Polyline distance index and snapping choose the correct segment/direction.
- Ride feedback eligibility requires completed session/passenger identity.
- Ride-history timestamp/status/stop normalization handles legacy forms.

Build/lint also validate that authenticated Firebase/API requests are `NetworkOnly`, protected metadata is no-index, dialogs/hooks obey React constraints, and every static route exports.

## Simulation scenarios

Use Firebase emulators for repeatable state injection; never point destructive simulations at production.

| ID | Injection | Expected result |
|---|---|---|
| SIM-01 | Two start requests for same bus/different routes in parallel | One 201/valid resume; one 409; one lock/session owner |
| SIM-02 | Send timestamps N, N, N-1, N+1 | 202, 200 duplicate, 200 duplicate, 202; state ends at N+1 |
| SIM-03 | Kill backend after RTDB claim before Firestore projection | Pending/lock is reconciled or resume repairs projection; no second bus session |
| SIM-04 | Kill worker during completion, then restart | Transaction/idempotency completes once; newer session untouched |
| SIM-05 | Delete RTDB lifecycle but retain `active_rides` | Next authenticated fix restores same session/progress |
| SIM-06 | Age active telemetry past stale threshold | Ride remains active, device/signal becomes offline/lost |
| SIM-07 | Age terminal live node | Node is removed and fleet lifecycle remains offline |
| SIM-08 | Remove route while active | Admin API returns 409 |
| SIM-09 | Rotate/reassign device during active lock | Provision/admin update returns conflict |
| SIM-10 | Invalid tokens/roles/direct Firebase writes | 401/403 or rule denial; no state mutation |
| SIM-11 | 61 messages/hour or <3-second gap | Message/rate transaction denied |
| SIM-12 | Feedback twice within 24 hours | Second transaction denied/cooldown shown |
| SIM-13 | Retention env unset | No deletion job is started |
| SIM-14 | Service worker with account A then account B | No authenticated response exists in runtime caches |
| SIM-15 | Reverse route plan with via | Ordered reverse stops and continuous reverse polyline |
| SIM-16 | Browser hidden/offline/online | Reconnecting state, stale pruning, one listener after resume |

For concurrency runs, send a unique correlation timestamp, assert both HTTP outcomes and then inspect `ride_sessions`, `_active_bus_locks`, `active_rides`, and all matching RTDB nodes. Clean emulator state between runs.

## API negative matrix

Every endpoint must be tested with: missing/wrong auth scheme, expired/revoked token where applicable, wrong role, invalid ID grammar, missing/extra body fields, boundary numeric/string sizes, malformed JSON, oversize body, repeated request, unavailable Firebase/upstream, and rate exhaustion. Mutations also need a partial-failure/retry case and verification that error responses contain no secret/token/stack.

Key expected HTTP families:

- `400`: malformed/invalid input.
- `401`: missing/invalid person/device credentials.
- `403`: authenticated but unauthorized assignment/role.
- `404`: safe ID but absent resource.
- `409`: lifecycle/assignment/lock conflict.
- `413`: parser body too large.
- `429`: rate limit.
- `500`: unexpected server failure.
- `503`: telemetry dependency unavailable/readiness degraded.

## Hardware bench matrix

| Test | Method | Evidence/pass condition |
|---|---|---|
| Build/reproducibility | Clean PlatformIO cache or CI build | Pinned packages, successful binary and size report |
| UART wiring/overflow | GNSS simulator/real module during 7 s network stall | NMEA continues; no no-data warning/drop-induced loss |
| Cold/warm fix | Power cycle indoors edge/outdoors | Time-to-first-trusted-fix recorded; HDOP gate works |
| Motion hysteresis | Replay speeds around 1.5–2.5 | No rapid state flapping; three readings required |
| Adaptive rate | Replay stationary/moving path | ≥3 s changes, 30/60 s heartbeats, thresholds correct |
| Payload | Capture backend request in controlled test | Exact six fields, ≤512 bytes, `Device` header, no secrets logged |
| TLS | Correct/wrong CA, hostname and clock | Correct succeeds; every wrong case fails closed |
| Retry | Drop backend for 2 minutes | 1–30 s jittered attempts, latest-only buffer, recovery |
| Watchdog | Controlled >15 s loop block | Panic/reset and reset reason; no permanent hang |
| Power brownout | Controlled supply interruption | Restart/reconnect; durable ride resumes |
| Wi-Fi loss | Disable hotspot then restore | Offline UI then same session recovers |
| GNSS loss | Shield/disconnect antenna safely | One uncertain fix at last point; no invented movement |
| Backend/Firebase outage | Stop service/emulator | Timeouts/backoff/503 metrics; recovery without duplicate progress |

Do not expose production secrets in packet captures or serial logs. Use a dedicated test device/project.

## End-to-end role acceptance

With passenger, assigned driver and admin sessions:

1. Verify role denial and correct fleet catalogs.
2. Arm with fresh fix away from origin; observe pre-departure.
3. Reach origin; observe in-service everywhere and passenger boarding eligibility.
4. Exercise message sender identity/rate behavior and delay update.
5. Visit out-of-order later stop; assert no advance.
6. Visit every expected stop and assert one-step progress/history.
7. Interrupt GNSS, Wi-Fi, ESP power, browser and backend separately; assert honest status and same-session recovery.
8. Attempt concurrent second route on same bus; assert conflict.
9. Reach final stop; assert one completed session/projection, no recovery/lock, and terminal feedback eligibility.
10. Verify admin history delete confirmation cancels without a request and terminal-only confirm deletes the complete history scope.

## Accessibility and UX acceptance

Keyboard-only test every route: visible focus, native selects, tab order, admin tabs, collapsibles, dialogs, Escape, focus containment/restoration, and no focus behind modal. Test screen-reader names/status announcements, 200% zoom, 320 px width, high contrast, slow 3G/offline, empty/error/loading states, and `prefers-reduced-motion`. Maps need equivalent textual status/route information; color must not be the only state cue.

## Performance/load test

Use a staging project/runtime near production topology. Ramp realistic devices at 3-second worst-case cadence and browsers with RTDB subscriptions. Record API p50/p95/p99, device-to-server and RTDB-write health metrics, errors/429s, CPU/memory, scrypt cache rate, Firebase connections/operations and UI update time. Include a reconnect storm with jitter. Define acceptance targets with university owners; do not invent a universal latency target from local tests.

## Release evidence

Archive commit/branch, environment class (no secrets), `npm run verify` log, firmware build/size/hash, emulator output, dependency/SAST results, route/device IDs, latency percentiles, failure-injection results, screenshots/serial extracts, known risks, rollback plan and approver/date. Physical tests and skipped emulator cases must never be described as passed unless actually run.
