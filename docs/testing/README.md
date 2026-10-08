# Testing and acceptance evidence

Last updated: 2026-10-06 15:15 IST (UTC+05:30).

## Start with the current gates

- [Current A–Z execution ledger](WEBAPP_A_Z_AB_TESTING.md): all 351 feature
  cases, actual localhost outcomes, software evidence and pending gates.
- [Full supplied A–Z plan](WEBAPP_A_Z_AB_TESTING_PLAN.md): preserved historical
  inventories, control/API/race matrices and current contract overrides.
- [Test strategy](TEST_STRATEGY.md): software, rules, browser, firmware and
  physical checks; required commands and their limits.
- [3 October acceptance](TESTING_ACCEPTANCE_2026_10_03.md): later consolidated
  browser, journal installation, physical cuts and short moving evidence.
- [Cold-power/motion audit](COLD_POWER_MOTION_AUDIT_2026_10_03.md): source and
  physical evidence for checkpoint recovery, motion and remaining gates.
- [Issue completion record](ISSUE_COMPLETION_2026_10_03.md): issue-specific
  outcomes and qualifications at the recorded baseline.

These are evidence records. Read each commit/build, run window, conditions and
limitations before relying on a result. An editorial update timestamp does not
mean the test was rerun. CI success, synthetic browser tests, stationary traces,
short motion traces and a full observed route are different kinds of evidence.

## Latest source changes after the recorded acceptance

The [4 October selected-part record](ISSUE_246_SELECTED_PARTS_2026_10_04.md)
describes map/ETA, firmware maintenance, clock, timing, allocation and canonical
configuration changes for [issue #246](https://github.com/notnamansinha/Eki/issues/246).
Use that issue's merged PR checklist and exact-head CI for current implementation
status. R34 and the physical/deployment gates in issue #245 remain open.

The [5 October priority record](ISSUE_246_PRIORITY_PARTS_2026_10_05.md) covers
the subsequent R01–R11/R25 continuation. R01 ([#254](https://github.com/notnamansinha/Eki/pull/254))
and R04 ([#255](https://github.com/notnamansinha/Eki/pull/255)) are merged into
`testing`, followed by R05 ([#256](https://github.com/notnamansinha/Eki/pull/256))
and R06 ([#257](https://github.com/notnamansinha/Eki/pull/257)), then R25
([#258](https://github.com/notnamansinha/Eki/pull/258)) at `c9bfee7`, with their
exact-head checks. Follow #246 for later merges;
the record names software tests and separates stationary GNSS baseline evidence
from acceptance of newly installed firmware.
R25's [bounded DNS guide](../hardware/DNS_COLD_CONNECT.md) and
[PR #258](https://github.com/notnamansinha/Eki/pull/258) include native/SDK checks
and 5 October stationary installed-image evidence for controlled DNS, Wi-Fi and
TLS failure/recovery. The priority record names the final image hash, cold/warm
timings, GNSS continuity and the remaining physical/moving gates.

The historical admin baseline `abd45a6` (4 October 2026) includes PR #205: App Check readiness,
the development-only opt-out, admin feedback HTTP loading/status and pending
verification/session guards during sign-out. PR #244 adds passenger in-app
station/bus dropdowns. Their behavior is maintained in [frontend guide](../../frontend/README.md),
[configuration](../CONFIGURATION.md) and [API reference](../../backend/API.md).

Use current test/CI output to validate newer commits. `npm run test:e2e:admin`
uses synthetic Firebase adapters; it cannot certify live provider enforcement.

## Evidence catalog

R08's [worker leadership guide](../operations/WORKER_LEADERSHIP.md) defines
independent expiry, the 2-second clock tolerance, destination checks and
cross-store limits. The priority record and #246 track its actual verification;
software/emulator checks do not close #245's live replica and route gates.

| Record | Purpose |
|---|---|
| [Full-feature QA](FULL_FEATURE_QA_2026_10_03.md) | Feature coverage at the recorded software baseline |
| [Passenger preview QA](PASSENGER_PREVIEW_QA_2026_10_03.md) | Route preview, stationary bus and destination behavior |
| [RTDB field audit](RTDB_FIELD_CONTRACT_AUDIT_2026_10_02.md) | Field necessity and compatibility decisions |
| [Live latency/recovery audit](LIVE_LATENCY_RECOVERY_AUDIT_2026_10_02.md) | Trace classification, recovery and latency limits |
| [GNSS trace validation](ADAPTIVE_GNSS_TRACE_VALIDATION.md) | Adaptive jump and recovery evidence |
| [Reroute simulations](REROUTE_SIMULATION_RESULTS.md) | Deterministic route/matching scenarios; not field latency |
| [Return-route acceptance](RETURN_ROUTE_ACCEPTANCE.md) | Direction/turnaround evidence and open physical cases |
| [Stationary readiness](STATIONARY_READINESS_REPORT.md) | Stationary runtime checks at its recorded build |
| [Non-moving recovery](NON_MOVING_RECOVERY_REPORT.md) | Backend/tunnel/reboot recovery window |
| [Live ESP32 latency](LIVE_ESP32_LATENCY_RESULT.md) | Actual device/backend measurements and TLS profile |
| [Transport evidence audit](REALTIME_TRANSPORT_EVIDENCE_AUDIT.md) | Available transport evidence and missing same-window usage/paint data |
| [Postfix stationary trace](POSTFIX_STATIONARY_TRACE.md) | A later stationary delivery window |
| [Earlier audit summary](AUDIT_STATUS_SUMMARY.md) | Historical fixes/readiness; superseded as a current status page |

## Browser fixtures

| Fixture | Runbook | Scope |
|---|---|---|
| Admin access | [Admin fixture](../../e2e/admin-access/README.md) | Real auth/guard/admin/feedback modules; synthetic SDK and backend data |
| Passenger/responsive | [UI fixture](../../e2e/fixtures/README.md) | Real passenger/settings/map logic; synthetic hooks and map SDK |
| Motion | [Motion fixture](../../e2e/motion/README.md) | Render/interpolation behavior; synthetic input |

## Remaining acceptance

Use the latest consolidated report and [deployment checklist](../operations/UNIVERSITY_DEPLOYMENT_CHECKLIST.md)
to track full-route/turnaround, weak-network and off-route paint evidence,
long soak, secure fleet first boot/OTA, monitoring and institutional approval.
Do not close a gate from source review or mock data alone.

R02's [work admission guide](../operations/WORK_ADMISSION.md) documents bounded
queues, current-state replay and the reproducible stalled-helper memory check.
The priority record reports measured heap/RSS and emulator ordering evidence;
it does not certify live fleet throughput or moving-route recovery.

R03's [telemetry deadline guide](../operations/TELEMETRY_DEADLINES.md) records
response/dependency/queue budgets and held-acknowledgement acceptance. Software
checks continue with the GNSS/ESP32 disconnected; field/live gates stay in #245.

## R07 operation recovery (5 October 2026)

[Operation resources](../api/OPERATION_RESOURCES.md) records the current bounds
and stop/audit/recovery procedure. Regressions reproduce unbounded independent
executors and stranded expired claims. `httpOperations.integration.test.ts`
kills a disposable child after actual emulator claim/effect commits, discovers
and abandons its unknown outcome, releases its lock with an atomic audit, and
proves same-key submission does not replay effects. A second emulator case
finds 31 expired claims across 25-record pages. These are software fault tests;
Google billing, Auth revocation uncertainty and replica supervisor termination
need suitable staging evidence. No physical GNSS or production mutation occurs.

## R10 privacy recovery (5 October 2026)

[Privacy deletion recovery](../operations/PRIVACY_DELETION.md) records bounded pagination/chunks, retry history, current passenger eligibility and admin monitoring/recovery. Emulator cases use actual Firestore SDKs and a killed disposable worker with synthetic Auth. They cover 1001 feedback records, indexed/legacy manifests and personal collection groups; no physical telemetry or live Auth is required. Staging and institutional privacy sign-off remain #245.

## R12 route catalog (5 October 2026)

[The telemetry route catalog](../operations/ROUTE_CATALOG.md) documents watcher-populated bounded state, shared freshness reads and edit/deletion fencing. Actual Firestore/RTDB cases process sixty unchanged pending fixes without explicit route point reads, preserve armed direction binding, refuse delayed-watcher stale direction and recover a real committed direction after injected acknowledgement loss. Coordinates/Google are synthetic; live/moving/replica acceptance remains open.

Passenger geometry reads are cached and read-only; explicit versioned admin saves perform legacy repair through bounded computation. See [geometry read/repair contract](../operations/ROUTE_GEOMETRY_READS.md) for fixed bounds, independent quotas and staging limits.
