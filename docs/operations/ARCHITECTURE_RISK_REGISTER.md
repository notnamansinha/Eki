# Architecture Risk Register

| Document ID | Version | Status | Last updated |
|---|---|---|---|
| EKI-OPS-010 | 4.0 | Current | 2026-11-07 |

## 1. Purpose

This register lists the material risks that remain in Eki, each with the source evidence for its status and the condition that closes it. It was re-checked against `main` at `216abeff` on 2026-11-07. Physical and institutional acceptance work is defined in the [test strategy](../testing/TEST_STRATEGY.md) and the [deployment checklist](UNIVERSITY_DEPLOYMENT_CHECKLIST.md); the historical starting point is the [production readiness audit](PRODUCTION_READINESS_AUDIT.md).

### 1.1 Summary

Of the ten risks, four are closed, two are open, and four have their code-side mitigation in place but wait on deployment, hardware or institutional evidence (status values are defined in Section 2). Five of the six remaining risks are rated High.

| Area | What is unfinished | Risks |
|---|---|---|
| Backend hosting | The staging backend runs as at most one Cloud Run instance, which starts on the first request after an idle period, with no failover, edge limits or alerting. Its lease-owned workers run only while that instance is up, and trackers still built with the retired tunnel origin cannot report. | OPS-01 (High) |
| Stop tracking | Stop arrival and route matching are validated on simulated rides only; a moving-bus field ride is still needed. | TRK-01 (High) |
| Tracker firmware | Outage recovery, Secure Boot and signed updates are built but not proven on hardware, and one shared update image would give every tracker the same credentials. | FW-01, FW-02, FW-03 (High) |
| Access control | A passenger can board by reporting a false location. | SEC-01 (Medium) |

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
| OPS-01 | Runtime availability and perimeter controls are not evidenced | High | External gate | Accepted worker availability mode, failover or a recorded single-instance acceptance, edge limits, alerts, a verified Authentication restore, an incident drill and trackers on the Cloud Run origin |
| OPS-02 | Scheduled QA runs no suites | Medium | Closed | Scheduled nightly runs from 2026-10-30 and the weekly run of 2026-10-31 resolved `main`, ran every suite and passed (GitHub Actions history, read 2026-11-07) |
| TRK-01 | Stop progress is validated on simulated tracks only | High | External gate | Instrumented ride on the real route, including the divided-road U-turn |
| SEC-03 | Ride operations accept stale administrator claims | Medium | Closed | Every administrator branch applies the `requireAdmin` policy; regression tests for revoked, legacy and partial tokens on each route |
| FW-03 | OTA images carry device secrets but the backend serves one release | High | Open | Per-device releases, or credentials kept out of the update image |
| OPS-03 | The `main` ruleset requires no status checks | Medium | Closed | Ruleset `Require verified changes on main` requires `web`, `backend-image`, `firmware`, `qa-evidence`, `Analyze javascript-typescript` and `Analyze python`, with branches up to date (GitHub API, read 2026-11-02) |

### 3.1 SEC-01: passengers can join a ride without proof of presence

- Evidence: PR #382 (commit `3cf7ade`, 2026-10-25) removed the driver-issued boarding code that PR #23 had introduced as the closing control. `joinSession` in `backend/src/routes/sessions.ts` requires a passenger role (or no role), an existing profile, a session in status `armed` or `active` with a resolved direction, route stops in travel order, browser accuracy of 100 m or better and, on first join, a position within 150 m of a fresh hardware fix bound to the same session, bus and route (`backend/src/services/boardingPolicy.ts`). A transaction re-checks the session, capacity (1,000 entries) and membership. Firestore rules deny every client write to `ride_sessions`.
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

- Evidence: the code supports replicated hosting. `RATE_LIMIT_SHARD_FACTOR` divides every in-memory limiter budget by the replica count (`backend/src/lib/rateLimitShard.ts`); `/health` returns `200` only while Firestore and RTDB probes pass, and `/live` stays `200` while the process runs; a Firestore lease with fencing keeps lifecycle work on one leader ([worker leadership](WORKER_LEADERSHIP.md)); CI builds and smoke-boots the container. The manual job `deploy-backend-staging` deploys the backend from `deploy/cloud-run/staging.service.yaml` to the Cloud Run service `eki-backend-staging` in `asia-south2` (first deployed on 2026-11-01), which runs one instance at most and scales to zero. The job keeps the previous revision serving until the new one reports `status: ok` on `/health` within 3 minutes ([CI, deployment and releases](CI_CD_AND_RELEASES.md#52-steps)). On 2026-11-02 the worker handoff was rehearsed on that service, and Firestore and RTDB exports restored into scratch databases matched the live data ([issue #374](https://github.com/notnamansinha/Eki/issues/374)).
- Staging state: the serving revision `eki-backend-staging-00009-7sh`, deployed with `gcloud` outside `deploy-backend-staging` on 2026-11-03, runs `WORKER_ENABLED=true` with no minimum instance, and the two Cloud Scheduler jobs that would hold one instance from 06:00 to 22:00 IST are paused (Cloud Run and Cloud Scheduler, read 2026-11-07). Staging therefore runs in wake-on-traffic mode: the first request after an idle period, normally a tracker's first telemetry after the bus ignition powers it, starts an instance, the instance takes the worker lease within about 5 s of starting, and it closes 15 to 17 minutes after the last request (measured on 2026-11-03, [staging runtime configuration](STAGING_RUNTIME_CONFIG.md#2-project-facts)). The Realtime Database is `bustrack-be165-asia-rtdb` in `asia-southeast1`; the move on 2026-11-02 preceded the cutover gate of the [RTDB region decision](../design/RTDB_REGION_LATENCY_DECISION.md#3-status), and every Hosting release checks the RTDB host and region (`npm run verify:rtdb-instance -- --require-region`) and the `rtdb` deploy target (`scripts/verify-rtdb-deploy-target.mjs`). The staging web app and `hardware/include/secrets.example.h` use the Cloud Run origin, and a tracker built with that origin reported through Cloud Run on 2026-11-02 ([Cloud Run latency](../testing/CLOUD_RUN_LATENCY_2026_11_02.md)).
- Cold start: on 2026-11-03 a cold start took about 4.5 s, and a client with the tracker's 1.5 s request timeout and 1 s retry got its first answer about 5.7 s after its first request ([staging runtime configuration](STAGING_RUNTIME_CONFIG.md#8-verification)). On 2026-11-02 the tracker's first request received 503, as did one later request (2 of 712 telemetry requests, [Cloud Run latency](../testing/CLOUD_RUN_LATENCY_2026_11_02.md)). A staging Hosting release probes the live backend, retrying `/health` for up to 90 s, only when the same Deploy dispatch also deploys the backend; a staging release that deploys only the frontend does not probe it (`.github/workflows/deploy.yml`).
- Backup path: the workflow `Publish backend image` (`.github/workflows/publish-backend-image.yml`) publishes the backend image to Docker Hub after a green Production verification run on `main`, and `deploy/vps/docker-compose.yml` runs that image on another host ([VPS guide](../../deploy/vps/README.md)). The workflow skips publishing while the `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN` secrets are missing, and all three of its runs, the last on 2026-11-06, succeeded without publishing: each stopped after the credential check (GitHub Actions history, read 2026-11-07).
- Impact: one instance serves the backend without failover. Lease-owned work (stop progress, the stale sweep, the passenger projection, reconciliation, retention and privacy deletion) runs only while an instance is up, so in wake-on-traffic mode work that falls due while no instance is up waits for the next request that starts one. The first telemetry after an idle period is answered only after the instance starts. A revision deployed outside `deploy-backend-staging` skips its `/health` gate and release record. Devices built with the offline tunnel origin cannot deliver telemetry. There is no edge rate limit, WAF or alerting, and no restore of the Authentication export has been verified.
- Open gate: a recorded choice between wake-on-traffic, with its cold start accepted for trackers, and a minimum instance for the service window ([staging runtime configuration](STAGING_RUNTIME_CONFIG.md)); at least two replicas with health-based failover and no duplicate lifecycle transitions, or a recorded single-instance acceptance; edge and global rate limits with `RATE_LIMIT_SHARD_FACTOR` equal to the replica count; alerts on health, rejections, latency, stale telemetry and lease ownership; a verified Authentication restore and an incident drill; every tracker reflashed with the Cloud Run origin and its root CA.

### 3.6 OPS-02: scheduled QA runs no suites

- Evidence: the `resolve` jobs in `.github/workflows/deep-qa.yml` and `.github/workflows/weekly-reliability.yml` read the head of `main` through the GitHub API for scheduled and dispatched runs, and `scripts/qa/workflow-policy.mjs` (tested in `scripts/qa-workflow-policy.test.mjs`) rejects a resolver that names any other branch. Until 2026-10-30 they read `testing`, which was deleted on 2026-10-25: every scheduled nightly run from 2026-10-25 to 2026-10-29 (UTC) failed in `resolve` with `Not Found` and skipped `suites` and `report`, and the last runs that executed suites were on 2026-10-24 (GitHub Actions history, read 2026-10-30).
- Impact while open: the nightly emulator, browser, API, native and GNSS campaigns and the weekly mutation and soak baselines did not run, so regressions on `main` that only these suites catch went unnoticed.
- Open gate: record one green nightly and one green weekly run on a current `main` commit, for example by a manual dispatch of each workflow from `main`.
- Closure (2026-11-07): all eight scheduled nightly runs created between 2026-10-30 and 2026-11-07 (UTC) resolved `main` and passed `resolve`, the six suites (`gnss`, `emulator`, `browser`, `api`, `native`, `reviewedUnit`) and `report`, from run [41146982794](https://github.com/notnamansinha/Eki/actions/runs/41146982794) on `2fdbedd` to run [42316350964](https://github.com/notnamansinha/Eki/actions/runs/42316350964) on `216abeff`. The scheduled weekly run [41253458756](https://github.com/notnamansinha/Eki/actions/runs/41253458756) of 2026-10-31 (UTC) resolved `main` at `bd7a394` and passed the `mutation` and `soak` suites (GitHub Actions history, read 2026-11-07).

### 3.7 TRK-01: stop progress is validated on simulated tracks only

- Evidence: stop arrival uses a 15 m corridor and an offside gate for divided roads, a stop missed while telemetry runs is credited `passed_unobserved`, and the route matcher applies a speed-plausibility penalty ([automatic GNSS service](AUTOMATIC_GNSS_SERVICE.md#4-direction-and-stop-progress)). The evidence is 1,500 simulated rides; about 0.6 % still credit a stop early, mostly on spurs where both directions share one road ([passenger field ride repairs](../testing/PASSENGER_FIELD_RIDE_REPAIRS_2026_10_29.md)).
- Impact: on a real route, receiver error or pin placement can still mark a stop early or late, or match the bus to the wrong carriageway near a U-turn; passengers then see wrong progress and ETAs.
- Open gate: an instrumented ride on the same route, including the divided-road U-turn, recorded with [field capture](FIELD_CAPTURE.md) and compared with an independent position reference.

### 3.8 SEC-03: ride operations accept stale administrator claims

- Evidence: `requireAdmin` (`backend/src/middleware/requireAdmin.ts`) admits a token only with `admin: true`, `role: "admin"` and an `authorizationVersion` that `authorizationIsCurrent` matches against `_userAuthorization/{uid}` in Firestore and RTDB. Handlers shared with operators and passengers apply the same policy through `hasCurrentAdminAuthority` (`backend/src/middleware/adminAuthority.ts`): ride start, delay and the operator fallback of End ride early (`readOperatorAssignment` in `backend/src/routes/shifts.ts`), the administrator stop (`adminStopTarget`), the v2 ride read, and, in `backend/src/routes/sessions.ts`, the legacy boarding code, chat messages and ride status. On these paths a revoked, legacy or partial administrator token is treated as an operator or passenger.
- Impact before closure: a token that still carried an administrator claim after the role was withdrawn, or a legacy token without a version, could start, delay, end or read any ride and post administrator chat messages.
- Closure evidence: `backend/src/middleware/adminAuthority.test.ts`, and the revoked, legacy and role-only administrator cases in `backend/src/routes/shifts.test.ts`, `sessionsStatus.test.ts`, `sessionsMessages.test.ts` and `rideSessions.test.ts`. The fixed-title cases are mapped to acceptance case AUTH13 in `qa/critical-source-test-map.mjs`.

### 3.9 FW-03: OTA images carry device secrets but the backend serves one release

- Evidence: the firmware compiles `DEVICE_ID`, `DEVICE_SECRET`, Wi-Fi credentials and the backend origin from `hardware/include/secrets.h` into the application image (`hardware/src/main.cpp:8`, `:618` to `:641`, `:2132` to `:2135`). The backend reads one global release descriptor from the six `FIRMWARE_RELEASE_*` values (`backend/src/services/firmwareRelease.ts:47`) and returns it to every authenticated, assigned device whose sequence is lower (`backend/src/routes/devices.ts:197` to `:222`).
- Impact: a release built for one device would install that device's identity and secret on every device that updates, so all of them authenticate as one device and the secret is exposed to anyone who obtains the image. Over-the-air updates cannot be used for a fleet as built.
- Open gate: per-device release descriptors and images, or credentials provisioned outside the update image (for example in encrypted NVS), with a test that one device cannot receive another device's image.

### 3.10 OPS-03: the main ruleset requires no status checks

- Evidence: the only repository ruleset (`main`, applied to the default branch and all branches) requires a pull request with one approving review and code owner review, blocks deletion and force pushes, and has no required status checks; maintainers and administrators may bypass it. The default branch has no classic branch protection (GitHub API, read 2026-10-30).
- Impact: a pull request can merge while Production verification or CodeQL is failing or still running. Deploy does not release a failed commit, but `main` can carry it and later green commits deploy on top of it.
- Open gate: add the Production verification jobs (`web`, `backend-image`, `firmware`, `qa-evidence`) and the CodeQL `analyze` jobs as required status checks, and record whether administrators keep bypass rights.
- Closure (2026-11-02): a second ruleset, `Require verified changes on main` (`refs/heads/main`), requires `web`, `backend-image`, `firmware`, `qa-evidence`, `Analyze javascript-typescript` and `Analyze python`, with branches up to date before merging. Correction (2026-11-03): the two rulesets have different bypass lists. Ruleset `main` can be bypassed by the administrator role and the user `suryaraj09`; `Require verified changes on main` by the maintain role, the administrator role and `suryaraj09`, all with `bypass_mode: always` (GitHub API, read 2026-11-03). `suryaraj09` holds the write role, so a write collaborator can merge without an approving review or an up-to-date green run: #418, #426 and #428 merged that way on 2026-11-02, and #426 stopped every staging release until #434. Whether to keep that bypass is the repository owner's decision. Read again on 2026-11-07, both rulesets and their bypass lists are unchanged, and ruleset `main` excludes branches matching `refs/heads/dependabot/**/*` (GitHub API).

## 4. Maintenance rule

A pull request that changes the behaviour behind a risk updates its entry and attaches fresh evidence. A risk is closed only when the remediation and its acceptance evidence are on `main`; code on another branch does not close it. External gates stay open until their evidence is recorded in the deployment checklist and the release evidence.
