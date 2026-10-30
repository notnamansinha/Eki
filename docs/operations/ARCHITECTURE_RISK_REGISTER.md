# Architecture Risk Register

| Document ID | Version | Status | Last updated |
|---|---|---|---|
| EKI-OPS-010 | 2.0 | Current | 2026-10-30 |

## 1. Purpose

This register lists the material risks that remain in Eki, each with the source evidence for its status and the condition that closes it. It was re-checked against `main` at `c4d47b3` plus PR #395 on 2026-10-30. Physical and institutional acceptance work is defined in the [test strategy](../testing/TEST_STRATEGY.md) and the [deployment checklist](UNIVERSITY_DEPLOYMENT_CHECKLIST.md); the historical starting point is the [production readiness audit](PRODUCTION_READINESS_AUDIT.md).

### 1.1 Summary

Of the ten risks, one is closed, four are open in the repository or its settings, and five have their code-side mitigation in place but wait on deployment, hardware or institutional evidence (status values are defined in Section 2). Five of the nine remaining risks are rated High.

| Area | What is unfinished | Risks |
|---|---|---|
| Backend hosting | The backend runs as one process on a workstation behind an ngrok tunnel, with no failover, alerting or tested restore. | OPS-01 (High) |
| Stop tracking | Stop arrival and route matching are validated on simulated rides only; a moving-bus field ride is still needed. | TRK-01 (High) |
| Tracker firmware | Outage recovery, Secure Boot and signed updates are built but not proven on hardware, and one shared update image would give every tracker the same credentials. | FW-01, FW-02, FW-03 (High) |
| Access control | A passenger can board by reporting a false location, and ride operations accept administrator claims without the current version check. | SEC-01, SEC-03 (Medium) |
| Delivery process | Scheduled QA campaigns have not yet recorded a green run on `main`, and a merge to `main` does not require passing checks. | OPS-02, OPS-03 (Medium) |

## 2. Status values

| Status | Meaning |
|---|---|
| Open | The repository or the deployment still exposes the risk |
| External gate | The code-side mitigation is in place; closure needs deployment, hardware or institutional evidence |
| Closed | The remediation and its acceptance evidence are on `main` |

## 3. Register

| ID | Risk | Severity | Status | Closure evidence or open gate |
|---|---|---|---|---|
| SEC-01 | Passengers can join a ride without proof of presence | Medium | Open | Owner acceptance of the residual risk, or a server-verifiable presence check |
| SEC-02 | Privileged writes are client-authoritative | High | Closed | PR #53 endpoints; feedback rules since PR #359; emulator suite in CI |
| FW-01 | Store-and-forward needs physical recovery evidence | High | External gate | Witnessed outage and recovery run on the target board |
| FW-02 | Firmware updates and key protection need physical proof | High | External gate | Spare-board Secure Boot trial, key custody, signed update and rollback |
| OPS-01 | Runtime availability and perimeter controls are not evidenced | High | External gate | Managed backend, failover, edge limits, alerts, backup and restore drill |
| OPS-02 | Scheduled QA runs no suites | Medium | External gate | Scheduled runs resolve `main`; a green nightly and weekly run on `main` remain to be recorded |
| TRK-01 | Stop progress is validated on simulated tracks only | High | External gate | Instrumented ride on the real route, including the divided-road U-turn |
| SEC-03 | Ride operations accept stale administrator claims | Medium | Open | Every administrator branch checks the current authorization version, with regression tests |
| FW-03 | OTA images carry device secrets but the backend serves one release | High | Open | Per-device releases, or credentials kept out of the update image |
| OPS-03 | The `main` ruleset requires no status checks | Medium | Open | Production verification and CodeQL jobs required before merge |

### 3.1 SEC-01: passengers can join a ride without proof of presence

- Evidence: PR #382 (commit `3cf7ade`, 2026-10-25) removed the driver-issued boarding code that PR #23 had introduced as the closing control. `joinSession` in `backend/src/routes/sessions.ts` now requires a passenger role (or no role), an existing profile, a session in status `armed` or `active` with a resolved direction, route stops in travel order, browser accuracy of 100 m or better and, on first join, a position within 150 m of a fresh hardware fix bound to the same session, bus and route (`backend/src/services/boardingPolicy.ts`). A transaction re-checks the session, capacity (1,000 entries) and membership. Firestore rules deny every client write to `ride_sessions`.
- Impact: the browser position is supplied by the client. A signed-in passenger who forges it can join any boarding ride, read and send that ride's chat, and leave ride feedback after completion.
- Open gate: the product owner records acceptance of this residual risk, or a check that the server can verify (not the browser position) replaces it.

### 3.2 SEC-02: privileged writes are client-authoritative

- Evidence: PR #53 moved chat, profile bootstrap and settings writes to authenticated endpoints that derive identity from the token and re-check membership and rate state in transactions. `firestore.rules` denies client writes to every collection except `feedbacks` and `feedbackCooldowns`. PR #359 moved feedback submission, the administrator list and status changes into Firestore under rules: a create needs a profile, valid fields, a completed ride with the author in its manifest, and a cooldown document written in the same commit that enforces 24 h between submissions; an update needs a current administrator and changes only `status`, `reviewedAt` and `reviewedBy`.
- Closure evidence: the emulator suite (`backend/src/rulesIntegration.test.ts`, including "feedback without the backend tunnel") runs in every Production verification run. PR #53 passed default-branch run [31300104926](https://github.com/notnamansinha/Eki/actions/runs/31300104926) on merge commit `cc147ba`.

### 3.3 FW-01: store-and-forward needs physical recovery evidence

- Evidence: `hardware/src/main.cpp` runs Wi-Fi, NTP, TLS and HTTPS in a publisher task on core 0 while the Arduino loop drains the GNSS UART. A 100-sample RTC ring survives warm resets; samples older than 55 s, which keeps them inside the backend's 60 s acceptance window, are counted and dropped instead of sent. An encrypted flash checkpoint every 10 s restores the latest committed sample after cold power loss; newer uncommitted fixes can be lost. Diagnostics report health and security state every five minutes. Native tests in CI cover queue ordering, retry, overflow, stale compaction and HTTP response policy ([hardware telemetry](../hardware/HARDWARE_TELEMETRY.md), [cold power recovery](../hardware/COLD_POWER_RECOVERY.md)).
- Impact: a dead zone or backend outage longer than the ring and freshness window loses positions by design; untested radio, power or TLS behaviour could lose more.
- Open gate: a witnessed dead-zone and backend-outage run on the target board showing no UART or FIFO overflow and acceptable queue high-water and recovery; TLS established with NTP blocked; the credential-fault LED and radio shutdown; device-specific reflash and credential rotation. These remain open as items `245-04`, `245-24` and `300-04` in the [open acceptance disposition](../testing/OPEN_ACCEPTANCE_DISPOSITION_2026_10_21.md).

### 3.4 FW-02: firmware updates and key protection need physical proof

- Evidence: the `esp32dev-secure` environment needs an RSA-3072 signing key, builds Secure Boot V2 firmware with release-mode flash encryption, and halts at runtime unless both are active. It adds dual signed update slots, withholding during an active ride, exact size and SHA-256 checks, strictly increasing release sequences and rollback when the backend health check fails. CI builds it with a throwaway key and checks that modified or foreign-signed images are rejected.
- Impact: until hardware security is provisioned, a captured device exposes its Wi-Fi and device credentials, and configuration changes need a wired reflash.
- Current physical state: the field board (ESP32-D0WD-V3, revision 3.1) runs development firmware with Secure Boot and flash encryption disabled, and no approved fleet signing key exists ([non-motion inventory](../testing/LIVE_NON_MOTION_INVENTORY_2026_10_11.md), [19 October capture](../testing/MOVING_GNSS_CAPTURE_2026_10_19.md)).
- Open gate: run [hardware security provisioning](../security/HARDWARE_SECURITY_PROVISIONING.md) on spare boards with first-boot, tampered-image and rotation evidence; establish key custody, immutable artifact hosting and the six `FIRMWARE_RELEASE_*` values; prove ride withholding, staged update and automatic rollback.

### 3.5 OPS-01: runtime availability and perimeter controls are not evidenced

- Evidence: the code supports replicated hosting. `RATE_LIMIT_SHARD_FACTOR` divides every in-memory limiter budget by the replica count (`backend/src/lib/rateLimitShard.ts`); `/health` returns `200` only while Firestore and RTDB probes pass, and `/live` stays `200` while the process runs; a Firestore lease with fencing keeps lifecycle work on one leader ([worker leadership](WORKER_LEADERSHIP.md)); CI builds and smoke-boots the container. No workflow deploys the backend. It runs as one process on a workstation behind an ngrok tunnel, and every Hosting release checks that backend live ([CI, deployment and releases](CI_CD_AND_RELEASES.md#71-current-state)).
- Impact: the service stops whenever the workstation, the backend process or the tunnel stops. There is no failover, edge rate limit, WAF, alerting or tested restore.
- Open gate: a managed backend runtime (the [Cloud Run proposal](CI_CD_AND_RELEASES.md#72-proposed-migration-to-cloud-run) or an equivalent); at least two replicas with health-based failover and no duplicate lifecycle transitions, or a recorded single-instance acceptance; edge and global rate limits with `RATE_LIMIT_SHARD_FACTOR` equal to the replica count; alerts on health, rejections, latency, stale telemetry and lease ownership; an archived backup, restore and incident drill.

### 3.6 OPS-02: scheduled QA runs no suites

- Evidence: the `resolve` jobs in `.github/workflows/deep-qa.yml` and `.github/workflows/weekly-reliability.yml` read the head of `main` through the GitHub API for scheduled and dispatched runs, and `scripts/qa/workflow-policy.mjs` (tested in `scripts/qa-workflow-policy.test.mjs`) rejects a resolver that names any other branch. Until 2026-10-30 they read `testing`, which was deleted on 2026-10-25: every scheduled nightly run from 2026-10-25 to 2026-10-29 (UTC) failed in `resolve` with `Not Found` and skipped `suites` and `report`, and the last runs that executed suites were on 2026-10-24 (GitHub Actions history, read 2026-10-30).
- Impact while open: the nightly emulator, browser, API, native and GNSS campaigns and the weekly mutation and soak baselines did not run, so regressions on `main` that only these suites catch went unnoticed.
- Open gate: record one green nightly and one green weekly run on a current `main` commit, for example by a manual dispatch of each workflow from `main`.

### 3.7 TRK-01: stop progress is validated on simulated tracks only

- Evidence: PR #395 widened stop arrival to a 15 m corridor, added the offside gate for divided roads, credited missed stops as `passed_unobserved` and added a speed penalty to the route matcher ([automatic GNSS service](AUTOMATIC_GNSS_SERVICE.md#4-direction-and-stop-progress)). The evidence is 1,500 simulated rides; about 0.6 % still credit a stop early, mostly on spurs where both directions share one road ([passenger field ride repairs](../testing/PASSENGER_FIELD_RIDE_REPAIRS_2026_10_29.md)).
- Impact: on a real route, receiver error or pin placement can still mark a stop early or late, or match the bus to the wrong carriageway near a U-turn; passengers then see wrong progress and ETAs.
- Open gate: an instrumented ride on the same route, including the divided-road U-turn, recorded with [field capture](FIELD_CAPTURE.md) and compared with an independent position reference.

### 3.8 SEC-03: ride operations accept stale administrator claims

- Evidence: `requireAdmin` (`backend/src/middleware/requireAdmin.ts`) admits a token only with `admin: true`, `role: "admin"` and an `authorizationVersion` that `authorizationIsCurrent` matches against `_userAuthorization/{uid}` in Firestore and RTDB. The ride-operation routes use `requireAuth` and decide administrator authority from the token claims alone (`role === "admin" || admin === true`): `readOperatorAssignment` (`backend/src/routes/shifts.ts:95`) for ride start (`POST /api/shifts/start`, `POST /api/v2/ride-sessions`), delay changes and the operator fallback of `POST /api/shifts/stop`; `readSession` (`shifts.ts:536`); and, in `backend/src/routes/sessions.ts`, the legacy boarding code (`:113`), chat messages (`:377`, `:411`) and session status (`:513`). Only the administrator branch of the stop route (`adminStopTarget`, `shifts.ts:278`) checks the current version.
- Impact: a token that still carries an administrator claim after the role was withdrawn (within the same second as the revocation, inside the `AUTH_REVOCATION_CACHE_MS` window, or a legacy token without a version) can start, delay, end or read any ride and post administrator chat messages.
- Open gate: route every administrator branch through the `requireAdmin` policy (claims plus `authorizationIsCurrent`), and add regression tests for a stale and a legacy administrator token on each route.

### 3.9 FW-03: OTA images carry device secrets but the backend serves one release

- Evidence: the firmware compiles `DEVICE_ID`, `DEVICE_SECRET`, Wi-Fi credentials and the backend origin from `hardware/include/secrets.h` into the application image (`hardware/src/main.cpp:8`, `:618` to `:641`, `:2132` to `:2135`). The backend reads one global release descriptor from the six `FIRMWARE_RELEASE_*` values (`backend/src/services/firmwareRelease.ts:47`) and returns it to every authenticated, assigned device whose sequence is lower (`backend/src/routes/devices.ts:197` to `:222`).
- Impact: a release built for one device would install that device's identity and secret on every device that updates, so all of them authenticate as one device and the secret is exposed to anyone who obtains the image. Over-the-air updates cannot be used for a fleet as built.
- Open gate: per-device release descriptors and images, or credentials provisioned outside the update image (for example in encrypted NVS), with a test that one device cannot receive another device's image.

### 3.10 OPS-03: the main ruleset requires no status checks

- Evidence: the only repository ruleset (`main`, applied to the default branch and all branches) requires a pull request with one approving review and code owner review, blocks deletion and force pushes, and has no required status checks; maintainers and administrators may bypass it. The default branch has no classic branch protection (GitHub API, read 2026-10-30).
- Impact: a pull request can merge while Production verification or CodeQL is failing or still running. Deploy does not release a failed commit, but `main` can carry it and later green commits deploy on top of it.
- Open gate: add the Production verification jobs (`web`, `backend-image`, `firmware`, `qa-evidence`) and the CodeQL `analyze` jobs as required status checks, and record whether administrators keep bypass rights.

## 4. Maintenance rule

A pull request that changes the behaviour behind a risk updates its entry and attaches fresh evidence. A risk is closed only when the remediation and its acceptance evidence are on `main`; code on another branch does not close it. External gates stay open until their evidence is recorded in the deployment checklist and the release evidence.
