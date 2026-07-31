# Production readiness audit

Audit date: 2026-07-30

Target: the HTTPS GNSS firmware, Firebase data plane, Express backend, Next.js
passenger/driver/admin applications, deployment configuration, and operational
documentation.

## Outcome

The project should remain a modular monolith with Firebase Realtime Database
for the live position stream, Firestore for durable state, and one
lease-controlled backend worker. A broker, Redis tier, microservice split, or
client-side lifecycle engine would add more failure modes than value for this
fleet and university demonstration.

The audited code has one authoritative ride lifecycle:

1. The driver arms an assigned bus and route.
2. Hardware posts a closed six-field GNSS payload over verified HTTPS.
3. Reaching ordered stop 1 changes the ride from `pre_departure` to
   `in_service`.
4. Only the next expected stop can advance progress.
5. Power, GNSS, network, browser, or backend interruption preserves the
   durable active ride.
6. Reaching the final expected stop completes the ride.

## Issues fixed

| Area | Classification | Change |
|---|---|---|
| ESP32 publish loop | Performance/correctness | Removed the five-second retry gate that also throttled successful uploads. Successful changed fixes can now use the intended three-second floor. |
| ESP32 failure recovery | Reliability/performance | Added capped exponential HTTPS retry with per-device jitter, connection reset after failure, and removal of nearly stale buffered samples before they can delay a fresh fix. |
| GNSS UART | Reliability | Increased the RX buffer from the ESP32 default to 8 KiB before UART startup, enough to retain 9,600-baud NMEA input during the configured seven-second HTTPS timeout. |
| Browser API auth | Performance/security | Kept Firebase revocation checking but coalesced concurrent checks and cached only the SHA-256 token key plus decoded claims for 15 seconds. Raw bearer tokens are not retained; the cache is bounded and can be disabled. |
| Firestore deployment | Deployment/correctness | Added the previously missing tracked index manifest, including the retention query composite index and collection-group indexes used by privacy deletion. |
| Admin ride history | Performance | Changed the listener from 250 arbitrary sessions plus client sorting to the latest 100 sessions ordered by `startTime` on the server. |
| API boundaries | Security | Applied a strict safe-ID grammar to passenger request document IDs and made every telemetry route response explicitly non-cacheable. |
| Maintenance | Architecture/maintenance | Removed four unreachable UI modules, unused helpers/exports and dev dependencies, made the backend ESLint toolchain explicit, and retained Firestore as an explicit runtime dependency for optional-free container installs. |

## Performance guardrails

- Telemetry change floor: 3 seconds.
- Moving heartbeat: 30 seconds.
- Stopped heartbeat: 60 seconds.
- HTTPS timeout: 7 seconds.
- HTTPS failure backoff: capped at 30 seconds with jitter.
- Device ingestion default: 30 accepted requests per minute.
- Auth revocation cache: 15 seconds by default, maximum 60 seconds.
- Ride-history live query: 100 newest started sessions.
- Current production route JavaScript, before Google Maps external code:
  approximately 212 KiB gzip for landing, 226 KiB admin, 477 KiB driver,
  383 KiB feedback, and 424 KiB passenger. Firebase and Maps account for most
  of the larger authenticated-route bundles and are required for live data.

## Security conclusions

- Device secrets remain independent per device, scrypt-hashed at rest,
  timing-safe compared, excluded from payloads/logs, and transmitted only
  through certificate-verified HTTPS.
- Bus/route identity remains server-side; a device cannot choose its assigned
  vehicle or route in telemetry.
- Firestore and RTDB default-deny rules keep device registry, active-ride
  recovery, and all live mutations backend-authoritative.
- Browser Firebase/Maps keys are public identifiers by design. Production
  still requires console-side hostname/API restrictions and App Check
  enforcement.
- In-memory rate limits are appropriate for the local demo and a small
  single-instance service. A multi-instance university deployment still needs
  load-balancer/WAF rate limiting because process-local counters are not
  globally shared.

## Verification

- Backend lint and TypeScript compilation: passed.
- Frontend lint, TypeScript validation, and static production build: passed.
- Backend tests: 50 passed; three emulator cases skipped locally.
- Frontend tests: 23 passed.
- Production dependency audit: zero known vulnerabilities.
- A full install audit reports six moderate advisories only through
  Firebase Admin's optional Cloud Storage dependency chain. The backend image
  explicitly omits optional dependencies, and npm's suggested "fix" is an
  unsupported Firebase Admin downgrade, so these packages were not forced
  across incompatible major versions.
- ESP32 PlatformIO release build: passed; 14.4% RAM and 29.7% flash.
- Dead-file/dependency/export scan: no actionable findings remain.
- Firebase index JSON and generated hosting CSP: validated by the build/tests.

The Firebase rule emulator could not run on this laptop because Java is not
installed; CI installs Java and runs that suite. The Dockerfile could not be
built locally because the Docker Desktop daemon was stopped. These are
environment limitations, not passing checks.

## Required real-world validation

Software verification cannot replace the final bus rehearsal. Before the
professor demonstration, complete
[LIVE_DEMO_RUNBOOK.md](LIVE_DEMO_RUNBOOK.md), including real GNSS acquisition,
the public HTTPS path, three role-specific browsers, ordered stops, an ESP
power interruption longer than the stale threshold, backend/browser restart,
and final-stop-only completion.

University production acceptance must also complete
[UNIVERSITY_DEPLOYMENT_CHECKLIST.md](UNIVERSITY_DEPLOYMENT_CHECKLIST.md),
especially managed TLS/DNS, WAF limits, monitoring, backups, key restrictions,
App Check, signed OTA, Secure Boot/flash encryption, and privacy approval.

## Files reviewed without architectural changes

- Backend entrypoint, all route handlers, Firebase Admin setup, geometry
  helpers, worker lease, lifecycle engine/reducer, retention and privacy
  workers, provisioning/claims utilities, tests, Dockerfile, and environment
  templates.
- Frontend routes, role guard/auth state, Firebase modules, RTDB resume/store,
  Firestore hooks, passenger/driver/admin flows, map rendering, polyline
  snapping/distance caches, ETA logic, feedback/chat flows, metadata, manifest,
  styles, assets, and build configuration.
- Firebase/Firestore/RTDB rules and hosting headers, CI workflows, root build
  scripts, package manifests/lockfile, firmware configuration/secrets template,
  and all maintained project documentation.
