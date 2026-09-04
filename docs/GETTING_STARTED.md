# Eki getting started and operating guide

This is the plain-language entry point for the Eki campus bus-tracking system.
It explains what the system does, who uses it, how to run it locally, and
where to find the detailed technical contracts. It intentionally uses
placeholders for project IDs, domains, credentials, and infrastructure names.

## What Eki does

Eki tracks university buses from an ESP32 and GNSS receiver to a browser-based
passenger and administrator experience:

1. The ESP32 reads a GNSS fix and sends a small, authenticated HTTPS request.
2. The backend validates the device credential, timestamp, coordinates and
   movement state. Bus and route assignment always come from the protected
   device registry, never from the device payload.
3. The backend publishes the latest live position to Firebase Realtime Database
   (RTDB), while Firestore stores configuration, recovery state, messages,
   feedback, and history.
4. Browsers receive live changes through Firebase listeners. REST requests are
   used for commands and other deliberate mutations; the live map is not
   implemented as repeated API polling.
5. An exclusive Firestore bus lock and durable ride record keep one physical bus
   from running two sessions and allow a session to recover after interruptions.

The end-to-end architecture is documented in [High-level design](design/HIGH_LEVEL_DESIGN.md).

## Who uses the system

| Role | What the role can do | How access is granted |
|---|---|---|
| Passenger | View configured routes and live buses, join an active ride with the driver-issued boarding code, select boarding/alighting stops, message ride members, submit feedback, and request personal-data deletion | Firebase Authentication account with a passenger role |
| Driver/operator | Operate the assigned bus and route, arm/resume a ride, issue a boarding code, adjust delay, and message passengers | Admin-managed driver record, assigned bus, trusted role claims, and current session ownership |
| Administrator | Manage routes, buses, drivers, devices, settings, requests, feedback, ride history, analytics, and reconciliation | Firebase Authentication account with an administrator role and backend admin claim |
| Deployment/firmware operator | Provision devices, create protected firmware artifacts, perform physical acceptance tests, and rotate device credentials | Controlled operational process; this is not a browser role |

Presentation guards improve the user experience but are not authorization
boundaries. Firestore/RTDB rules and backend middleware enforce access.

## Read the documentation in this order

1. [Architecture and lifecycle summary](design/ARCHITECTURE.md)
2. [This guide](GETTING_STARTED.md)
3. [Environment and configuration reference](CONFIGURATION.md)
4. [Low-level design and module catalog](design/LOW_LEVEL_DESIGN.md)
5. [Firebase data model](data/FIREBASE_DATA_MODEL.md)
6. [Backend API reference](../backend/API.md)
7. [Hardware telemetry](hardware/HARDWARE_TELEMETRY.md)
8. [Test strategy](testing/TEST_STRATEGY.md)
9. [Deployment and operations documents](operations/UNIVERSITY_DEPLOYMENT_CHECKLIST.md)

The [documentation index](index/README.md) lists every maintained document,
including the demo, security, DNS, hardware-provisioning, and contribution
guides.

## Local development

### Prerequisites

- Node.js 20 or newer and npm 10 or newer.
- Java when running Firebase emulator rule tests.
- PlatformIO for firmware compilation and hardware tests.
- A Firebase project and backend Firebase Admin credentials for live backend
  development.
- Google Maps browser and server credentials if route geometry or maps are used.

### Install and configure

Run these commands from the repository root:

```powershell
npm install
Copy-Item backend/.env.example backend/.env
Copy-Item frontend/env.production.example frontend/.env.local
```

Fill the two ignored environment files using [CONFIGURATION.md](CONFIGURATION.md).
Use separate development Firebase data from production. Do not copy service
account JSON, device secrets, signing keys, or App Check debug tokens into the
repository.

### Start the application

```powershell
npm run dev
```

The development frontend is normally available at `http://localhost:3000` and
the backend at `http://localhost:4000`. The backend health endpoint is
`http://localhost:4000/health`; a `503` can be expected when placeholder or
unreachable Firebase dependencies are used.

For frontend-only or backend-only work:

```powershell
npm run dev --workspace=frontend
npm run dev --workspace=backend
```

### Create initial development data

The usual order is:

1. Configure Firebase Authentication, Firestore, RTDB, App Check and Maps for
   the development project.
2. Seed the predefined routes when route geometry is needed:

   ```powershell
   npm run seed --workspace=backend
   ```

   This calls the server-side Google Routes integration and therefore requires
   `GOOGLE_MAPS_API_KEY`.
3. Create or bootstrap user profiles, then assign roles and driver records from
   the backend/admin process. Run `npm run sync-role-claims --workspace=backend`
   after changing role or driver assignments so Firebase Auth claims and the
   RTDB assignment mirror are refreshed.
4. Create bus records and assign routes to them.
5. Provision a device only after its bus and route exist:

   ```powershell
   npm run provision-device --workspace=backend -- `
     --device-id device_01 --bus-id bus_01 --route-id route_01
   ```

   The command prints a randomly generated secret once and stores only a
   salted verifier. Transfer it only through the controlled firmware-signing
   process described in [hardware security provisioning](operations/HARDWARE_SECURITY_PROVISIONING.md).

The provisioning command is intentionally not a browser endpoint. It prevents
duplicate device assignment and unsafe changes during an active ride.

For the person physically preparing a tracker, follow the complete [ESP32 +
NEO-M8N hardware setup guide](../hardware/README.md). It lists every required
backend/frontend template, all six firmware definitions, wiring, certificate
requirements, secure signing prerequisites, route-versus-firmware changes, and
the checks to perform after flashing.

## The ride lifecycle

The durable state machine is:

`armed / pre_departure → active / in_service → completed`

- A driver can arm only an assigned bus/route with a fresh device fix.
- If the bus is already at the route origin, the session can enter service
  immediately; otherwise it waits for the first configured stop.
- Only the next ordered stop advances progress. Visiting a later stop cannot
  skip the expected stop.
- Network loss, GNSS loss, browser refresh, device power loss, and backend
  restart do not by themselves complete or delete a durable ride.
- The final ordered stop completes the ride and releases its bus lock. Manual
  stop is not a substitute for reaching the final stop.

See [the data model](data/FIREBASE_DATA_MODEL.md) for the records and
[the API reference](../backend/API.md) for command contracts.

## Common workflows

### Passenger

1. Sign in through the frontend.
2. Select a route and plan a trip between stops.
3. When a driver provides a boarding code for an active session, join with the
   boarding and destination stations. The destination is stored in the ride
   manifest for administrators.
4. Follow the live bus position and session status. The browser may show a
   reconnecting or stale state when live data is unavailable; it must not invent
   an authoritative position.
5. Use in-session messaging only for operational communication. Messages are
   scoped to the session and rate-limited.
6. Submit ride feedback after an eligible completed ride, or request deletion
   from the account/privacy flow.

### Driver/operator

1. Confirm the assigned bus, route, device and current GNSS/network status.
2. Arm or resume the assigned session from the Operations workspace.
3. Issue the boarding code to passengers through the approved channel.
4. Adjust delay when required; the backend validates session ownership and
   preserves the value durably.
5. Drive the route in configured stop order. The first stop activates service
   and the final stop completes it.
6. Report device, power, GNSS, Wi-Fi or backend faults using the diagnostics and
   operational runbooks. Do not operate the web app while driving.

### Administrator

1. Configure routes, waypoints and stops before assigning them to buses.
2. Maintain bus and driver records and reconcile claims/mirrors after bulk
   changes.
3. Provision, inspect, disable or reassign devices only when no conflicting
   active ride or bus lock exists.
4. Monitor `/health`, telemetry rejection counts, latency percentiles, worker
   lease health, Firebase usage and Maps usage.
5. Review feedback and requests, and delete ride history only according to the
   approved retention/privacy process.

## Verification commands

| Command | Purpose |
|---|---|
| `npm run lint` | Lint frontend and backend |
| `npm test` | Run script, backend, frontend and documentation tests |
| `npm run test:rules` | Run Firebase rules emulator integration tests; requires Java |
| `npm run build` | Build backend/frontend, generate the service worker, and regenerate CSP hashes |
| `npm run build:production` | Run the strict production environment gate and build |
| `npm run verify` | Run lint, all tests, build and the production dependency audit |
| `platformio test --project-dir hardware -e native` | Run host-side firmware policy tests |
| `platformio run --project-dir hardware -e esp32dev` | Build development firmware |
| `platformio run --project-dir hardware -e esp32dev-secure` | Build a signed fleet artifact in the controlled signing environment |

`npm run deploy` deploys the static Firebase Hosting output and Firebase rules.
The backend container/runtime, DNS, TLS, WAF, secrets, monitoring and
replication are separate deployment responsibilities; use the university
deployment checklist rather than treating a successful Hosting deploy as a
complete production rollout.

## Troubleshooting guide

| Symptom | First checks | Reference |
|---|---|---|
| Backend will not start in production | `CORS_ORIGIN`, `FIREBASE_DATABASE_URL`, credentials, Maps configuration, and replica shard factor | [Backend README](backend/README.md), [configuration](CONFIGURATION.md) |
| `/health` returns 503 | Firebase Admin credentials, Firestore/RTDB reachability, and the cached probe timestamp | [API health](../backend/API.md#health) |
| Browser shows no live bus | Auth/App Check, RTDB URL, rules, device health, and whether the fix is fresh | [Hardware telemetry](hardware/HARDWARE_TELEMETRY.md) |
| Device receives 400 | Validate the deployed schema (nine-field current; eight-field sequenced and six-field legacy compatibility), JSON size, ranges, sequence, and capture/send timestamps | [API device endpoints](../backend/API.md#device-endpoints) |
| Device receives 401 | Device ID, registry status, secret, assignment and certificate/clock; correct by re-provisioning and reflashing | [Security provisioning](operations/HARDWARE_SECURITY_PROVISIONING.md) |
| Device receives 413 | Telemetry body exceeds the 512-byte limit or diagnostics exceed 1 KiB | [API device endpoints](../backend/API.md#device-endpoints) |
| Device receives 429/503 | Backoff, per-device/IP/WAF limits, backend health and Firebase availability | [API limits](../backend/API.md#authentication) |
| Ride does not advance | Fix freshness, route/stop order, next-stop geometry, and session ownership | [Lifecycle design](design/HIGH_LEVEL_DESIGN.md) |
| Rules test fails locally | Java, Firebase emulator CLI, and the generated temporary rules path | [Test strategy](testing/TEST_STRATEGY.md) |

## Public-safe documentation boundary

These documents describe architecture, interfaces, procedures, limits and
failure behavior. They must not contain:

- service-account JSON, private signing keys, device secrets, Wi-Fi passwords,
  App Check debug tokens, bearer tokens, or unredacted production logs;
- private hostnames, internal IP addresses, tunnel credentials, or secret
  manager contents;
- personal passenger/driver records or real location history;
- unreviewed incident details that could help bypass authentication or physical
  security.

Browser Firebase and Maps configuration values are public identifiers, but they
still require hostname/API restrictions. Keep them in environment-specific
configuration and do not confuse “public” with “unrestricted.”

## Further references

- [Backend API reference](../backend/API.md)
- [Firebase data model](data/FIREBASE_DATA_MODEL.md)
- [Storage architecture](data/STORAGE_ARCHITECTURE.md)
- [Security policy](../SECURITY.md)
- [Production readiness audit](operations/PRODUCTION_READINESS_AUDIT.md)
- [Live demo runbook](operations/LIVE_DEMO_RUNBOOK.md)
- [University deployment checklist](operations/UNIVERSITY_DEPLOYMENT_CHECKLIST.md)
