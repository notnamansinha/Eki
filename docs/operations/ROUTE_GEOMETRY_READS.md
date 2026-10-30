# Route Geometry Reads and Repair

| Document ID | Version | Status | Last updated |
|---|---|---|---|
| EKI-OPS-020 | 1.0 | Current | 2026-10-30 |

## 1. Purpose

This document describes the read-only endpoint that serves stored directional route geometry to signed-in users, its cache, and the administrator procedure that repairs a route whose stored geometry is missing or invalid.

## 2. Scope

The document covers `GET /api/routes/{routeId}/geometry`, the shared admin route computation pool and geometry repair through a route save. The in-memory catalog used by telemetry matching is described in [the telemetry route catalog](ROUTE_CATALOG.md). Per-user request budgets are listed in the [security architecture](../security/SECURITY_ARCHITECTURE.md#7-rate-limiting-and-abuse-controls).

## 3. Behaviour

### 3.1 Read endpoint

`GET /api/routes/{routeId}/geometry` requires a signed-in user and returns the stored forward and reverse polylines with their distances, durations, `configVersion` and `geometryVersion`. It never calls Google, never starts a repair and never writes Firestore, including when the caller is an administrator. Responses set `Cache-Control: private, no-store`, and only the listed geometry fields are returned.

| Condition | Response |
|---|---|
| Invalid route ID | 400 |
| Route document missing | 404 |
| Stops have no usable coordinates | 422 |
| Geometry missing, invalid or of an older quality | 409 `GEOMETRY_REPAIR_REQUIRED` |
| Read capacity full, deadline passed, read invalidated or Firestore read failed | 503 `GEOMETRY_READ_UNAVAILABLE` with `Retry-After: 1` |

When neither the route document nor this endpoint supplies valid geometry, live maps draw no road overlay for the route; they never substitute straight lines between stops. Accepted telemetry is unaffected.

### 3.2 Cache

Each process caches at most 100 route documents, including missing ones, for 60 s of monotonic time. Concurrent misses share one read per route. Up to 16 distinct reads run at once with up to 32 callers each, and a caller waits at most 3 s. A read that times out keeps its slot until it settles and cannot fill the cache late.

A route watcher edit or deletion, a watcher failure or stop, and a successful save or delete on this replica invalidate the entry; an in-flight read that is invalidated returns 503. A replica that has not yet seen an edit serves the old document until its entry expires, so freshness across replicas is bounded by 60 s, not guaranteed.

`GET` and `HEAD` count against the per-user read budget and skip the route computation budget, so geometry reads cannot use up an administrator's computation quota.

### 3.3 Admin route computation pool

Route saves, legacy admin previews and durable geometry previews share one computation pool per process: 2 running pipelines, 8 waiting, and a 2 s limit on how long a pipeline may wait before it starts. A preview is one pipeline; a route save runs one pipeline per direction, so a single save can occupy both running slots. A pipeline splits the stops into chunks of at most 27 points (origin, 25 intermediates and destination) and requests all chunks in parallel; a route of at most 100 stops therefore needs at most four chunks, so the pool runs at most eight upstream requests. Each chunk request is aborted after 10 s. A dispatched pipeline keeps its slot until every chunk has settled, even after the queue limit or an abort. A full pool or an expired wait returns 503 `ROUTING_CAPACITY_EXHAUSTED` with `Retry-After: 1`. Live rerouting uses its own queue; see the [reroute retry policy](REROUTE_RETRY_POLICY.md).

## 4. Configuration

None of these values is configurable at run time, except `GOOGLE_MAPS_API_KEY`, without which computation returns 503 `ROUTING_NOT_CONFIGURED`.

| Item | Value | Source |
|---|---|---|
| Geometry document cache | 100 documents, 60 s | `backend/src/services/routeGeometryReads.ts:9`, `backend/src/services/routeGeometryReads.ts:24` |
| Geometry read single flight | 16 reads, 32 callers each, 3 s | `backend/src/services/routeGeometryReads.ts:10` |
| Computation pool | 2 running, 8 waiting, 2 s queue limit | `backend/src/routes/polyline.ts:46` |
| Points per provider request | 27 | `backend/src/lib/orderedRouteGeometry.ts:4` |
| Stops per route | 100 | `backend/src/lib/orderedRouteGeometry.ts:3` |
| Chunk request timeout | 10 s | `backend/src/routes/polyline.ts:214` |
| Route computation budget | 10 per minute per verified user, divided by `RATE_LIMIT_SHARD_FACTOR`; `GET` and `HEAD` skipped | `backend/src/lib/routeComputeLimiter.ts:9` |

## 5. Repairing a route

Perform this procedure as an administrator when a read returns 409 `GEOMETRY_REPAIR_REQUIRED`.

1. In the admin **Routes** tab, open the route in the editor. Keep its name, colour and ordered stops unless they need to change.
   Expected result: the editor shows the current stops.
2. Save the route. The editor sends `PUT /api/routes/{routeId}` with `mode`, the current `expectedVersion` (`0` for a route that has no version) and a stable `saveId`. `PUT /api/v2/routes/{routeId}` accepts the same body.
   Expected result: the backend computes geometry for both directions (or reuses valid stored geometry when the stops did not change), and the response reports the new configuration and geometry versions.
3. If the outcome is unknown (timeout or lost response), the editor reconciles the same `saveId` through `GET /api/routes/{routeId}/save-operations/{saveId}`. A stale `expectedVersion` or an active ride on the route rejects the save; reload the route instead of overwriting newer data.
   Expected result: the operation reports completed, or a definite error.
4. Read `GET /api/routes/{routeId}/geometry` again.
   Expected result: 200 with the new `geometryVersion`. Viewers receive it without another provider request.

A provider request that was already dispatched cannot be recalled.

## 6. Verification

| Behaviour | Tests |
|---|---|
| Cache bounds, negative caching, invalidation, monotonic freshness, eviction | `backend/src/services/routeGeometryReads.test.ts` |
| Read-only responses with no provider calls or writes, versioned repair, stalled-provider pool bounds | `backend/src/routes/polyline.test.ts` |
| Geometry reads cannot consume the computation budget | `backend/src/lib/routeComputeLimiter.test.ts` |
| Coalesced reads and watcher invalidation against the Firestore emulator | `backend/src/telemetryCatalog.integration.test.ts`, run by `npm run test:rules` |

Provider road correctness, propagation across real replicas, fleet budget tuning and moving-route latency need staging or field evidence. No route is migrated automatically.
