# MQTT deployment and owner checklist

Last updated: 2026-07-28

This document separates what has already been deployed from what the university
must provide. Do not treat a green frontend deployment as an end-to-end launch:
the browser now fails closed until the university backend and MQTT service are
available.

## Already completed

- Firebase RTDB rules, Firestore rules/indexes, and the static frontend were
  deployed to project `bustrack-be165`.
- Browser and device clients cannot write RTDB. Only the backend Admin SDK may
  create or update `/activeBuses`.
- The old device HTTP/Firebase-token route was removed.
- ESP32 firmware publishes MQTT over TLS with QoS 1 and a persistent session.
- The accepted telemetry JSON is schema-closed to exactly:
  `lat`, `lng`, `speed`, `heading`, `motionState`, `timestamp`.
- The backend validates identity, topic, size, schema, ranges, freshness,
  assignment, message rate, retained-message status, and duplicate timestamps
  before writing RTDB.
- Worker leadership, bounded reads, route-cache limits, privacy deletion,
  retention sweeping, reconciliation, strict script CSP, and browser App Check
  initialization are implemented.
- The Firebase browser API key is restricted to the two Firebase Hosting
  domains and localhost development origins.

Live frontend: <https://bustrack-be165.web.app>

## University backend and MQTT cutover

Complete these tasks before calling the beta operational.

### 1. Provide the MQTT broker

- Use an MQTT 3.1.1/5-compatible broker reachable only through TLS, normally
  `mqtts://broker.example.edu:8883`.
- Install a publicly trusted or university CA certificate. Put the matching CA
  certificate in firmware and, for a private CA, in `MQTT_CA_CERT`.
- Disable anonymous access. Give each device a unique username/password or,
  preferably, a unique client certificate.
- Apply the example policy in `ops/mosquitto/acl.example`: a device may publish
  only to `eki/v1/telemetry/<its-device-id>`, and the backend ingestion account
  may subscribe to `eki/v1/telemetry/+`.
- Deny device subscriptions, retained publishes, wildcard publishes, and access
  to other device topics.
- Limit connection rate, per-client inflight messages, queued bytes, maximum
  packet size, and publish rate at the broker. The application default is
  30 accepted messages/device/minute, but an edge limit is still required for
  traffic rejected before application processing.
- Send broker authentication failures, disconnect storms, rejected publishes,
  and bandwidth/connection thresholds to university monitoring.
- Test credential disable and rotation for one device before rollout.

Start from `ops/mosquitto/mosquitto.conf.example` and
`ops/mosquitto/acl.example`; do not deploy their placeholder credentials.

### 2. Deploy the backend

- Build from the repository root, then install production packages with:
  `npm ci --omit=dev --omit=optional`.
- Configure every variable in `backend/.env.example` using Secret Manager,
  workload identity, or the university's equivalent. Do not place service
  account JSON, MQTT passwords, or CA private keys in the repository or image.
- Set `CORS_ORIGIN` to the exact two Firebase Hosting origins.
- Use a dedicated server-side Google Maps key restricted to the backend's fixed
  egress IP and only the APIs actually used.
- Set `FIREBASE_DATABASE_URL` to the production RTDB and use a least-privilege
  runtime identity.
- Keep `WORKER_ENABLED=true`. The Firestore lease elects one leader across
  instances; all instances still need access to the same Firestore project.
- Put the API behind the university reverse proxy/WAF. Enforce TLS, request and
  header size limits, timeouts, a shared rate limiter, instance/concurrency
  caps, and upstream budgets. The in-process limiter is defense in depth, not
  DDoS protection.
- Restrict the backend from the public internet where practical, except for
  required frontend API paths and health probes.
- Verify `/health` reports backend readiness and MQTT connectivity before
  routing user traffic.

The university must provide the final HTTPS API URL. After it is known, set
`NEXT_PUBLIC_BACKEND_URL=https://...`, run `npm run build:production`, and
redeploy Hosting. Until then, privileged driver/admin operations intentionally
show an unavailable-backend error instead of calling localhost or bypassing the
server.

### 3. Register devices

- Create one Firestore `devices/<deviceId>` record through the authenticated
  admin device API, with `enabled: true`, the assigned `busId`, and `routeId`.
- Create a matching broker identity whose ACL permits only that device's topic.
- Copy `hardware/include/secrets.example.h` to the ignored `secrets.h`, insert
  the Wi-Fi/MQTT values and CA certificate, compile, and flash the unit.
- Never reuse a device ID, client ID, or password across buses.
- On loss or theft, disable the Firestore record and broker credential, then
  rotate any shared Wi-Fi secret.
- Use ESP32 secure boot, flash encryption, and encrypted NVS if the selected
  board and university provisioning process support them. Physical extraction
  cannot be solved by source code alone.

### 4. Run the cutover test

Use a staging project and staging broker first.

1. Confirm a valid device message reaches only its assigned bus.
2. Confirm extra JSON fields, stale/future timestamps, oversized payloads,
   retained publishes, wrong topics, wrong assignments, and messages over the
   rate limit are rejected.
3. Confirm QoS 1 duplicate delivery does not create duplicate state changes.
4. Disconnect Wi-Fi and the broker repeatedly; confirm reconnect, persistent
   session behavior, and bounded buffering.
5. Run at least the expected peak device count for several hours, including a
   reconnect storm and invalid-message flood.
6. Smoke-test driver shift start/stop, admin route/fleet changes, passenger
   tracking, chat, feedback, privacy deletion, and stale-bus cleanup.
7. Run an authenticated authorization test and a web security scan against
   staging. Never load-test or fuzz production without written authorization.

Hardware-in-the-loop, multi-device soak, RF/GNSS-loss, and reconnect-storm tests
require real university hardware/network infrastructure and therefore remain
owner acceptance tests.

## Firebase and Google Cloud owner controls

These are not safely deployable from source code or without billing/owner
authority:

- Register the web app with Firebase App Check using reCAPTCHA Enterprise, set
  `NEXT_PUBLIC_RECAPTCHA_ENTERPRISE_SITE_KEY`, redeploy, monitor valid/invalid
  traffic, then enforce App Check for supported Firebase products. Do not enable
  enforcement before validating the production browser flow.
- The current Google Maps key is shared between browser and server and cannot
  safely receive both referrer and server-IP restrictions. Create two new keys:
  a browser key restricted to the Hosting referrers and Maps JavaScript API,
  and a server key restricted to university egress IPs and only required
  Routes/Places APIs. Rotate the old shared key after both deployments.
- Enable billing budgets, quota caps where available, and alerts for Firebase,
  Maps, egress, authentication failures, API errors/latency, MQTT rejects,
  worker lease loss, and abnormal per-device traffic.
- Enable Firestore delete protection, point-in-time recovery, scheduled
  backups, and a separate-location/appropriate-retention backup policy. Perform
  and record a restore drill before beta.
- Create separate staging and production Firebase/GCP projects, service
  accounts, secrets, broker namespaces, and budgets.
- Review and approve the configured retention periods, privacy notice, purpose
  limitation, user deletion process, incident response, breach notification,
  and access-control review with university IT/legal.
- Maintain a credential inventory and rotation dates. Remove access immediately
  when an operator/admin leaves.
- OTA remains disabled. Do not enable it until signed firmware, authenticated
  metadata, rollback protection, staged rollout, and recovery are designed and
  tested.

## Current go/no-go

- **Firebase-only prototype:** deployed and hardened.
- **End-to-end beta:** **NO-GO until sections 1–4 are completed and evidenced.**
- **Public or high-volume launch:** additionally requires the Firebase/GCP owner
  controls, load/soak results, monitoring, backup restore evidence, and legal
  approval above.
