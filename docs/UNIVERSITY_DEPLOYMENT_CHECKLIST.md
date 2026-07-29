# University handover checklist

This document separates university-owned production work from the student's
local professor demonstration.

## Infrastructure and ownership

- [ ] Name owners for Firebase/GCP billing, backend runtime, DNS/TLS, maps
  quotas, incident response, privacy, hardware, and driver onboarding.
- [ ] Provide production Firebase projects, approved regions, budgets, quota
  alerts, backup/export schedules, and separate staging/production data.
- [ ] Deploy the backend behind university-managed HTTPS, a load
  balancer/WAF, edge rate limits, health checks, and restricted administration.
- [ ] Use Workload Identity or Secret Manager for server credentials; never
  store service-account JSON or secrets in the repository or firmware build
  logs.
- [ ] Set exact `CORS_ORIGIN`, `FIREBASE_DATABASE_URL`,
  `GOOGLE_MAPS_API_KEY`, retention values, and worker settings.
- [ ] Ensure exactly one healthy worker lease owner processes lifecycle,
  stale-state, and retention jobs.

## Identity and device provisioning

- [ ] Maintain approved passenger/admin/driver accounts and immutable role
  claims; immediately revoke departed or reassigned staff.
- [ ] Create one random device secret per ESP32 and store only its salted
  verifier in Firestore.
- [ ] Bind every device to one approved bus and route; document rotation,
  disablement, lost-device, and reassignment procedures.
- [ ] Restrict the browser Maps key by HTTPS referrer and API; restrict the
  server key by runtime identity/IP and Routes/Places APIs.
- [ ] Provision ESP32 Secure Boot V2 and flash encryption on spare hardware
  before fleet rollout. These eFuse operations are irreversible and require
  controlled signing-key custody.
- [ ] Define a signed firmware update and rollback process before enabling OTA.

## Data protection and safety

- [ ] Obtain privacy/legal approval for location purpose, notice, access,
  retention, deletion, incident response, and completed-trip reporting.
- [ ] Verify Firestore/RTDB rules in emulators and production; `devices`,
  `active_rides`, and telemetry writes must remain server-only.
- [ ] Monitor rejected device authentication, rate limits, stale devices,
  worker lease loss, backend errors, Firebase usage, and Maps cost.
- [ ] Use fused automotive power conversion, safe antenna placement, protected
  wiring, and maintenance records for each bus.
- [ ] Prohibit drivers from operating the web app or laptop while the vehicle
  is moving.

## Acceptance test

University acceptance is complete only after an authorized team observes:

- [ ] Correct passenger, driver, and admin authorization and assignment.
- [ ] Fresh GNSS positions appear on all panels at measured acceptable latency.
- [ ] Stop 1 alone activates a pre-armed ride.
- [ ] Stops advance strictly in configured order; downstream visits cannot
  skip an expected stop.
- [ ] ESP power loss, network loss, GNSS loss, browser refresh, and backend
  restart preserve the active session and recover its stop index.
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
- [ ] Open-risk list. Never request committed `.env`, `secrets.h`, service
  account JSON, private keys, device secrets, or App Check debug tokens.
