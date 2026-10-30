# Telemetry Route Catalog

| Document ID | Version | Status | Last updated |
|---|---|---|---|
| EKI-OPS-019 | 1.0 | Current | 2026-10-30 |

## 1. Purpose

Route matching, direction inference and rerouting need each route's stops and directional geometry for every accepted fix. This document describes the read-only, versioned in-memory catalog that supplies that data on every backend replica, and how it stays current when an administrator edits or deletes a route.

## 2. Scope

The document covers the catalog cache, the Firestore route watcher, generation fencing and the handling of routes without valid geometry. Passenger geometry reads and admin geometry repair are described in [route geometry reads](ROUTE_GEOMETRY_READS.md). Provider rerouting is described in the [reroute retry policy](REROUTE_RETRY_POLICY.md).

## 3. Behaviour

### 3.1 Catalog entries

Every replica starts one Firestore watcher on the `routes` collection. The watcher decodes each changed document and publishes an entry directly from the snapshot: forward and reverse geometry, stops, configuration version, geometry version and a fingerprint of those values. Unchanged fixes, including fixes whose direction is still pending, reuse the entry instead of reading the document again.

An entry is usable only when both directional polylines decode to at least two points and the route has at least two stops. Otherwise the route is cached as unavailable (a negative entry).

### 3.2 Freshness

Each entry expires 5 min after it was stored, measured on the monotonic clock. A missing or expired entry triggers one point read per route; concurrent callers share it. If that read finds a different fingerprint from the cached entry, the route is invalidated, which also covers a watcher event that never arrived. The catalog and the generation table each keep at most 1,000 routes in least-recently-used order.

### 3.3 Edits, deletions and watcher failure

- An observed edit or deletion increments the route's local generation and immediately publishes the new entry or a negative entry. It also clears that route's passenger geometry cache entry and the whole route list cache.
- Generations are unique within the process, so an evicted route cannot revive work started under an old generation. Cleanup of an in-flight read compares the promise identity before removing a newer fill.
- When the watcher fails, every entry and in-flight read is invalidated and later fixes use point reads until it reconnects. Reconnection waits 1 s, doubling to 30 s. Callbacks from an older subscription are ignored, and the first snapshot after reconnecting removes entries for routes that no longer exist.

The watcher keeps a listener on the whole collection, so snapshot reads are still billed.

### 3.4 Fencing work in progress

Direction, matching and reroute callbacks recheck the route's local generation before they write. A durable session-direction transaction also reads the current route document and compares its versions and stop signature before writing session and lock fields. When it refuses definitively, it resets only the same still-provisional, pre-departure RTDB projection, so newer telemetry, sessions and directions survive. An unknown commit result never triggers that reset: a later fix reconciles the committed direction. An active ride keeps its direction; a moving session is not re-inferred.

RTDB transactions that first see an empty local cache retry against the server value and then apply the usual timestamp, session and version checks. Reroute publication rechecks the generation after writing the geometry sibling node, so an edit observed meanwhile prevents the old pointer from being published. A sibling written but not published stays unreferenced until [RTDB retention](RTDB_RETENTION.md) removes it.

### 3.5 Routes without valid geometry

Loading the catalog never calls Google and never writes a repair. A route without valid directional geometry is cached as unavailable. Accepted raw telemetry and lifecycle data are still stored, but matching and direction inference are unavailable for that route until an administrator saves it, which computes the missing geometry; see [route geometry reads](ROUTE_GEOMETRY_READS.md).

## 4. Configuration

None of these values is configurable at run time.

| Item | Value | Source |
|---|---|---|
| Entry lifetime | 5 min, monotonic | `backend/src/services/telemetryRouteService.ts:54` |
| Catalog and generation table size | 1,000 routes each, least recently used | `backend/src/services/telemetryRouteService.ts:97`, `backend/src/services/telemetryRouteService.ts:101` |
| Watcher reconnect delay | 1 s, doubling to 30 s | `backend/src/services/telemetryRouteService.ts:213` |
| Largest accepted encoded polyline | 500,000 characters | `backend/src/services/telemetryRouteService.ts:57` |
| Watcher start | Every replica at boot | `backend/src/server.ts:307` |

## 5. Failure modes and recovery

| Condition | Effect | Action |
|---|---|---|
| Watcher error | Catalog cleared; point reads for every route until reconnect. | The log shows `Catalog watcher failed; freshness reads are required.` Check Firestore availability; reconnection is automatic. |
| Replica misses an edit event | Old data is served until the entry expires (at most 5 min) or a freshness read sees a new fingerprint. | None. Edits are not atomic across replicas. |
| Route lacks valid geometry | Matching and direction inference stop for that route; telemetry is still stored. | Repair the route with an admin save. |

## 6. Verification

| Behaviour | Tests |
|---|---|
| Watcher publication, freshness coalescing, old subscription callbacks, transaction retry fences | `backend/src/services/telemetryRouteCatalog.test.ts` |
| An edit during reroute publication discards the new pointer | `backend/src/services/liveRouting.integration.test.ts` (mocked Firebase) |
| 60 pending fixes with no extra route reads or Google calls, edit and delete propagation, a held watcher event refused at commit, and a lost commit acknowledgement recovered without rollback, against emulators | `backend/src/telemetryCatalog.integration.test.ts`, run by `npm run test:rules` |

These tests use synthetic coordinates and providers. Edit propagation delay, snapshot billing, replica load and moving-route ordering need staging measurements.
