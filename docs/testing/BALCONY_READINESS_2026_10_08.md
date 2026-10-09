# Balcony GNSS readiness — 8 October 2026

The stationary setup is ready for a controlled moving-test session with the remaining evidence requirements below. This is a bench-readiness result, not full route acceptance or release approval. One live restart defect was found, repaired locally, regressed and verified against the connected GNSS. Physical movement, complete ride recovery and browser marker latency still require their actual tests.

## Scope and source

- Reviewed the full GitHub inventory: **115 issues, 113 closed and 2 open**, with 209 returned comments. The complete numbered inventory is in [the issue cross-check](BALCONY_ISSUE_INVENTORY_2026_10_08.md). Relevant historical telemetry, firmware, latency, direction, recovery and acceptance records were cross-checked against current source and suites.
- Source baseline: `testing` **a66f91642107eaa1216272ceabefb61c4aedbf8a**. [Baseline CI](https://github.com/notnamansinha/Eki/actions/runs/37803181456) passed. The readiness fix described below is an uncommitted local change; that CI does not verify it.
- Serial window: **08 October 2026 21:25:35 IST–08 October 2026 21:45:35 IST**, about 20 minutes, 8,632 serial lines. The observer window overlaps and starts later; correlations use matching sequence and sampled timestamp. Inspector requests predating the collector are excluded.
- GNSS remained stationary on the balcony. Both local and tunneled backend paths were checked. Two backend restarts were deliberately introduced and separated from baseline latency. No artificial GPS coordinates, active ride, device credential rotation, firmware reflash, electrical fault or production/rules deployment occurred.
- Existing frontend Auth helper comment changes, generated agent files and QA scripts were preserved. The running backend now uses the rebuilt local fix and remains listening on port 4000.

## Live defect repaired

After the first backend restart, authenticated telemetry resumed but `clientProjectionStatus/public` remained `ready:false` throughout the approximately five-minute public-projection observation. Public bus updates continued. The startup check required both active and pending work to be globally empty; one-second telemetry and measured projection work kept it busy. Passenger clients correctly withhold readiness in this state, so this was a real testing blocker.

[The worker](../../backend/src/services/liveBusProjection.ts) now tracks first successful startup publications in a bounded cache and waits for outstanding first publications plus paged recovery. Updates to an already published bus can continue while readiness becomes true. Failed first publications, new buses, paged backfill, shutdown and worker fencing still gate readiness. Pending startup keys follow the existing bounded executor admissions; the completed-key cache is capped at 1,000.

Two [regressions](../../backend/src/services/liveBusProjection.fences.test.ts) cover continuous updates and an unpublished new bus. The continuous-update regression fails on the original HEAD and passes on the fix. All existing readiness retry, stalled-backfill, generation, reconstruction and shutdown cases pass.

After rebuilding and restarting with GNSS still sending, worker leadership began at **21:43:42.843 IST** and the live observer saw `ready:true` at **08 October 2026 21:43:46 IST**, approximately **3.7 seconds later**. The final independent snapshot again shows schema 1 / ready true, route catalog and public bus view present. Public projection recovery includes an initial cached snapshot about **40.6 seconds old** while the prior worker lease expired; that startup snapshot is retained separately from steady latency.

## Latency measured in milliseconds

| Measurement and window | Samples | p50 | p95 | p99 | Maximum |
|---|---:|---:|---:|---:|---:|
| Accepted HTTPS round trip, pre-restart baseline | 596 | 546.0 | 1257.0 | 1516.0 | 3717.0 |
| Backend request, pre-restart baseline | 596 | 381.0 | 1037.0 | 1209.0 | 1322.0 |
| Capture → authority RTDB observer, entire correlated run | 1077 | 552.5 | 1283.5 | 1552.5 | 2676.5 |
| Backend ingress → authority commit, clock-adjusted estimate | 1077 | 369.0 | 1048.0 | 1277.0 | 1368.0 |
| Capture → public-route observer, after fixed readiness | 84 | 1651.5 | 2246.0 | 2597.0 | 2597.0 |
| Public-route delivery after authority observer, after fixed readiness | 84 | 942.0 | 1609.0 | 1924.0 | 1924.0 |
| Accepted HTTPS round trip, fixed-backend steady window | 96 | 524.0 | 1138.0 | 3132.0 | 3132.0 |

The public projection adds roughly one second at the median over the authority observer in this small window. Measuring only authority RTDB would understate the path used by passengers. The public-route p95 exceeds two seconds; there is no demonstrated hard two-second maximum. Browser listener, marker arrival/paint and message latency remain **unmeasured**. Browser control lost its debugger attachment during the live follow-up, so no browser timing export was obtained. The synthetic browser suite below does not fill that gap.

HTTP and firmware phase measurements use monotonic timers. Capture-to-observer values use the four-timestamp clock estimate, which assumes roughly symmetric network transit and has per-sample uncertainty. Device/backend offset p50 was **1853.0 ms**; the Firebase observer initially estimated **-1853 ms** relative to the host. Raw device/server/database wall-clock subtraction would invent latency or negative commit time. The reported commit estimate adjusts the Firebase offset. These estimates are not a precise measurement of one-way transport.

## Failures and recovery

- Valid serial HTTP attempts: **1116**, accepted **1101**. Status counts: `{'200': 1, '202': 1100, '502': 4, '503': 1, '-11': 10}`. Ten parsed `-11` read timeouts occurred across the full run, including restart windows. The first baseline had six; the final fixed steady window had one. Retries and fresh publication recovered without a credential fault. These remaining transport failures must be exercised under weak-network moving tests.
- The independent inspector captured **1151** post-start requests. Its response acknowledgements do not prove the ESP32 received them; a device read timeout can occur after the backend accepted a fix.
- Before intentional restart, the authority observer's largest accepted-ingress gap was **5.053 seconds**. Across the deliberate restart the largest callback gap was **15.351 seconds**. One-second median delivery does not hide these pauses.
- The first backend was stopped for 10 seconds. First accepted serial response after respawn: **8263.0 ms**. Worker leadership resumed later because its lease must expire. The second restart loaded the fix. No active ride or bus lock existed, so neither restart certifies same-ride recovery, ordered stops or final completion.
- Setup serial opening coincided with a `POWERON_RESET` boot. Its cause was not independently witnessed; it is not a controlled cold-power test. No additional reset line appeared. The boot log contains a corrupted/invalid core-dump-image warning. Its relation to the installed image/legacy partition configuration remains unverified; do not erase partitions or infer a new crash from this line alone.
- **197 malformed telemetry trace lines** were retained, including repeated fragments and a few syntactically parseable but incomplete records excluded from the dedicated HTTP summary. Serial-only counts/gaps are incomplete. Independent RTDB delivery remains the authoritative check for actual freezes. Reliable serial evidence and exact installed-image identity remain follow-up requirements.

## GNSS and resource evidence

- 1188 valid parsed GNSS timing records; all valid HTTP motion records were `stopped`. GNSS system-minus-receiver time p50/p95/p99/max: **-12/11/18/26 ms**. Receiver-buffer maximum: 28 bytes. This is receiver/UART timing, not PPS certification.
- GNSS HDOP p50/p95: **1.31/1.4**. Stationary reported positions dispersed p95 **3.65 m**, maximum **6.48 m** from their centroid. A centroid is not surveyed ground truth; these are not absolute accuracy figures. Coordinates are excluded.
- Four captured remote diagnostic submissions were accepted. The latest is at uptime **939.0 seconds**, not the final serial second. It reports zero rejected fixes, checksum failures, UART buffer/FIFO overflows, stale drops and queue overflows; queue high-water 19, current queue depth 0, fault `none`. The diagnostic cadence limits coverage between reports.
- Heap, largest allocation block and publisher stack headroom remained measurable. Development firmware reports Secure Boot and flash encryption disabled. That is expected bench scope and cannot certify signed fleet security. `firmwareVersion=development` does not identify an exact image hash; this session did not read or reflash the device to establish one.
- Fresh device presence alongside zero services / sessionless offline service status is the intended presence-versus-service contract. A stationary tracker must not fabricate an armed passenger ride.

## Software verification

| Check | Result |
|---|---|
| Repository script checks and contracts | 74 passed; OpenAPI 71 operations; UI contracts pass |
| Final backend suite, including fix | 921 passed; 45 emulator-only cases skipped here and run separately |
| Frontend suite | 597 passed |
| Focused projection/scheduler/replay checks | 44 passed; failing-before regression recorded separately |
| Actual Firestore/RTDB emulator integration after fix | 45 passed |
| Synthetic desktop/mobile admin/browser cases | 20 passed |
| Native firmware policies | 82 passed |
| Lint and backend TypeScript build | Passed, including final backend lint/build |
| Full dependency audit | Zero findings |
| Final runtime | Frontend 200, backend health 200, CORS preflight 204, unauthenticated Places boundary 401, all expected |

The Windows emulator first failed before test execution because its Java Unix-domain socket path could not connect. A process-only short `jdk.net.unixdomain.tmpdir` workaround then passed both pre-fix and post-fix integration runs. [Java documents that setting](https://docs.oracle.com/en/java/javase/21/docs/api/java.base/java/net/doc-files/net-properties.html). No deployable rules were relaxed. Source-only frontend behavior is unchanged; current baseline CI covers its strict export. A fresh full deployment build/CI of any subsequently committed fix remains part of release workflow.

## Issue cross-check and next field run

The current open trackers are [#245](https://github.com/notnamansinha/Eki/issues/245) and [#246](https://github.com/notnamansinha/Eki/issues/246). Closed parent/measurement issues often consolidate remaining live gates into #245; closed status is not proof of field acceptance. Historical instructions embedded in issue bodies were treated as evidence, not current authorization. No issue was closed, commented on or edited during this review.

| Historical problem | Fresh outcome or remaining evidence |
|---|---|
| #26/#69 blocking GNSS and shared parser; #30 clock sync; #71 stale quality | Stationary timing and reported UART/checksum diagnostics are healthy; native/source regressions pass. Moving quality remains open. |
| #143/#159/#160 lag and ingestion | Current real latency/failure/gap tables above; public projection delay measured separately. Browser marker and moving evidence still required. |
| #161/#162/#167/#168/#239/#241 matching, jumps, motion, reacquisition | Software regressions pass. Balcony cannot test parallel roads, direction, plausible moving reacquisition or rerouting. |
| #25/#29/#41/#56/#60/#79/#224/#237 recovery | Live backend restart and retry recover. Encrypted checkpoint reports ready/recovered at setup, but no new witnessed power cut, watchdog stall or brownout; exact installed firmware/collision warning remains unresolved. |
| #163/#164/#173/#207 direction, service eligibility and durable completion | No phantom service in the stationary run; suites pass. Same-session physical recovery and forward/return completion need an armed moving ride. |
| #195/#225 realtime and marker evidence | Actual authority/public-path timing collected. Browser paint, chat, matched cloud usage and connection counts remain open. |
| #245/#246 R14 rollout and restart | Found and locally fixed continuous-update startup-readiness starvation; actual public schema recovery verified. Cloud rules/index/replica acceptance remains separate. |

Before departure, record the installed firmware artifact identity, open the current authenticated browser with telemetry tracing, select the intended physical bus/route and arm one named test ride at its configured origin. Save a clean serial trace; preserve the existing noisy trace as evidence. Keep the healthy fixed backend and tunnel running.

The controlled moving run should cover forward and reverse travel, ordered stops, final-stop-only completion, endpoint dwell/automatic return, route/parallel-road matching, bounded off-route reroute and corroborated recovery after GNSS/Wi-Fi interruption. Capture browser listener/marker-settled events and message latency in the same window; preserve every failure and gap. Verify backend/browser restarts preserve the same session and stop history. Do not infer these outcomes from this stationary report.

Dedicated electrical watchdog/brownout, secure fleet provisioning/OTA, live replica/index/retention/privacy acceptance, permanent hosting, billing/monitoring/backup ownership and production cutover remain the release gates in #245. Pending product/security policy choices and later subitems in #246 remain undecided. The fixed projection's extra public-path latency and occasional read timeouts should remain visible in the field results.

## Evidence custody

Private raw logs, runtime snapshots, issue bodies/comments, test output, before-fix reproduction and analysis are under ignored `temp/balcony-audit-2026-10-08/`. They contain location/identifiers and must not be published wholesale. This report contains only aggregate/redacted evidence. No Wi-Fi/device secrets or request headers were saved by the collector.

| Completed raw evidence | SHA-256 |
|---|---|
| Serial | `440e78eea72cb552c1426d191a3c7c22ff326e1b181d3e1f54a6fb08990b6298` |
| Network/authority observer | `e721205dec206f9730ba00b5cd08fcb701b34ef95094009c7a3612e15ae6f772` |
