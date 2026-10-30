# Live latency, storage and recovery audit: October 2, 2026

| Document ID | Version | Status | Last updated |
|---|---|---|---|
| EKI-EVD-020 | 1.0 | Historical | 2026-10-04 |

> Historical evidence: original run dates, commits, measurements and limits below remain authoritative for that run. This documentation update does not rerun the test. See [current testing gates](README.md).

The stationary ESP32 delivered 1,109 accepted requests out of 1,131 parsed attempts. Successful HTTP latency was 616 / 1,203 / 1,514 ms at p50 / p95 / p99. One interval between accepted fixes reached 26.692 seconds during transport failures. The audit found stop-history loss, incomplete completion recovery, an invalid frontend page-prop contract and partial retention deletion, tracked in [#206](https://github.com/notnamansinha/Eki/issues/206), [#207](https://github.com/notnamansinha/Eki/issues/207), [#208](https://github.com/notnamansinha/Eki/issues/208) and [#209](https://github.com/notnamansinha/Eki/issues/209).

## Capture and coverage

The running primary checkout remained on `testing` at `a12368f`. Fixes were prepared separately on `codex/live-latency-recovery-audit`. The primary checkout had unrelated local Firebase Auth helper changes; it was not a clean, uniquely deployed build. The serial stream did not identify a firmware image hash, so this report does not claim that the subsequently compiled image ran on the device.

| Evidence | UTC window | Coverage |
| --- | --- | --- |
| Serial monitor | 09:54:33.947–10:14:32.915 | 3,835 lines; 1,131 parsed device HTTP traces; all motion states stopped |
| Network / RTDB observer | 09:57:19.434–10:17:19.466 | 1,369 inspector requests, 1,155 RTDB child events, local/public health and host DNS/TCP/TLS probes |
| Firebase RTDB profiler | 10:06:38.984–10:08:08.235 | 365 profiler events over approximately 90 seconds |
| Firestore storage snapshot | After capture | 22 ride sessions, 1 completed projection, 0 active rides, 0 active bus locks |

Add 05:30 for IST. The initial user-provided 502 serial log is archived separately; it is not pooled with this restored-backend experiment. No movement, physical power interruption, controlled radio impairment or artificial coordinates were introduced. The empty active-ride snapshot means this capture cannot establish same-session physical restart recovery. Later diagnostic uptime resets were outside the serial window, with no independently recorded cause.

Raw evidence is privately saved in the primary checkout under `temp/live-audit-2026-10-02/`. It includes `serial.log`, `network-rtdb.jsonl`, `rtdb-profile.jsonl`, `storage-snapshot.json`, the original pasted log, `telemetry.csv`, `summary.json`, analysis scripts and reports. The collector omits HTTP headers. Raw location, identifiers and profiler IP metadata stay outside Git and GitHub.

Captured parameters include sample sequence/time, queue/send/receipt/response times, HTTP status and retries, motion, DNS/TLS preparation, reconnects, GNSS/UART counters, queue depth/high-water/drops, heap, RSSI, uptime/reset diagnostics, RTDB payloads/callback times, profiler operation timing and ngrok metrics. Diagnostic fields are reported at their actual cadence, not invented for every fix. Host DNS/TCP/TLS probes are separate from device connection timings. These are the available instrumented parameters, not a complete packet trace or every possible hardware measurement.

| Raw file | SHA-256 |
| --- | --- |
| Serial | `d860a905156a431834915803b34848fa2df3f8170446829c181b4b241082b5a5` |
| Network / observer | `7fd7cb7801e16bfa96cf7de97b0da2ca1563608e5541441c1c4d09eaeb9a698a` |
| RTDB profiler | `ebb46fc110c097895a5ffd3ea4e4689b1df2d19f30e0498578586eb65babecaf` |

## Latency results

Percentiles use nearest rank. Request failures are included only in the explicitly labeled all-attempt row; each row retains its own count/window.

| Metric (ms) | Samples | p50 | p95 | p99 | Maximum |
| --- | ---: | ---: | ---: | ---: | ---: |
| Successful device HTTP | 1,109 | 616 | 1,203 | 1,514 | 4,846 |
| All device HTTP attempts | 1,131 | 622 | 1,291 | 1,958 | 5,043 |
| Device queue before successful send | 1,109 | 8 | 347 | 909 | 1,019 |
| Backend request work | 1,109 | 439 | 1,015 | 1,196 | 1,319 |
| Estimated network round trip | 1,109 | 141 | 200 | 997 | 4,430 |
| Accepted backend-ingress gap | 1,108 | 1,001 | 1,265 | 2,922 | 26,692 |
| Sample to Admin SDK observer | 975 | 547.5 | 1,186 | 1,469 | 2,959.5 |
| Backend receipt to RTDB timestamp | 975 | 416 | 996 | 1,201 | 1,326 |
| Local health probe | 119 | 3.5 | 11.3 | 21.0 | 27.2 |
| Public tunnel health probe | 119 | 250.2 | 421.8 | 1,090.3 | 6,008.9 |
| Host DNS probe | 119 | 28.9 | 85.1 | 195.8 | 1,096.9 |
| Host TCP probe | 119 | 43.9 | 86.2 | 251.4 | 1,124.0 |
| Host TLS probe | 119 | 105.9 | 208.8 | 544.7 | 6,796.9 |

There were 13 device read timeouts and 9 failed connection attempts: 22/1,131 attempts (1.95%). Twenty-two retries and 12 reconnects were observed. Four malformed trace lines are excluded from parsed-attempt counts. The public health maximum includes one six-second timeout; 237/238 health probes returned HTTP 200. The collector recorded no errors. Diagnostic reports within the serial window showed no queue overflow/stale drops or UART overflow and approximately 144 KB free heap; only four periodic diagnostic samples were available.

The longest ingress gap followed repeated read timeouts and six failed TCP/TLS connections, with repeated retry delays. The final reconnection logged roughly 1.4 seconds DNS preparation and 3.3 seconds TLS preparation. This establishes a real tail gap, not a CPU or Firebase server-processing cause. Successful HTTP latency alone hides the outage.

Cross-clock estimates use request/response offset bounds. Offset p50 was 889.5 ms and uncertainty p50/p95/p99 was 70.5 / 100 / 498.5 ms. The Admin observer's Firebase clock offset estimate was -872 ms. Signed RTDB-to-observer estimates included 563 negative values out of 975 (median -2 ms), revealing clock uncertainty; they are preserved instead of being truncated to produce a biased delivery claim. The observer is a Node Admin SDK callback, not browser first marker paint. It cannot establish the moving sample-to-marker acceptance gate.

## Firebase RTDB findings and optimization scope

The instance-list API verified that the measured database is active in `us-central1`. The profiler recorded 215 realtime transactions, 108 listener broadcasts, 20 listens, 20 unlistens and one connection/disconnection event each. Transaction server duration was p50 1 ms, p95/p99 2 ms, maximum 8 ms; pending duration was p50 0 ms, p95/p99 1 ms. No denied operations appeared in this window. Observed broadcast bytes totaled 236,384, including pre-existing clients and the added observer.

Profiler timing is much smaller than the measured 416 ms median backend-to-RTDB duration. Together with the India-to-Iowa placement, this supports network round trips as an optimization candidate; it does not prove the improvement from a region migration. Compare authenticated transactions/listeners against the approved regional candidate before a cutover, following the existing [region decision](../design/RTDB_REGION_LATENCY_DECISION.md) and #169 evidence. Keep the existing token leases, change-only lifecycle writes, connection reuse and bounded payloads. Profile real transaction retries and moving contention before replacing transactions or adding a second streaming stack.

Firmware already separates capture/publishing and keeps a bounded newest-first queue. Arbitrarily shortening cold TLS deadlines or weakening certificate verification would not repair unavailable DNS/radio/backend paths and could worsen reconnection. A controlled weak-radio and moving experiment should measure freshness, failure gaps and first recovered fix before tuning those budgets.

The profiler is a bounded operational trace, not a permanent server log, complete error history or account billing export. Operation/listener counts do not establish physical peak connections. Firebase billed bytes/reads, moving browser paint, chat delivery and browser offline/recovery cycles remain required by [#195](https://github.com/notnamansinha/Eki/issues/195). Keep Firebase SDK listeners while those measurements are pending.

## Confirmed recovery defects and corrections

1. **Stop history could lose crossings or failed writes (#206).** The reducer could advance across several stops while the engine wrote only the last one asynchronously. Activation/history/checkpoint commits were separate. The corrected transaction records every missing crossed stop and activation together with the active checkpoint before RTDB publication. A failed checkpoint leaves the sample retryable; an older live projection is repaired from the newer durable checkpoint. Existing names/timestamps are retained, and recovered history identifies its later recovery time.
2. **Completion could remain stranded after a partial cross-store commit (#207).** Once Firestore completed the ride and removed its lock, a failed RTDB publication could not be retried under the original active-session guard. Recovery now validates the matching canonical completed projection and republishes its original completion/dwell time. It neither rewrites retention timestamps nor removes a replacement session's lock.
3. **Production feedback build rejected custom page props (#208).** The Admin view imported the `/feedback` page and supplied `embedded`, which Next.js rejects for a page export. The reusable client panel now lives in a normal component file; the route is a no-argument wrapper. The authenticated API write boundary and both presentations are preserved.
4. **A partial recursive purge could strand child data (#209).** Firestore's recursive deletion can remove the ride parent even if a descendant operation fails, making an age query unable to find remaining children on the next sweep. A backend-only durable job is now committed before deletion and removed only after success. Startup/daily sweeps resume these jobs even with no parent. Tests cover failed job persistence, partial child deletion and restart recovery.

The same failure pattern applies to Admin history deletion. Its separate durable job remains until both descendants and completed projections are removed; the endpoint recurses even when the parent is already absent, and the worker can resume an interrupted request. A terminal-status guard precedes each attempt. Manual and age-based jobs stay separate to avoid clearing each other's unfinished cleanup.

Synthetic regression tests reproduce four failures against the original engine and pass against the corrected code. These are deterministic correctness proofs for the modeled failures; they are not live performance measurements. Lifecycle/history work remains outside the device HTTP ingress handler. Adding the history read to changed lifecycle transactions can increase lifecycle publication work; the stationary capture did not have an active ride and cannot quantify that overhead.

Terminal ride sessions now default to **180 days**, matching completed-trip projections. The daily leader-owned sweep deletes strictly older terminal records; recursive session deletion includes passengers/messages. Active rides/locks are excluded from age-only retention. Deployment overrides must be set to 180 and production must explicitly enable the existing sweeper. No live deletion, migration, firmware upload or deployment was performed. See the [storage explanation](../data/STORAGE_ARCHITECTURE.md) for readable ride fields and power-loss limits.

## Security review and validation

Review covered backend authentication/roles/device credentials, request validation/rate limits, public/private API boundaries, Firebase rules and data access, lifecycle/reconciliation/retention, map upstream calls, hardware TLS/queue/clocks/watchdog/update controls, frontend auth/live state/listener cleanup/history and build/deployment contracts. This was source review plus the listed tests and stationary observation; it does not certify absence of vulnerabilities or verify every production-console setting.

| Area | Evidence and qualification |
| --- | --- |
| Access controls | Backend-only collections and browser live writes are denied by source rules; role/assignment/credential checks and negative cases are tested. Emulator tests use isolated App Check-free rule copies, so production App Check enforcement still needs deployment verification. |
| Ingress / external requests | Bounded payloads/identifiers, distinct rate pools, shared device token leases, fixed Maps upstreams and deadlines are covered by existing tests. Production dependency audit reports zero known advisories; that does not rule out application flaws or undisclosed advisories. |
| Hardware | TLS CA verification remains enabled. The observed bench diagnostics report flash encryption and Secure Boot disabled; production fleet provisioning/signing checks must be validated separately. RTC memory depends on retained power, as described by [Espressif](https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-reference/system/sleep_modes.html); unsent fixes are not a nonvolatile ride archive. |
| Application checks | 50 script tests, 573 backend tests, 221 frontend tests, lint, OpenAPI (59 operations) and UI contracts pass. Seven backend tests remain skipped in the ordinary suite; the separate emulator rules suite passes 7 tests. |
| Regression / hardware checks | 39 focused new/existing lifecycle/history/retention tests plus 7 deletion-recovery tests pass; native firmware tests pass all 52 cases and the ESP32 bench image compiles. No new image was flashed. |

The strict production build passes, including static export, service-worker generation and web/backend CSP verification, using placeholder configuration in a separate validation copy. The linked dependencies in the managed checkout are outside Turbopack's root; the copy installs its own dependencies and sets an explicit Turbopack root only in its temporary build configuration. No frontend build configuration or generated hosting hashes are changed in the PR. Before the feedback extraction, an alternative Webpack build reached type checking and reproduced #208.

The first rules run failed because Java could not establish a Windows Unix-domain loopback connection. Setting a short `jdk.net.unixdomain.tmpdir` for the test process resolved it; [Java documents this directory setting](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/net/doc-files/net-properties.html). One application test run timed out in the existing 205-request diagnostics-rate-pool test while the emulators were starting; the complete subsequent `npm test` run passed.

Physical moving routes, full power cuts/watchdog stalls with an active ride, radio impairment, production fleet security/OTA, browser marker/chat/recovery and Firebase billing remain unverified in this session. Track physical recovery in [#60](https://github.com/notnamansinha/Eki/issues/60) and transport acceptance in [#195](https://github.com/notnamansinha/Eki/issues/195); neither is closed by this stationary audit.
