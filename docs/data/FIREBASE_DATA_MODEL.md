# Firebase Firestore and RTDB data model

Last updated: 2026-10-07 22:40 IST (UTC+05:30).

Field ownership and compatibility build on [the field contract audit](../testing/RTDB_FIELD_CONTRACT_AUDIT_2026_10_02.md).

## Reading this document

Firestore is durable/queryable; RTDB is the low-latency latest-state projection. `server` means Firebase Admin SDK and therefore not governed by client rules. Timestamps are called out because this repository contains both Firestore `Timestamp`, ISO strings, RTDB server milliseconds and epoch-millisecond numbers.

Access model: client-facing Firestore and RTDB rules require authentication and enforce least-privilege roles. App Check is enforced for both products through Firebase Console; it is not available as a Firestore Security Rules request field. Server/Admin SDK writes bypass rules. The emulator integration suite uses isolated copies of the deployed rules (`scripts/rules-for-emulator.mjs`).

```mermaid
erDiagram
  BUSES ||--o{ ROUTES : assignedRoutes
  DRIVERS }o--o| BUSES : assignedBusId
  DEVICES }o--|| BUSES : busId
  DEVICES }o--|| ROUTES : routeId
  RIDE_SESSIONS }o--|| BUSES : busId
  RIDE_SESSIONS }o--|| ROUTES : routeId
  RIDE_SESSIONS }o--|| DRIVERS : driverId
  ACTIVE_RIDES ||--|| RIDE_SESSIONS : sessionId
  ACTIVE_BUS_LOCKS ||--|| RIDE_SESSIONS : sessionId
  COMPLETED_TRIPS }o--|| RIDE_SESSIONS : sessionId
  FEEDBACKS }o--o| RIDE_SESSIONS : sessionId
```

## RTDB

### Public live views (R14)

`publicRouteBuses/route:{routeId}/buses/node:{busId}_{routeId}` contains only fields explicitly selected by `publicLiveBus`: coordinates, accepted sample identity, matched/raw location, public route state and ride lifecycle. Opaque prefixes safely preserve legal prototype-like IDs. Histories, anchors, claims, retry state and worker metadata are excluded. Passengers subscribe directly to a selected route, plus their explicitly joined ride route when browsing another route. Trusted boolean administrators may read the public fleet root. All writes are server-only; bare legacy route/node entries are excluded from schema 1 browser consumption.

`liveRouteCatalog/values/route:{routeId}` contains active counts and `availableReceipts`, an exact bounded receipt vector with no coordinates or identities. The browser applies its configured freshness window; receipt/sample pairing follows the accepted -10s/+60s skew contract. Legacy `available`/`freshestAt` remain diagnostics and do not decide browser expiry. Parent `revisions`, per-route `generations` and `_workerGeneration` are private. The elected worker repairs missing/removal publications using bounded periodic replay, including empty route tombstones and successor revision lineage.

`clientProjectionStatus/public` exposes only `{schemaVersion:1,ready}`. It becomes ready after current-generation bounded backfill and queued publications settle. Absent/incompatible/not-ready status is an actionable unavailable state, rather than an empty fleet; a compatible ready empty fleet is valid. The status parent retains a private worker fence. Deploy the publisher and verify backfill before restrictive rules and the browser release; a testing merge does not deploy any of them.

The guarded natural-completion write retains one `lastCompletedSessionId/lastCompletedAt/lastCompletedRouteId` marker through automatic turnaround. This bounded marker is public lifecycle evidence, not full ride history. Older/cross-route joined-session recovery uses the closed member-authorized HTTP status endpoint backed by durable `ride_sessions`. Removed/offline/interrupted data never invents completion. See [R14 evidence and rollout](../testing/R14_LIVE_PROJECTION.md).

### `activeBuses/{busId}_{routeId}`

Backend-only authority, with every browser read/write denied. One latest record per assigned bus/route. The key is an internal composite locator; consumers use stored `busId` and `routeId` and must not split the key because IDs can contain underscores. A telemetry-created node represents device presence only and omits ride lifecycle fields. Passenger service exists only when the server-owned tuple `status: active` + non-empty `sessionId` + resolved `direction` + `tripState: pre_departure|in_service` is complete.

| Field | Type | Meaning/source |
|---|---|---|
| `busId` | string | Server registry assignment |
| `_workerGeneration` | integer, optional | Internal generation on surviving worker projections; stale worker transactions cannot overwrite a newer value. Not a telemetry sequence or public service state. |
| `routeId` | string | Server registry/shift assignment |
| `lat`, `lng` | number | Latest accepted GNSS coordinate |
| `rawLocation` | object | Original authenticated `{lat,lng,speed,heading,gpsHdop,motionState,seq,sampledAt}`; never overwritten by snapping |
| `matchedLocation` | object | Current confident `{lat,lng,segmentIndex,segmentFraction,alongRouteDistanceM,distanceToRouteM,headingDifference,matchConfidence,seq,sampledAt,routeVersion}` |
| `mapMatchSeq`, `mapMatchSampledAt` | number | Sample identity of the latest completed matching pass, including passes that produced no confident match |
| `matchConfidence`, `distanceToActiveRoute` | number | Latest matcher confidence (0–1) and raw distance in metres |
| `routeState` | enum | `ON_ROUTE`, `POSSIBLE_OFF_ROUTE`, `OFF_ROUTE`, `REROUTING`, or `ON_NEW_ROUTE` |
| `activeRouteId` | string | Authoritative configured/dynamic matching-context label; route geometry is NOT on this hot node (see sibling store below) |
| `routeVersion`, `routeSource`, `routeDirection`, `routeSessionId` | number/string | Atomic live-route identity; version increments on session/direction/reroute changes |
| `routeGeometryVersion` | non-negative integer | Firestore configured-geometry revision used by this live context |
| `routeMatchHistory` | array | Bounded last four accepted points used to derive recent trajectory heading |
| `speed` | number | km/h, 0–200 |
| `heading` | number | degrees, 0–360 |
| `gpsHdop` | number/null | Receiver horizontal dilution of precision; null for staged legacy firmware |
| `motionState` | `moving` / `stopped` / `uncertain` | Firmware; uncertain means trustworthy GNSS lost |
| `timestamp` | epoch ms | NTP-synchronised device measurement time |
| `seq`, `deviceSentAt`, `backendReceivedAt` | number / epoch ms | Sample tie-breaker, device send time, and backend ingress/freshness boundary |
| `receivedAt` | RTDB server epoch ms | Backend commit time |
| `plausibilityAnchor` | object | Last physically accepted `{lat,lng,speed,gpsHdop,timestamp}`; held outliers do not advance its timestamp |
| `plausibilityReacquisition` | optional object | Temporary `{count,startedAt}` for three coherent, good-quality fixes after a 60–300 second accepted-position gap. Uses existing `rawLocation` as the preceding candidate, requires 0.5–5 second spacing and the full bounded travel envelope. Clears on acceptance or an ineligible fix; it is not ride progress/history. |
| `deviceState` | `online` / `offline` | Ingestion/worker connectivity projection; `online` is trusted by clients only while `timestamp` is fresh |
| `signalState` | `connected` / `gnss_lost` / `lost` | Derived signal explanation |
| `status` | `active` / `offline` | Ride lifecycle ownership, not hardware power; initial device-only nodes are `offline` |
| `sessionId` | string | Firestore ride-session link when armed/active |
| `driverId` | string | Authorized driver link |
| `tripState` | `pre_departure` / `in_service` / `completed` | Server worker lifecycle; absent until a ride is armed |
| `direction` | `forward` / `reverse` / `null` | Immutable resolved session travel order; null while inference is pending |
| `directionState`, `directionEndpointVersion` | string | Pending/resolved state and the endpoint snapshot that was used for inference |
| `directionFirestoreSynced` | boolean | `false` only while a telemetry-resolved session direction still needs its one-time Firestore projection; `true` after synchronization |
| `originStopId`, `destinationStopId` | string | Endpoints for this direction |
| `completedAt`, `turnaroundEligibleAt` | epoch ms | Completion and earliest automatic opposite-direction arm time; removed when the next session activates |
| `turnaroundSampledAt` | epoch ms | Minimum fresh device sample for automatic return; separate from the dwell deadline |
| `turnaroundClaimId`, `turnaroundClaimedAt` | string / epoch ms | Short-lived cross-replica automatic-turnaround claim; removed after activation or failed durable claim |
| `automaticTurnaround`, `previousSessionId` | boolean / string | Identifies a backend-armed return session and its completed predecessor |
| `currentStopIndex` | integer | Zero-based next/current ordered stop progress |
| `hasDepartedOrigin` | boolean | Prevents repeated origin activation |
| `delayMinutes` | number | Driver API value, 0–1440 |
| `delayUpdatedAt` | epoch ms | Delay revision for conflict-safe recovery/projection |
| `lifecycleUpdatedAt` | RTDB server epoch ms | Server lifecycle/status mutation time |

`rtdbCommittedAt` is a retired alias of `receivedAt`; new accepted telemetry
removes it while browser trace exports keep the historical `rtdbCommittedAtMs`
key. `activeRoutePolyline` is a retired inline geometry field; the versioned
sibling store below is authoritative. Route context also owns
`offRouteSampleCount`, `mapMatchUpdatedAt`, `rerouteRequestId`,
`lastRerouteAttemptAt`, `rerouteError`, `rerouteCompletedAt` and
`rerouteFailedAt`; the field audit explains their hysteresis/ownership/diagnostic
roles. Context reset clears `mapMatchSeq` and `mapMatchSampledAt` as well as the
previous match result.

Read: any authenticated Firebase user (`.read: auth != null`); App Check is enforced through the Firebase console. Write: denied to all clients; server only. Indexed by `routeId`, `busId`. Active rides survive stale hardware and are marked offline; stale non-active nodes can be removed.

### `activeRouteGeometry/{busId}_{routeId}/{routeVersion}`

Version-keyed sibling node holding the full dynamic-reroute polyline. The geometry is written once when a reroute activates (version bump) and is immutable per version, so the high-frequency `activeBuses` child above never carries the encoded polyline on every accepted fix. Clients read it once when `routeSource === "dynamic-reroute"` and the `routeVersion` changes, then cache it locally. Configured (non-reroute) geometry is not stored here — clients derive it from the Firestore route document (`forwardPolyline`/`reversePolyline`/`polyline`).

| Field | Type | Meaning |
|---|---|---|
| `polyline` | string | Encoded reroute geometry, ordered in travel direction |
| `routeId` | string | Route the reroute belongs to |
| `direction` | `forward` / `reverse` | Travel direction of the reroute |
| `source` | `dynamic-reroute` | Marker for the sibling store |
| `routeVersion` | integer | Version this geometry is bound to (> 0) |

### `driverRouteAssignments/{driverId}`

Server-only authorization mirror used with Auth claims/driver records. It is written/reconciled by fleet management and removed on unassignment/deletion. Typical data identifies `driverId`, `assignedBusId`, and authorized `routeIds`/assignment values. All client reads/writes are denied; clients receive their assignment through trusted claims and allowed Firestore/API views.

### `users/{uid}` and `messages`

RTDB `users/{uid}` and top-level `messages` are legacy trees with all client
reads/writes denied by the current default rules. Active profiles and ride
messages are in Firestore. No new feature should use either legacy tree.
Existing legacy copies and historical reroute versions are not covered by the
Firestore retention sweeper; migration/cleanup is tracked in issue #214.

## Firestore client-visible collections

### `users/{uid}`

| Field | Type | Meaning |
|---|---|---|
| `uid` | string | Same as verified auth UID |
| `email` | string ≤320 | Firebase account email |
| `displayName` | string ≤100 | UI name |
| `photoURL` | string ≤2048 | Auth avatar URL |
| `role` | `passenger` / `driver` / `admin` | Presentation mirror; Auth custom claim is API authority |
| `createdAt` | Firestore Timestamp | Server create time |

Owner can read. All client writes are denied. `POST /api/users/bootstrap` transactionally creates a missing passenger profile from verified ID-token claims and never overwrites an existing role; server role sync/fleet/privacy flows can mutate/delete.

### `routes/{routeId}`

| Field | Type | Meaning |
|---|---|---|
| `id`, `name`, `color` | string | Stable ID, display name and UI color |
| `waypoints[]` | `{lat,lng}` | Admin-entered control points |
| `stops[]` | `{id,name,shortName,lat,lng,waypointIndex}` | Authoritative ordered stops |
| `polyline`, `forwardPolyline`, `reversePolyline` | string | Legacy/forward geometry plus independently routed legal road geometry for each direction |
| `distanceMeters`, `forwardDistanceMeters`, `reverseDistanceMeters` | number | Forward-compatible and direction-specific Routes distances |
| `duration`, `forwardDuration`, `reverseDuration` | string | Forward-compatible and direction-specific durations such as `1200s` |
| `configVersion` | non-negative integer | Optimistic-concurrency revision; increments for metadata and geometry edits |
| `geometryVersion` | non-negative integer | Revision of route-shaping inputs/geometry; metadata-only edits preserve it |
| `geometrySignature` | SHA-256 string | Exact ordered coordinates plus server routing contract; no coordinate rounding |
| `updatedAt` | ISO string or server timestamp | Seed/admin update marker |

Any authenticated user reads. All client writes are denied; admin backend validates geometry, IDs, active usage and Maps output. `routes-list`, plan, maps and trip worker consume this collection.

### `buses/{busId}`

Fields: `id`, `name` (≤100), and `assignedRoutes: string[]` (≤50); legacy readers also tolerate `assignedRouteId`. Admin bus saves merge only these editable catalog fields, preserve unrelated server timestamps/nested metadata, and explicitly delete legacy `assignedRouteId`. Unknown request fields are ignored; new documents contain only the catalog fields. Authenticated users read; only admin backend writes. Devices, drivers, route deletion, start authorization and UI catalogs join by `busId`.

### `drivers/{driverId}`

Fields: `id`, `name`, `authUid`, `assignedBusId` (`string|null`), and optional `photoUrl`. Admin reads all; a driver reads only the record whose `authUid` equals their UID. Client writes are denied. Fleet endpoints update the document, Auth custom claims (`role`, `driverId`, `assignedBusId`) and RTDB assignment mirror together/reconcile them after partial failure.

### `bus_locations/{busId}`

Compact server lifecycle projection: `routeId`, `driverId`, `status`, `deviceState`, `tripState`, `lastSeen`, plus legacy/optional motion fields. It changes on lifecycle/fleet state, not every coordinate. Admin-only client read/write rule; backend writes. Fleet analytics consumes it.

### `passenger_requests/{uid}`

Legacy collection; one document per passenger (document ID equals UID). Clients are fully denied (reads and writes) by the explicit catch-all — no client rule block exists (issues #72 + #73 removed the dead surface). Only the Admin SDK touches it via the admin request routes.

| Field | Type | Constraint |
|---|---|---|
| `passengerId` | string | Equals the passenger UID |
| `busId` | string ≤128 | Requested bus |
| `type` | `pickup` / `dropoff` | Request kind |
| `lat`, `lng` | number | Valid world coordinate |
| `status` | `pending` initially; then `accepted/completed/cancelled` | Admin transition |
| `createdAt` | server timestamp | Creation marker |

No frontend or hardware consumer exists (the passenger flow is session-based); the admin `PATCH/DELETE /api/requests/:uid` routes are the only lifecycle path.

### `ride_sessions/{sessionId}`

Durable ride record and parent of messages.

| Field | Type | Meaning |
|---|---|---|
| `id` | string | Same as document ID |
| `busId`, `routeId`, `driverId` | string | Configuration links |
| `direction` | `forward` / `reverse` | Immutable travel order inferred from the endpoint for initial arm or inverted by automatic turnaround |
| `originStopId`, `destinationStopId` | string | Direction-specific route endpoints |
| `status` | `pending` / `armed` / `active` / `completed` / `failed` / `interrupted` | Durable session status |
| `armedAt`, `startTime`, `endTime` | epoch ms | Driver arm, service activation, terminal time |
| `activatedAt`, `updatedAt`, `reconciledAt` | Firestore Timestamp | Server audit markers |
| `failureReason`, `interruptionReason` | string | Terminal explanation when applicable |
| `passengers` | map keyed UID | Passenger manifest |
| `passengers.{uid}` | `{userId,userName,boardingStopId,alightingStopId,joinedAt}` | Server-issued entry for the authenticated UID |
| `boardingCode` | eight-character string | Driver-visible session proof; never projected into RTDB |
| `boardingCodeIssuedAt` | Firestore Timestamp | Server issuance time |
| `stopsReached` | map keyed zero-based index | Ordered server evidence |
| `stopsReached.{i}` | `{stopIndex,stopId,stopName,timestamp,evidence?}` | Stop evidence; new `evidence` is `gnss_progress` or `recovered_checkpoint`, whose timestamp denotes repair time rather than original arrival |
| `automaticTurnaround`, `previousSessionId` | boolean / string | Present on an automatically armed opposite-direction session |
| `path` | legacy map/array | Older history tolerated/read/deleted; no current per-fix writes |

Admin and the assigned session driver can read. All client writes are denied. The assigned driver obtains the session code from the authenticated API; a passenger presents that code plus a fresh near-bus position to the join endpoint, which validates boarding and alighting stops in the session's travel order and writes the manifest transactionally.

#### `ride_sessions/{sessionId}/messages/{messageId}`

Fields: `text` (1–500), `from` (`driver|passenger`), `senderName` (1–100), `senderId` (auth UID), `requestHash` (server idempotency fingerprint), and `timestamp` (server time). Session operator/admin and registered session passengers read; all client writes are denied. The active-session message endpoint derives identity, keys each document from UID plus `requestId`, and writes message/rate state atomically. Admin API can recursively clear messages.

#### `ride_sessions/{sessionId}/messageRateLimits/{uid}`

Fields: `userId`, `sentAt: Timestamp[]` (bounded rolling history), `lastSentAt`. The backend advances the message and rate record in one transaction after rechecking live session membership. Minimum gap is three seconds and maximum is 60/hour. Owner/member reads are allowed; all client writes are denied.

### `completed_trips/{sessionId}`

Fields: `busId`, `driverId`, `routeId`, `direction`, `originStopId`, `destinationStopId`, `completedAt` (ISO string), `automaticTurnaroundEligibleAt` (epoch ms), `stopCount`, direction-ordered `stopNames[]`, `sessionId`. The worker writes/merges at the session destination. Admin reads; client writes denied. This is a compact analytics projection used for forward/reverse completion counts; `ride_sessions` remains the detailed record.

### `feedbacks/{feedbackId}`

Fields: `userId`, server-derived `userName`, `type` (`general|ride`), nullable `sessionId/busId/driverId/rating`, `comment` (≤2000 characters and 200 words), `requestHash`, `timestamp`, `status` (`new|reviewed|resolved`), and optional review audit fields. All client writes are denied. The idempotent feedback endpoint checks completed-session passenger eligibility and cooldown in the write transaction. Admin review uses `GET /api/v2/feedback` (latest 200 records, no-store) and a status PATCH; the browser does not attach a direct feedback listener. The admin status endpoint changes review state. Retention/server privacy can delete.

### `feedbackCooldowns/{uid}`

`userId` and `lastSubmittedAt`. Read and advanced inside the same server transaction as feedback, preventing concurrent cooldown bypass; one submission per 24 hours. Owner reads; all client writes are denied.

### `settings/global`

Fields: `serviceStartTime`, `noBusesMessage`, `noBusesSubMessage`, `announcementText`, `announcementActive`, `updatedAt`, and `updatedBy`. Authenticated users read through one auth-ready shared snapshot listener. All client writes are denied; the admin settings endpoint validates bounded partial updates. Defaults are applied locally when fields/document are absent.

## Firestore backend-only collections

These have no matching allow rule and are therefore client-denied.

### `devices/{deviceId}`

Fields: `deviceId`, `busId`, `routeId`, `enabled`, `secretHash` (`32-hex-salt:128-hex-scrypt-key`), `credentialRotatedAt`, `updatedAt`, optional `disabledAt`. Plain `secret` is explicitly deleted on provisioning. Exactly one device may own a bus/route assignment; active ride/lock guards prevent unsafe rotation/reassignment.

### `active_rides/{busId}_{routeId}`

Minimal recovery state: `sessionId`, `busId`, `routeId`, `driverId`, `direction`, `originStopId`, `destinationStopId`, `status: active`, `tripState`, direction-ordered `currentStopIndex`, `hasDepartedOrigin`, `delayMinutes`, optional `automaticTurnaround`/`previousSessionId`, and `updatedAt`. No coordinate history. Recovery reads this projection, its bus lock and non-terminal session in one Firestore transaction. Telemetry and the leader's initial/completed RTDB snapshots restore missing lifecycle fields. A completed predecessor can be replaced only by its own durable automatic return, with a matching claim when present; unrelated or newer live sessions and terminal durable sessions are protected. Recovery reuses the claimed session ID, clears old completion/claim and match/reroute context, preserves newer raw telemetry and same-session delays, and leaves completed history/locks untouched. A newly observed claim bypasses the earlier no-ride miss cache; claimed misses retry after 1s rather than 30s. Completion/reconciliation deletes only a matching session.

### `_active_bus_locks/{busId}`

Unique active-session constraint: `busId`, `routeId`, `driverId`, `sessionId`, `direction`, optional `automaticTurnaround`, `createdAt`, `updatedAt`. Created in the same Firestore transaction as the pending/automatically armed session; repaired on idempotent resume; conditionally released on conflict, completion or abandonment. Together with the short RTDB turnaround claim it closes same-bus and cross-replica races.

### `_worker_leases/{leaseName}`

The coordinator uses `_worker_leases/trip-state-worker`: unique process `ownerId`, persistent integer `generation`, `renewedAt` and `expiresAt` Firestore timestamps. Acquisition increments the generation; renewal retains it; release sets `ownerId:null` and an expired timestamp without deleting the generation. Worker durable writes validate the lease within their transaction. Independent monotonic expiry also stops admission during hung renewal. See [worker leadership](../operations/WORKER_LEADERSHIP.md) for the 2-second skew allowance and limits of fencing RTDB/Auth/recursive deletion.

### `_privacy_deletion_requests/{uid}`

Server-only `status` (`pending|processing|failed`), lifetime `attempts`, consecutive `failures`, `nextAttemptAt`, `generation`, `executorId`, `deadlineAt`, `phase` (`cleaning|auth_deletion_dispatched`), original `requestedAt`, `updatedAt`, last attempt/error timestamps and fixed `lastErrorCode`. `targetCreatedAt` binds the current Auth account identity. Resubmission adds `resubmittedAt/resubmissions` without clearing history; admin recovery adds `recoveredBy/recoveredAt/recoveries/executorStopped`, increments generation and resets only the failure cycle. Successful cleanup removes the record. The privacy worker cursor is `_reconciliation_cursors/privacy-deletions`. Shared fleet mutex records can carry `privacyRequestId`, and lock recovery audits its linked status. See [privacy deletion](../operations/PRIVACY_DELETION.md) for bounds and limits.

### `_retention_deletion_jobs/{sessionId}`

Backend-only retry reference with `requestedAt` (Firestore Timestamp). The session ID is the document ID; the worker always derives the fixed `ride_sessions/{sessionId}` target itself. It commits this job before a terminal ride's recursive deletion and removes it only after every descendant is deleted. Startup/daily retention sweeps replay pending jobs even when the parent ride was already removed by a partial failure. The default-deny client rules cover this internal collection. Jobs are removed on successful cleanup, not aged out while child records remain.

### `_ride_history_deletion_jobs/{sessionId}`

Independent backend-only retry reference with `requestedAt` for an Admin-requested terminal history deletion. This job remains until both recursive session cleanup and all matching completed-trip projections are removed. The manual endpoint and startup/daily retention worker can resume it even without the ride parent. It is kept separate from age-based deletion jobs so concurrent manual/retention requests cannot acknowledge each other's incomplete projection cleanup. Ongoing session status is rechecked before each attempt; client access is denied by the default rules.

### `_fleet_operations/{operationId}`

Server-only legacy/admin fleet audit: method, path, admin UID, pending/completed/failed status, created/completed timestamps and bounded batch/count/cursor progress. Persisted before mutation; it does not provide durable HTTP replay. Existing operational retention applies.

### `_route_save_operations/{saveId}`

Server-only route-save coordination record. It binds a stable `saveId` to `routeId` and an exact payload hash, with `processing|succeeded|failed` status, a bounded cross-replica lease/owner, attempt count, timestamps, and a replayable result or structured failure. A different payload cannot reuse the ID. The final transaction writes the versioned route and successful operation together, allowing timeout-after-commit reconciliation without a duplicate Google request or stale overwrite.

### `_route_geometry_previews/{operationId}` / `_fleet_reconciliation_jobs/{operationId}`

Server-only payload hash, admin UID, `processing|succeeded|failed` status, unique
process `executorId`, positive `generation`, wall-clock `deadlineAt`, timestamps,
and redacted replay outcome. Phase/progress checkpoints identify the current
bounded fleet batch without exposing Auth UIDs. Expired status reads persist
`recovery_required`; processing records have no terminal-retention timestamp.
Operator abandonment requires a verified stopped executor and exact generation;
it writes a failed unknown outcome, generation bump and internal `recoveredBy`
audit. No automatic billable/Auth replay. Legacy claims use identity `legacy`/0.

### `_fleet_reconciliation_locks/singleton` / `_fleet_lock_recoveries/{id}`

The singleton has `owner`, process `executorId`, optional linked `operationId`
and creation timestamp. Legacy, periodic and operation reconciliation share it;
there is no expiry takeover of dispatched Auth work. Recovery atomically audits
that owner, operation, executor, stopped-executor attestation, admin UID and
`recoveredAt`, then deletes only the matching singleton. Linked processing jobs
must first be recovered; local unsettled work is refused. Recovery logs follow
`OPERATION_LOG_RETENTION_DAYS` from `recoveredAt`; retention never removes a lock.
See the [operator recovery runbook](../api/OPERATION_RESOURCES.md).

### `_health/*`

Read-only probe target. The server issues a bounded `limit(1)` every 30 seconds and caches readiness; `/health` does not issue a Firebase read per request. No application data is required here.

### `_device_diagnostics/{deviceId}`

Server-only latest health report received through device-authenticated HTTPS. It contains the registry `deviceId`/`busId`/`routeId`, firmware version, uptime, free heap, RSSI, bounded telemetry/queue/UART/reset counters, current fault, reported flash-encryption/Secure-Boot state, device timestamp, and server `receivedAt`. Each accepted report replaces the prior one; this is operational state, not an unbounded event history. Browser Firebase rules deny all access. Admins read it through `GET /api/devices/:deviceId/diagnostics`; credentials, SSIDs, and CA content are never accepted.

### `_deviceRateLimits/{deviceId}` and `_deviceCredentialVersions/{deviceId}`

Server-only ingress controls. `_deviceRateLimits` stores the number of tokens
reserved from each shared fixed-window budget. Replicas consume their small
leases in memory, which amortizes RTDB transactions while ensuring total issued
tokens never exceed the configured per-device limit. Unused leased tokens may
reduce capacity only until that minute window expires. `_deviceCredentialVersions`
changes whenever a device is disabled, reassigned, or re-provisioned; every
backend replica listens for those changes and immediately evicts matching
credential-cache entries. Browser rules deny all reads and writes.

## Relationships and deletion

- Changing/deleting a route or bus is blocked while `active_rides` (and for buses, `_active_bus_locks`) references it. Route edit/delete checks and the route write/delete share a transaction so a concurrent ride start cannot slip between the guard and mutation. Bound devices must be reassigned first.
- A device assignment must match `buses.assignedRoutes` and an existing route.
- Driver API authority requires agreement among Auth claims, `drivers`, `buses`, and the requested bus/route.
- Terminal history deletion recursively removes the ride session/subcollections and all matching `completed_trips`; active states return 409.
- Privacy deletion removes one user's profile, feedback/cooldown/request, session passenger entries/messages, and Auth account while leaving non-personal operational ride facts according to policy.
- Retention defaults: terminal sessions 180 days after `endTime`, feedback 180, completed projections 180 days after `completedAt`, fleet operation logs 90. Session deletion recursively removes passenger/message subcollections. The daily sweep deletes records strictly older than the cutoff, so removal occurs on the next successful sweep after day 180. Production startup requires `RETENTION_SWEEPER_ENABLED=true`; development and tests remain non-destructive when omitted. Deployment overrides must agree with the approved schedule.

## Indexes

`firestore.indexes.json` is authoritative. It includes composites for terminal session retention (`status` + `endTime` + document ID), time-ordered feedback/completed/operation deletion, ride-history ordering/filters, and collection-group queries used for privacy cleanup. Deploy rules and indexes together; missing indexes surface as query errors rather than silently changing results.

## Timestamp and ID conventions

- External IDs use `[A-Za-z0-9_-]{1,128}`. Human strings have explicit length bounds.
- Hardware measurement: epoch milliseconds in `timestamp`.
- RTDB receipt/lifecycle: server epoch milliseconds.
- Firestore operational writes: `FieldValue.serverTimestamp()`/`Timestamp`.
- Some legacy/history summaries use ISO strings or epoch milliseconds; normalizers accept documented variants.
- Never infer IDs by splitting composite keys; use stored fields.

### `_reconciliation_cursors/{scan}`

Server-only stable document-ID continuation for `abandoned-sessions` and `fleet-authorizations`: `cursor` is a string or null after a completed cycle, with `updatedAt`. A lease-valid transaction advances it only after a settled page; restart resumes the saved page. Pages contain at most 100 records. This is not a whole-collection snapshot. Fleet operation progress adds the last settled cursor; `_fleet_operations` stores bounded per-batch driver IDs/counts/cursor, and the shared singleton mutex can carry `auditOperationId` for crashed legacy/admin mutation audit. See [reconciliation](../operations/RECONCILIATION.md).
