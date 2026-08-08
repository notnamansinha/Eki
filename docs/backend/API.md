# Backend API reference

Base path is the deployed backend origin. JSON request bodies are strict and limited to 16 KiB except device telemetry (512 bytes). `TRACE` and `CONNECT` return 405. Responses are JSON; errors use `{ "error": "…" }` and do not expose stacks/secrets.

## Authentication

- Browser: `Authorization: Bearer <Firebase ID token>`. `requireAuth` verifies revocation and trusted custom claims. Admin endpoints additionally require role/admin claim; driver endpoints recheck `drivers` and `buses` records.
- Hardware: `Authorization: Device <per-device secret>`. It is not a Firebase token and must never use `Bearer`.
- Public: only `GET /health`.

IDs accept 1–128 ASCII letters, digits, `_`, or `-`. Browser writes are broadly limited to 30/minute/IP, normal traffic 200/minute/IP; route compute/plan/place/device telemetry also have dedicated limits. Production needs global edge limits because these counters are process-local.

## Health

### `GET /health` — public

Returns 200 when the cached 30-second Firestore/RTDB probe is ready, otherwise 503. It does not read Firebase for every request.

```json
{
  "status": "ok",
  "firebase": "connected",
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
  "checkedAt": "2026-08-08T00:00:00.000Z"
}
```

Metrics are a 512-sample in-memory rolling window and reset on restart.

## Device endpoints

### `POST /api/devices/:deviceId/telemetry` — device

Body must contain exactly:

```json
{"lat":23.034,"lng":72.55,"speed":18.2,"heading":94,"motionState":"moving","timestamp":1800000000000}
```

Ranges: latitude -90..90, longitude -180..180, speed 0..200 km/h, heading 0..360, `motionState` is `moving|stopped|uncertain`; timestamp must satisfy server freshness/future bounds. Bus/route comes from `devices`, never the body.

- 202 `{accepted:true,duplicate:false}`: new RTDB fix.
- 200 `{accepted:true,duplicate:true}`: equal/older timestamp safely ignored.
- 400 invalid ID/payload; 401 bad/missing/disabled credential or registry; 413 raw body too large; 429 limiter; 503 Firebase/ingestion failure.
- Response has `Cache-Control: no-store`.

### `PUT /api/devices/:deviceId` — admin

Body: `{ "busId":"bus_01", "routeId":"route_01", "enabled":true }`. Bus/route must exist and be assigned; a bus/route can have only one device; active ride/lock prevents unsafe reassignment. Does not rotate `secretHash`. Returns `{saved:true}`, 400, 409 or 500.

### `POST /api/devices/:deviceId/disable` — admin

Sets `enabled:false`/`disabledAt`, invalidates credential/rate cache. Returns `{disabled:true}` or 400/500.

Device creation/secret rotation is deliberately local: `npm run provision-device --workspace=backend -- --device-id … --bus-id … --route-id …`.

## Live bus endpoints

### `GET /api/buses` — authenticated

Returns current RTDB `activeBuses` value or `{}`. Prefer the client RTDB `onValue` listener for continuous live UI; this endpoint is a snapshot, not a polling recommendation.

### `GET /api/buses/:busId` — authenticated

Searches live entries for the stored `busId` and returns the snapshot or 404. Invalid ID returns 400.

## Shift endpoints

### `POST /api/shifts/start` — assigned driver

Body: `{ "busId":"bus_01", "routeId":"route_01" }`.

Requires agreement among Auth claim, `drivers`, `buses`, route assignment and a fresh ≤60-second nonfuture hardware fix. A Firestore bus lock prevents another route session. If already owned by the same driver/session, repairs durable records and returns 200 `{sessionId,resumed:true}`. New ride returns 201 `{sessionId,resumed:false}`. Returns 403 assignment mismatch, 409 active/lock/fix conflict, 422 invalid route origin or 500.

If the bus is already at origin, the session starts `active/in_service` and records stop 0; otherwise it is `armed/pre_departure` until GNSS reaches origin.

### `PATCH /api/shifts/delay` — assigned driver

Body: `{ "busId":"…", "routeId":"…", "delayMinutes":0 }`, allowed 0–1440. Session ownership/status is checked in RTDB. Writes RTDB and durable active ride. Returns `{saved:true,delayMinutes}`, 400/409/500.

### `POST /api/shifts/stop` — assigned driver

Body: `{ "busId":"…", "routeId":"…", "sessionId":"…" }`. Active rides cannot be manually stopped: 409 explains final-stop automatic completion. An already completed session returns `{stopped:true,alreadyCompleted:true}`. Invalid ownership/resource returns 403/404.

### `DELETE /api/shifts/:sessionId/messages` — admin

Deletes messages in batches from the session subcollection. Returns `{deleted:number}` or 400/500.

### `DELETE /api/shifts/:sessionId/history` — admin

Only `completed|interrupted|failed` sessions. Recursively deletes session/subcollections and same-ID/query-matching completed projections. Returns `{deleted:true,...counts}`. Active/pending/armed is 409; invalid ID 400; absence/errors follow deletion service response.

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

Passengers normally create the tightly constrained request directly through Firestore rules; assigned drivers have constrained rule-based status transitions.

### `POST /api/privacy/deletion-request` — passenger

Queues `_privacy_deletion_requests/{uid}` and returns 202 `{accepted:true}`. Driver/admin accounts receive 409 and must be offboarded by IT; failures return 500.

## Consistency/retry guidance

- Telemetry and start/resume are idempotent by timestamps/session ownership.
- Do not blindly retry a 400/401/403/409. Fix configuration/user action first.
- 429 respects limiter headers/backoff. 500/503 may be retried with bounded exponential jitter.
- Clients should wait for RTDB/Firestore push confirmation where UI truth depends on database state.
- Never cache bearer/device responses or log authorization headers.
