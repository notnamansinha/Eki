# Test strategy and failure matrix

Last updated: 2026-10-06 00:35 IST (UTC+05:30).

## Quality gates

Run from the repository root:

```powershell
npm run verify
& "$env:USERPROFILE\.platformio\penv\Scripts\platformio.exe" test -d hardware -e native
& "$env:USERPROFILE\.platformio\penv\Scripts\platformio.exe" run -d hardware
```

`verify` executes frontend/backend ESLint, the repository script tests, backend
and frontend Vitest suites, backend TypeScript, the Next static production
build, Workbox injection, CSP hash regeneration and
`npm audit --omit=dev --omit=optional`. It does not run the Firebase rules
emulator or PlatformIO; run those commands separately. A production release
additionally runs `npm run build:production` with actual deployment variables;
it intentionally fails closed when required public configuration is missing.

## Choose the right check

| Change | Additional command or evidence |
|---|---|
| Documentation | `npm run docs:sync`, targeted `src/docsMirror.test.ts`, relative-link review and `git diff --check` |
| Auth/admin/feedback | `npm run test:e2e:admin` (Chromium mobile and desktop, synthetic Firebase adapters) |
| General responsive/motion UI | `npm run test:e2e` (see fixture and motion READMEs) |
| Firebase rules | `npm run test:rules` with Java 21; isolated emulator configuration |
| Firmware | Native policies and affected `esp32dev`, `esp32dev-journal` or secure build profile |
| Provider/enforcement, device movement, power or live latency | Dedicated live/physical procedure and redacted evidence |

Install Chromium with `npx playwright install chromium` before local browser
runs when needed. CI installs it with Linux dependencies.

Use current runner output for test counts and audit results. Dated results in
[the acceptance index](README.md) apply to their recorded commits and conditions;
they are not a claim that a newer head or production deployment passed.

## Test layers

| Layer | Existing coverage | What it proves |
|---|---|---|
| Pure backend units | telemetry schema, scrypt/auth header, latency summaries, endpoint direction inference/turnaround readiness, route direction/via, reducer/geofence, lifecycle normalization/draining, abandoned decision, deletion | Deterministic correctness and boundaries |
| Backend lifecycle mocks | worker listener recovery, missing-route cache, completion/shutdown | Async orchestration without cloud dependency |
| Static security/deployment checks | rules/headers/routes/cache/cleanup patterns | Critical configuration does not silently regress |
| Firebase emulator integration | Firestore/RTDB allow/deny matrix | Actual rule evaluation when Java/emulators are available |
| Pure frontend units | freshness/expiry, singleton RTDB store, resume state, snapping/distance, jump hold/reacquisition, heading wrap, history, feedback eligibility | Map/live-data behavior independent of React/browser network |
| Builds/type/lint | TS, React hooks/a11y-relevant lint, static export, SW/CSP | Integration and packaging consistency |
| Dependency audit | production npm graph | Known registry advisories in shipped required packages |
| Firmware native units | shared clock/connectivity/telemetry/queue policies | Strict UTC conversion/discipline, Wi-Fi escalation, LED codes, distance/heading math, jump rejection/reacquisition, hysteresis, credential latching, HTTP classification, bounded `Retry-After`, retry cap, one-second moving cadence, stationary heartbeat and queue recovery |
| Firmware compile | pinned PlatformIO ESP32 target | API/library compatibility, binary size |
| Physical acceptance | runbooks below | Radio, GNSS, power, TLS, public path and human workflows |

## Automated backend cases

### Device ingestion

- Authorization accepts only `Device ` and a 20–512 character secret.
- Secret hashing is salted scrypt, nondeterministic, plaintext-free and mismatch-safe.
- Body is at most 512 bytes: current nine-field, previous eight-field sequenced or legacy six-field schema; finite/ranged coordinate/speed/heading, enumerated motion, and fresh timestamp.
- Duplicate/older RTDB timestamp is idempotent; new timestamp commits.
- Invalid/disabled/unknown device and invalid bus/route binding fail.
- Positive/negative credential caches and device/IP limits are bounded.
- Durable ride restore coalesces work and does not delay accepted HTTP response.
- A first device-only fix creates presence state without fabricating `tripState`, stop progress, direction, or an active service.
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
- Route saves replay identical operation IDs, reject changed-payload reuse/stale versions, coalesce concurrent routing work, reuse valid geometry for metadata-only edits, and abort commit when an active ride appears during calculation. Browser regressions first reproduced a committed save failing after one transient 503/network status poll, then the protected status GET failing on `AUTH_BUSY` before the handler ran; they verify bounded retry and Retry-After, stable `saveId`, no extra PUT, abort and late-result fencing, deadline unknown outcome, and immediate terminal 401/403/stored 5xx propagation on the legacy GET.
- Place search distinguishes validation, authentication, configuration, upstream/rate-limit, body-timeout and genuine empty-result outcomes.
- Terminal history deletion deduplicates projections and rejects active status.
- Retention is disabled for missing/false/misspelled values and enabled only by explicit `true`.
- Privacy collection-group queries/rules/indexes are checked; emulator verifies users cannot reach backend-only collections.

## Automated frontend cases

- Live timestamps reject missing, too-old and implausibly future samples.
- Device presence requires an explicit online flag plus a fresh timestamp; missing, stale, and contradictory flags are reported as offline/unknown without changing ride truth.
- Passenger route visibility and service counts require the complete active-session tuple; device-only, malformed, duplicated-session, completed, and direction-pending nodes cannot inflate service.
- Active sessions remain visible while stale non-active locations expire.
- One shared RTDB snapshot/delta pipeline fans out to subscribers, prunes on the nearest expiry, and tears down at zero subscribers.
- Healthy short tab switches and unrelated online events preserve data and
  subscriptions. Meaningful suspension/confirmed disconnect recovery debounces,
  jitters and clears only after connection plus authoritative snapshot. See
  [browser recovery bounds](../operations/RTDB_RECONNECT_RECOVERY.md).
- Polyline distance index and snapping choose the correct segment/direction.
- Ride feedback eligibility requires completed session/passenger identity.
- Ride-history timestamp/status/stop normalization handles legacy forms.

Build/lint also validate that authenticated Firebase/API requests are `NetworkOnly`, protected metadata is no-index, dialogs/hooks obey React constraints, and every static route exports.

### Authentication and feedback regressions

The [local admin recovery evidence](ADMIN_PERMISSION_RECOVERY.md) distinguishes
software regression checks from the remaining affected-browser acceptance.

- App Check: missing provider, explicit development-only opt-out, debug exchange,
  production rejection, token/error validation, forced recovery refresh and
  token deadline with a shared raw acquisition retained until settlement.
- Auth readiness: user/role publication only after verification; timeout,
  current ID token claims (including the admin bit), account switch and pending
  verification after sign-out cannot grant access. Concurrent permission
  retries share verification and cannot attach listeners before it completes.
- Listener disposal: collections/settings/live buses detach and clear old
  caches when protected readiness closes.
- Admin feedback: actual middleware denies non-admins; bounded HTTP list schema,
  shared standalone/tab behavior, retry, status acknowledgement, abort and
  generation guards reject stale reads/writes, including same-account reverify.
- Passenger: destination selection before service, directional stop order,
  boarding carryover, map target and in-app bus/station listbox behavior.

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
| SIM-12 | Feedback twice within 24 hours | Second submission returns 429/cooldown shown |
| SIM-13 | Retention env unset | No deletion job is started |
| SIM-14 | Service worker with account A then account B | No authenticated response exists in runtime caches |
| SIM-15 | Reverse route plan with via | Ordered reverse stops and continuous reverse polyline |
| SIM-16 | Browser hidden/offline/online | Reconnecting state, stale pruning, one listener after resume |
| SIM-17 | Two identical route saves while Routes API is blocked | One durable lease/geometry pair; duplicate gets 202 then identical replay |
| SIM-18 | Route edit computes while a ride starts | Final route transaction returns 409; route/version remain unchanged |
| SIM-19 | Browser times out after route commit | Same `saveId` reconciliation returns saved version; no second mutation |
| SIM-20 | Straight turn/parallel road/U-turn/stationary noise | One ≥120 m measured or two ordinary reliable deviations reroute; heading/progress reject wrong carriageway/back-jump; stationary/missing match does not confirm |

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
| Adaptive rate | Replay stationary/moving path | One-second evaluation and moving/stopped capture/heartbeat, thresholds correct |
| Payload | Capture backend request in controlled test | Current nine fields (including seq, deviceSentAt and gpsHdop), ≤512 bytes, `Device` header, no secrets logged |
| TLS | Correct/wrong CA, hostname and clock | Correct succeeds; every wrong case fails closed |
| GNSS clock | Block NTP with fresh and stale/invalid GNSS UTC | Fresh UTC establishes TLS-valid time; invalid/stale UTC never changes clock; NTP cross-check is non-blocking |
| Retry | Drop backend for 2 minutes | 1–30 s jittered attempts, bounded newest-first RTC queue, recovery |
| Watchdog | Controlled >25 s task block | Panic/reset and reset reason; no permanent hang |
| Power brownout | Controlled supply interruption | Restart/reconnect; durable ride resumes |
| Wi-Fi loss | Disable the configured hotspot for >2 minutes, then restore it | No recovery AP or configuration portal is created; bounded retries continue and the same session recovers when the configured network returns |
| Credential rejection | Return 401/403 repeatedly | One rejected attempt latches publishing off, retains the sample until normal freshness eviction, emits three-pulse LED and resumes only after device-credential repair/restart |
| GNSS loss | Shield/disconnect antenna safely | One uncertain fix at last point; no invented movement |
| Backend/Firebase outage | Stop service/emulator | Timeouts/backoff/503 metrics; recovery without duplicate progress |
| Active-ride OTA gate | Offer a newer release before, during and after a ride | Descriptor is available only outside the active ride; no reboot interrupts service |
| OTA integrity | Offer wrong size, digest, TLS chain and signing key | Every altered/untrusted candidate is rejected and the current slot remains selected |
| OTA confirmation/rollback | Install healthy candidate, then a candidate unable to reach authenticated backend | Healthy image confirms after telemetry/diagnostics; unhealthy image restores the prior slot within five minutes |
| OTA credential isolation | Capture controlled backend and artifact-host requests | Device header reaches only the backend manifest endpoint, never the artifact host or logs |

Do not expose production secrets in packet captures or serial logs. Use a dedicated test device/project.

## End-to-end role acceptance

With passenger and admin sessions, plus an admin-managed assigned operator record:

1. Verify role denial and correct fleet catalogs.
2. Attempt to arm while moving or between endpoints; assert the backend refuses to guess.
3. Stop near A, arm without a direction field, and observe inferred A→Z in-service state and passenger boarding eligibility.
4. Exercise message sender identity/rate behavior and delay update.
5. Visit out-of-order later stop; assert no advance.
6. Visit every expected stop and assert one-step progress/history.
7. Interrupt GNSS, Wi-Fi, ESP power, browser and backend separately; assert honest status and same-session recovery.
8. Attempt concurrent second route on same bus; assert conflict.
9. Reach Z; assert one completed A→Z session/projection and terminal feedback eligibility.
10. Remain stopped through the configured dwell; assert exactly one fresh Z→A session/lock is automatically armed, including across two backend replicas and a backend restart. Confirm stale, moving and displaced telemetry do not arm it.
11. Complete Z→A and verify directional counts, reversed stop evidence, passenger map/ETA ordering, and return to A.
12. Verify admin history delete confirmation cancels without a request and terminal-only confirm deletes the complete history scope.

## Accessibility and UX acceptance

Keyboard-only test every route: visible focus, in-app listbox open/select/escape behavior, tab order, admin tabs, collapsibles, dialogs, Escape, focus containment/restoration, and no focus behind modal. Test screen-reader names/status announcements, 200% zoom, 320 px width, high contrast, slow 3G/offline, empty/error/loading states, and `prefers-reduced-motion`. Maps need equivalent textual status/route information; color must not be the only state cue.

## Performance/load test

Use a staging project/runtime near production topology. Ramp realistic devices at one-second moving cadence and browsers with RTDB subscriptions. Record API p50/p95/p99, device-to-server and RTDB-write health metrics, errors/429s, CPU/memory, scrypt cache rate, Firebase connections/operations and UI update time. Include a reconnect storm with jitter. Define acceptance targets with university owners; do not invent a universal latency target from local tests.

## Release evidence

Archive commit/branch, environment class (no secrets), `npm run verify` log, firmware build/size/hash, emulator output, dependency/SAST results, route/device IDs, latency percentiles, failure-injection results, screenshots/serial extracts, known risks, rollback plan and approver/date. Physical tests and skipped emulator cases must never be described as passed unless actually run.

### Privacy deletion recovery (R10)

Run privacy route, manifest and queue regressions plus `privacyDeletion.integration.test.ts` through the loopback rules-integration command. Verify resubmission preserves failure history; twenty poison/backoff records do not starve later users; 1001-record histories continue in bounded turns; operators/recreated identities are refused; held raw Auth retains the mutex/permit; and stopped-executor claim recovery precedes lock recovery. The child-process crash uses actual Firestore and synthetic Auth. Live Auth/index/supervisor/quiescence acceptance remains #245.

### Versioned telemetry route catalog (R12)

Run `telemetryRouteCatalog.test.ts`, route service/live-routing cases and `telemetryCatalog.integration.test.ts` in the rules-integration command. Check sixty unchanged pending fixes do not reread a watched route, shared expired fills, observed edit/deletion and delayed subscription/RTDB callbacks, read-only missing geometry, armed direction transaction binding, definitive stale refusal and actual committed direction with lost acknowledgement. Physical/provider/replica edit timing stays #245.

### Read-only passenger geometry (R13)

Run route geometry reads, route compute limiter and polyline HTTP suites. Check legacy enumeration and administrator GET invoke no Google/write, sixty stored reads share one document read, authorized versioned saves refresh the cache, bounded raw/waiting computation survives stalled dependencies, and read quotas do not spend computation tokens. The catalog emulator suite additionally verifies actual watcher cache invalidation. Live provider/replica/road acceptance remains #245.

## Bus edit metadata regression (R21)

`routes/fleetOperations.test.ts` exercises HTTP bus edit/create, preserving existing timestamps/nested metadata, ignoring injected request fields, explicitly deleting legacy `assignedRouteId`, and retaining all fields when an active ride blocks removal. `reconciliation.integration.test.ts` repeats edit/create through real loopback Firestore merge/delete transforms with actual Timestamp fields. The integration case requires local emulators; synthetic HTTP tests alone do not certify deployed behavior. Browser acceptance should edit a disposable bus and verify the original server metadata and assignment mirrors, then verify active-ride/bound-device conflict outcomes.
