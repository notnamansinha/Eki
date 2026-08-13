# University handover checklist

This document separates university-owned production work from the student's
local professor demonstration.

## Infrastructure and ownership

- [ ] Name owners for Firebase/GCP billing, backend runtime, DNS/TLS, maps
  quotas, incident response, privacy, hardware, and driver onboarding.
- [ ] Provide production Firebase projects, approved regions, budgets, quota
  alerts, backup/export schedules, and separate staging/production data.
- [ ] Run at least two backend replicas behind university-managed HTTPS, a
  load balancer/WAF, edge rate limits, health checks, and restricted
  administration. Set `RATE_LIMIT_SHARD_FACTOR` on every instance to the
  deployed replica count so the in-memory rate limiters enforce the same
  aggregate budget as one instance; the WAF provides the authoritative global
  cap (issue #28). Configure the load balancer to fail over on non-200
  `/health` (`/health` returns 200 only while both Firestore and RTDB probes
  pass); the Firestore worker lease keeps lifecycle work single-leader across
  replicas, so failover must not duplicate lifecycle transitions.
- [ ] Use Workload Identity or Secret Manager for server credentials; never
  store service-account JSON or secrets in the repository or firmware build
  logs.
- [ ] Set exact `CORS_ORIGIN`, `FIREBASE_DATABASE_URL`,
  `GOOGLE_MAPS_API_KEY`, `AUTH_REVOCATION_CACHE_MS`, retention values, and
  worker settings.
- [ ] Enforce App Check (console toggle) on Firestore and Realtime Database in
  both projects. Firestore rules also require `request.app != null`; RTDB
  enforcement is configured in Firebase because RTDB rules do not expose that
  variable. The Admin SDK backend is unaffected. Emulator tests strip the
  Firestore App Check gates via `scripts/rules-for-emulator.mjs` (the
  rules-unit-testing SDK cannot attach App Check tokens).

## Staging and deployment pipeline

- [ ] Create the `eki-staging` and `eki-production` Firebase projects and
  configure each with App Check (ReCaptcha Enterprise) and its own data.
- [ ] Configure the `staging` and `production` GitHub environments with
  `FIREBASE_TOKEN` plus all `NEXT_PUBLIC_*` build variables listed in
  `.github/workflows/deploy.yml`.
- [ ] `.firebaserc` defaults to `eki-staging`, so an unqualified
  `firebase deploy` can never reach production. Production deploys run only
  through the explicit `--project eki-production` job behind the protected
  `production` environment (manual `workflow_dispatch` + approval).
- [ ] Verify the `Deploy` workflow promotes main to staging automatically after
  a green `Production verification` run, and that staging smoke checks (rules,
  hosting headers, App Check) pass before any production dispatch.
- [ ] Deploy and monitor the committed `firestore.indexes.json`; retention and
  privacy deletion depend on those indexes.
- [ ] Ensure exactly one healthy worker lease owner processes lifecycle,
  stale-state, and retention jobs. The Firestore lease is safe at any replica
  count, so this is about observing the lease, not limiting replicas.
- [ ] Alert on `/health` readiness, rejected telemetry, credential-cache rate,
  device-to-server/processing/RTDB-write p95/p99, watchdog reset reports and
  worker lease churn. Define targets from a real route load test.

## Identity and device provisioning

- [ ] Maintain approved passenger/admin/driver accounts and immutable role
  claims; immediately revoke departed or reassigned staff.
- [ ] Create one random device secret per ESP32 and store only its salted
  verifier in Firestore.
- [ ] Bind every device to one approved bus and route; document rotation,
  disablement, lost-device, and reassignment procedures.
- [ ] Restrict the browser Maps key by HTTPS referrer and API; restrict the
  server key by runtime identity/IP and Routes/Places APIs.
- [ ] Complete the witnessed
  [ESP32 fleet security and provisioning](HARDWARE_SECURITY_PROVISIONING.md)
  procedure on spare ECO3-or-newer hardware before fleet rollout. Archive
  first-boot evidence that Secure Boot V2 and release-mode flash encryption are
  active; these eFuse operations are irreversible.
- [ ] Confirm every fleet artifact was built with `esp32dev-secure`; development
  firmware is never installed in a vehicle. Verify the runtime hard gate and
  remote diagnostic both report flash encryption and Secure Boot active.
- [ ] Build each device-specific configuration only in the controlled signing
  environment, protect/delete plaintext `secrets.h` and unencrypted artifacts,
  and demonstrate independent signed-reflash secret rotation, revocation, and
  lost-device disablement.
- [ ] Define a signed firmware update and rollback process before enabling OTA.

## Data protection and safety

- [ ] Obtain privacy/legal approval for location purpose, notice, access,
  retention, deletion, incident response, and completed-trip reporting.
- [ ] Verify Firestore/RTDB rules in emulators and production; `devices`,
  `active_rides`, `_active_bus_locks`, internal worker/privacy collections, and
  telemetry writes must remain server-only.
- [ ] Confirm the strict production build (`npm run build:production`) runs in
  CI with the fail-closed env gate and CSP regeneration (issue #39 D1), and
  that the API fails closed without `CORS_ORIGIN` in production (issue #39 D6).
- [ ] Verify the deployed service worker contains no authenticated/default
  runtime cache and that account switching on a shared device cannot replay
  the prior account's data.
- [ ] Monitor rejected device authentication, rate limits, stale devices,
  worker lease loss, backend errors, Firebase usage, and Maps cost.
- [ ] Use fused automotive power conversion, safe antenna placement, protected
  wiring, and maintenance records for each bus.
- [ ] Prohibit drivers from operating the web app or laptop while the vehicle
  is moving.

## Acceptance test

University acceptance is complete only after an authorized team observes:

- [ ] Successful execution of `npm run verify` to confirm linting, unit tests, and production bundle generation.
- [ ] Correct passenger, driver, and admin authorization and assignment.
- [ ] Fresh GNSS positions appear on all panels at measured acceptable latency.
- [ ] Stop 1 alone activates a pre-armed ride.
- [ ] Stops advance strictly in configured order; downstream visits cannot
  skip an expected stop.
- [ ] Parallel start requests on two routes for one bus produce exactly one
  active session/lock; delayed completion from an old session cannot affect a
  newly armed ride.
- [ ] ESP power loss, network loss, GNSS loss, browser refresh, and backend
  restart preserve the active session and recover its stop index.
- [ ] With browser throttling set to Slow 3G (about 400 ms RTT) and then
  Offline, passenger, driver, and admin views show reconnecting status, clear
  stale live positions, and recover after connectivity returns.
- [ ] While a production tab stays open, returning to it triggers a service
  worker update check; an activated update reloads once onto matching assets.
- [ ] Only the final ordered stop completes the ride.
- [ ] Disabled/bad device credentials, malformed/stale payloads, and browser
  write attempts are rejected.
- [ ] Alerts, backups, credential rotation, and rollback are demonstrated.

Record test date, route, firmware version, application commit, participants,
measured latency, failures, evidence links, accepted risks, and signatures.

## Student handover package

- [ ] Source repository and verified commit identifier.
- [ ] Build/test/firmware logs and dependency audit results.
- [ ] Architecture, API, storage, and live-demo documents.
- [ ] Non-secret bus/route/device inventory and wiring diagram.
- [ ] Open-risk list. Never request committed `.env`, service-account JSON,
  signing keys, device secrets, firmware binaries, or App Check debug tokens.
- [ ] HLD, LLD, exhaustive Firebase dictionary, hardware latency analysis,
  API reference and test/failure matrix from the documentation index.
