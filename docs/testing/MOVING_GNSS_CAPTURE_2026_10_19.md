# Short moving GNSS capture: 19 October 2026

| Document ID | Version | Status | Last updated |
|---|---|---|---|
| EKI-EVD-022 | 1.0 | Historical | 2026-10-20 |

Recording is stopped and the evidence is retained privately. The observed route movement supplies useful latency and transport evidence for issues #245, #246, #300 and #337. No issue was edited or closed during capture. No service was armed, so this run does not validate ordered stops, ride direction, final completion or automatic return.

## Window and identity

- Owner requested start at 17:45:13 IST. Cloud collector ran **17:45:15–17:51:33 IST**, 377.6 seconds. Serial opened at 17:45:30 IST after a local script startup repair.
- Owner confirmed the intended configured route and physical vehicle; route/device identifiers and exact locations remain private. Source HEAD **3a1486bddbe8acc44b460060e6573508b15e88c9**, branch codex/pr-336-review-fixes. Tracked working diff, source archive and local image/ELF/map/build hashes are retained.
- Owner confirmed the final USB/telemetry cutoff near **17:50:35 IST** was intentional unplug/power-off. Last raw update arrived at 17:50:35.726 IST; the remaining 57.34 seconds are post-disconnection observation. No unexplained freeze or recovery PASS is inferred.
- Phone hotspot supplied internet to the laptop/device. No independent GNSS truth reference. Local compiled binaries do not prove the exact flashed image. Receiver MON-VER was not obtained; development firmware reports secure boot/flash encryption disabled.

## Movement and delivery

299 unique raw cloud observations: **213 moving**, **86 stopped**. 221 public projection observations; 220 seq/timestamp pairs with **0 mismatches** in checked lat/lng/speed/heading/motion/seq fields. The GNSS polyline sums to about **1.40 km**, which is an observed position-path estimate rather than surveyed distance. Maximum reported speed **51.54 km/h**. HDOP p50/p95 **0.54/0.87**; HDOP is not an absolute accuracy measurement.

All 299 raw observations carried service status offline, direction pending and no session ID, while device state was online. The initial 15 history documents were pre-existing; no active-ride or lock document appeared. Both final browser views showed service not started / ride not armed. This prevents lifecycle, boarding/chat, ETA, stop/completion and return-session acceptance.

Raw callback intervals exceeded two seconds **17 times**, largest **5.563 s**, before the intentional unplug. Twenty skipped sequence numbers between observed endpoints are **not a packet-loss estimate**. Full gap timestamps are in metrics-summary.sanitized.json. Raw-to-public observer lag p50/p95/p99 was **1.182/1.854/2.330 s**; this measures visibility in this collector, not a direct commit-to-commit interval.

## Transport, backend and hotspot

The tunnel inspector retained **293 telemetry requests**, all HTTP 202, plus one accepted diagnostic. Device serial independently retained **286 classified HTTP attempts: 276 accepted, 9 read timeouts (-11), 1 connection failure (-1)**, with 10 retry attempts. Three timed-out attempts correlate by both sequence and device-send timestamp to inspector HTTP 202. Those are accepted-at-inspector / unknown-device-ack outcomes, not definite delivery rejection. Unmatched attempts remain unknown. Inspector duration and device round trip measure different stages and windows.

All **75 local and 75 tunneled /health probes returned 200**. All 75 laptop TLS probes passed certificate validation; all 35 hotspot-gateway and 35 public-resolver ICMP probes succeeded. These periodic laptop probes do not prove continuous availability or the ESP32's link quality. ICMP, TLS, backend health and authenticated device requests remain separate measurements.

| Measurement | Samples | p50 | p95 | p99 | Max |
|---|---:|---:|---:|---:|---:|
| Device accepted HTTP round trip, ms | 276 | 584.0 | 1455.0 | 2103.0 | 2239.0 |
| Tunnel telemetry request duration, ms | 293 | 419.4 | 1156.3 | 1368.7 | 1465.4 |
| Local backend health RTT, ms | 75 | 5.6 | 11.4 | 19.2 | 19.2 |
| Tunneled backend health RTT, ms | 75 | 297.5 | 629.5 | 893.5 | 893.5 |
| Hotspot gateway ICMP RTT, ms | 35 | 3.0 | 40.0 | 116.0 | 116.0 |
| Public resolver ICMP RTT, ms | 35 | 27.0 | 121.0 | 285.0 | 285.0 |
| Laptop DNS lookup, ms | 75 | 24.0 | 97.3 | 163.4 | 163.4 |
| Laptop TCP connect, ms | 75 | 51.5 | 189.4 | 278.8 | 278.8 |
| Laptop TCP+TLS handshake elapsed, ms | 75 | 126.2 | 304.3 | 374.0 | 374.0 |

Device diagnostic at 17:48:40 IST reported fault none, queue depth 0, high-water 7, zero overflow drops, one cumulative stale drop, one cumulative checksum failure, zero UART overflow, RSSI -48 dBm and heap 143,088 bytes. The initial snapshot already had one stale drop/checksum failure/reset, so these are not newly established failures from this drive. Diagnostics span a five-minute interval partly before the drive and do not cover every instant or the final disconnect. Host CPU/RSS/thread/handle, Wi-Fi and network byte/error observations are retained in host-metrics.private.jsonl; this brief run does not establish long-term memory behavior or fleet capacity.

## Browser timing recovered

Both original browser exports and final screenshots are saved. Admin export contains **1,105 records**, Passenger **1,131**; within the cloud-recorder window there are **574 Admin** and **865 Passenger** records. Later exported records, including post-unplug stale/GPS-lost/reconnecting displays, remain in the original files but are excluded from test-window statistics. Browser console export was a final bounded query, not a continuous console capture.

Below are **moving samples only**, correlated by sequence/sample timestamp, tab/run, node and session. Cross-clock capture-to-browser intervals use the existing four-HTTP-timestamp estimator, assuming approximately symmetric transit; accepted-sample clock uncertainty p50/p95/p99 is **81.5/172.5/852 ms**, maximum 923 ms. Three serial clock-discontinuity candidates and two missing accepted-sample clock estimates are retained. These are estimates with uncertainty, not exact synchronized one-way measurements. Same-tab listener-to-render/target intervals use monotonic browser time.

| Measurement | Samples | p50 | p95 | p99 | Max |
|---|---:|---:|---:|---:|---:|
| Passenger capture → React marker snapshot, ms | 106 | 1850.0 | 2485.5 | 2831.5 | 2993.5 |
| Passenger capture → marker target, ms | 103 | 1876.0 | 2507.5 | 2852.5 | 3015.5 |
| Passenger listener → React snapshot, ms | 106 | 28.7 | 366.4 | 987.3 | 1125.1 |
| Passenger listener → marker target, ms | 103 | 50.6 | 400.2 | 998.9 | 1145.8 |
| Admin capture → React marker snapshot, ms | 35 | 1724.5 | 2727.5 | 3446.5 | 3446.5 |
| Admin capture → marker target, ms | 35 | 1746.0 | 2736.5 | 3457.5 | 3457.5 |

There are 202 accepted moving device samples in the serial correlation, 106 Passenger moving capture-to-React pairs and 103 Passenger capture-to-target pairs. This supplies over 100 moving latency observations, but not 1,000 contention samples, matched baseline/candidate usage, all roles, full-route lifecycle or independent position acceptance. Admin correlated coverage is sparse: 35 moving capture-to-React pairs. Across all states, one Admin same-sequence listener-to-render interval was **43.701 seconds**; its visibility/suspension cause was not instrumented, so it remains a coverage caveat rather than proof of an application stall. Missing renders/targets remain missing; they are not zero latency.

React marker snapshot and the marker target callback (5 cm tolerance) are software instrument boundaries. They do not independently certify actual display paint or physical positional accuracy. No chat message latency was measured. Logical listeners/application JSON byte estimates are not physical socket counts or billed cloud usage.

## Issue evidence allocation

| Open issue | Evidence retained | Explicit remaining gates |
|---|---|---|
| [#245](https://github.com/notnamansinha/Eki/issues/245) | Short real movement, raw/public delivery parity, complete device/HTTP retry evidence, health/hotspot timing, browser listener/marker timings, local source/build custody | Armed forward/reverse ride, ordered stops/direction/completion/dwell/return, controlled recovery, fleet/replica/load/contention and production/security/operations gates |
| [#246](https://github.com/notnamansinha/Eki/issues/246) | R34 local source/bin/ELF/map/hash evidence; R36 stopped/moving/presence observations | Exact installed image and MON-VER, effective secure toolchain evidence, policy decisions, 30/90-day windows, release index/deletion/monitoring and signatures |
| [#300](https://github.com/notnamansinha/Eki/issues/300) | 213 cloud moving samples, 202 accepted serial moving samples, 106 Passenger moving latency pairs, actual hotspot transport failures and intentional final power-off annotation | Independent truth/uncertainty, full-route/parallel-road/turnaround acceptance, coupled fault/recovery, threshold/owner sign-off and 1,000-sample contention |
| [#337](https://github.com/notnamansinha/Eki/issues/337) | Fresh moving follow-up with continuous raw bytes, device/cloud/HTTP/browser correlation, health and timing | Remaining authenticated feature census, lifecycle/provider/absolute accuracy and release acceptance |

## Capture integrity and corrections

1. The initial serial filename shadowed pySerial. It was renamed and restarted without sending device commands or intentionally asserting DTR/RTS. Serial starts about 15 seconds after cloud collection; this gap is not hidden. Failure and recovery logs/annotations are saved.
2. The earlier bounded preflight serial trace contains repeated/corrupt fragments. The actual test preserved **402,702 exact serial bytes** in 12,631 timestamped chunks and parsed **876 TelemetryTrace JSON records** with zero malformed trace prefixes. One valid JSON device_http record lacked a classified HTTP status and is excluded from the 286-attempt denominator. The preflight artifact is preserved separately.
3. At the intentional final disconnect, serial retries logged 58 port-unavailable errors through stop; these are not 58 independent device faults. No subsequent power-up or recovery was tested.
4. Browser download waiting timed out during preparation, but the downloaded file was recovered; final Admin and Passenger exports succeeded without reloading their tabs. Original complete exports and separately filtered test-window copies are both saved.
5. Automatic ZIP creation initially failed because it tried to include its own locked output log. That failure remains saved. The final archive uses atomic creation plus ZIP CRC and every-file SHA-256 verification; failed/preparation archives are historical artifacts, not the final evidence bundle.

## Evidence custody

Raw locations, device identifiers, screenshots, source snapshots and compiled firmware stay in this ignored private run folder and the final private ZIP. No raw evidence was posted to GitHub, and no firmware, route, credential or production deployment was changed. The evidence directory includes originals, sanitized CSV/metrics, role-specific detailed latency/realtime reports, analyst scripts, issue snapshot, source/working diff and local build artifacts.

The private evidence index retains the ZIP path and digest; its SHA256SUMS.json enumerates the evidence files. The verified original archive digest is `1244074ee9046b4fe398e21daed02f798bb93a0b6713f9f8510a45a0ca347cdb` (60 evidence files, 61 ZIP entries including its manifest). The archive is a second local copy on this laptop, not an off-device/cloud backup. All three owned recorder processes have exited; application services and browser tabs remain available.

## Follow-up in this PR

The previously recorded operator-form validation and false Selected stop defects were repaired in source commit 3a1486b, merged by PR #336 into testing at 8297c4f before this follow-up. This PR does not repeat those fixes or claim a new deployed retest. Archived-message permission denial and earlier degraded health remain live-environment investigations.

This PR preserves the field results, hardens the serial recorder with exact byte/chunk evidence and reconnect handling, repairs parsing of concatenated trace objects, explicitly reports location-only samples, and adds verified archival and the [preflight/runbook](../operations/FIELD_CAPTURE.md). The first parser regression failed before repair; eleven disposable Python fault cases exercise capture/reconnect/archival without hardware. Transport deadlines and firmware policy are unchanged: a timeout cause was not established by this run.

The source and validation in this PR are separate from the older firmware/browser artifacts used during the drive. PR merge and physical/deployed acceptance are still owner-controlled and pending.

## Follow-up validation — 20 October 2026

The [expanded re-verification record](REVERIFICATION_2026_10_20.md) supersedes the
initial tooling-only validation scope. It records 143 root script tests (11
Python capture/archive fault cases), 1,229 backend unit tests, 690 frontend
tests, 58 Firebase integration cases, 84 native host assertions, 97 browser
scenarios, the API authorization sweep, GNSS/property/reviewed-unit sub-oracles,
selective mutation, bounded admission soak, strict packaging and dependency
audits. Three defects were repaired: checksum overwrite, reverted-settings
dirty state, and incomplete raw-file writes. All evidence tiers and tested
commits are explicit in that record.

The six required local QA families pass on their recorded clean software
commit. The official catalog still reports NOT_RELEASE_READY; exhaustive
control/state mapping, real providers, deployed acceptance and physical gates
remain pending. The original drive still has no armed session. No firmware
flash, cloud/rules deployment or new physical acceptance is claimed.
