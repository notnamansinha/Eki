# Issue #246 priority software verification: 5 October 2026

| Document ID | Version | Status | Last updated |
|---|---|---|---|
| EKI-EVD-016 | 1.0 | Historical | 2026-10-05 |

Current merge and acceptance status belongs to [issue #246](https://github.com/notnamansinha/Eki/issues/246).
This record covers the requested R01–R11 and R25 continuation. Each part has its
own PR and exact-head CI before merging into `testing`. Update this record with
each part's actual implementation and evidence; an entry does not certify deployment.

| Part | Implementation and local verification |
|---|---|
| R01 | CORS/preflight precedes generous IP ingress; verified UID owns independent reads and mutations. GET/HEAD polling does not spend writes. Route/Places quotas use verified UID, and scoped device/probe exemptions retain their authorization. Actual HTTP admission tests cover shared IPs, forged credentials, CORS on ingress rejection, polling, device methods and non-admin health denial. All 636 backend cases passed; 7 emulator-only cases run separately in CI. All 59 script cases, 61-operation OpenAPI coverage, backend lint and TypeScript pass. The actual ride-session mount harness verifies 35 reads followed by all 30 writes and rejection of write 31, for three resource paths. |
| R04 | Readiness requires a true RTDB connected snapshot, bounded per-store single-flight probes and monotonic freshness. A timed-out underlying call keeps its slot until settlement; late results never republish success. `/live` stays independent of Firebase and is Docker's restart check; `/health` remains traffic readiness. Ten health regressions pass, including malformed/false snapshots, stalled repeated probes, late success and freshness expiry. All 646 backend cases and 59 script cases pass; OpenAPI now covers 62 operations. Backend lint and TypeScript pass. Three request-auth regressions and the actual admission/admin pipeline confirm one verification per request, fresh checks on later requests, and denial of injected identities/changed tokens. CI container smoke checks degraded readiness, successful liveness and the actual image healthcheck. |
| R08 | Independent monotonic leadership cutoff, unique process owners, persistent generations and lease validation in worker Firestore transactions/batches. RTDB callbacks recheck expiry/reject older destination generations; conditional stale cleanup and original-context shutdown prevent stale work escaping revocation. 47 targeted coordinator/fence/engine cases pass; actual Linux-container Firebase emulators pass all 10 rules/fencing cases. Baseline stalled-renewal and late-acquisition regressions failed before the fix. Clock skew is limited to 2 seconds; dispatched Auth/recursive deletes and cross-store RTDB limits are documented in the [worker leadership guide](../operations/WORKER_LEADERSHIP.md). Exact-head CI/merge evidence belongs to #246; staged replica and moving acceptance remain #245. |

The previous six selected parts and their evidence remain in
[the 4 October record](ISSUE_246_SELECTED_PARTS_2026_10_04.md).
R01 is merged in [PR #254](https://github.com/notnamansinha/Eki/pull/254);
R04 and its request-authentication correction are merged in
[PR #255](https://github.com/notnamansinha/Eki/pull/255).
R05 is merged in [PR #256](https://github.com/notnamansinha/Eki/pull/256).
R06 is merged in [PR #257](https://github.com/notnamansinha/Eki/pull/257).
API policy changes are reflected in `backend/API.md`, its generated mirror,
`backend/openapi.json`, the HTTP contract and low-level design.

R05: device/digest misses share one bounded registry/KDF fill. Sixteen unsettled
fills and 64 waiting callers per digest cap retained work; a 5s monotonic
response deadline keeps the underlying slot occupied until real settlement.
Positive/negative TTLs remain at most 60s/5s from fill start. Invalidation fences
in-flight work across all digests; listener failure clears cached authorization.
Detailed admin health exposes only fill/waiter counts. Targeted verification:
45 cases across the actual credential service and bounded-fill helper, including
20 identical callers, wrong-secret isolation, rotation/reassignment during device
and post-KDF registry reads, failed-fill recovery, positive/negative expiry,
listener failure, overload and timed-out retry amplification. Full local checks:
659 backend cases, all 59 script cases, OpenAPI 62 operations, lint and TypeScript.

R06: the leader's initial/completed RTDB snapshots and actual telemetry ingestion
recover a durable return after the claim/publication crash window. Recovery reads
the active ride, bus lock and non-terminal session together, then restores only
that session or its completed predecessor with the matching return claim. It
protects newer live sessions, changed locks, terminal sessions and conflicting
claims; no new session/lock/history is created. New claims bypass earlier miss
cache entries. Newer GNSS data and uncertainty survive an older recovery sample,
and old reroute/delay state does not leak into the return. Eight actual helper/
ingestion integration cases and the initial-snapshot engine regression pass.
Recovery is single-flight with 16 admitted keys and drains before Firebase shutdown.
All 668 backend cases, 59 script cases, OpenAPI 62 operations, lint and TypeScript
pass locally. One legacy source-string assertion initially referenced the old
two-argument scheduling call; it now checks propagation of the actual claim ID.
Moving and physical crash acceptance remain separate in #245.

R25 software: publisher/diagnostic DNS runs on the TCP/IP callback thread with
one retained owner slot and a one-second caller budget. Expiry cannot spawn more
queries; late results and changed network epochs fail closed. The SDK DNS cache,
hostname-validated TLS, per-task key ownership and healthy HTTP reuse remain.
Eight native policy cases and seven tests of the actual production resolver
under controlled native radio/TCP-IP adapters cover stalls, overload, retries,
disconnection and recovery. All 82 native cases pass and the actual pinned SDK
development build passes. The new [DNS guide](../hardware/DNS_COLD_CONNECT.md)
documents budgets, transport scope and physical limits. The source is reviewed in
[PR #258](https://github.com/notnamansinha/Eki/pull/258), merged into `testing`
at `c9bfee775b2ce694ebb76e2be5977843b367c66f`. Both final exact-head CI runs
([push](https://github.com/notnamansinha/Eki/actions/runs/37231192272),
[PR](https://github.com/notnamansinha/Eki/actions/runs/37231195726)) passed on
`e43a11f73e94ae1f208c22e6c3a2967dfa094133`, including all web/backend, actual rules, synthetic browser,
strict export, container, quiet/journal/signed fleet build checks. The Windows
private journal build also passed after resolving ESP-IDF's path-space/tooling
limitations; there was no change to repository build or provisioning security.

Stationary R25 fault acceptance on COM3: first inspect security flags read-only,
validate the original app0/coredump layout, back up the complete current app and
journal, and validate the app checksum/hash. The stub's full read encountered a
digest error; bounded chunk reads and one ROM read completed the backup before
installation. A temporary private publisher fixture compiled from R25 code
blackholed DNS to loopback, restored DNS, disconnected/reconnected Wi-Fi and
performed a wrong-hostname TLS handshake with the original CA. It sent no HTTP
request or credentials on the TLS probe. Its app-only image SHA-256 was
`c7245995f62b02d877e1779af60eb9f7b071d1cc61d5407360aff37bbeaae4a0`;
esptool verified the write at `0x10000`. No bootloader, partition table, NVS or
fuse write was performed. The fixture is excluded from the PR and final app.

Measured: blackholed DNS rejected at 1,000 ms; 100 expired retries rejected in
1 ms total; offline DNS rejected in 0 ms; wrong-hostname TLS rejected in 110 ms.
The 120-second capture recorded 119 GNSS samples (maximum serial sample gap
1,047 ms), 109 HTTP 202 acknowledgements, all with stopped motion state, and no
watchdog/panic/brownout/credential-fault log. Successful telemetry reconnected
with DNS 1 ms, key preparation 258 ms and TLS connect 691 ms. HTTP duration
p50/p95/max was 522/1,082/2,247 ms. Minimum heap was 165,740 bytes and publisher
stack headroom 14,580 bytes. Twelve checkpoint commits succeeded. These are a
stationary fault window, not fleet tail latency or a moving-route acceptance.

Original source was restored exactly and the preserved reviewed private journal
image installed and verified at `0x10000`: SHA-256
`28cd2bdd9324145bafe25fe081f3a98c5eafe8fd9d76223c91cc635ee51e44c5`,
952,736 bytes, source `3cb9bebb48f75acf0207fd25ee23f22935e4b86c` plus the matching
ignored device configuration. Final documentation-only changes do not change
that firmware source. The original five compiled device/network values were
checked against the working app without exposing them. The 120-second normal
image window recorded 120 GNSS samples (max serial gap 1,079 ms), 115 HTTP 202
acknowledgements, no watchdog/panic/brownout/credential-fault log, and 12 successful
checkpoint writes. Cold telemetry connection: DNS 63 ms, key preparation 252 ms,
TLS connect 747 ms. HTTP duration p50/p95/max: 572/1,104/2,388 ms. One telemetry
connection setup served all 115 acknowledgements, preserving healthy reuse.
Minimum heap was 166,396 bytes and publisher stack headroom 14,396 bytes.
This tests firmware against the existing reachable backend; it does not establish
a new backend deployment or the remaining authenticated browser/deployment gates.
An independent post-installation read confirmed the partition table remained
byte-for-byte unchanged. Its subsequent 60-second reset/cold capture had 60 GNSS
samples and 55 complete parsed HTTP 202 records. It also contained 67 malformed
or repeated serial trace fragments, which were excluded from acknowledgement
counts; substring counting incorrectly reported 120 and is not valid evidence.
Cold DNS/key/TLS was 65/253/698 ms. No watchdog/panic/brownout/credential-fault log
was observed. The two earlier 120-second windows had no malformed trace lines.
The subsequent clean 60-second warm window had 60 GNSS samples and 60 fully
parsed HTTP 202 acknowledgements, no malformed trace or fault line, no new
telemetry/diagnostic connection setup, and six successful checkpoint commits.
HTTP duration p50/p95/max was 573/1,165/1,264 ms, with max GNSS serial gap 1,063 ms.
The normal reviewed image remains installed; the temporary fault fixture and
its DNS/radio changes have been removed.
After merge, #246's R25 checklist and #245's baseline were updated immediately.
Related existing closed issues #26/#30/#31/#56/#67/#159/#225 have refreshed
documentation and scope qualifications. Earlier priority updates already refreshed
#28/#48/#74/#207 and the still-open deployment tracker #204. Neither #245 nor
#246 currently has attached GitHub child subissues; their existing referenced
issues were updated without inventing new issues or closing physical gates.
Captures/configurations remain ignored
and private; public evidence contains no location, hostname or credentials.

Stationary baseline: COM3 was read without flash, reboot or serial writes.
Twenty GNSS/telemetry samples from the previously installed firmware received
HTTP 202. Private raw captures remain ignored; this is baseline connectivity
evidence, not acceptance of newly built firmware or moving behavior.
[Issue #245](https://github.com/notnamansinha/Eki/issues/245) retains moving,
physical fault, secure-board and rollout gates. R25 bench evidence must name
the actual installed build before it can certify that implementation.

## R02 bounded admission verification

Baseline actual helpers reproduced 4 active + 96 waiting KDF calls, 20 workers
for 20 matcher keys, and 100 ordered writes with fingerprint capacity 1. Fixed
ceilings and the five-second undispatched budget are documented in
[work admission](../operations/WORK_ADMISSION.md). Admitted durable work remains
FIFO; dispatched operations retain permits until actual settlement. Rejected
lifecycle intake/write work requests one 25-item paginated current-state replay,
with missing-node recovery guarded by current presence and canonical ownership.

The engine stall regression admits 8 active/256 waiting out of 300 events and
recovers a rejected current node; returned presence/new-owner regressions prevent
stale offline recovery. Actual Linux-container Firebase emulators pass all 11
rules/fencing/ordering cases, including a committed write with its acknowledgement
held, queued expiry and a newer final write. The helper acceptance script submits
250,000 jobs to each of the production KDF/writer/matcher primitives. Five post-GC
heap samples were 7,072,992 / 7,104,680 / 7,150,704 / 6,267,696 / 6,273,296 bytes;
retained growth was -799,696 bytes. Active/waiting stayed at 4/32, 8/256 and 8/256.
RSS grew during warmup from 170,536,960 to 203,784,192, then was
208,809,984 / 208,855,040 / 209,068,032 bytes. All pools drained/reopened and FIFO
passed. These are synthetic local Node v24.19.0 measurements, not fleet-load or
end-to-end latency evidence. The same script is an exact-head CI acceptance step.

R08's merged testing commit c353318 also passed its own
[verification run](https://github.com/notnamansinha/Eki/actions/runs/37234282478).
R02 PR/head/merge and complete check results are tracked in #246 after verification.
R03 retains whole-ingestion dependency/response deadlines; #245 retains staged
replica and moving-route evidence. Recovery cannot reconstruct movement/times
never observed or committed during overload. R34 remains open; the board and
production remain untouched.

## R03 telemetry deadline verification

Both actual-ingestion baseline regressions failed before the fix: a committed
transaction with a held acknowledgement never bounded its caller, and an
expired delayed SDK callback could still publish an old fix. Telemetry now
uses monotonic immediate/capped admission, two-second queue age, five-second
dependency stages within an eight-second total service response budget, and
eight active/32 waiting pipelines (one waiting/device). Raw dispatched promises
retain permits and per-device order through actual settlement. Expired callbacks
abort, including when the timer callback has not run. Repeated timed-out retries
do not multiply the stalled telemetry operation. Queued KDF work rechecks the
credential/deadline authority before expensive computation starts.

Actual service regressions cover a held committed acknowledgement with 20
retries, expired callback, quota reservation expiry, queued request expiry and
expired queued KDF. Monotonic helper cases cover cumulative stage budgets,
wall-clock rollback, actual permit retention and delayed timer callbacks. HTTP
contract cases validate both `not_dispatched` and `unknown` 503 states with a
one-second retry header. Actual Linux-container Firebase emulators pass all
12 rules/fencing/ordering/deadline cases; the new case verifies committed RTDB
state, held acknowledgement, retained capacity and a newer final update.

All 438 frontend cases, 59 script checks, 62-operation OpenAPI/UI contracts,
lint/TypeScript and zero-vulnerability audit pass locally. The final backend
suite passes all 724 cases, including the queued-KDF regression; strict-build/CI
results and PR merge are tracked in #246. The
[telemetry deadline contract](../operations/TELEMETRY_DEADLINES.md), API/README
mirrors, health schema, design, configuration and testing index are updated.

R02's merged commit baeb878 passed its own
[verification run](https://github.com/notnamansinha/Eki/actions/runs/37269141912)
and all 67 targeted bounded queue/replay/engine cases on the merged tree.
R03 changes service execution after validated body parsing; Node body/header
receipt timeouts remain separate. A permanently unresolved SDK call deliberately
keeps its slot unavailable; synthetic checks do not certify staging latency or
replica capacity. GNSS/ESP32 are disconnected and local dev/ngrok stopped by the
owner. No board or production change occurred. #245's live/moving/physical gates
and R34 remain open. R07 retains durable resource/stranded-lock recovery.

## R09 bounded reconciliation software evidence

Baseline reproductions exposed 600 simultaneous held session reads, unbounded 601-session summaries, only 500 of 1001 drivers visited, and a missed conflicting 301st bound device. Document-ID pages now bound query/results/caches to 100 records, with four session or ten fleet pipelines. Worker checkpoints resume failed/interrupted pages and preserve leadership fencing; admin jobs/legacy headers expose continuation. Per-bus repair/validation traverses all pages and shares the durable fleet mutex with periodic work. SDK pairs/batches settle fully after failure before freeing ownership. Actual RTDB tests also reproduced an empty-local-cache transaction abort; server retries now perform conditional cleanup.

Regression and actual loopback-emulator evidence covers full 1001-driver traversal (synthetic Auth), 201 interrupted stale sessions with protected newer/unknown lifecycles, beyond-cap device conflicts and inactive RTDB cleanup. The [operating contract](../operations/RECONCILIATION.md) records bounds, new-key continuation after settled outcomes, partial mutations, legacy audit locks and stopped-executor recovery. Final suite/CI/head/merge evidence is recorded in #246 after verification. Live Auth, suitable staging indexes, replica load/supervision and latency remain #245 acceptance gates. Board/dev/ngrok remain disconnected/stopped; R34 remains open.

Local final verification: 753 backend cases, 438 frontend cases (two workers after startup/resource timeouts in an overlapping default run), 59 script checks, 68-operation OpenAPI/UI contracts, lint/TypeScript, strict production export/CSP/service worker, ten mobile/desktop browser cases and zero-vulnerability audit. All 17 actual Linux-container emulator cases pass; live Auth is synthetic in fleet tests. Final exact-head CI and merged verification remain mandatory before completion.

## R10 privacy deletion recovery software evidence

Baseline regressions reproduced three failures: resubmission reset attempts/error/due-time history; twenty poison requests starved a later passenger; and poison attempts exceeded five without a failed state. Transactional resubmission now preserves that history. Current Auth/profile/driver membership admits claim-less passengers safely, and the shared fleet mutex protects eligibility and Auth dispatch. Worker scans use durable twenty-record cursors, one raw execution/twenty waiting, two-second undispatched age and thirty-second dispatch authority. Cleanup yields after fixed 200-record pages. Five consecutive failed executions dead-letter with jittered exponential backoff; admin monitoring and exact-generation recovery preserve lifetime history.

Regression coverage includes 1001-record histories, late claim replacement, hung raw Auth with bounded admission and refused active recovery, current operators/account recreation, and deliberate failed-cycle recovery. Three actual loopback Firestore cases verify later-user traversal, indexed/legacy manifests and collection-group cleanup, and a disposable worker killed during synthetic Auth. The killed executor really committed its claim/mutex/cleanup; the test accelerates only the elapsed claim deadline after confirmed process exit, then recovers claim before lock and refuses a changed account identity. No live Auth or board action occurred.

Local verification: 766 backend tests, 438 frontend tests, 59 script checks, 70-operation OpenAPI/UI contracts, frontend/backend lint and TypeScript, strict production export/service worker/CSP, all twenty actual emulator cases and zero dependency vulnerabilities. All ten mobile/desktop synthetic browser cases pass. Exact-final-head CI and merged-tree evidence are recorded in #246 when verified. [Privacy recovery](../operations/PRIVACY_DELETION.md) documents current bounds and staging limits. Already-dispatched external effects, console/CLI changes and delayed authenticated clients need staging quiescence/supervisor/index/Auth evidence; universal concurrent-client or backup erasure and institutional acceptance are not certified. R34 remains open.

## R12 versioned route catalog software evidence

Five baseline failures reproduced 60 pending-fix route reads, duplicate pending fills, unused watcher snapshots, telemetry-triggered legacy Google repair and redundant post-edit reads. The catalog now uses watcher snapshots directly, five-minute monotonic freshness, coalesced pending/resolved fills and 1000-entry LRU data/generation bounds. Unique generations fence old callbacks after eviction, reconnect and edit/deletion; configured telemetry reads are read-only. Durable direction transactions read current route versions/stops, and unknown committed directions reconcile without rollback.

Actual loopback SDK testing also exposed an empty-local-cache RTDB abort; callbacks now retry against server state before applying their existing predicates. Three actual emulator cases check sixty pending fixes with zero additional explicit route point reads/Google calls, edited/deleted endpoints and armed session/lock projection; delayed watcher delivery after a real route edit refuses obsolete durable direction and resets only provisional state; injected acknowledgement loss after a real direction commit recovers without rollback or a new session. Final suite/head/CI/merge results are recorded in #246 after verification. Live propagation/provider/replica/moving acceptance remains #245; the board and production stay untouched and R34 remains open.

Local final verification: 773 backend tests, 438 frontend tests, 50 focused catalog/live-routing/mirror checks, 59 script checks, 70-operation OpenAPI/UI contracts, all 23 actual emulator cases, frontend/backend lint and TypeScript, strict production export/service worker/CSP, ten synthetic mobile/desktop browser cases and zero dependency vulnerabilities. One existing diagnostics test timed out during the initial overlapping run; the entire backend suite passed on rerun without changing that test or its timeout. Exact-final-head CI and merged verification remain required.

## R13 read-only passenger geometry software evidence

Three baseline failures reproduced passenger/admin GET repairs and sixty point reads for sixty unchanged geometry requests. Cached GET is now strictly read-only, with explicit repair-required responses and independent read/computation quotas. Authorized versioned admin saves repair legacy geometry through a shared bounded provider pool. HTTP/cache/limiter tests exercise enumeration without writes/provider calls, admin-only repair, stale-fill invalidation, fixed bounds and raw stalled permits; actual loopback Firestore watcher testing covers cached edits/deletions. Final suite/head/CI/merge evidence is recorded in #246 after verification. Live provider/replica/moving acceptance stays #245; no board or production action occurred, and R34 remains open.

Local final verification: 783 backend tests, 438 frontend tests, 40 focused read/cache/limiter/polyline/catalog tests, 80 security/document-mirror/OpenAPI checks, 59 script checks and 70-operation OpenAPI/UI contracts. All 24 actual emulator cases, lint/TypeScript, strict production export/service worker/CSP and zero-vulnerability audit pass. All ten synthetic mobile/desktop browser cases pass on the independent rerun; one mobile initial-screen assertion failed during overlapping checks. A source-inspection assertion was updated to follow the extracted limiter helper; the entire backend suite then passed. Exact-final-head CI and merged verification remain mandatory.
