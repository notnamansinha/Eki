# Architecture and lifecycle summary

The authoritative design is split into [High-level design](HIGH_LEVEL_DESIGN.md), [Low-level design](LOW_LEVEL_DESIGN.md), [Firebase data model](../data/FIREBASE_DATA_MODEL.md), and [Hardware telemetry](../hardware/HARDWARE_TELEMETRY.md). This page is the short operational reference.

```mermaid
flowchart LR
  GNSS["NEO-M8N"] --> ESP["ESP32"]
  ESP -->|"HTTPS + Device secret"| API["Express"]
  API -->|"validate/deduplicate"| RTDB["RTDB activeBuses"]
  RTDB --> WORKER["Firestore-lease worker"]
  WORKER -->|"ordered lifecycle"| RTDB
  API & WORKER --> FS["Firestore durable state"]
  RTDB -->|"onValue push"| WEB["Passenger / driver / admin"]
  FS -->|"onSnapshot / queries"| WEB
```

Hardware pushes; the backend never polls devices. Browsers do not repeatedly poll the live API: Firebase listeners push live changes and REST commands use `fetch`. `fetch` is not an alternative to polling—it is an HTTP API that could be used to implement polling.

Ride state is `pre_departure → in_service → completed`. The driver may arm only their assigned bus/route with a fresh fix. `_active_bus_locks/{busId}` makes the physical bus exclusive across routes. Stop 1 activates service, only the next ordered stop advances, and the final stop completes. GNSS/network loss changes signal/device state, never ride truth.

RTDB `activeBuses/{busId}_{routeId}` is the current projection. Firestore `active_rides/{busId}_{routeId}` is minimal recovery; `ride_sessions` and `completed_trips` are history. Completion and abandoned cleanup compare session IDs before deleting recovery/lock or changing RTDB, so delayed old work cannot damage a new session.

Security boundaries: device assignment comes from protected Firestore; device secrets are independent salted scrypt verifiers; browser API calls use Firebase bearer tokens and server role/assignment checks; Firebase is default deny and live writes/internal collections are server-only. Authenticated/unknown network responses are not service-worker cached.

Performance: one shared RTDB listener per browser, a three-second changed-fix floor, 30/60-second heartbeats, seven-second HTTPS timeout, jittered backoff, Firestore only on lifecycle changes, and local polyline ETA math. `/health` reports rolling latency percentiles. Physical-route latency and GNSS reliability still require the acceptance runbook.
