# Backend API reference

Base path is the deployed backend origin. JSON request bodies are strict and limited to 16 KiB except device telemetry (512 bytes) and diagnostics (1 KiB). `TRACE` and `CONNECT` return 405. Responses are JSON; errors use `{ "error": "…" }` and do not expose stacks/secrets.

## Quick start

Use the backend origin without an `/api` suffix. The only public endpoint is
the cached health probe:

```bash
curl -i https://api.example.edu/health
```

Browser endpoints use a Firebase ID token. The frontend obtains that token
after sign-in and sends it as a bearer token:

```bash
TOKEN="<firebase-id-token>"
curl -H "Authorization: Bearer $TOKEN" \
  https://api.example.edu/api/buses
```

Hardware uses its per-device credential and the exact six-field telemetry
contract:

```bash
DEVICE_KEY="<device-secret>"
TIMESTAMP=$(date +%s%3N)
curl -i -X POST \
  -H "Authorization: Device $DEVICE_KEY" \
  -H "Content-Type: application/json" \
  --data "{\"lat\":23.034,\"lng\":72.55,\"speed\":18.2,\"heading\":94,\"motionState\":\"moving\",\"timestamp\":$TIMESTAMP}" \
  https://api.example.edu/api/devices/device_01/telemetry
```

Populate shell variables securely through a secret manager or protected prompt
before use. Never put a real bearer token or device secret in shell history,
documentation, tickets or logs. A successful new telemetry sample returns
`202`; an equal or older duplicate returns `200`.

## Endpoint map

| Area | Endpoints | Authentication |
|---|---|---|
| Health | `GET /health`; `GET /api/health` | Public readiness; admin diagnostics |
| Live buses | `GET /api/buses`, `GET /api/buses/:busId` | Authenticated |
| Device ingestion | `POST /api/devices/:deviceId/telemetry`, `POST /api/devices/:deviceId/diagnostics` | Device credential |
| Device administration | `GET/PUT /api/devices/:deviceId/diagnostics`, `PUT /api/devices/:deviceId`, `POST /api/devices/:deviceId/disable` | Admin |
| Ride operations | `POST /api/shifts/start`, `PATCH /api/shifts/delay`, `POST /api/shifts/stop` | Assigned operator or admin |
| Boarding and chat | Session boarding-code, join and messages endpoints | Session member/operator/admin as applicable |
| Passenger/account | Feedback, bootstrap, privacy deletion, requests | Authenticated/admin as noted below |
| Fleet and settings | Fleet, analytics, route, settings and places endpoints | Admin unless noted below |
| Route planning | `POST /api/plan`, `GET /api/routes-list` | Authenticated |

The sections below are the contract source of truth for each request body,
response, status code and side effect.

## Authentication

- Browser: `Authorization: Bearer <Firebase ID token>`. `requireAuth` verifies revocation and trusted custom claims. Admin endpoints additionally require role/admin claim; operational endpoints recheck assigned `drivers` and `buses` records even when invoked from the admin workspace.
- Hardware: `Authorization: Device <per-device secret>`. It is not a Firebase token and must never use `Bearer`.
- Public: only `GET /health`.

IDs accept 1–128 ASCII letters, digits, `_`, or `-`. Rate-limit counters always use normalized IP addresses (and verified Firebase UID when authenticated). Browser writes are broadly limited to 30 requests/minute and normal traffic to 200 requests/minute; route compute/plan endpoints use dedicated limiters (10/min and 30/min), `placeSearchLimiter` is an unsharded process-local 20/minute limiter, and device telemetry bypasses global and write limiters while enforcing separate pre-auth IP (120/min) and per-device limits. Sharded counters divide their budgets by `RATE_LIMIT_SHARD_FACTOR` (set it to the deployed replica count; invalid values fall back to 1). If the replica count exceeds the smallest in-process budget (currently 10/minute), startup fails; use a shared distributed limiter beyond that scale. An edge load balancer or WAF cap is an external deployment requirement for global rate protection.

## Health

### `GET /health` — public

Returns only `{ "status": "ok" }` when the cached 30-second Firestore/RTDB probe is ready, otherwise 503 with `{ "status": "degraded" }`. It does not read Firebase for every request or expose dependency and telemetry details.

### `GET /api/health` — admin

Returns the cached Firestore/RTDB status, telemetry counters and latency summaries, background-failure state, and probe timestamp. This is the detailed operational response formerly exposed by `/health`; it requires an admin Firebase ID token.

```json
{
  "status": "ok",
  "firestore": "connected",
  "rtdb": "connected",
  "telemetry": {
    "transport": "https",
    "accepted": 10,
    "rejected": 2,
    "lastAcceptedAt": "2026-08-08T00:00:00.000Z",
    "lastRejectedAt": null,
    "credentialCacheHitRate": 0.8,
    "processingLatencyMs": { "samples": 10, "average": 42.1, "p50": 35, "p95": 80, "p99": 80 },
    "deviceToServerLatencyMs": { "samples": 10, "average": 900, "p50": 850, "p95": 1300, "p99": 1300 },
    "rtdbWriteLatencyMs": { "samples": 10, "average": 30, "p50": 28, "p95": 55, "p99": 55 }
  },
  "backgroundTasks": {
    "totalFailures": 0,
    "sustainedSources": [],
    "sources": {
      "tripState.backgroundTask": {
        "label": "Trip-state background task",
        "totalFailures": 3,
        "windowFailures": 3,
        "sustained": false,
        "lastFailureAt": "2026-08-08T00:00:00.000Z",
        "lastMessage": "[TripState] Failed to activate session abc:"
      }
    }
  },
  "checkedAt": "2026-08-08T00:00:00.000Z"
}
```

Metrics are a 512-sample in-memory rolling window and reset on restart.

`backgroundTasks` counts failures from fire-and-forget background writes
(`trackBackgroundTask` and `scheduleDurableRideRestore`). A source
whose failures inside the 5-minute sliding window reach the threshold (5) is
flagged `sustained: true` and listed in `sustainedSources`; the backend also
emits an error-level `[BackgroundFailures] SUSTAINED failure alert` log once
per episode so log-based alerting can page. The readiness bit deliberately
ignores these counters — one flapping background write must not take the whole
probe down.

## Device endpoints

### `POST /api/devices/:deviceId/telemetry` — device

Body must contain exactly:

```jsonc
{"lat":23.034,"lng":72.55,"speed":18.2,"heading":94,"motionState":"moving","timestamp":<current Unix epoch in milliseconds>}
```

Generate `timestamp` immediately before sending (for example, with `Date.now()`). Ranges: latitude -90..90, longitude -180..180, speed 0..200 km/h, heading 0..360, `motionState` is `moving|stopped|uncertain`; timestamp must satisfy server freshness/future bounds. Bus/route comes from `devices`, never the body.

- 202 `{accepted:true,duplicate:false}`: new RTDB fix.
- 200 `{accepted:true,duplicate:true}`: equal/older timestamp safely ignored.
- 400 invalid ID/payload; 401 bad/missing/disabled credential or registry; 413 raw body too large; 429 limiter with `Retry-After` and `retryAfterMs`; 503 Firebase/ingestion failure.
- Response has `Cache-Control: no-store`.

### `POST /api/devices/:deviceId/diagnostics` — device

Accepts the closed 1 KiB firmware-health object: firmware version, uptime, free heap, RSSI, queue depth/high-water/drop counters, accepted/rejected fixes, NMEA/UART errors, reset total, fault code, flash-encryption and Secure-Boot booleans, and device timestamp. Device ID, bus, and route come from the authenticated server registry; credentials and network names are never accepted in the body. The latest report overwrites `_device_diagnostics/{deviceId}` through the Admin SDK. Returns 202, 400, 401, 429, or 503 with `Cache-Control: no-store`.

### `GET /api/devices/:deviceId/diagnostics` — admin

Returns the latest authenticated device report plus registry assignment and server `receivedAt`, or 404 when no report exists. Firebase clients cannot read `_device_diagnostics` directly.

### `PUT /api/devices/:deviceId` — admin

Body: `{ "busId":"bus_01", "routeId":"route_01", "enabled":true }`. Bus/route must exist and be assigned; a bus/route can have only one device; active ride/lock prevents unsafe reassignment. Does not rotate `secretHash`. Returns `{saved:true}`, 400, 409 or 500.

### `POST /api/devices/:deviceId/disable` — admin

Sets `enabled:false`/`disabledAt`, invalidates credential/rate cache. Returns `{disabled:true}` or 400/500.

Device creation/secret rotation is deliberately local: `npm run provision-device --workspace=backend -- --device-id … --bus-id … --route-id …`. Transfer the one-time plaintext only into the ignored `hardware/include/secrets.h` inside the controlled signing environment, build the device-specific protected artifact, and reflash the tracker. Never commit the plaintext or retain an unencrypted firmware image.

## Live bus endpoints

### `GET /api/buses` — authenticated

Returns `{ "buses": [...] }` from the current RTDB `activeBuses` projection. Prefer the client RTDB `onValue` listener for continuous live UI; this endpoint is a snapshot, not a polling recommendation.

### `GET /api/buses/:busId` — authenticated

Searches live entries for the stored `busId` and returns the snapshot or 404. Invalid ID returns 400.

## Shift endpoints

### `POST /api/shifts/start` — assigned operator or admin

Body: `{ "busId":"bus_01", "routeId":"route_01", "driverId":"driver_01" }`. `driverId` is required for admin requests and comes from trusted claims for legacy assigned-operator requests.

Requires agreement among Auth claim, `drivers`, `buses`, route assignment and a fresh ≤60-second stopped hardware fix near exactly one route endpoint. The backend infers `forward` at endpoint A or `reverse` at endpoint Z; the client cannot choose or override direction. A Firestore bus lock prevents another route session. If already owned by the same driver/session, repairs durable records and returns 200 `{sessionId,resumed:true,direction}`. New ride returns 201 `{sessionId,resumed:false,direction}`. Returns 403 assignment mismatch, 409 active/lock/stale/moving/ambiguous-position conflict, 422 invalid route endpoints or 500.

At the inferred origin, the session starts `active/in_service` and records stop 0. An active session always restores its immutable stored direction after hardware/backend interruption. After final-stop completion, a fresh stopped fix at that destination for `AUTOMATIC_TURNAROUND_DWELL_MS` causes the backend to atomically arm a new session in the opposite direction; stale, moving, mid-route or contested state never auto-arms.

### `PATCH /api/shifts/delay` — assigned operator or admin

Body: `{ "busId":"…", "routeId":"…", "driverId":"…", "delayMinutes":0 }`, allowed 0–1440. `driverId` is required for admin requests. Session ownership/status is checked in RTDB. Writes RTDB and durable active ride. Returns `{saved:true,delayMinutes}`, 400/409/500.

### `POST /api/shifts/stop` — assigned operator or admin

Body: `{ "busId":"…", "routeId":"…", "sessionId":"…" }`. Active rides cannot be manually stopped: 409 explains final-stop automatic completion. An already completed session returns `{stopped:true,alreadyCompleted:true}`. Invalid ownership/resource returns 403/404.

### `DELETE /api/shifts/:sessionId/messages` — admin

Deletes messages in batches from the session subcollection. Returns `{deleted:number}` or 400/500.

### `DELETE /api/shifts/:sessionId/history` — admin

Only `completed|interrupted|failed` sessions. Recursively deletes session/subcollections and same-ID/query-matching completed projections. Returns `{deleted:true,...counts}`. Active/pending/armed is 409; invalid ID 400; absence/errors follow deletion service response.

## Session boarding endpoints

### `POST /api/sessions/:sessionId/boarding-code` — assigned operator or admin

An admin may request the code for any active session; a legacy assigned-operator token must match the session driver ID and assigned bus. Idempotently creates or returns an eight-character, 40-bit boarding code stored only in the operator-readable session record; the code is never projected into passenger-readable RTDB. Responses use `Cache-Control: no-store`.

### `POST /api/sessions/:sessionId/join` — passenger

Body: `{ "boardingCode":"ABCD2345", "lat":23.0, "lng":72.5, "accuracy":25, "boardingStopId":"stop_1", "alightingStopId":"stop_3" }`; `alightingStopId` may be `null`. Coordinates are required on first boarding and may be omitted only when the same authenticated UID updates an existing manifest entry.

Requires a valid Firebase bearer token, the driver-issued session code, route-owned stops in forward order, browser accuracy no worse than 100 m, and—on first boarding—a passenger coordinate within 150 m of a fresh nonfuture hardware GNSS projection bound to the exact session/bus/route. Browser location is defense in depth rather than trusted proof; possession of the non-public session code is the server-verifiable authorization. An existing passenger may correct stops without a second location prompt. A Firestore transaction rechecks session state, code, and existing membership when proximity is omitted before adding or updating only the authenticated UID's manifest entry. Display name and timestamps are server-derived. Returns `{joined:true,sessionId}` or 400/403/404/409/422/500.

### `POST /api/sessions/:sessionId/messages` — session member/operator

Body: `{ "text":"Bus arriving", "requestId":"browser-generated-uuid" }`. The authenticated UID must be a manifest passenger, the assigned driver on the assigned bus, or an admin, and the session must still be `armed|active`. Sender role/name are server-derived. One transaction rechecks membership/state, applies the three-second and 60-per-hour limits, and writes both message and rate state. `requestId` makes retries idempotent: first success is 201, an identical retry is 200, and reuse with changed content is 409. Throttling is 429 with `Retry-After` and `retryAfterMs`.

## Feedback, profile, and settings endpoints

### `POST /api/feedback` — authenticated

Body: `{ "type":"general|ride", "requestId":"browser-generated-uuid", "comment":"...", "rating":5, "sessionId":"...", "busId":"...", "driverId":"..." }`. Ride identifiers are required only for ride feedback. The backend derives the author name, validates comment/rating limits and completed-ride membership, and reads the per-user 24-hour cooldown in the same transaction that writes feedback/cooldown state. Identical retries are idempotent; request-ID payload conflicts are 409; cooldown is 429.

### `PATCH /api/feedback/:feedbackId/status` — admin

Body: `{ "status":"new|reviewed|resolved" }`. Updates only review state plus server audit metadata. Missing feedback is 404.

### `POST /api/users/bootstrap` — authenticated

Creates a missing `users/{uid}` passenger profile transactionally from verified ID-token claims; request-body identity fields are ignored and existing profiles/roles are never overwritten. Returns 201 when created or 200 when already present, with `Cache-Control: no-store`.

### `PUT /api/settings` — admin

Accepts a non-empty partial object containing only `serviceStartTime`, `noBusesMessage`, `noBusesSubMessage`, `announcementText`, and/or boolean `announcementActive`. Values are bounded and stored with server audit metadata.

## Fleet/admin endpoints
All `/api/fleet/*` handlers are behind `requireAdmin` plus an idempotency/fingerprint guard for mutations.

### `POST /api/fleet/reconcile`

Rebuilds driver Auth claims and RTDB assignment mirrors from Firestore. Returns summary; partial per-record failures can produce 207.

### `PUT /api/fleet/buses/:id`

Body: `{ "name":"Campus Bus 1", "assignedRoutes":["route_01"] }`. Routes must exist; cannot remove a route used by an active ride or bound device. Updates driver authorization after save. Returns `{saved:true}`, 400/409/500.

### `DELETE /api/fleet/buses/:id`

Blocked by active ride/bus lock or bound device. Deletes bus and `bus_locations`, unassigns drivers/claims/mirrors and removes matching inactive RTDB nodes. Returns `{deleted:true}` or 400/409/500.

### `PUT /api/fleet/drivers/:id`

Body: `{ "name":"…", "authUid":"…", "assignedBusId":"…" }` (`assignedBusId` may be null). UID must exist and be unique. Active ride prevents identity/bus reassignment. Updates Firestore profile, Auth claims/token revocation as needed and RTDB mirror. Returns `{saved:true}`, 400/409/500.

### `DELETE /api/fleet/drivers/:id`

Blocked by active ride. Deletes driver/mirror, demotes Auth account to passenger and revokes tokens. Returns `{deleted:true}` or 400/404/409/500.

### `GET /api/analytics/fleet` — admin

Returns `{totalBuses,activeBuses,idleBuses,signalLostBuses,ongoingTrips,passengerCount:null}` from up to 1,000 `bus_locations`. Passenger count is explicitly unavailable rather than fabricated.

## Route endpoints

### `POST /api/routes/compute-polyline` — admin

Validates route control points, calls server-key Google Routes API and returns road-snapped encoded geometry/distance/duration. Dedicated 10/minute limit. Upstream timeout/config/errors map to safe error responses.

### `PUT /api/routes/:routeId` — admin

Validates and saves route name/color/type, ordered waypoints/stops and computed geometry. Existing active route use restricts unsafe changes. Returns saved route/result or 400/409/500.

### `DELETE /api/routes/:routeId` — admin

Blocked by active rides and bus assignments. Deletes route when safe; invalid/absent/conflict/error returns 400/404/409/500.

### `POST /api/plan` — authenticated

Body: `{ "routeId":"…", "startStopId":"…", "endStopId":"…", "viaStopId":"…" }` (`viaStopId` optional). Uses cached Firestore route and pure stored-polyline slicing; makes no Google API request. Works in either direction, orders stops by travel direction, and requires via to lie between endpoints. Returns route metadata, stop objects, ordered `stopsOnSegment`, encoded `polyline`, and `totalStops`; 400/404/422/500 on invalid input/data.

### `GET /api/routes-list` — authenticated

Returns bounded cached route metadata/configuration used by clients. Firestore errors return 500.

### `GET /api/places/search?q=…` — admin

Bounded query string search proxied to Google Places with server key, timeout and dedicated limit. Returns normalized candidates or 400/429/502/503 depending on input/upstream/configuration.

## Passenger/privacy endpoints

### `PATCH /api/requests/:uid` — admin

Body status is one of `pending|accepted|completed|cancelled`; updates existing request. Returns merged request or 400/404/500.

### `DELETE /api/requests/:uid` — admin

Deletes existing request. Returns `{message:"Deleted successfully"}` or 400/404/500.

Passenger requests are backend-authoritative: clients have no Firestore write
surface (issues #72 + #73); the admin route above is the only lifecycle path.

### `POST /api/privacy/deletion-request` — passenger

Queues `_privacy_deletion_requests/{uid}` and returns 202 `{accepted:true}`. Driver/admin accounts receive 409 and must be offboarded by IT; failures return 500.

## Consistency/retry guidance

- Telemetry and start/resume are idempotent by timestamps/session ownership.
- Do not blindly retry a 400/401/403/409. Fix configuration/user action first.
- 429 respects limiter headers/backoff. 500/503 may be retried with bounded exponential jitter.
- Clients should wait for RTDB/Firestore push confirmation where UI truth depends on database state.
- Never cache bearer/device responses or log authorization headers.
