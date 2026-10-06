# Backend API reference

Last updated: 2026-10-06 00:18 IST (UTC+05:30).

The machine-readable contract is `backend/openapi.json` (OpenAPI 3.1.1).
See [HTTP contract checks and rollout](../docs/api/HTTP_CONTRACT.md) for schema
validation, policy extensions, Firebase listener channels, and compatibility.
Run `npm run verify:openapi` from the repository root.

Base path is the deployed backend origin. JSON request bodies are strict and limited to 16 KiB except device telemetry (512 bytes) and diagnostics (1 KiB). `TRACE` and `CONNECT` return 405. Responses are JSON; errors use `{ "error": "…" }` and do not expose stacks/secrets.

## Quick start

Use the backend origin without an `/api` suffix. Public probes separate
dependency readiness from process liveness:

```bash
curl -i https://api.example.edu/health
curl -i https://api.example.edu/live
```

Browser endpoints use a Firebase ID token. The frontend obtains that token
after sign-in and sends it as a bearer token:

```bash
TOKEN="<firebase-id-token>"
curl -H "Authorization: Bearer $TOKEN" \
  https://api.example.edu/api/buses
```

Hardware uses its per-device credential and the exact nine-field telemetry
contract:

```bash
DEVICE_KEY="<device-secret>"
TIMESTAMP=$(date +%s%3N)
curl -i -X POST \
  -H "Authorization: Device $DEVICE_KEY" \
  -H "Content-Type: application/json" \
  --data "{\"deviceSentAt\":$TIMESTAMP,\"gpsHdop\":1.2,\"lat\":23.034,\"lng\":72.55,\"speed\":18.2,\"heading\":94,\"motionState\":\"moving\",\"seq\":1,\"timestamp\":$TIMESTAMP}" \
  https://api.example.edu/api/devices/device_01/telemetry
```

Populate shell variables securely through a secret manager or protected prompt
before use. Never put a real bearer token or device secret in shell history,
documentation, tickets or logs. A successful new telemetry sample returns
`202`; an equal or older duplicate returns `200`.

## Endpoint map

The compatible v2 resource aliases for settings, route planning/listing, device
disable, feedback status, and privacy deletion requests are documented in
[`API_RESOURCE_MIGRATION.md`](API_RESOURCE_MIGRATION.md). Existing paths remain
available during the rollout.

| Area | Endpoints | Authentication |
|---|---|---|
| Health | `GET /health`; `GET /live`; `GET /api/health` | Public readiness/liveness; admin diagnostics |
| Live buses | `GET /api/buses`, `GET /api/buses/:busId` | Authenticated |
| Device ingestion/update | `POST /api/devices/:deviceId/telemetry`, `POST /api/devices/:deviceId/diagnostics`, `GET /api/devices/:deviceId/firmware` | Device credential |
| Device administration | `GET /api/devices/:deviceId/diagnostics`, `PUT /api/devices/:deviceId`, `POST /api/devices/:deviceId/disable` | Admin |
| Ride operations | `POST /api/shifts/start`, `PATCH /api/shifts/delay`, `POST /api/shifts/stop` | Assigned operator or admin |
| Boarding and chat | Session boarding-code, join and messages endpoints | Session member/operator/admin as applicable |
| Passenger/account | Feedback submission, bootstrap, privacy deletion, requests | Authenticated/admin as noted below |
| Admin feedback | `GET /api/v2/feedback`, `PATCH /api/v2/feedback/:feedbackId` | Admin |
| Fleet and settings | Fleet, analytics, route, settings and places endpoints | Admin unless noted below |
| Route planning | `POST /api/plan`, `GET /api/routes-list` | Authenticated |

The sections below provide human-oriented request, response and side-effect
guidance; the OpenAPI contract and schema-backed tests check HTTP conformance.

## Authentication

- Browser: `Authorization: Bearer <Firebase ID token>`. `requireAuth` verifies revocation and trusted custom claims. Admin endpoints additionally require role/admin claim; operational endpoints recheck assigned `drivers` and `buses` records even when invoked from the admin workspace.
- Hardware: `Authorization: Device <per-device secret>`. It is not a Firebase token and must never use `Bearer`.
- Public: only `GET /health`.

IDs accept 1–128 ASCII letters, digits, `_`, or `-`. CORS/preflight runs before admission. A generous normalized-IP ingress guard admits 1,000 browser requests/minute before authentication; scoped public GET/HEAD probes and exact device-ingress paths are exempt. After revocation-aware token verification, separate per-UID budgets permit 200 reads/minute and 30 mutations/minute (POST/PUT/PATCH/DELETE); read polling never consumes mutation tokens. Detailed admin health is authenticated and exempt from the user read budget. Route compute/plan endpoints use dedicated verified-UID limiters (10/min and 30/min), and Places search has a verified-UID 20/minute limiter, and device telemetry bypasses global and write limiters while enforcing separate pre-auth IP (15 requests per configured device per 10 seconds before replica sharding; `HTTPS_INGRESS_DEVICES_PER_IP` defaults to 100, with separate diagnostics and firmware pools of 2 requests per configured device per 10 seconds) and authenticated per-device limits. The safe default device mode reserves bounded token leases from a shared RTDB fixed-window budget, so replicas cannot exceed the fleet-wide limit without paying for one transaction per fix. Local device limiting requires explicit `HTTPS_DEVICE_RATE_LIMIT_MODE=local` and `RATE_LIMIT_SHARD_FACTOR=1`. Other sharded counters divide their budgets by `RATE_LIMIT_SHARD_FACTOR` (set it to the deployed replica count; invalid values fall back to 1). If the replica count exceeds the smallest in-process budget (currently 10/minute), startup fails; use a shared distributed limiter beyond that scale. An edge load balancer or WAF cap is an external deployment requirement for global rate protection.

## Health

### `GET /health` — public

Returns only `{ "status": "ok" }` when the cached 30-second Firestore/RTDB probe is ready, otherwise 503 with `{ "status": "degraded" }`. It does not read Firebase for every request or expose dependency and telemetry details.

### `GET /api/health` — admin

Returns the cached Firestore/RTDB status, telemetry counters, latency/transaction summaries, bounded route-processing queue state, background-failure state, and probe timestamp. This is the detailed operational response formerly exposed by `/health`; it requires an admin Firebase ID token. `telemetry.workQueues` reports process-local KDF, durable lifecycle and intake active/waiting counts, admission rejections, expiry and configured ceilings. Recovery reports one bounded 25-item page. `routeProcessing.rerouting` reports the separate reroute scheduler. See [work admission](../docs/operations/WORK_ADMISSION.md) for FIFO, recovery and uncertain-commit boundaries.

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
    "credentialFills": { "activeFills": 0, "waitingCallers": 0 },
    "workQueues": {
      "kdf": { "active": 0, "pending": 0, "keys": 0, "rejected": 0, "expired": 0, "peakPending": 0, "maxConcurrent": 4, "maxPending": 32, "maxPendingPerKey": 1, "maxQueueAgeMs": 5000 },
      "ingestion": { "active": 0, "pending": 0, "keys": 0, "rejected": 0, "expired": 0, "peakPending": 0, "maxConcurrent": 8, "maxPending": 32, "maxPendingPerKey": 1, "maxQueueAgeMs": 2000 },
      "lifecycle": { "active": 0, "pending": 0, "keys": 0, "rejected": 0, "expired": 0, "peakPending": 0, "maxConcurrent": 8, "maxPending": 256, "maxPendingPerKey": 32, "maxQueueAgeMs": 5000 },
      "intake": { "active": 0, "pending": 0, "keys": 0, "rejected": 0, "expired": 0, "peakPending": 0, "maxConcurrent": 8, "maxPending": 256, "maxPendingPerKey": 32, "maxQueueAgeMs": 5000 },
      "recovery": { "requested": false, "inFlight": false, "scanned": 0, "failures": 0, "pageSize": 25 }
    },
    "processingLatencyMs": { "samples": 10, "average": 42.1, "p50": 35, "p95": 80, "p99": 80 },
    "deviceQueueLatencyMs": { "samples": 10, "average": 120, "p50": 80, "p95": 300, "p99": 300 },
    "networkLatencyMs": { "samples": 10, "average": 780, "p50": 700, "p95": 1100, "p99": 1100 },
    "deviceToServerLatencyMs": { "samples": 10, "average": 900, "p50": 850, "p95": 1300, "p99": 1300 },
    "rtdbWriteLatencyMs": { "samples": 10, "average": 30, "p50": 28, "p95": 55, "p99": 55 },
    "rtdbTransactionAttempts": { "samples": 10, "average": 1, "p50": 1, "p95": 1, "p99": 1 },
    "rateLimit": {
      "mode": "distributed",
      "limitPerMinute": 90,
      "leaseSize": 5,
      "replicas": 2,
      "localDecisions": 0,
      "leaseHits": 80,
      "storeTransactions": 20,
      "storeTransactionRetries": 2,
      "decisionLatencyMs": { "samples": 100, "average": 4.8, "p50": 0, "p95": 24, "p99": 31 }
    },
    "serverIngressGapMs": { "samples": 9, "average": 1010, "p50": 1000, "p95": 1100, "p99": 1100 },
    "routeProcessing": {
      "scheduled": 10,
      "processed": 9,
      "coalesced": 1,
      "failed": 0,
      "rejected": 0,
      "expired": 0,
      "activeWorkers": 0,
      "pendingKeys": 0,
      "lastQueueAgeMs": 4,
      "maxQueueAgeMs": 20,
      "rerouting": { "scheduled": 0, "processed": 0, "coalesced": 0, "failed": 0, "rejected": 0, "expired": 0, "activeWorkers": 0, "pendingKeys": 0, "lastQueueAgeMs": 0, "maxQueueAgeMs": 0 }
    },
    "metricWindow": {
      "scope": "process",
      "maximumSamplesPerMetric": 512,
      "resetsOnRestart": true,
      "crossClockValuesAreEstimates": true
    }
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

Metrics are a 512-sample in-memory rolling window on one backend process and
reset on restart. The rate-limit counters are also process-local and cumulative
since restart. A lease hit avoids a shared-store operation;
`storeTransactions` counts SDK transaction invocations for reservations;
`storeTransactionRetries` counts extra callback evaluations beyond the first,
including SDK local-state/server reconciliation. It does not count HTTP retries
or establish extra billed operations. `serverIngressGapMs` uses only that process's clock.
`networkLatencyMs` and `deviceToServerLatencyMs` compare device and backend wall
clocks, so use the correlated telemetry baseline trace when clock skew matters.
Route-processing counters are also process-local and monotonic until restart. A
live-node transaction-attempt p95 above 1 or sustained route queue age/coalescing
indicates contention or matcher saturation and should be investigated before
partitioning the live schema.

`backgroundTasks` counts failures from fire-and-forget background writes
(`trackBackgroundTask` and `scheduleDurableRideRestore`). A source
whose failures inside the 5-minute sliding window reach the threshold (5) is
flagged `sustained: true` and listed in `sustainedSources`; the backend also
emits an error-level `[BackgroundFailures] SUSTAINED failure alert` log once
per episode so log-based alerting can page. The readiness bit deliberately
ignores these counters — one flapping background write must not take the whole
probe down.

## Device endpoints

Accepted telemetry also triggers durable ride recovery when the live node has
missing lifecycle state or still carries a completed predecessor. The leader
checks completed nodes on startup/events too. Recovery reads the active ride,
matching bus lock and non-terminal session together, then conditionally restores
the same claimed return session in RTDB. It protects newer/unrelated sessions,
preserves newer GNSS data, and clears the predecessor's match/reroute and delay
state. A new claim bypasses the earlier no-ride miss cache; no extra session or
lock is created by recovery. This background work drains before Firebase shutdown
and does not delay the telemetry acceptance response.

Device authentication coalesces concurrent misses for the same device ID and
secret digest into one registry/KDF fill. It admits at most 16 unsettled fills
and 64 waiting callers per digest; overload and a 5-second monotonic cache-miss
response deadline return transient 503. A timed-out underlying fill keeps its
slot until it actually settles. It cannot publish late authorization, and
expired work does not dispatch subsequent reads. Successful authorization is
cached for at most 60s, negative results for 5s, anchored to fill start with
monotonic expiry; access does not extend TTL. Rotation/reassignment invalidation
fences all in-flight digests as well as existing cache entries. A failed
invalidation listener clears authorization and detaches before reconnecting.
Detailed admin health exposes `telemetry.credentialFills.activeFills` and
`waitingCallers` without device IDs, digests or secrets.

### `POST /api/devices/:deviceId/telemetry` — device

The body schema is nine fields today; during the staged rollout the parser also accepts the immediate previous bounded eight-field sequenced schema (no `gpsHdop`) and the legacy six-field schema (no `seq`/`deviceSentAt`):

```jsonc
{"deviceSentAt":<send epoch ms>,"gpsHdop":4.1,"lat":23.034,"lng":72.55,"speed":18.2,"heading":94,"motionState":"moving","seq":1,"timestamp":<GNSS sample epoch ms>}
```

`timestamp` is the GNSS capture time, `deviceSentAt` is refreshed immediately before each HTTP attempt, and `seq` is a positive 32-bit queue sequence. `gpsHdop` is the fix-quality gate (0..99) required before an off-route deviation can be confirmed. Ranges: latitude -90..90, longitude -180..180, speed 0..200 km/h, heading 0..<360, `motionState` is `moving|stopped|uncertain`, `gpsHdop` 0..99; both times must satisfy server bounds and `deviceSentAt >= timestamp`. Bus/route comes from `devices`, never the body.

Deploy the backend before flashing this firmware. Validate the schema your deployed firmware actually sends instead of requiring an exact field count, keeping the compatibility paths only as long as staged rollout needs them.

Authentication and the server registry assignment check run before the
per-device budget. HTTP 202 is returned only after the ordered live-node RTDB
transaction commits; HTTP 200 means the authenticated sample was already
present or older. Route matching and durable-lifecycle repair remain
background work and cannot change that acknowledgement contract.

- 202 `{accepted:true,duplicate:false}`: new RTDB fix.
- 200 `{accepted:true,duplicate:true}`: older timestamp or duplicate timestamp/sequence safely ignored.
- 400 invalid ID/payload; 401 bad/missing/disabled credential or registry; 413 raw body too large; 429 limiter with `Retry-After` and `retryAfterMs`; 503 Firebase/ingestion failure.
- Successful 200/202 responses have `Cache-Control: no-store` plus
  `X-Eki-Server-Received-At` and `X-Eki-Server-Responded-At` epoch-millisecond
  timing headers. Firmware combines them with its send/receive timestamps to
  estimate clock offset and transport delay without logging coordinates.

### `POST /api/devices/:deviceId/diagnostics` — device

Accepts the closed 1 KiB firmware-health object: firmware version, uptime, free heap, RSSI, queue depth/high-water/drop counters, accepted/rejected fixes, NMEA/UART errors, reset total, fault code, flash-encryption and Secure-Boot booleans, and device timestamp. Device ID, bus, and route come from the authenticated server registry; credentials and network names are never accepted in the body. The latest report overwrites `_device_diagnostics/{deviceId}` through the Admin SDK. Returns 202, 400, 401, 429, or 503 with `Cache-Control: no-store`.

### `GET /api/devices/:deviceId/firmware?sequence=N` — device

Authenticates the existing device credential and returns the complete configured
signed-release descriptor only when its sequence is newer and neither the
assigned bus lock nor active-ride document exists. Returns 204 when disabled,
current, or ride-gated; 200 contains `version`, `sequence`, immutable HTTPS
`url`, exact `sha256`, and exact `size`. Partial/unsafe deployment configuration
fails closed with 503. The backend never proxies the binary and the device never
sends its credential to the artifact host.

### `GET /api/devices/:deviceId/diagnostics` — admin

Returns the latest authenticated device report plus registry assignment and server `receivedAt`, or 404 when no report exists. Firebase clients cannot read `_device_diagnostics` directly.

### `PUT /api/devices/:deviceId` — admin

Body: `{ "busId":"bus_01", "routeId":"route_01", "enabled":true }`. Bus/route must exist and be assigned; a bus/route can have only one device; active ride/lock prevents unsafe reassignment. Does not rotate `secretHash`. Returns `{saved:true}`, 400, 409 or 500.

### `POST /api/devices/:deviceId/disable` — admin

Sets `enabled:false`/`disabledAt`, invalidates credential/rate cache. Returns `{disabled:true}` or 400/500.

Device creation/secret rotation is deliberately local: `npm run provision-device --workspace=backend -- --device-id … --bus-id … --route-id …`. Transfer the one-time plaintext only into the ignored `hardware/include/secrets.h` inside the controlled signing environment, build the device-specific protected artifact, and reflash the tracker. Never commit the plaintext or retain an unencrypted firmware image.

## Live bus endpoints

### `GET /api/buses` — authenticated

Returns `{ "buses": [...] }` from the current RTDB authority, with the same explicit public field whitelist as the route materialization. Prefer the compact per-route client RTDB subscription (initial sync plus child deltas) for continuous live UI; this endpoint is a snapshot, not a polling recommendation.

### `GET /api/buses/:busId` — authenticated

Searches live entries for the stored `busId` and returns the snapshot or 404. Invalid ID returns 400.

## Shift endpoints

### `POST /api/shifts/start` — assigned operator or admin

Body: `{ "busId":"bus_01", "routeId":"route_01", "driverId":"driver_01" }`. `driverId` is required for admin requests and comes from trusted claims for legacy assigned-operator requests.

Requires agreement among Auth claim, `drivers`, `buses`, route assignment and a fresh ≤60-second stopped hardware fix near exactly one route endpoint. The backend infers `forward` at endpoint A or `reverse` at endpoint Z; the client cannot choose or override direction. A Firestore bus lock prevents another route session. If already owned by the same driver/session, repairs durable records and returns 200 `{sessionId,resumed:true,direction}`. New ride returns 201 `{sessionId,resumed:false,direction}`. Returns 403 assignment mismatch, 409 active/lock/stale/moving/ambiguous-position conflict, 422 invalid route endpoints or 500.

At the inferred origin, the session starts `active/in_service` and records stop 0. An active session always restores its immutable stored direction after hardware/backend interruption. After final-stop completion, a fresh stopped fix at that destination after the optional `AUTOMATIC_TURNAROUND_DWELL_MS` delay (default zero) causes the backend to atomically arm a new session in the opposite direction; stale, moving, mid-route or contested state never auto-arms.

### `PATCH /api/shifts/delay` — assigned operator or admin

Body: `{ "busId":"…", "routeId":"…", "driverId":"…", "delayMinutes":0 }`, allowed 0–1440. `driverId` is required for admin requests. Session ownership/status is checked in RTDB. Writes RTDB and durable active ride. Returns `{saved:true,delayMinutes}`, 400/409/500.

### `POST /api/shifts/stop` — assigned operator or admin

Body: `{ "busId":"…", "routeId":"…", "sessionId":"…" }`. Pending, armed and active sessions can be interrupted early; this never marks a ride completed. An already completed session returns `{stopped:true,alreadyCompleted:true}`. Interruptions return `{stopped:true,interrupted:true,alreadyInterrupted:boolean}`. Invalid ownership/resource returns 403/404.

### `DELETE /api/shifts/:sessionId/messages` — admin

Deletes messages in batches from the session subcollection. Returns `{deleted:number}` or 400/500.

### `DELETE /api/shifts/:sessionId/history` — admin

Only `completed|interrupted|failed` sessions. Recursively deletes session/subcollections and same-ID/query-matching completed projections. Returns `{deleted:true,...counts}`. Active/pending/armed is 409; invalid ID 400; absence/errors follow deletion service response.

## Session boarding endpoints

### `POST /api/sessions/:sessionId/boarding-code` — assigned operator or admin

An admin may request the code for any active session; a legacy assigned-operator token must match the session driver ID and assigned bus. Idempotently creates or returns an eight-character, 40-bit boarding code stored only in the operator-readable session record; the code is never projected into passenger-readable RTDB. Responses use `Cache-Control: no-store`.

### `POST /api/sessions/:sessionId/join` — passenger

Body: `{ "boardingCode":"ABCD2345", "lat":23.0, "lng":72.5, "accuracy":25, "boardingStopId":"stop_1", "alightingStopId":"stop_3" }`. Both stop IDs are required. Coordinates are required on first boarding and may be omitted only when the same authenticated UID updates an existing manifest entry.

Requires a valid Firebase bearer token, the driver-issued session code, route-owned stops in forward order, browser accuracy no worse than 100 m, and—on first boarding—a passenger coordinate within 150 m of a fresh nonfuture hardware GNSS projection bound to the exact session/bus/route. Browser location is defense in depth rather than trusted proof; possession of the non-public session code is the server-verifiable authorization. An existing passenger may correct stops without a second location prompt. A Firestore transaction rechecks session state, code, and existing membership when proximity is omitted before adding or updating only the authenticated UID's manifest entry. Display name and timestamps are server-derived. Returns `{joined:true,sessionId}` or 400/403/404/409/422/500.

### `POST /api/sessions/:sessionId/messages` — session member/operator

Body: `{ "text":"Bus arriving", "requestId":"browser-generated-uuid" }`. The authenticated UID must be a manifest passenger, the assigned driver on the assigned bus, or an admin, and the session must still be `armed|active`. Sender role/name are server-derived. One transaction rechecks membership/state; applies the three-second, 10-per-minute, and 60-per-hour limits; normalizes unsafe Unicode formatting; censors common English, Hindi/Hinglish, leetspeak, separator, and repeated-letter profanity evasions; and writes both message and rate state. The uncensored text is not stored. `requestId` makes retries idempotent: first success is 201, an identical retry is 200, and reuse with changed content is 409. Throttling is 429 with `Retry-After` and `retryAfterMs`.

## Feedback, profile, and settings endpoints

### `POST /api/feedback` — authenticated

Body: `{ "type":"general|ride", "requestId":"browser-generated-uuid", "comment":"...", "rating":5, "sessionId":"...", "busId":"...", "driverId":"..." }`. Ride identifiers are required only for ride feedback. The backend derives the author name, validates comment/rating limits and completed-ride membership, and reads the per-user 24-hour cooldown in the same transaction that writes feedback/cooldown state. Identical retries are idempotent; request-ID payload conflicts are 409; cooldown is 429.

### `GET /api/v2/feedback` — admin

Returns `{ "feedbacks": [...] }` with at most the latest 200 records ordered by
Firestore `timestamp` descending. Uses the Admin SDK with `requireAdmin` and
`Cache-Control: no-store`; ordinary signed-in passengers cannot list feedback.
There is no cursor/pagination contract in this endpoint.

Each item includes `id`, `userId`, `userName`, `type`, nullable
`busId/driverId/sessionId/rating`, `comment`, `status` and `timestamp`.
The timestamp is `{ "seconds": N, "nanoseconds": N }` when valid, otherwise
`null`. Missing/legacy values are normalized to safe defaults. Database
failures return `500` with `Unable to load feedback.`; middleware can return
authentication, authorization or rate-limit failures first.

The embedded and standalone admin views validate the response, provide retry,
and discard requests/results belonging to an earlier auth generation. A status
change uses `PATCH /api/v2/feedback/:feedbackId` with the same status-only body
and acknowledgement as the legacy endpoint below.

### `PATCH /api/feedback/:feedbackId/status` — admin

Body: `{ "status":"new|reviewed|resolved" }`. Updates only review state plus server audit metadata. Missing feedback is 404.

### `POST /api/users/bootstrap` — authenticated

Creates a missing `users/{uid}` passenger profile transactionally from verified ID-token claims; request-body identity fields are ignored and existing profiles/roles are never overwritten. Returns 201 when created or 200 when already present, with `Cache-Control: no-store`.

### `PUT /api/settings` — admin

Accepts a non-empty partial object containing only `serviceStartTime`, `noBusesMessage`, `noBusesSubMessage`, `announcementText`, and/or boolean `announcementActive`. Values are bounded and stored with server audit metadata.

## Fleet/admin endpoints

All `/api/fleet/*` handlers are behind `requireAdmin` plus a persisted audit record before mutation. Audit records identify bounded progress; they are not a durable HTTP idempotency/replay guarantee.

### `POST /api/fleet/reconcile`

Rebuilds driver Auth claims and RTDB assignment mirrors from Firestore. Returns summary; partial per-record failures can produce 207.

### `PUT /api/fleet/buses/:id`

Body: `{ "name":"Campus Bus 1", "assignedRoutes":["route_01"] }`. Routes must exist; cannot remove a route used by an active ride or bound device. Only `id`, trimmed `name`, and deduplicated `assignedRoutes` are written; unrelated timestamps and metadata are preserved with a merge, and legacy `assignedRouteId` is explicitly deleted. Extra request fields never become bus fields. The same policy creates a new bus without accepting caller-supplied metadata. Updates driver authorization after save. Returns `{saved:true}`, 400/409/500.

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

Validates route control points, calls server-key Google Routes API and returns road-snapped encoded geometry/distance/duration. Dedicated verified-UID 10/minute mutation limit. All admin geometry computations share two raw directional pipelines, eight waiting and a two-second queue age; each pipeline has at most four ordered chunks. Dispatched work retains its permit until actual settlement. Capacity/expiry returns 503 with Retry-After: 1; upstream timeout/config/errors map to safe error responses.

### `GET /api/routes/:routeId/geometry` — authenticated

Returns cached independently routed `forwardPolyline` and `reversePolyline` geometry (plus forward-compatible `polyline`, distance and duration fields). The GET is read-only for every caller and never invokes Google or writes Firestore. Stored/negative documents use a 100-entry, sixty-second monotonic cache with watcher/local-save invalidation, sixteen raw fills, thirty-two callers/fill and a three-second response deadline. Legacy/invalid geometry returns 409 `GEOMETRY_REPAIR_REQUIRED`; authorized versioned admin saves perform repair. GET/HEAD skip the dedicated ten/minute computation limiter and retain the independent verified-UID read quota. Responses are private/no-store. See [read/repair contract](../docs/operations/ROUTE_GEOMETRY_READS.md).

### `PUT /api/routes/:routeId` — admin

Body includes validated route metadata/stops plus `mode`, a stable `saveId`, and `expectedVersion` (`0` for a legacy route/create). A Firestore operation lease deduplicates concurrent/restarted requests; the final transaction rechecks route version and active rides before atomically storing the route and replayable result. `configVersion` advances on every edit; `geometryVersion` advances only when exact ordered coordinates/routing inputs change. Valid directional geometry is reused for metadata-only edits. The browser allows 30 seconds for the routing/persistence budget and reconciles unknown outcomes with the same operation ID. Returns 200 saved/replayed, 202 processing, or structured 400/404/409/502/503/504 errors with `code` and `phase`.

### `GET /api/routes/:routeId/save-operations/:saveId` — admin

Reconciles a timed-out save. Returns its replayable saved result, 202 while the durable lease is processing, the recorded structured failure, or 404 when the original request never reached the backend.

### `DELETE /api/routes/:routeId` — admin

Blocked by active rides and bus assignments. Deletes route when safe; invalid/absent/conflict/error returns 400/404/409/500.

### `POST /api/plan` — authenticated

Body: `{ "routeId":"…", "startStopId":"…", "endStopId":"…", "viaStopId":"…" }` (`viaStopId` optional). Uses cached Firestore route and pure stored-polyline slicing; makes no Google API request. Works in either direction, orders stops by travel direction, and requires via to lie between endpoints. Returns route metadata, stop objects, ordered `stopsOnSegment`, encoded `polyline`, and `totalStops`; 400/404/422/500 on invalid input/data.

### `GET /api/routes-list` — authenticated

Returns up to 250 route metadata/configuration records from Firestore per request, omitting geometry. Firestore errors return 500.

### `GET /api/places/search?q=…` — admin

Bounded query string search proxied to Google Places with server key, five-second whole-response timeout and dedicated limit. Returns normalized candidates (an empty array is a genuine no-result response) or structured codes for invalid query, authentication/role, missing configuration, local/upstream rate limit, upstream failure, and timeout. Credentials and upstream response bodies are never returned.

## Passenger/privacy endpoints

### `PATCH /api/requests/:uid` — admin

Body status is one of `pending|accepted|completed|cancelled`; updates existing request. Returns merged request or 400/404/500.

### `DELETE /api/requests/:uid` — admin

Deletes existing request. Returns `{message:"Deleted successfully"}` or 400/404/500.

Passenger requests are backend-authoritative: clients have no Firestore write
surface (issues #72 + #73); the admin route above is the only lifecycle path.

### `POST /api/privacy/deletion-request` — passenger

Registers `_privacy_deletion_requests/{uid}` and returns 202 `{accepted:true}` without resetting existing retry/error/status history. Current Auth/profile/driver membership permits claim-less passengers while excluding operators (409, IT offboarding). Admission has a three-second caller budget and returns 503/Retry-After on an uncertain or unavailable acknowledgement. Admin `GET /api/v2/privacy-deletion-requests` monitors twenty-record cursor pages; `POST /api/v2/privacy-deletion-requests/{uid}/recovery` compares executor/generation and audits a deliberate retry. Expired processing additionally requires independently verified executor termination and `executorStopped:true`. See [privacy deletion recovery](../docs/operations/PRIVACY_DELETION.md) for bounds, backoff, linked fleet lock recovery and staging limits.

## Consistency/retry guidance

- Telemetry and start/resume are idempotent by timestamps/session ownership.
- Route-save retries must retain `saveId` only for the exact same payload and `expectedVersion`; changed editor content starts a new operation. A 202 or unknown network outcome is reconciled, not treated as a confirmed failure.
- Do not blindly retry a 400/401/403/409. Fix configuration/user action first.
- 429 respects limiter headers/backoff. 500/503 may be retried with bounded exponential jitter.
- Clients should wait for RTDB/Firestore push confirmation where UI truth depends on database state.
- Never cache bearer/device responses or log authorization headers.

## Versioned ride-session resources (#193)

See [the lifecycle and migration contract](../docs/api/RIDE_SESSION_CONTRACT.md)
for the state transition table and compatibility decisions. V2 responses are
private (`Cache-Control: no-store`). Existing clients can continue using the
legacy routes; Firebase SDK reads retain their existing authorization rules.

| Method and path | Contract |
| --- | --- |
| `POST /api/v2/ride-sessions` | Same start body and assignment/hardware gates; requires UID-scoped `Idempotency-Key` (16-128 letters/digits/underscore/hyphen). Returns 201 new or 200 resumed and `Location`. Same key retains original session after terminal state; changed assignment 409, deleted session 410. Use a fresh key for a new ride. |
| `GET /api/v2/ride-sessions/:sessionId` | Assigned operator, admin or manifest member; only sessionId, busId, routeId, status and direction. |
| `PATCH /api/v2/ride-sessions/:sessionId` | Only `{delayMinutes:0..1440}`; derives assignment from session, checks path identity in the RTDB transaction and preserves durable mirror semantics. |
| `POST /api/v2/ride-sessions/:sessionId/boarding-code` | Existing idempotent operator/admin issuance command, armed/active only. |
| `PUT /api/v2/ride-sessions/:sessionId/passengers/me` | Existing join body; binds membership to token UID, rechecks boarding code, proximity, stop order and live state. |
| `POST /api/v2/ride-sessions/:sessionId/messages` | Existing text/requestId body; same moderation, membership, durable rate limit and request ID replay. Reads remain Firestore listeners. |
| `DELETE /api/v2/ride-sessions/:sessionId/messages` | Admin; messages deleted in batches of at most 400, including during live sessions under existing policy. |
| `DELETE /api/v2/ride-sessions/:sessionId` | Admin; only terminal or absent sessions, recursive history/projection cleanup. Creation-key bindings survive deletion. |

Normal completion remains telemetry-owned. `POST /api/shifts/stop` remains an
early interruption command; this migration introduces no v2 stop/completion
command. Browser clients can read the exposed `Location` response header.

## Durable operation resources (#194)

See `docs/api/OPERATION_RESOURCES.md` for states, retention, execution budgets,
crash recovery and staging measurements. All new endpoints require admin auth
and return `Cache-Control: no-store`.

| Endpoint | Contract |
| --- | --- |
| `PUT /api/v2/routes/:routeId` | Existing saveId/versioned save body, geometry reuse, active-ride guards and durable outcome. 202 adds Location and Retry-After: 1; successful/replayed saves retain the legacy body. |
| `GET /api/v2/routes/:routeId/save-operations/:saveId` | 200 state snapshot with operationId, routeId, status and result or redacted error; processing includes retryAfterMs. |
| `POST /api/v2/route-geometry-previews` | Idempotency-Key (16-128 safe ASCII characters), `{waypoints:[{lat,lng},...]}`. 202 while processing, 200 terminal replay; changed payload 409. |
| `GET /api/v2/route-geometry-previews/:operationId` | 200 state/result/error, 404 missing; never calls Google. |
| `POST /api/v2/fleet-reconciliation-jobs` | Idempotency-Key and optional `{cursor}` body; one 100-driver page with nextCursor/timeBudgetExceeded. 202 while processing; 200 terminal replay including partial per-driver outcomes. |
| `GET /api/v2/fleet-reconciliation-jobs/:operationId` | 200 state/result/error, 404 missing; may classify expired operation metadata, never modifies Auth/assignment state. |
| `GET /api/v2/route-geometry-previews/recovery`, `GET /api/v2/fleet-reconciliation-jobs/recovery` | Discover processing claims in 25-record pages; optional `cursor`, returned `nextCursor`. No external replay. |
| `POST /api/v2/route-geometry-previews/:operationId/recovery`, `POST /api/v2/fleet-reconciliation-jobs/:operationId/recovery` | Exact `expectedExecutorId`, `expectedGeneration`, `executorStopped:true`; abandon an expired unknown outcome with admin audit and generation bump. 409 if changed/ineligible/live locally. |
| `GET /api/v2/fleet-reconciliation-jobs/lock` | Admin owner/executor/linked operation; 404 without a lock. |
| `POST /api/v2/fleet-reconciliation-jobs/lock/recovery` | `expectedOwner`, `executorStopped:true`; linked processing operation must first be terminal; missing retained records are audited. Atomic audited conditional lock release, never Auth/Google replay. |

Preview/fleet submission exposes Location and Retry-After for polling. An
unresolved operation past its budget reports outcomeUnknown and is never
re-executed automatically. Retention ends the replay window (default 90 days).
Fleet reconciliation is serialized across the new jobs, legacy endpoint, all fleet admin mutations and
periodic worker; legacy `/api/fleet/reconcile` retains aggregate response bodies
and returns 409 while another reconciliation owns the lock. Execution is bounded
per process (2 active, 8 queued, 2-second queue age); durable admissions and
control reads/recovery each retain at most 16 raw fills, 32 waiters/fill with
3-second response deadlines. Progress and recovery identity are redacted admin
fields. Follow the operation-resource runbook to verify executor termination,
audit unknown effects and recover ownership; expiry alone is insufficient.

Telemetry service admission now uses an 8-second monotonic response budget,
2-second undispatched queue age and 5-second maximum dependency stages. Dispatched
work retains its slot through real settlement. A retryable 503 includes
`Retry-After: 1`, `retryAfterMs: 1000` and `commitState: not_dispatched|unknown`;
an unknown outcome may have committed. See
[telemetry deadlines](../docs/operations/TELEMETRY_DEADLINES.md) for ordering,
replica and receipt-timeout boundaries. Admin health adds anonymous
`workQueues.ingestion` active/waiting/rejection/expiry counters and budgets.

Fleet reconciliation returns one 100-record page. Legacy POST /api/fleet/reconcile accepts optional cursor and exposes X-Reconciliation-Complete / X-Next-Cursor through CORS while retaining its aggregate JSON body. Follow every page; new jobs use a new key per settled cursor. Bus guards and repairs page all bound rides/devices/drivers; no first-250/500 truncation remains. See [bounded reconciliation](../docs/operations/RECONCILIATION.md) for bounds, partial mutations, audit checkpoints and recovery.

Telemetry configured-route reads now use the watcher-populated catalog for both pending and resolved directions. Missing legacy geometry is read-only on this live path and requires an authorized route save/repair; accepted raw fixes/lifecycle remain available. See [route catalog](../docs/operations/ROUTE_CATALOG.md). Passenger geometry GET is also cached/read-only; legacy repair requires an authorized versioned admin save. See [geometry reads](../docs/operations/ROUTE_GEOMETRY_READS.md).
