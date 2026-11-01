# Eki Documentation Index

| Document ID | Version | Status | Last updated |
|---|---|---|---|
| EKI-GEN-002 | 1.0 | Current | 2026-10-30 |

## 1. Purpose

This index is the entry point to the Eki documentation set and its register of controlled documents. Every Markdown document in the repository is either listed in Section 4 or is an uncontrolled file defined in the [documentation standard](DOCUMENTATION_STANDARD.md#34-uncontrolled-files).

Current documents describe the software at the head of the branch that contains them. Historical documents record a dated run, audit or measurement and are not rewritten to match later code.

## 2. Reading paths

| Reader | Read in this order |
|---|---|
| New developer | [Project overview](../README.md), [getting started](GETTING_STARTED.md), [configuration](CONFIGURATION.md), [architecture](design/ARCHITECTURE.md), [glossary](GLOSSARY.md), [contributing](../CONTRIBUTING.md) |
| Evaluator or reviewer | [Project overview](../README.md), [architecture summary](design/ARCHITECTURE.md#12-system-summary), [cost model summary](cost/COST_MODEL.md#11-summary), [risk register summary](operations/ARCHITECTURE_RISK_REGISTER.md#11-summary), [software requirements specification](requirements/SOFTWARE_REQUIREMENTS_SPECIFICATION.md), [high-level design](design/HIGH_LEVEL_DESIGN.md), [test strategy](testing/TEST_STRATEGY.md), [testing and evidence index](testing/README.md) |
| Frontend developer | [Frontend guide](../frontend/README.md), [UI design system](design/UI_DESIGN_SYSTEM.md), [data model](data/FIREBASE_DATA_MODEL.md), [API reference](../backend/API.md) |
| Backend developer | [Backend guide](../backend/README.md), [API reference](../backend/API.md), [low-level design](design/LOW_LEVEL_DESIGN.md), [tracking algorithms](design/TRACKING_ALGORITHMS.md), [data model](data/FIREBASE_DATA_MODEL.md) |
| Firmware developer | [Hardware guide](../hardware/README.md), [hardware telemetry](hardware/HARDWARE_TELEMETRY.md), [fleet security provisioning](security/HARDWARE_SECURITY_PROVISIONING.md) |
| Operator or administrator | [Getting started](GETTING_STARTED.md), [local testing](operations/LOCAL_TESTING.md), [live demo runbook](operations/LIVE_DEMO_RUNBOOK.md), [CI, deployment and releases](operations/CI_CD_AND_RELEASES.md), [deployment checklist](operations/UNIVERSITY_DEPLOYMENT_CHECKLIST.md) |
| Security reviewer | [Security policy](../SECURITY.md), [security architecture](security/SECURITY_ARCHITECTURE.md), [browser API security](security/BROWSER_API_SECURITY.md), [privileged database authorization](security/PRIVILEGED_DATABASE_AUTHORIZATION.md) |
| Budget owner | [Cost model](cost/COST_MODEL.md) (Section 1.1 is the summary), [risk register](operations/ARCHITECTURE_RISK_REGISTER.md), [deployment checklist](operations/UNIVERSITY_DEPLOYMENT_CHECKLIST.md) |

## 3. Folder layout

| Folder | Contents |
|---|---|
| `docs/` | This index, the [documentation standard](DOCUMENTATION_STANDARD.md), [getting started](GETTING_STARTED.md), [configuration](CONFIGURATION.md) and the [glossary](GLOSSARY.md) |
| `docs/requirements/` | Software requirements specification |
| `docs/design/` | Architecture, high-level and low-level design, tracking algorithms, UI design system and decision records |
| `docs/api/` | HTTP contract validation, ride-session and operation-resource contracts |
| `docs/data/` | Firestore and Realtime Database model, storage responsibilities |
| `docs/security/` | Security architecture, browser API security, privileged database authorization, fleet provisioning |
| `docs/cost/` | Cost, quota and capacity model |
| `docs/operations/` | Deployment, runbooks, runtime policies and the risk register |
| `docs/hardware/` | Firmware telemetry, recovery and connection designs |
| `docs/testing/` | Test strategy, testing index and dated evidence records |
| `docs/repository/`, `docs/backend/`, `docs/frontend/`, `docs/e2e/`, `docs/qa/`, `docs/github/`, `docs/tools/` and the README files in `docs/hardware/` | Generated mirrors of Markdown files kept beside the code. Edit the source, then run `npm run docs:sync`. See [Section 7 of the standard](DOCUMENTATION_STANDARD.md#7-mirrors). |

## 4. Document register

The register lists every controlled document by its source path. A mirror carries the same ID as its source and is not listed separately.

<!-- register:start -->

### 4.1 General and repository (GEN)

| ID | Document | Version | Status | Last updated |
|---|---|---|---|---|
| EKI-GEN-001 | [Eki Campus Bus Tracking](../README.md) | 1.1 | Current | 2026-10-30 |
| EKI-GEN-002 | [Eki Documentation Index](README.md) | 1.0 | Current | 2026-10-30 |
| EKI-GEN-003 | [Eki Documentation Standard](DOCUMENTATION_STANDARD.md) | 1.0 | Current | 2026-10-30 |
| EKI-GEN-004 | [Getting Started with Eki](GETTING_STARTED.md) | 2.0 | Current | 2026-10-30 |
| EKI-GEN-005 | [Eki Configuration Reference](CONFIGURATION.md) | 1.1 | Current | 2026-10-30 |
| EKI-GEN-006 | [Eki Glossary](GLOSSARY.md) | 2.0 | Current | 2026-10-30 |
| EKI-GEN-007 | [Contributing to Eki](../CONTRIBUTING.md) | 1.0 | Current | 2026-10-30 |
| EKI-GEN-008 | [Contributor Covenant Code of Conduct](../CODE_OF_CONDUCT.md) | 1.0 | Current | 2026-10-30 |

### 4.2 Requirements (REQ)

| ID | Document | Version | Status | Last updated |
|---|---|---|---|---|
| EKI-REQ-001 | [Software Requirements Specification](requirements/SOFTWARE_REQUIREMENTS_SPECIFICATION.md) | 3.0 | Current | 2026-10-30 |

### 4.3 Architecture and design (ARC)

| ID | Document | Version | Status | Last updated |
|---|---|---|---|---|
| EKI-ARC-001 | [Eki Architecture](design/ARCHITECTURE.md) | 2.0 | Current | 2026-10-30 |
| EKI-ARC-002 | [Eki High-Level Design](design/HIGH_LEVEL_DESIGN.md) | 3.0 | Current | 2026-10-30 |
| EKI-ARC-003 | [Low-Level Design](design/LOW_LEVEL_DESIGN.md) | 3.0 | Current | 2026-10-30 |
| EKI-ARC-004 | [Tracking Algorithms](design/TRACKING_ALGORITHMS.md) | 1.1 | Current | 2026-10-30 |

### 4.4 Architecture decision records (ADR)

| ID | Document | Version | Status | Last updated |
|---|---|---|---|---|
| EKI-ADR-001 | [Realtime Transport Decision](design/REALTIME_TRANSPORT_DECISION.md) | 1.0 | Current | 2026-10-30 |
| EKI-ADR-002 | [RTDB Region Latency Decision](design/RTDB_REGION_LATENCY_DECISION.md) | 1.0 | Proposed | 2026-10-30 |
| EKI-ADR-003 | [Telemetry State Partition Decision](design/TELEMETRY_STATE_PARTITION_DECISION.md) | 1.0 | Current | 2026-10-30 |
| EKI-ADR-004 | [Google Map Reuse Decision](design/GOOGLE_MAP_REUSE_DECISION.md) | 1.0 | Current | 2026-10-30 |

### 4.5 User interface (UIX)

| ID | Document | Version | Status | Last updated |
|---|---|---|---|---|
| EKI-UIX-001 | [Eki UI Design System](design/UI_DESIGN_SYSTEM.md) | 2.0 | Current | 2026-10-30 |

### 4.6 Interfaces (API)

| ID | Document | Version | Status | Last updated |
|---|---|---|---|---|
| EKI-API-001 | [Eki Backend HTTP API](../backend/API.md) | 3.0 | Current | 2026-10-30 |
| EKI-API-002 | [HTTP Contract](api/HTTP_CONTRACT.md) | 2.0 | Current | 2026-10-30 |
| EKI-API-003 | [Ride Session Contract](api/RIDE_SESSION_CONTRACT.md) | 2.0 | Current | 2026-10-30 |
| EKI-API-004 | [Operation Resources](api/OPERATION_RESOURCES.md) | 1.0 | Current | 2026-10-30 |
| EKI-API-005 | [HTTP Resource Migration](../backend/API_RESOURCE_MIGRATION.md) | 2.0 | Current | 2026-10-30 |

### 4.7 Data (DAT)

| ID | Document | Version | Status | Last updated |
|---|---|---|---|---|
| EKI-DAT-001 | [Firebase Data Model](data/FIREBASE_DATA_MODEL.md) | 2.0 | Current | 2026-10-30 |
| EKI-DAT-002 | [Eki Storage Architecture](data/STORAGE_ARCHITECTURE.md) | 2.0 | Current | 2026-10-30 |

### 4.8 Security (SEC)

| ID | Document | Version | Status | Last updated |
|---|---|---|---|---|
| EKI-SEC-001 | [Security Policy](../SECURITY.md) | 1.0 | Current | 2026-10-30 |
| EKI-SEC-002 | [Security Architecture](security/SECURITY_ARCHITECTURE.md) | 3.0 | Current | 2026-10-30 |
| EKI-SEC-003 | [Browser API Security](security/BROWSER_API_SECURITY.md) | 3.0 | Current | 2026-10-30 |
| EKI-SEC-004 | [Privileged Database Authorization](security/PRIVILEGED_DATABASE_AUTHORIZATION.md) | 1.0 | Current | 2026-10-30 |
| EKI-SEC-005 | [Hardware Security Provisioning](security/HARDWARE_SECURITY_PROVISIONING.md) | 1.0 | Current | 2026-10-30 |

### 4.9 Cost (CST)

| ID | Document | Version | Status | Last updated |
|---|---|---|---|---|
| EKI-CST-001 | [Eki Cost Model](cost/COST_MODEL.md) | 2.0 | Current | 2026-10-30 |

### 4.10 Operations (OPS)

| ID | Document | Version | Status | Last updated |
|---|---|---|---|---|
| EKI-OPS-001 | [CI, Deployment and Releases](operations/CI_CD_AND_RELEASES.md) | 2.0 | Current | 2026-10-30 |
| EKI-OPS-002 | [DNS and Domains](operations/DNS_AND_DOMAINS.md) | 1.0 | Current | 2026-10-30 |
| EKI-OPS-003 | [ngrok Tunnel for the Backend](operations/NGROK_TUNNEL.md) | 1.0 | Current | 2026-10-30 |
| EKI-OPS-004 | [Local Web, Phone and Device Testing](operations/LOCAL_TESTING.md) | 1.0 | Current | 2026-10-30 |
| EKI-OPS-005 | [Live Demo Runbook](operations/LIVE_DEMO_RUNBOOK.md) | 1.0 | Current | 2026-10-30 |
| EKI-OPS-006 | [University Deployment Checklist](operations/UNIVERSITY_DEPLOYMENT_CHECKLIST.md) | 1.2 | Current | 2026-10-30 |
| EKI-OPS-007 | [Firestore Index Deployment](operations/FIRESTORE_INDEX_DEPLOYMENT.md) | 1.0 | Current | 2026-10-30 |
| EKI-OPS-008 | [Field Capture](operations/FIELD_CAPTURE.md) | 1.0 | Current | 2026-10-30 |
| EKI-OPS-009 | [Automatic GNSS Service](operations/AUTOMATIC_GNSS_SERVICE.md) | 1.1 | Current | 2026-10-30 |
| EKI-OPS-010 | [Architecture Risk Register](operations/ARCHITECTURE_RISK_REGISTER.md) | 3.0 | Current | 2026-10-30 |
| EKI-OPS-011 | [Production Readiness Audit](operations/PRODUCTION_READINESS_AUDIT.md) | 1.0 | Historical | 2026-10-04 |
| EKI-OPS-012 | [API Read Caching and Compatibility Retirement](operations/API_READS_AND_RETIREMENT.md) | 1.1 | Current | 2026-10-30 |
| EKI-OPS-013 | [Browser Telemetry Trace](operations/BROWSER_TELEMETRY_TRACE.md) | 1.0 | Current | 2026-10-30 |
| EKI-OPS-014 | [Matching and Stale Presence Scans](operations/MATCHING_AND_LIFECYCLE_SCANS.md) | 1.0 | Current | 2026-10-30 |
| EKI-OPS-015 | [Passenger Account Deletion](operations/PRIVACY_DELETION.md) | 1.0 | Current | 2026-10-30 |
| EKI-OPS-016 | [Realtime Transport Measurements](operations/REALTIME_TRANSPORT_MEASUREMENTS.md) | 1.0 | Current | 2026-10-30 |
| EKI-OPS-017 | [Bounded Reconciliation](operations/RECONCILIATION.md) | 1.0 | Current | 2026-10-30 |
| EKI-OPS-018 | [Live Reroute Retry Policy](operations/REROUTE_RETRY_POLICY.md) | 1.0 | Current | 2026-10-30 |
| EKI-OPS-019 | [Telemetry Route Catalog](operations/ROUTE_CATALOG.md) | 1.1 | Current | 2026-10-30 |
| EKI-OPS-020 | [Route Geometry Reads and Repair](operations/ROUTE_GEOMETRY_READS.md) | 1.0 | Current | 2026-10-30 |
| EKI-OPS-021 | [Browser Reconnect and Access Recovery](operations/RTDB_RECONNECT_RECOVERY.md) | 2.0 | Current | 2026-10-30 |
| EKI-OPS-022 | [RTDB Retention](operations/RTDB_RETENTION.md) | 1.0 | Current | 2026-10-30 |
| EKI-OPS-023 | [Telemetry Execution Deadlines](operations/TELEMETRY_DEADLINES.md) | 1.0 | Current | 2026-10-30 |
| EKI-OPS-024 | [Telemetry Ingestion Load Test](operations/TELEMETRY_INGESTION_LOAD_TEST.md) | 1.0 | Current | 2026-10-30 |
| EKI-OPS-025 | [Telemetry Latency Baseline](operations/TELEMETRY_LATENCY_BASELINE.md) | 1.0 | Current | 2026-10-30 |
| EKI-OPS-026 | [Worker Leadership and Fencing](operations/WORKER_LEADERSHIP.md) | 1.0 | Current | 2026-10-30 |
| EKI-OPS-027 | [Bounded Work Admission](operations/WORK_ADMISSION.md) | 1.0 | Current | 2026-10-30 |
| EKI-OPS-028 | [ngrok Removal and Managed Firebase Backend Migration](operations/NGROK_REMOVAL_AND_FIREBASE_BACKEND_MIGRATION.md) | 1.0 | Proposed | 2026-11-01 |

### 4.11 Hardware and firmware (HW)

| ID | Document | Version | Status | Last updated |
|---|---|---|---|---|
| EKI-HW-001 | [Hardware Telemetry Contract](hardware/HARDWARE_TELEMETRY.md) | 1.0 | Current | 2026-10-30 |
| EKI-HW-002 | [Cold Power Recovery](hardware/COLD_POWER_RECOVERY.md) | 1.0 | Current | 2026-10-30 |
| EKI-HW-003 | [DNS Cold Connect](hardware/DNS_COLD_CONNECT.md) | 1.0 | Current | 2026-10-30 |
| EKI-HW-004 | [HTTPS Response Reuse](hardware/HTTPS_RESPONSE_REUSE.md) | 1.0 | Current | 2026-10-30 |

### 4.12 Package and test-suite guides (PKG)

| ID | Document | Version | Status | Last updated |
|---|---|---|---|---|
| EKI-PKG-001 | [Eki Backend](../backend/README.md) | 1.0 | Current | 2026-10-30 |
| EKI-PKG-002 | [Eki Frontend](../frontend/README.md) | 2.0 | Current | 2026-10-30 |
| EKI-PKG-003 | [ESP32 GNSS Tracker](../hardware/README.md) | 1.0 | Current | 2026-10-30 |
| EKI-PKG-004 | [Firmware Headers](../hardware/include/README.md) | 1.0 | Current | 2026-10-30 |
| EKI-PKG-005 | [Firmware Tests](../hardware/test/README.md) | 1.0 | Current | 2026-10-30 |
| EKI-PKG-006 | [Fleet Signing Keys](../hardware/keys/README.md) | 1.0 | Current | 2026-10-30 |
| EKI-PKG-007 | [Admin Access Browser Checks](../e2e/admin-access/README.md) | 2.0 | Current | 2026-10-30 |
| EKI-PKG-008 | [Passenger UI Fixture](../e2e/fixtures/README.md) | 2.0 | Current | 2026-10-30 |
| EKI-PKG-009 | [Moving-Marker Simulation](../e2e/motion/README.md) | 1.0 | Current | 2026-10-30 |
| EKI-PKG-010 | [Production Audit Browser Fixture](../e2e/production-audit/README.md) | 1.0 | Current | 2026-10-30 |
| EKI-PKG-011 | [Live Google Maps Check](../e2e/routing/live-maps/README.md) | 1.0 | Current | 2026-10-30 |
| EKI-PKG-012 | [Next Lint Directory Matching Adapter](../tools/next-lint-glob/README.md) | 1.0 | Current | 2026-10-30 |

### 4.13 Testing and QA programme (TST)

| ID | Document | Version | Status | Last updated |
|---|---|---|---|---|
| EKI-TST-001 | [Eki Testing and Evidence Index](testing/README.md) | 1.1 | Current | 2026-10-30 |
| EKI-TST-002 | [Eki Test Strategy](testing/TEST_STRATEGY.md) | 3.0 | Current | 2026-10-30 |
| EKI-TST-003 | [Eki QA Programme](../qa/README.md) | 1.0 | Current | 2026-10-30 |
| EKI-TST-004 | [Disposable Browser Acceptance](../qa/BROWSER_ACCEPTANCE.md) | 1.0 | Current | 2026-10-30 |
| EKI-TST-005 | [Disposable Emulator Acceptance](../qa/EMULATOR_ACCEPTANCE.md) | 1.0 | Current | 2026-10-30 |
| EKI-TST-006 | [Current-Source Execution Ledger](../qa/EXECUTION_EVIDENCE.md) | 1.0 | Current | 2026-10-30 |
| EKI-TST-007 | [Witnessed Field Acceptance Package](../qa/FIELD_ACCEPTANCE.md) | 1.0 | Current | 2026-10-30 |
| EKI-TST-008 | [Deterministic GNSS Properties](../qa/GNSS_PROPERTIES.md) | 1.0 | Current | 2026-10-30 |
| EKI-TST-009 | [Disposable HTTP Authorization Sweep](../qa/HTTP_AUTHORIZATION.md) | 1.0 | Current | 2026-10-30 |
| EKI-TST-010 | [Reviewed HTTP policy sub-oracles](../qa/HTTP_UNIT_EVIDENCE.md) | 1.0 | Historical | 2026-10-12 |
| EKI-TST-011 | [Native Firmware Evidence](../qa/NATIVE_EVIDENCE.md) | 1.0 | Current | 2026-10-30 |
| EKI-TST-012 | [Reviewed Unit Sub-Oracles](../qa/REVIEWED_UNIT_EVIDENCE.md) | 1.0 | Current | 2026-10-30 |
| EKI-TST-013 | [Scheduled Reliability Workflows](../qa/SCHEDULED_RELIABILITY.md) | 2.0 | Current | 2026-10-30 |

### 4.14 Evidence records (EVD)

| ID | Document | Version | Status | Last updated |
|---|---|---|---|---|
| EKI-EVD-001 | [Adaptive GNSS trace validation](testing/ADAPTIVE_GNSS_TRACE_VALIDATION.md) | 1.0 | Historical | 2026-10-04 |
| EKI-EVD-002 | [Local admin permission recovery evidence](testing/ADMIN_PERMISSION_RECOVERY.md) | 1.0 | Historical | 2026-10-06 |
| EKI-EVD-003 | [Adversarial component audit: 25 October 2026](testing/ADVERSARIAL_AUDIT_2026-10-25.md) | 1.0 | Historical | 2026-10-27 |
| EKI-EVD-004 | [Readiness audit Low findings: 11 October 2026](testing/AUDIT_LOW_DISPOSITION_2026_10_11.md) | 1.0 | Historical | 2026-10-11 |
| EKI-EVD-005 | [Eki audit fixes and physical-test readiness](testing/AUDIT_STATUS_SUMMARY.md) | 1.0 | Historical | 2026-10-04 |
| EKI-EVD-006 | [GitHub issue inventory: 8 October 2026](testing/BALCONY_ISSUE_INVENTORY_2026_10_08.md) | 1.0 | Historical | 2026-10-08 |
| EKI-EVD-007 | [Balcony GNSS readiness: 8 October 2026](testing/BALCONY_READINESS_2026_10_08.md) | 1.0 | Historical | 2026-10-08 |
| EKI-EVD-008 | [Passenger boarding request budgets](testing/BOARDING_REQUEST_BUDGETS.md) | 1.0 | Historical | 2026-10-06 |
| EKI-EVD-009 | [First CodeQL findings review](testing/CODEQL_FINDINGS_2026_10_11.md) | 1.0 | Historical | 2026-10-11 |
| EKI-EVD-010 | [Cold power and moving-marker follow-up: 2026-10-03](testing/COLD_POWER_MOTION_AUDIT_2026_10_03.md) | 1.0 | Historical | 2026-10-04 |
| EKI-EVD-011 | [Delta brief and QA patch review](testing/DELTA_BRIEF_REVIEW_2026_10_11.md) | 1.0 | Historical | 2026-10-11 |
| EKI-EVD-012 | [Full feature QA: 3 October 2026](testing/FULL_FEATURE_QA_2026_10_03.md) | 1.0 | Historical | 2026-10-04 |
| EKI-EVD-013 | [GNSS automatic service verification: 2026-10-25](testing/GNSS_AUTOMATIC_SERVICE_VERIFICATION_2026_10_25.md) | 1.0 | Historical | 2026-10-25 |
| EKI-EVD-014 | [Google sign-in recovery (#356)](testing/GOOGLE_SIGN_IN_RECOVERY.md) | 1.0 | Historical | 2026-10-27 |
| EKI-EVD-015 | [Historical movement and passenger tracking audit: 25 October 2026](testing/HISTORICAL_MOTION_AUDIT_2026-10-25.md) | 1.0 | Historical | 2026-10-25 |
| EKI-EVD-016 | [Issue #246 priority software verification: 5 October 2026](testing/ISSUE_246_PRIORITY_PARTS_2026_10_05.md) | 1.0 | Historical | 2026-10-05 |
| EKI-EVD-017 | [Issue #246 selected-part software evidence: 4 October 2026](testing/ISSUE_246_SELECTED_PARTS_2026_10_04.md) | 1.0 | Historical | 2026-10-04 |
| EKI-EVD-018 | [Testing issue and PR cross-check: 3 October 2026](testing/ISSUE_COMPLETION_2026_10_03.md) | 1.0 | Historical | 2026-10-04 |
| EKI-EVD-019 | [ESP32 live bench result (2026-09-13)](testing/LIVE_ESP32_LATENCY_RESULT.md) | 1.0 | Historical | 2026-10-04 |
| EKI-EVD-020 | [Live latency, storage and recovery audit: October 2, 2026](testing/LIVE_LATENCY_RECOVERY_AUDIT_2026_10_02.md) | 1.0 | Historical | 2026-10-04 |
| EKI-EVD-021 | [Live non-motion inventory: 11 October 2026](testing/LIVE_NON_MOTION_INVENTORY_2026_10_11.md) | 1.0 | Historical | 2026-10-11 |
| EKI-EVD-022 | [Short moving GNSS capture: 19 October 2026](testing/MOVING_GNSS_CAPTURE_2026_10_19.md) | 1.0 | Historical | 2026-10-20 |
| EKI-EVD-023 | [Armed moving capture: 20 October 2026](testing/MOVING_GNSS_CAPTURE_2026_10_20.md) | 1.0 | Historical | 2026-10-20 |
| EKI-EVD-024 | [21 October ride evidence and remaining issue work](testing/MOVING_GNSS_CAPTURE_2026_10_21.md) | 1.0 | Historical | 2026-10-21 |
| EKI-EVD-025 | [MUSE audit verification and boarding coordinate repair](testing/MUSE_AUDIT_VERIFICATION_2026_10_12.md) | 1.0 | Historical | 2026-10-12 |
| EKI-EVD-026 | [Non-moving webapp readiness: 9 October 2026](testing/NON_MOVING_READINESS_2026_10_09.md) | 1.0 | Historical | 2026-10-09 |
| EKI-EVD-027 | [Non-moving recovery verification](testing/NON_MOVING_RECOVERY_REPORT.md) | 1.0 | Historical | 2026-10-04 |
| EKI-EVD-028 | [Open issue disposition after the Downloads evidence review](testing/OPEN_ACCEPTANCE_DISPOSITION_2026_10_21.md) | 1.0 | Historical | 2026-10-21 |
| EKI-EVD-029 | [Passenger audit repairs: 23 October 2026](testing/PASSENGER_AUDIT_REPAIRS_2026_10_23.md) | 1.0 | Historical | 2026-10-23 |
| EKI-EVD-030 | [Passenger boarding and CodeRabbit follow-up: 25 October 2026](testing/PASSENGER_BOARDING_UPDATE_2026-10-25.md) | 1.0 | Historical | 2026-10-25 |
| EKI-EVD-031 | [Passenger map and disconnect verification](testing/PASSENGER_DISCONNECT_AND_LAYOUT_2026-10-26.md) | 1.0 | Historical | 2026-10-26 |
| EKI-EVD-032 | [Passenger field ride repairs: 29 October 2026](testing/PASSENGER_FIELD_RIDE_REPAIRS_2026_10_29.md) | 1.0 | Historical | 2026-10-30 |
| EKI-EVD-033 | [Passenger GPS progress regression](testing/PASSENGER_GPS_PROGRESS.md) | 1.0 | Historical | 2026-10-21 |
| EKI-EVD-034 | [Passenger map per-bus work (R18)](testing/PASSENGER_MAP_PER_BUS_WORK.md) | 1.0 | Historical | 2026-10-06 |
| EKI-EVD-035 | [Passenger preview and operator controls audit: 2026-10-03](testing/PASSENGER_PREVIEW_QA_2026_10_03.md) | 1.0 | Historical | 2026-10-04 |
| EKI-EVD-036 | [Telemetry latency baseline](testing/POSTFIX_STATIONARY_TRACE.md) | 1.0 | Historical | 2026-10-04 |
| EKI-EVD-037 | [PR #364 independent audit follow-up: 24 October 2026](testing/PR364_INDEPENDENT_REPAIRS_2026_10_24.md) | 1.0 | Historical | 2026-10-24 |
| EKI-EVD-038 | [Production audit claim validation: 20 October 2026](testing/PRODUCTION_AUDIT_VALIDATION_2026_10_20.md) | 1.0 | Historical | 2026-10-20 |
| EKI-EVD-039 | [PR #323 CodeRabbit verification: 2026-10-15](testing/PR_323_CODERABBIT_VERIFICATION.md) | 1.0 | Historical | 2026-10-15 |
| EKI-EVD-040 | [PR #323 interaction and retirement review](testing/PR_323_INTERACTION_REVIEW.md) | 1.0 | Historical | 2026-10-15 |
| EKI-EVD-041 | [PR #336 review follow-up](testing/PR_336_REVIEW_VERIFICATION.md) | 1.0 | Historical | 2026-10-18 |
| EKI-EVD-042 | [Eki Transit: Comprehensive QA Audit Report](testing/QA_AUDIT_2026_10_15.md) | 1.0 | Historical | 2026-10-15 |
| EKI-EVD-043 | [R14 live projection: evidence and rollout](testing/R14_LIVE_PROJECTION.md) | 1.0 | Historical | 2026-10-08 |
| EKI-EVD-044 | [R31 moderation and instrumentation profile](testing/R31_PROFILE.md) | 1.0 | Historical | 2026-10-07 |
| EKI-EVD-045 | [Realtime transport evidence audit (#195)](testing/REALTIME_TRANSPORT_EVIDENCE_AUDIT.md) | 1.0 | Historical | 2026-10-04 |
| EKI-EVD-046 | [Reroute latency simulation (2026-09-10)](testing/REROUTE_SIMULATION_RESULTS.md) | 1.0 | Historical | 2026-10-04 |
| EKI-EVD-047 | [Return journeys, long routes, and live reroutes](testing/RETURN_ROUTE_ACCEPTANCE.md) | 1.0 | Historical | 2026-10-04 |
| EKI-EVD-048 | [Reverification: 20 October 2026](testing/REVERIFICATION_2026_10_20.md) | 1.0 | Historical | 2026-10-20 |
| EKI-EVD-049 | [Ride lifecycle and telemetry claim validation: 20 October 2026](testing/RIDE_LIFECYCLE_VALIDATION_2026_10_20.md) | 1.0 | Historical | 2026-10-20 |
| EKI-EVD-050 | [Routing lifecycle audit and verification](testing/ROUTING_LIFECYCLE_VERIFICATION.md) | 1.0 | Historical | 2026-10-18 |
| EKI-EVD-051 | [RTDB field contract audit: 2026-10-02](testing/RTDB_FIELD_CONTRACT_AUDIT_2026_10_02.md) | 1.0 | Historical | 2026-10-04 |
| EKI-EVD-052 | [Security issues #315-#317: testing-branch acceptance](testing/SECURITY_315_317_ACCEPTANCE.md) | 1.0 | Historical | 2026-10-16 |
| EKI-EVD-053 | [Stationary GNSS and hotspot recovery: 11 October 2026](testing/STATIONARY_GNSS_HOTSPOT_2026_10_11.md) | 1.0 | Historical | 2026-10-11 |
| EKI-EVD-054 | [Stationary readiness checks: 2026-09-13](testing/STATIONARY_READINESS_REPORT.md) | 1.0 | Historical | 2026-10-04 |
| EKI-EVD-055 | [Testing acceptance follow-up: 3 October 2026](testing/TESTING_ACCEPTANCE_2026_10_03.md) | 1.0 | Historical | 2026-10-04 |
| EKI-EVD-056 | [Testing branch CI investigation: 2026-10-16](testing/TESTING_CI_INVESTIGATION_2026-10-16.md) | 1.0 | Historical | 2026-10-16 |
| EKI-EVD-057 | [Passenger/admin QA and loading optimization](testing/WEBAPP_QA_2026_10_10.md) | 1.0 | Historical | 2026-10-10 |
| EKI-EVD-058 | [Webapp readiness: 8 October 2026](testing/WEBAPP_READINESS_2026_10_08.md) | 1.0 | Historical | 2026-10-08 |
| EKI-EVD-059 | [Webapp readiness: 9 October 2026](testing/WEBAPP_READINESS_2026_10_09.md) | 1.0 | Historical | 2026-10-09 |
| EKI-EVD-060 | [Deterministic QA baseline and first implementation slice](../qa/BASELINE_2026_10_11.md) | 1.0 | Historical | 2026-10-11 |

<!-- register:end -->

## 5. Maintenance

1. Follow the [documentation standard](DOCUMENTATION_STANDARD.md) for structure, control blocks and writing rules.
2. Add a new document to the register in the same change, with the next free ID in its area.
3. Run `npm run docs:sync` and `npm run docs:check` before opening a pull request. The checks are described in [Section 8 of the standard](DOCUMENTATION_STANDARD.md#8-verification).
