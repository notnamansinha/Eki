# Eki production-readiness remediation report — 2026-07-28

## Outcome

The repository and Firebase-owned deployment layers have been remediated. The
known broad RTDB writes are closed, the stale frontend was replaced, and direct
device HTTP/Firebase telemetry was replaced by an MQTT QoS 1 ingestion design.

This is **not yet an end-to-end production approval**. The university must
deploy the backend and MQTT broker, supply the final API URL, and complete the
infrastructure controls in the
[deployment and owner checklist](../MQTT_DEPLOYMENT_AND_OWNER_CHECKLIST.md).
The current hosted frontend deliberately fails closed for backend-dependent
operations until that URL is configured and the frontend is rebuilt.

## Deployed state

On 2026-07-28 the following were successfully released to Firebase project
`bustrack-be165`:

- Realtime Database rules
- Firestore rules
- Firestore composite indexes
- Firebase Hosting static frontend

Post-release checks confirmed:

- RTDB root writes are denied and `/activeBuses` writes are denied to browser,
  driver, admin, and device clients.
- `driverRouteAssignments` and RTDB messages are not client-readable/writable.
- the required `ride_sessions(status, endTime)` index exists;
- the Hosting response contains the new CSP with script hashes and no
  `script-src 'unsafe-inline'`;
- live driver/admin/passenger bundles contain no localhost URL,
  `test_bus_1`, or direct RTDB mutation path;
- the browser Firebase API key now has Hosting/localhost referrer restrictions.

The Firestore rules-source readback REST API returned `403` for the current
operator identity. Evidence for that rules deployment is therefore the
successful Firebase release response plus the passing local emulator
authorization suite; source readback remains an owner-permission verification.

## Telemetry contract

Devices publish to:

`eki/v1/telemetry/<deviceId>`

Transport requirements:

- MQTT over verified TLS (`mqtts://` in production)
- QoS 1
- persistent session
- retained flag prohibited
- unique per-device broker identity and topic ACL

The JSON object must have exactly six keys and no others:

| Key | Meaning |
|---|---|
| `lat` | latitude |
| `lng` | longitude |
| `speed` | ground speed |
| `heading` | heading in degrees |
| `motionState` | normalized motion state |
| `timestamp` | device Unix time in milliseconds |

Route/bus/device identity, trip lifecycle, delay, ETA, status, and server
timestamps are authoritative server data and are not accepted from firmware.
The ingestion layer enforces a 512-byte maximum, exact schema, numeric/range
checks, freshness/future-skew checks, device enablement and assignment, a
per-device rate, retained-message rejection, and timestamp deduplication.
QoS 1 is at-least-once delivery, so duplicate handling is intentional.

## Audit finding disposition

| ID | Status | Remediation / remaining risk |
|---|---|---|
| PR-01 | **Fixed and deployed** | RTDB client writes are denied; new frontend deployed; live bundle/rule checks passed. |
| PR-02 | **Code fixed; university action** | Production builds cannot inherit localhost. University must deploy HTTPS backend, set exact CORS/API URL, rebuild, and smoke-test. |
| PR-03 | **Application fixed; edge control required** | Devices no longer access Firebase. MQTT ingestion validates/rate-limits/deduplicates. Broker connection/publish limits and cost alerts remain university work. |
| PR-04 | **University action** | In-process limits exist; WAF/reverse proxy, shared limiter, instance/concurrency caps, and DDoS monitoring require the deployment environment. |
| PR-05 | **Fixed** | Firestore lease elects one worker leader and cleans up listeners/timers on lease loss. |
| PR-06 | **Partially fixed** | App Check client initialization exists. Owner must create the Enterprise site key, observe metrics, and enable enforcement. |
| PR-07 | **Substantially fixed; physical residual** | Per-device MQTT ACL design, disable/rotation API, TLS, assignment validation, rate/freshness/dedupe checks added. Secure boot/flash/NVS and physical-extraction controls require hardware provisioning. |
| PR-08 | **Code fixed; operations required** | Retention sweeper and deletion workflow added. Backups, restore drill, alerts, incident runbooks, and retention approval remain owner tasks. |
| PR-09 | **Fixed** | Fleet operation records and periodic reconciliation repair Auth/Firestore/RTDB partial failures. |
| PR-10 | **Fixed** | Shift start requires fresh coordinates within 250 m of a valid route origin. |
| PR-11 | **Fixed** | Passenger views share a single normalized RTDB listener. |
| PR-12 | **Fixed for beta bounds** | Previously unbounded reads now have explicit caps. Large-scale admin UX will later need cursor pagination rather than only caps. |
| PR-13 | **Fixed locally** | Bounded five-minute route/polyline cache, invalidation, and dedicated planner limiter added. Distributed edge limiting remains PR-04. |
| PR-14 | **Script risk fixed** | Built inline scripts receive CSP hashes; `script-src` no longer permits inline scripts. `style-src 'unsafe-inline'` remains for React inline styles and should be removed in a future UI refactor. |
| PR-15 | **University action** | Separate staging infrastructure and promotion controls cannot be created safely from this repository alone. |
| PR-16 | **Code fixed; legal approval required** | Passenger deletion and scheduled data minimization implemented. Privacy notice, purpose/retention approval, access audit, and incident process require university IT/legal. |
| PR-17 | **Fixed** | Role synchronization now paginates, uses bounded concurrency, checkpoints, and records retryable failures. |
| PR-18 | **Fixed** | Passenger geolocation denial now displays a nonblocking explanation. |
| PR-19 | **Safe current state; future action** | OTA stays disabled. A signed, authenticated, rollback-safe design is required before enabling it. |

## Verification evidence

Completed checks:

- frontend and backend ESLint: pass;
- backend unit tests: 48 pass, with rule tests skipped outside emulator;
- frontend unit tests: 15 pass;
- Firebase emulator authorization suite: 51 backend tests pass, including
  authenticated/unauthenticated RTDB reads and denied passenger/admin/device
  writes plus Firestore lifecycle bypass tests;
- TypeScript backend build and static Next.js production build: pass;
- ESP32 PlatformIO compile: pass (RAM 14.2%, flash 29.2%);
- production dependency audit using
  `npm audit --omit=dev --omit=optional`: zero known vulnerabilities;
- Firebase deployment dry run and live deployment: pass;
- repository diff whitespace check: pass;
- forbidden production pattern scan: no device HTTP/Firebase writes,
  `/api/devices/auth`, `test_bus_1`, or direct frontend RTDB mutations.

The full developer/optional dependency audit still reports six moderate notices
through Firebase Admin's optional Cloud Storage chain. This application does not
use Cloud Storage, and the production install command omits optional and
development packages. Firebase Admin is already on the current repository
version used by this project; do not apply npm's suggested downgrade to 10.3.0.

## What could not be fully verified here

These checks require systems or authority not present in the workspace:

- real broker TLS/ACL enforcement and broker-level DDoS limits;
- multi-device hardware-in-the-loop, GNSS-loss, long soak, and reconnect-storm
  tests;
- deployed university backend behavior, WAF, shared rate limiting, egress IP,
  CORS, secrets, monitoring, and resource caps;
- App Check registration/enforcement (the Enterprise API is not enabled or
  accessible to the current identity);
- backup/PITR/delete protection and a successful restore drill;
- separate browser/server Maps keys and final key rotation;
- legal/privacy/retention and incident-response approval;
- signed OTA and physical device security.

Firestore currently reports Standard edition in `asia-south2`, delete protection
disabled, PITR disabled, one-hour version retention, no backup schedules, and no
monitoring policies visible to the current account. These are explicit owner
actions, not silent assumptions.

## Launch decision

The previously exposed Firebase prototype is hardened and deployed.

The end-to-end beta remains **NO-GO** until the university completes the linked
checklist, deploys the broker/backend, rebuilds the frontend with the final HTTPS
API URL and App Check site key, and records successful cutover/acceptance tests.
