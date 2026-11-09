# University Deployment Checklist

| Document ID | Version | Status | Last updated |
|---|---|---|---|
| EKI-OPS-006 | 1.4 | Current | 2026-11-07 |

## 1. Purpose

This checklist lists what a university release of Eki needs beyond the repository: named owners, infrastructure, release controls, device provisioning, data protection and the witnessed acceptance test. The repository's automated verification is described in [CI, deployment and releases](CI_CD_AND_RELEASES.md); open risks are in the [risk register](ARCHITECTURE_RISK_REGISTER.md). A student demonstration follows the [live demo runbook](LIVE_DEMO_RUNBOOK.md) and does not satisfy this checklist.

Each item is complete only when its evidence is recorded in the release evidence (see [release evidence](CI_CD_AND_RELEASES.md#11-release-evidence)).

## 2. Release ownership

| Area | Owner role | Evidence of completion |
|---|---|---|
| Firebase and Google Cloud billing, projects and quotas | Platform owner | Project IDs (recorded privately), budgets and alerts ([cost model](../cost/COST_MODEL.md)) |
| Backend runtime, DNS and TLS | Platform owner | Runtime manifest, health checks, certificates ([DNS and domains](DNS_AND_DOMAINS.md)) |
| Release approval | Release manager | Approved `production` environment run |
| Maps keys and quotas | Platform owner | Key restrictions and quota alerts |
| Incident response | Operations lead | Contact list and drill record |
| Privacy and retention | Data protection officer | Written approval |
| Devices and installation | Hardware owner | Provisioning records, installation records per bus |
| Operator and driver onboarding | Transport office | Accounts and assignments |

- [ ] Every owner role above is filled by a named person.

## 3. Infrastructure

- [ ] Provide separate staging and production Firebase projects with approved regions, budgets, quota alerts and scheduled backups or exports. Only `bustrack-be165` exists; it receives every green push to `main` and serves field tests. `eki-production` is named in the Deploy workflow but not provisioned.
- [ ] Run the production backend on a managed runtime under university HTTPS, not on a workstation behind a tunnel ([proposal](CI_CD_AND_RELEASES.md#72-proposed-migration-to-cloud-run)). The repository releases only the staging service: the manual job `deploy-backend-staging` applies `deploy/cloud-run/staging.service.yaml` to `bustrack-be165`. Production needs its own service manifest, deploy identity and release job. The Docker Hub image and the [VPS guide](../../deploy/vps/README.md) describe a backup host that an operator starts and updates by hand; no workflow deploys it or checks its `/health`.
- [ ] Run at least two backend replicas behind a load balancer with a WAF and edge rate limits, or record acceptance of a single instance. The WAF is the authoritative global rate cap.
- [ ] Set `RATE_LIMIT_SHARD_FACTOR` on every instance to the replica count, so the in-memory limiters together enforce one instance's budget. The count must not exceed the smallest limiter budget (10 requests per minute, route computation); beyond that, use a shared limiter. Keep `HTTPS_DEVICE_RATE_LIMIT_MODE=distributed`.
- [ ] Set `TRUST_PROXY` to the number of reverse proxies in front of the backend (unset means one in production), so rate limits key on the real client address.
- [ ] Point load balancer readiness at `/health`, which returns `200` only while the Firestore and RTDB probes pass. Point restart or liveness probes at `/live`, which stays `200` while the process runs. Do not restart a healthy process because a dependency is down.
- [ ] Use Workload Identity or Secret Manager for server credentials. Keep service-account JSON out of the repository, images and build logs.
- [ ] Set the production runtime values: `NODE_ENV=production`, exact `CORS_ORIGIN`, `FIREBASE_DATABASE_URL`, `GOOGLE_MAPS_API_KEY`, `AUTH_REVOCATION_CACHE_MS`, the worker settings and the approved retention values. Production startup fails without `CORS_ORIGIN` and without `RETENTION_SWEEPER_ENABLED=true` ([configuration](../CONFIGURATION.md)).
- [ ] Before moving RTDB to another instance or region, set both database URL variables and `RTDB_EXPECTED_REGION`, run `npm run verify:rtdb-instance`, and follow the [RTDB region decision](../design/RTDB_REGION_LATENCY_DECISION.md).

## 4. Release pipeline

- [ ] Create the GitHub `production` environment with required reviewers, deployments from `main` only (as `staging` has), its secrets (`FIREBASE_TOKEN`, `FIREBASE_DATABASE_URL` and the ten `NEXT_PUBLIC_*` values in `.github/workflows/deploy.yml`) and the variable `RTDB_EXPECTED_REGION` before the first production dispatch; the release fails while that variable is unset. A production backend job needs its own trust binding, because `eki-github-deployer` trusts only the `staging` environment. On 2026-11-07 the environment does not exist ([repository settings](CI_CD_AND_RELEASES.md#55-repository-settings)).
- [ ] If the production project ID differs from `eki-production`, change the workflow's project and frontend origin through a reviewed pull request.
- [ ] Map the `rtdb` deploy target to the production RTDB instance in `.firebaserc`, which maps it for `bustrack-be165` only. Without the mapping `deploy-production` stops at its first check (`node scripts/verify-rtdb-deploy-target.mjs --project eki-production`).
- [ ] Deploy the production backend before the first production dispatch. `deploy-production` always runs `npm run verify:web-backend-contract` against its `NEXT_PUBLIC_BACKEND_URL` and stops unless `/health` reports `ok` and CORS allows `https://eki-production.web.app`.
- [ ] Add `NEXT_PUBLIC_SITE_URL` (and `NEXT_PUBLIC_SITE_INDEXING` for non-production builds) to the Deploy build step; neither Deploy job passes them.
- [x] Require the Production verification jobs as status checks: the ruleset `Require verified changes on main` requires them and both CodeQL jobs, with branches up to date; the maintain and administrator roles and the account `suryaraj09` keep bypass rights, and the owner decides whether to keep that bypass ([OPS-03](ARCHITECTURE_RISK_REGISTER.md#310-ops-03-the-main-ruleset-requires-no-status-checks), GitHub API, read 2026-11-07).
- [x] Record a green nightly and a green weekly QA run on `main`, which the scheduled workflows test: every scheduled nightly run from 2026-10-30 to 2026-11-07 (UTC) and the scheduled weekly run of 2026-10-31 passed ([OPS-02](ARCHITECTURE_RISK_REGISTER.md#36-ops-02-scheduled-qa-runs-no-suites), GitHub Actions history, read 2026-11-07).
- [ ] Confirm that a green push to `main` deploys to staging and that staging checks (Hosting headers, sign-in, role checks, rules) pass before any production dispatch. A push releases Hosting, rules and indexes only; the Deploy workflow changes the staging backend only on a dispatch with `deploy_backend: true` ([CI, deployment and releases](CI_CD_AND_RELEASES.md#51-triggers-and-conditions)).
- [ ] Confirm that the Deploy run's App Check step reports `UNENFORCED` for Firestore and RTDB. The web app does not use App Check; Security Rules and backend authorization carry identity and role checks.
- [ ] Deploy `firestore.indexes.json` and confirm the readiness gate ([Firestore index deployment](FIRESTORE_INDEX_DEPLOYMENT.md)). Deploy the RTDB `activeBuses` `.indexOn` before relying on indexed stale scans, and run the [matching and lifecycle scan acceptance](MATCHING_AND_LIFECYCLE_SCANS.md).
- [ ] Confirm exactly one worker lease owner runs lifecycle, stale-state and retention work ([worker leadership](WORKER_LEADERSHIP.md)).
- [ ] Alert on `/health` readiness, rejected telemetry, credential cache rate, device-to-server, processing and RTDB-write p95 and p99, device watchdog resets and lease changes. Set targets from a load test on the real route ([telemetry ingestion load test](TELEMETRY_INGESTION_LOAD_TEST.md)).

## 5. Identity and devices

- [ ] Maintain approved passenger and administrator accounts with backend-published role claims; revoke departed or reassigned staff at once ([privileged database authorization](../security/PRIVILEGED_DATABASE_AUTHORIZATION.md)). Operator assignments are fleet records managed by administrators.
- [ ] Give each ESP32 its own random secret with `npm run provision-device --workspace=backend -- --device-id <device-id> --bus-id <bus-id> --route-id <route-id>`; Firestore stores only its salted verifier.
- [ ] Bind each device to one bus and route. Document rotation, disablement (`POST /api/devices/<device-id>/disable`), lost-device and reassignment procedures.
- [ ] Restrict the browser Maps key by HTTPS referrer and API, and the server key by runtime identity or source address and the Routes and Places APIs. The staging server key carries the API restriction only, because Cloud Run outgoing addresses are not fixed ([staging runtime configuration](STAGING_RUNTIME_CONFIG.md#6-maps-keys)).
- [ ] Complete [hardware security provisioning](../security/HARDWARE_SECURITY_PROVISIONING.md) on spare ECO3 or newer boards before fleet rollout, with first-boot evidence that Secure Boot V2 and release-mode flash encryption are active. The eFuse operations are irreversible.
- [ ] Build every vehicle image with `esp32dev-secure` in the controlled signing environment; never install development firmware in a vehicle. Confirm the runtime gate and the remote diagnostic report Secure Boot and flash encryption active.
- [ ] Protect or delete plaintext `secrets.h` files and unencrypted artifacts; demonstrate secret rotation, revocation and lost-device disablement.
- [ ] Resolve [FW-03](ARCHITECTURE_RISK_REGISTER.md#39-fw-03-ota-images-carry-device-secrets-but-the-backend-serves-one-release) before enabling over-the-air updates: every image embeds one device's secret, but the backend offers one release to every device.
- [ ] Configure immutable HTTPS hosting for signed firmware and all six `FIRMWARE_RELEASE_*` backend values; prove withholding during an active ride, rejection of a wrong key or digest, healthy confirmation and automatic rollback on spare boards.

## 6. Data protection and safety

- [ ] Obtain privacy and legal approval for location purpose, notice, access, retention, deletion, incident response and completed-trip reporting. The default retention is 180 days for ride sessions, feedback and completed trips and 90 days for operation logs.
- [ ] Record the staging evidence that [privacy deletion](PRIVACY_DELETION.md) lists: deployed collection-group indexes, real Auth failure and revocation outcomes, process supervision, replica and console quiescence, and backup erasure.
- [ ] Decide on the residual boarding risk ([SEC-01](ARCHITECTURE_RISK_REGISTER.md#31-sec-01-passengers-can-join-a-ride-without-proof-of-presence)).
- [ ] Verify Firestore and RTDB rules in the emulator (CI) and in production: `devices`, `active_rides`, `_active_bus_locks`, internal collections and live telemetry are server-only; `feedbacks` and `feedbackCooldowns` are the only client-written collections.
- [ ] Verify that the deployed service worker has no authenticated or default runtime cache, and that switching accounts on a shared device does not show the previous account's data.
- [ ] Monitor rejected device authentication, rate limits, stale devices, lease loss, backend errors, Firebase usage and Maps cost.
- [ ] Install each device with fused automotive power conversion, safe antenna placement and protected wiring; keep maintenance records per bus.
- [ ] Prohibit drivers from operating the web app or a laptop while the vehicle moves.

## 7. Acceptance test

University acceptance is complete only when an authorised team observes and records every item below on the release candidate:

- [ ] `npm run verify` passes and the Production verification run for the commit is green.
- [ ] Passenger and administrator authorization behave as specified, and operator assignment is managed by administrators.
- [ ] Fresh GNSS positions appear on every view within the measured latency target ([telemetry latency baseline](TELEMETRY_LATENCY_BASELINE.md)).
- [ ] A qualified fix starts the service with no operator action; the ride enters `In Service` only after the bus leaves stop 1 ([automatic GNSS service](AUTOMATIC_GNSS_SERVICE.md)).
- [ ] Stops advance in route order. A missed stop shows `Passed · not confirmed`, and stops passed during a GNSS gap are recorded as skipped, never as arrivals.
- [ ] Stop arrivals on the real route, including the divided-road U-turn, match an independent position reference ([TRK-01](ARCHITECTURE_RISK_REGISTER.md#37-trk-01-stop-progress-is-validated-on-simulated-tracks-only)).
- [ ] Parallel start requests for one bus produce exactly one session and lock; a delayed completion from an old session cannot affect a newer ride.
- [ ] Device power loss, network loss, GNSS loss, browser refresh and backend restart keep the session and its stop progress.
- [ ] With browser throttling at Slow 3G (about 400 ms round-trip time) and then Offline, the passenger and admin views show delayed or lost tracking instead of stale positions as live, and recover when the connection returns.
- [ ] Returning to an open production tab triggers a service worker update check; an activated update reloads the page once onto matching assets.
- [ ] Only the final stop completes the ride; the return service starts after the turnaround wait.
- [ ] `End ride early` records an interrupted ride and pauses the bus; `Resume tracking` restarts it.
- [ ] Disabled or wrong device credentials, malformed or stale payloads and browser write attempts are rejected.
- [ ] Alerts, backups, credential rotation and rollback are demonstrated.

Record the date, route, firmware version and image hash, application commit, participants, measured latency, failures, evidence links, accepted risks and signatures.

## 8. Handover package

- [ ] Source repository and the verified commit.
- [ ] Build, test, firmware and dependency audit outputs, and the CycloneDX SBOM artifact `production-dependency-sbom` from the Production verification run of the release commit (GitHub keeps it for 30 days).
- [ ] The documentation set listed in the [documentation index](../README.md), including architecture, API, data model, test strategy and these operations documents.
- [ ] Non-secret inventory of buses, routes and devices, and the wiring diagram.
- [ ] The current risk register with owner decisions.
- [ ] Never request or hand over committed `.env` files, service-account JSON, signing keys, device secrets or firmware binaries containing credentials.
