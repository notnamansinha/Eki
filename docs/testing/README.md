# Eki Testing and Evidence Index

| Document ID | Version | Status | Last updated |
|---|---|---|---|
| EKI-TST-001 | 1.0 | Current | 2026-10-30 |

## 1. Purpose

This index lists the documents that define how Eki is tested and every dated evidence record in the repository. It states what kind of evidence each record holds, which later record corrects or replaces it, and which acceptance gates remain open. Use the [test strategy](TEST_STRATEGY.md) to choose and run checks.

## 2. Programme documents

| ID | Document | Use it to |
|---|---|---|
| EKI-TST-002 | [Test strategy](TEST_STRATEGY.md) | Choose and run checks; see levels, commands, environments and CI jobs |
| EKI-TST-003 | [QA programme](../../qa/README.md) | Understand the acceptance catalog, evidence levels and execution ledger |
| EKI-TST-004 | [Browser acceptance](../../qa/BROWSER_ACCEPTANCE.md) | Run the disposable L3 browser suite |
| EKI-TST-005 | [Emulator acceptance](../../qa/EMULATOR_ACCEPTANCE.md) | Run the L2 emulator suites |
| EKI-TST-006 | [Execution ledger](../../qa/EXECUTION_EVIDENCE.md) | Combine family reports for one commit |
| EKI-TST-007 | [Field acceptance package](../../qa/FIELD_ACCEPTANCE.md) | Prepare and record a witnessed L5 run |
| EKI-TST-008 | [GNSS properties](../../qa/GNSS_PROPERTIES.md) | Run and replay the deterministic GNSS properties |
| EKI-TST-009 | [HTTP authorization sweep](../../qa/HTTP_AUTHORIZATION.md) | Run the L2 negative authorization matrix |
| EKI-TST-010 | [HTTP policy sub-oracles](../../qa/HTTP_UNIT_EVIDENCE.md) | Read the 12 October 2026 HTTP boundary selection |
| EKI-TST-011 | [Native firmware evidence](../../qa/NATIVE_EVIDENCE.md) | Run the native firmware evidence collector |
| EKI-TST-012 | [Reviewed unit sub-oracles](../../qa/REVIEWED_UNIT_EVIDENCE.md) | Run the reviewed L1 unit selection |
| EKI-TST-013 | [Scheduled reliability](../../qa/SCHEDULED_RELIABILITY.md) | Understand the nightly and weekly workflows |

Two machine-parsed files hold the acceptance requirements and their historical status. Do not change their table structure: `scripts/qa/acceptance-catalog.mjs` parses both.

- [A to Z acceptance plan](WEBAPP_A_Z_AB_TESTING_PLAN.md): 351 feature cases, 22 per-control matrix entries (C01 to C22), 18 per-HTTP-operation matrix entries (H01 to H18), 8 experiment protocols and 20 GNSS generator profiles, followed by historical appendices.
- [A to Z execution ledger](WEBAPP_A_Z_AB_TESTING.md): a historical status note for each of the 351 feature cases. The catalog keeps these notes separate from current execution evidence.

The [Antigravity browser testing skill](EKI_Antigravity_Webapp_Testing_Skill.md) and its [installable package](skills/eki-antigravity-webapp-audit/SKILL.md) are instructions for an automated browser auditor. `e2e/places-audit-recipe.spec.ts` checks their Places recipe.

## 3. Reading an evidence record

Every record below has Status `Historical`. Its body is the original result: commits, measurements, dates and limits apply to the run it describes, not to the current code. The control block date is the record's own last update, which can be later than the run. Corrections are made in a newer record, never by editing an old one.

| Type | Meaning |
|---|---|
| Synthetic | Automated tests, simulations, emulators or fixtures with synthetic identities and coordinates |
| Browser | The real application in a browser with real accounts, on localhost or a deployed site |
| Stationary physical | The ESP32 and GNSS receiver powered and connected, but not moving |
| Moving physical | The tracker in a moving vehicle |
| Audit | Review of source, issues, CI runs or supplied reports, usually with repairs and regression tests |

CI success, a synthetic browser test, a stationary trace, a short moving trace and a complete observed route are different evidence. A record of one type does not close a gate that needs another.

## 4. Evidence register

| ID | Date | Record | Type | Notes |
|---|---|---|---|---|
| EKI-EVD-001 | 2026-10-04 | [Adaptive GNSS trace validation](ADAPTIVE_GNSS_TRACE_VALIDATION.md) | Synthetic | Blocked: no recorded real-drive traces were available |
| EKI-EVD-002 | 2026-10-06 | [Local admin permission recovery](ADMIN_PERMISSION_RECOVERY.md) | Synthetic | Software recovery only; App Check statements predate its removal (EVD-052) |
| EKI-EVD-003 | 2026-10-27 | [Adversarial component audit, 25 October](ADVERSARIAL_AUDIT_2026-10-25.md) | Audit | Sixteen areas attacked with a failing test per defect; open defects needing product decisions |
| EKI-EVD-004 | 2026-10-11 | [Readiness audit Low findings](AUDIT_LOW_DISPOSITION_2026_10_11.md) | Audit | Disposition of grouped Low findings |
| EKI-EVD-005 | 2026-10-04 | [Audit fixes and physical-test readiness](AUDIT_STATUS_SUMMARY.md) | Audit | Status as of 2026-09-14; this index replaces it as a status page |
| EKI-EVD-006 | 2026-10-08 | [GitHub issue inventory, 8 October](BALCONY_ISSUE_INVENTORY_2026_10_08.md) | Audit | Inventory of 115 issues for EVD-007 |
| EKI-EVD-007 | 2026-10-08 | [Balcony GNSS readiness](BALCONY_READINESS_2026_10_08.md) | Stationary physical | Its uncommitted readiness fix is committed in EVD-026 |
| EKI-EVD-008 | 2026-10-06 | [Passenger boarding request budgets](BOARDING_REQUEST_BUDGETS.md) | Synthetic | Its code-based boarding is superseded by EVD-030 |
| EKI-EVD-009 | 2026-10-11 | [First CodeQL findings review](CODEQL_FINDINGS_2026_10_11.md) | Audit | Seven CodeQL alerts |
| EKI-EVD-010 | 2026-10-04 | [Cold power and moving-marker follow-up](COLD_POWER_MOTION_AUDIT_2026_10_03.md) | Stationary physical | Run 2026-10-03; pending claims superseded by EVD-055 |
| EKI-EVD-011 | 2026-10-11 | [Delta brief and QA patch review](DELTA_BRIEF_REVIEW_2026_10_11.md) | Audit | |
| EKI-EVD-012 | 2026-10-04 | [Full feature QA, 3 October](FULL_FEATURE_QA_2026_10_03.md) | Synthetic | Fixture and unit coverage at the recorded baseline, plus Chrome checks against live data |
| EKI-EVD-013 | 2026-10-25 | [GNSS automatic service verification](GNSS_AUTOMATIC_SERVICE_VERIFICATION_2026_10_25.md) | Synthetic | Automatic ride admission without a manual start request; emulator, native and fixture runs |
| EKI-EVD-014 | 2026-10-27 | [Google sign-in recovery](GOOGLE_SIGN_IN_RECOVERY.md) | Browser | Production sign-in incident of 2026-10-21 and its repair |
| EKI-EVD-015 | 2026-10-25 | [Historical movement and passenger tracking audit](HISTORICAL_MOTION_AUDIT_2026-10-25.md) | Audit | PR #381 |
| EKI-EVD-016 | 2026-10-05 | [Issue #246 priority software verification](ISSUE_246_PRIORITY_PARTS_2026_10_05.md) | Synthetic | R01 to R11 and R25; includes stationary installed-image checks |
| EKI-EVD-017 | 2026-10-04 | [Issue #246 selected-part software evidence](ISSUE_246_SELECTED_PARTS_2026_10_04.md) | Synthetic | R24, R26 to R29, R33 |
| EKI-EVD-018 | 2026-10-04 | [Testing issue and PR cross-check](ISSUE_COMPLETION_2026_10_03.md) | Audit | Run 2026-10-03 |
| EKI-EVD-019 | 2026-10-04 | [ESP32 live bench result](LIVE_ESP32_LATENCY_RESULT.md) | Stationary physical | Bench run 2026-09-13 through an ngrok tunnel |
| EKI-EVD-020 | 2026-10-04 | [Live latency, storage and recovery audit](LIVE_LATENCY_RECOVERY_AUDIT_2026_10_02.md) | Stationary physical | Run 2026-10-02 |
| EKI-EVD-021 | 2026-10-11 | [Live non-motion inventory](LIVE_NON_MOTION_INVENTORY_2026_10_11.md) | Browser | Live cloud checks and controlled faults, tracker stationary |
| EKI-EVD-022 | 2026-10-20 | [Short moving GNSS capture, 19 October](MOVING_GNSS_CAPTURE_2026_10_19.md) | Moving physical | No ride was armed |
| EKI-EVD-023 | 2026-10-20 | [Armed moving capture, 20 October](MOVING_GNSS_CAPTURE_2026_10_20.md) | Moving physical | Requirement allocation superseded by EVD-024 |
| EKI-EVD-024 | 2026-10-21 | [21 October ride evidence](MOVING_GNSS_CAPTURE_2026_10_21.md) | Moving physical | With its [requirement ledger](MOVING_GNSS_CAPTURE_2026_10_21.json); tracking moved to issue #351 |
| EKI-EVD-025 | 2026-10-12 | [MUSE audit verification](MUSE_AUDIT_VERIFICATION_2026_10_12.md) | Audit | Boarding coordinate repair |
| EKI-EVD-026 | 2026-10-09 | [Non-moving webapp readiness](NON_MOVING_READINESS_2026_10_09.md) | Synthetic | Supersedes earlier descriptions of these fixes as uncommitted |
| EKI-EVD-027 | 2026-10-04 | [Non-moving recovery verification](NON_MOVING_RECOVERY_REPORT.md) | Stationary physical | Run 2026-09-14 |
| EKI-EVD-028 | 2026-10-21 | [Open issue disposition](OPEN_ACCEPTANCE_DISPOSITION_2026_10_21.md) | Audit | The 64 open requirements; tracking moved to issue #351 |
| EKI-EVD-029 | 2026-10-23 | [Passenger audit repairs](PASSENGER_AUDIT_REPAIRS_2026_10_23.md) | Audit | PR #364 |
| EKI-EVD-030 | 2026-10-25 | [Passenger boarding and CodeRabbit follow-up](PASSENGER_BOARDING_UPDATE_2026-10-25.md) | Synthetic | Boarding without a code; supersedes code-based boarding in earlier records |
| EKI-EVD-031 | 2026-10-26 | [Passenger map and disconnect verification](PASSENGER_DISCONNECT_AND_LAYOUT_2026-10-26.md) | Browser | Signed-in Chrome on localhost |
| EKI-EVD-032 | 2026-10-29 | [Passenger field ride repairs](PASSENGER_FIELD_RIDE_REPAIRS_2026_10_29.md) | Moving physical | Observations from a passenger ride on deployed `main`; the 15 m arrival corridor replaces the stop radius in EVD-041 and EVD-050; the repairs are verified on synthetic tracks only |
| EKI-EVD-033 | 2026-10-21 | [Passenger GPS progress regression](PASSENGER_GPS_PROGRESS.md) | Synthetic | |
| EKI-EVD-034 | 2026-10-06 | [Passenger map per-bus work (R18)](PASSENGER_MAP_PER_BUS_WORK.md) | Synthetic | |
| EKI-EVD-035 | 2026-10-04 | [Passenger preview and operator controls audit](PASSENGER_PREVIEW_QA_2026_10_03.md) | Synthetic | Run 2026-10-03 |
| EKI-EVD-036 | 2026-10-04 | [Telemetry latency baseline](POSTFIX_STATIONARY_TRACE.md) | Stationary physical | Trace generated 2026-09-13 |
| EKI-EVD-037 | 2026-10-24 | [PR #364 independent audit follow-up](PR364_INDEPENDENT_REPAIRS_2026_10_24.md) | Audit | |
| EKI-EVD-038 | 2026-10-20 | [Production audit claim validation](PRODUCTION_AUDIT_VALIDATION_2026_10_20.md) | Audit | Origin of the production-audit browser fixture |
| EKI-EVD-039 | 2026-10-15 | [PR #323 CodeRabbit verification](PR_323_CODERABBIT_VERIFICATION.md) | Audit | |
| EKI-EVD-040 | 2026-10-15 | [PR #323 interaction and retirement review](PR_323_INTERACTION_REVIEW.md) | Audit | |
| EKI-EVD-041 | 2026-10-18 | [PR #336 review follow-up](PR_336_REVIEW_VERIFICATION.md) | Audit | Stop radius superseded by EVD-032 |
| EKI-EVD-042 | 2026-10-15 | [QA audit report, 15 October](QA_AUDIT_2026_10_15.md) | Browser | Localhost audit of the passenger account deletion branch |
| EKI-EVD-043 | 2026-10-08 | [R14 live projection](R14_LIVE_PROJECTION.md) | Synthetic | Emulator transaction and payload measurements |
| EKI-EVD-044 | 2026-10-07 | [R31 moderation and instrumentation profile](R31_PROFILE.md) | Synthetic | Data: [baseline](R31_baseline_node24.json), [final](R31_final_node24.json) |
| EKI-EVD-045 | 2026-10-04 | [Realtime transport evidence audit](REALTIME_TRANSPORT_EVIDENCE_AUDIT.md) | Audit | Review of captures, 2026-10-01 |
| EKI-EVD-046 | 2026-10-04 | [Reroute latency simulation](REROUTE_SIMULATION_RESULTS.md) | Synthetic | Run 2026-09-10; not field latency |
| EKI-EVD-047 | 2026-10-04 | [Return journeys, long routes and live reroutes](RETURN_ROUTE_ACCEPTANCE.md) | Synthetic | Physical cases left open |
| EKI-EVD-048 | 2026-10-20 | [Reverification, 20 October](REVERIFICATION_2026_10_20.md) | Synthetic | Six-family campaign and browser assertions |
| EKI-EVD-049 | 2026-10-20 | [Ride lifecycle and telemetry claim validation](RIDE_LIFECYCLE_VALIDATION_2026_10_20.md) | Audit | PR #344 |
| EKI-EVD-050 | 2026-10-18 | [Routing lifecycle audit and verification](ROUTING_LIFECYCLE_VERIFICATION.md) | Audit | Includes the Routes provider probe used by the live Maps check; stop radius superseded by EVD-032 |
| EKI-EVD-051 | 2026-10-04 | [RTDB field contract audit](RTDB_FIELD_CONTRACT_AUDIT_2026_10_02.md) | Audit | Run 2026-10-02 |
| EKI-EVD-052 | 2026-10-16 | [Security issues #315 to #317 acceptance](SECURITY_315_317_ACCEPTANCE.md) | Synthetic | Records the App Check removal policy selected on 2026-10-16 |
| EKI-EVD-053 | 2026-10-11 | [Stationary GNSS and hotspot recovery](STATIONARY_GNSS_HOTSPOT_2026_10_11.md) | Stationary physical | |
| EKI-EVD-054 | 2026-10-04 | [Stationary readiness checks](STATIONARY_READINESS_REPORT.md) | Stationary physical | Run 2026-09-13 |
| EKI-EVD-055 | 2026-10-04 | [Testing acceptance follow-up, 3 October](TESTING_ACCEPTANCE_2026_10_03.md) | Stationary physical | Also browser checks and physical power cuts; no moving check; supersedes pending claims in earlier October audit records |
| EKI-EVD-056 | 2026-10-16 | [Testing branch CI investigation](TESTING_CI_INVESTIGATION_2026-10-16.md) | Audit | |
| EKI-EVD-057 | 2026-10-10 | [Passenger and admin QA and loading optimisation](WEBAPP_QA_2026_10_10.md) | Browser | Partial live acceptance |
| EKI-EVD-058 | 2026-10-08 | [Webapp readiness, 8 October](WEBAPP_READINESS_2026_10_08.md) | Browser | Boarding and manifest gaps closed by EVD-059 |
| EKI-EVD-059 | 2026-10-09 | [Webapp readiness, 9 October](WEBAPP_READINESS_2026_10_09.md) | Browser | Stationary passenger flow on localhost |
| EKI-EVD-060 | 2026-10-11 | [Deterministic QA baseline](../../qa/BASELINE_2026_10_11.md) | Audit | First QA programme slice; the [QA programme](../../qa/README.md) describes the current state |

The `assets/` folder holds images referenced by these records. `simulations/generate-gnss.mjs` is the GNSS profile generator: the backend GNSS property tests that `qa:gnss` runs import it and the acceptance catalog reads its profile list, so it is current code, not evidence.

## 5. Remaining acceptance gates

No record above establishes release readiness. The execution ledger always reports `softwareRelease: NOT_RELEASE_READY` and `vehicleFieldDeployment: NOT_VERIFIED`; only owner-reviewed field and provider evidence can change that decision.

[Issue #351](https://github.com/notnamansinha/Eki/issues/351) is the working acceptance checklist. It consolidates the requirements of issues #245, #246, #300 and #337, which are closed. Issues #365 to #379 track the Cloud Run migration, including staging acceptance and a rollback rehearsal (#377).

| Gate | Level | Evidence needed |
|---|---|---|
| Stop arrival and matching on a real route | L5 | An instrumented ride on the reference route, including the divided-road U-turn, that checks the 15 m arrival corridor, the offside gate and the matcher speed penalty (EVD-032) |
| Turnaround, mobile suspension and weak network | L5 | Endpoint completion, turnaround and the separate return ride; passenger and admin suspend, resume and a PWA update during a ride; Slow 3G and Offline behaviour ([field acceptance](../../qa/FIELD_ACCEPTANCE.md), [deployment checklist](../operations/UNIVERSITY_DEPLOYMENT_CHECKLIST.md#7-acceptance-test)) |
| Moving latency and contention | L5 | At least 100 accepted moving latency samples and 1,000 moving contention samples across normal, degraded and reconnect phases ([field acceptance](../../qa/FIELD_ACCEPTANCE.md)) |
| GNSS truth and compound recovery | L5 | Independent position reference, drift, acquisition, GNSS plus network loss, reboot replay and replica recovery runs |
| Power, thermal, watchdog and journal | L5 | Bench runs on a spare board |
| Secure fleet and OTA | L5 | Witnessed provisioning, signed OTA, active-ride deferral and rollback ([hardware security provisioning](../security/HARDWARE_SECURITY_PROVISIONING.md)) |
| Live providers | L4 | Deployed Google sign-in, Maps, Routes and Places in an approved environment |
| Complete feature acceptance | L1 to L3 | Reviewed mappings and passing execution for each of the 351 feature cases and the SIM-01 to SIM-20 scenarios, which the catalog reports as NOT_COVERED |
| University handover | Owner | The [deployment checklist](../operations/UNIVERSITY_DEPLOYMENT_CHECKLIST.md) |

Do not close a gate from source review, CI success or synthetic data alone.
