# Eki Storage Architecture

| Document ID | Version | Status | Last updated |
|---|---|---|---|
| EKI-DAT-002 | 2.0 | Current | 2026-10-30 |

## 1. Purpose

This document states which store holds which data, why, who writes and reads it, how the stores stay consistent, and when data is deleted. Field names, types and access rules for every path are in the [Firebase data model](FIREBASE_DATA_MODEL.md). Store locations are in the [architecture description](../design/ARCHITECTURE.md#51-environments).

## 2. Store responsibilities

| Store | Holds | Why this store | Writers |
|---|---|---|---|
| Realtime Database (RTDB) | The latest state of each bus on each route, browser projections of it, and internal counters | Pushes small, frequently changing values to many listeners at low cost; supports per-node transactions | Backend only |
| Cloud Firestore | Configuration, identities, ride sessions and history, recovery records, locks, messages, feedback, operation records | Multi-document transactions, queries, indexes and rule checks that read other documents | Backend; browsers write only feedback |
| Tracker memory and flash | Unsent fixes and one recovery checkpoint | Survives network outages and resets until the backend acknowledges a fix | Firmware |

RTDB keeps one current point per bus and route, not a coordinate history. Firestore receives lifecycle, stop, delay, session and presence changes, not every fix. The trackers hold no Firebase credentials.

## 3. Realtime Database

| Path | Contents | Read by |
|---|---|---|
| `activeBuses/{busId}_{routeId}` | Authoritative live record: raw fix, matched position, ride lifecycle fields, device presence ([EKI-ADR-003](../design/TELEMETRY_STATE_PARTITION_DECISION.md)) | Backend only |
| `publicRouteBuses/route:{routeId}/buses` | Allow-listed copy of each live record on the route | Any signed-in user; the `publicRouteBuses` root only by current administrators |
| `liveRouteCatalog/values` | Live service count per route | Any signed-in user |
| `clientProjectionStatus/public` | Readiness of the public projection | Any signed-in user |
| `activeRouteGeometry/{busId}_{routeId}/{version}` | Versioned departure and reroute geometry for an active ride | Any signed-in user |
| `_userAuthorization/{uid}` | Current authorization version and role, read by RTDB rules | Rules only |
| `driverRouteAssignments/{driverId}` | Routes of the operator's assigned bus | Backend only |
| `_deviceRateLimits`, `_deviceCredentialVersions` | Shared device rate budget; credential invalidation signals for every backend process | Backend only |

The root rule denies everything not listed. Legacy `users` and `messages` trees have no consumer in the current code; the RTDB retention sweep removes them only when `LEGACY_RTDB_RETIRED=true` ([RTDB retention](../operations/RTDB_RETENTION.md)).

## 4. Firestore

| Group | Collections | Purpose |
|---|---|---|
| Configuration | `routes`, `buses`, `drivers`, `settings` | Routes stored once from stop A to stop Z, fleet records, operator to bus assignment, global settings (`settings/global`) and passenger route schedules (`settings/passengerRoutes`: the approved route IDs and a time per stop, never a second copy of route names or stops). Signed-in users read routes, buses and settings; operators read their own record |
| Devices | `devices`, `_device_diagnostics` | Salted scrypt verifier and bus and route assignment per tracker; last diagnostics. Backend only |
| Identity | `users`, `_userAuthorization` | Profile and role; authorization version mirror read by rules |
| Ride state | `ride_sessions` with `messages`, `archivedMessages` and `messageRateLimits` | Durable ride record: status, direction, stops reached with evidence, passenger manifest, chat |
| Recovery and exclusion | `active_rides`, `_active_bus_locks`, `_ride_session_creation_keys`, `bus_locations` | Checkpoint to rebuild a live record; one non-terminal session per bus; idempotent ride creation; per-bus fleet state (last known location, automatic-start pause) |
| History | `completed_trips` | Compact record of each completed ride for analytics |
| Feedback | `feedbacks`, `feedbackCooldowns` | Passenger feedback, written by the browser in one transaction with its 24 h cooldown record |
| Operations | `_fleet_operations`, `_route_save_operations`, `_route_geometry_previews`, `_fleet_reconciliation_jobs`, `_fleet_reconciliation_locks`, `_fleet_lock_recoveries`, `_reconciliation_cursors`, `_worker_leases`, `_health` | Recoverable administrative operations, reconciliation progress, the worker lease, readiness probes |
| Deletion | `_privacy_deletion_requests`, `_retention_deletion_jobs`, `_ride_history_deletion_jobs` | Durable markers that let interrupted deletions resume |
| Legacy | `passenger_requests` | No current producer; administrators may update or delete existing records |

A catch-all rule denies every collection not explicitly matched. Collections whose names start with `_`, together with `devices` and `active_rides`, deny all client access.

## 5. Consistency between the stores

1. Ride creation takes the Firestore lock `_active_bus_locks/{busId}` and creates the session before it claims the RTDB record. If the RTDB claim loses to another session, one Firestore transaction marks the new session `failed` and releases its lock.
2. The lifecycle worker commits the checkpoint in `active_rides` and every newly reached stop in one Firestore transaction, then publishes the new stop index to RTDB. If the RTDB write fails, the next fix republishes it; Firestore never moves the stop index backwards.
3. Every lifecycle, completion and cleanup transaction compares the session ID, so late work for an ended ride cannot change a newer ride on the same bus.
4. When an accepted fix finds no ride on the live record, the backend checks `active_rides` and the session in the background and restores the lifecycle fields of a ride that is still open.
5. Completion writes `completed_trips`, completes the session and deletes the matching recovery record and lock in one transaction. A retried completion reuses the original completion time and leaves a replacement ride's lock untouched.
6. A recovered stop records when the missing history was repaired; Eki does not invent an arrival time. Stops crossed between two fixes share the observation time.

## 6. Retention and deletion

The retention sweep runs on the worker leader at start and every 24 h. Production startup fails unless `RETENTION_SWEEPER_ENABLED=true`; development and tests leave it off unless set. The periods below are defaults and need approval by the university's data owner.

| Data | Kept for | Removed by | Setting |
|---|---|---|---|
| `ride_sessions` in `completed`, `failed` or `interrupted` status, with all subcollections | 180 days after `endTime` | Retention sweep, recursive and resumable through `_retention_deletion_jobs` | `RIDE_SESSION_RETENTION_DAYS` |
| `completed_trips` | 180 days after `completedAt` | Retention sweep | `COMPLETED_TRIP_RETENTION_DAYS` |
| `feedbacks` | 180 days after `timestamp` | Retention sweep | `FEEDBACK_RETENTION_DAYS` |
| Operation records in `_fleet_operations`, `_route_save_operations`, `_route_geometry_previews`, `_fleet_reconciliation_jobs`, `_fleet_lock_recoveries` | 90 days after `createdAt`; after `completedAt` for previews and reconciliation jobs, `recoveredAt` for lock recoveries | Retention sweep | `OPERATION_LOG_RETENTION_DAYS` |
| Unreferenced `activeRouteGeometry` versions; legacy RTDB trees | 180 days | RTDB retention sweep | `LEGACY_RTDB_RETIRED` for legacy trees |
| `activeBuses` records without an active ride | Until no fix arrives for `BUS_STALE_MS` (300 s by default) | Stale sweep; a record with an active ride is marked offline instead | `BUS_STALE_MS` |
| `active_rides`, `_active_bus_locks` | Until the ride completes, ends early or is abandoned | Lifecycle worker, stop endpoint, abandoned-ride reconciler after 12 h without activity; never age-based retention | `ABANDONED_RIDE_THRESHOLD_HOURS` |
| `settings/passengerRoutes` | Until the next save replaces it. Entries for routes or stops deleted later stay in the document, and browsers skip them, until an administrator saves again | `PUT /api/v2/settings/passenger-routes`, full replacement; never age-based retention | None |

Two deletions are requested by people:

| Request | Effect | Procedure |
|---|---|---|
| Account deletion by a passenger | The worker deletes `users/{uid}`, `feedbackCooldowns/{uid}`, `passenger_requests/{uid}`, the account's `messageRateLimits` entries and the Firebase Authentication account. Feedback, ride manifests and messages stay until retention removes them | [Privacy deletion](../operations/PRIVACY_DELETION.md) |
| Ride history deletion by an administrator | Deletes a terminal session with its subcollections and every `completed_trips` record with its `sessionId`; an ongoing ride is refused; `_ride_history_deletion_jobs` keeps the deletion resumable | [API reference](../../backend/API.md) |

## 7. Tracker storage

The firmware keeps up to 100 unsent fixes in RTC memory, which survives warm resets and is validated against its checksum and configuration on boot. It also writes one encrypted, authenticated flash checkpoint at the first fix of each boot and then at most every 10 s, so a cold power loss can recover the latest committed fix but lose newer ones. After clock synchronization, fixes older than 55 s are dropped instead of replayed. Details are in [cold power recovery](../hardware/COLD_POWER_RECOVERY.md).
