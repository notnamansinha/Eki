# API Read Caching and Compatibility Retirement

| Document ID | Version | Status | Last updated |
|---|---|---|---|
| EKI-OPS-012 | 1.0 | Current | 2026-10-30 |

## 1. Purpose

This document describes how the backend bounds and caches its list, lookup and analytics reads, and how it records legacy and v2 traffic so that an operator can decide when a legacy endpoint may be retired.

## 2. Scope

The document covers fleet analytics, the route catalog, live bus lists and lookups, ride-session reads and the compatibility traffic counters. Stored route geometry reads have their own cache, described in [route geometry reads](ROUTE_GEOMETRY_READS.md). The retirement policy is defined in the [API resource migration plan](../../backend/API_RESOURCE_MIGRATION.md) and the [HTTP contract](../api/HTTP_CONTRACT.md).

## 3. Behaviour

### 3.1 Caching rules

- Every cache is private to one backend process. Replicas do not share entries.
- Authentication and role checks run before each handler, including on a cache hit. The backend never caches a principal, membership, assignment or session authorization decision across requests.
- Every response sets `Cache-Control: no-store`.
- Concurrent misses for the same key share one underlying read. A fill that fails, expires or is invalidated never publishes a cache entry.
- A cache keeps at most 16 entries. A result larger than 256 KiB is returned to the caller but not retained.
- Expiry uses monotonic time, so a wall-clock change cannot extend an entry.

### 3.2 Read endpoints

| Endpoint | Default response | Options | Cache TTL |
|---|---|---|---|
| `GET /api/analytics/fleet` (admin) | Counts from the first 1,000 `bus_locations` and the first 1,000 `completed_trips` documents, reading only the counted fields. `statistics.sampled` is `true` and `sampleLimit` is `1000`. | `?scope=all` runs native count queries instead (Section 3.3). | 10 s |
| `GET /api/routes-list` and `GET /api/v2/routes` | First 250 routes in document-ID order with `id`, `name`, `color` and `stops`, plus `nextCursor`. | `limit` (1 to 250) and `after` (route ID). | 5 s |
| `GET /api/buses` | Without query parameters: every public live bus in one response. | Any parameter switches to pages: `routeId`, `limit` (1 to 250) and `after` (RTDB key). | 1 s |
| `GET /api/buses/{busId}` | One public live bus from an indexed `busId` query of at most 51 nodes, or 404 when no node is active. | None. | Not cached; concurrent requests share one read. |
| `GET /api/v2/ride-sessions/{sessionId}` | Admins and passenger members are authorized without operator checks. An operator's assignment documents are read on every request. | None. | Not cached. |
| `PATCH /api/v2/ride-sessions/{sessionId}` | The handler stages reuse one assignment check within the same request. The next request reads the assignment again. | None. | Not cached. |

### 3.3 Fleet analytics with `scope=all`

The backend runs seven Firestore count queries in one read-only transaction: all buses, active buses, buses with `deviceState` `offline` or `motionState` `uncertain` (an OR filter, so a bus with both counts once), completed trips, forward trips, reverse trips, and active buses in `in_service`. Trips without a valid direction are reported as `unresolved = total - forward - reverse`. The response sets `sampled: false` and `sampleLimit: null`.

The aggregation writes nothing, so a retry cannot double count. The counts describe records currently stored: trips removed by retention, privacy deletion or history deletion are not counted. Firestore bills count queries by index entries read, not by documents returned [1], [2].

### 3.4 Pages and invalidation

Cursors are document IDs or RTDB keys. Each page returns at most `limit` records and reads one extra record to decide `nextCursor`. Pages are not a snapshot across requests: a record inserted before the cursor appears only when the caller starts again from the first page. Unknown, repeated or out-of-range query parameters return 400.

Route save and delete, and every change seen by the route watcher, call `invalidateRouteGeometryRead`, which also clears the route catalog cache. A fill that was in flight during an invalidation cannot restore the old value. A replica that missed a watcher event serves catalog data that is at most 5 s old.

### 3.5 Compatibility traffic

Middleware counts requests to a fixed list of operations: `catalog`, `route-save`, `route-save-status`, `route-preview`, `boarding`, `boarding-code`, `chat`, `route-geometry`, `plan`, `ride-history-delete`, `ride-messages-delete`, `shift-start`, `shift-delay`, `shift-stop`, `settings`, `feedback-status` and `privacy`. For each operation and generation (`legacy` or `v2`) it records the request count, the successful (2xx) count and the last-seen time. The device-disable pair (`POST /api/devices/{deviceId}/disable`, `PATCH /api/v2/devices/{deviceId}`) and the fleet reconciliation pair (`POST /api/fleet/reconcile`, `POST /api/v2/fleet-reconciliation-jobs`) are not in the list and are not counted.

Admin health (`GET /api/health`) exposes these counters as `telemetry.apiCompatibility` and the read caches as `telemetry.apiReads`. The OpenTelemetry counter `eki.api.compatibility.requests` carries only the labels `operation`, `generation` and `status_class`. No token, user, route, bus, session or raw URL is recorded. Other endpoints are visible through the HTTP server request metrics.

### 3.6 Current callers

| Caller | Endpoints | Generation |
|---|---|---|
| `frontend/src/lib/routeSaveClient.ts` | `PUT /api/routes/{routeId}`, `GET /api/routes/{routeId}/save-operations/{saveId}` | Legacy |
| `frontend/src/components/admin/RouteManagementPanel.tsx` | `DELETE /api/routes/{routeId}`, `GET /api/places/search` | Legacy only; no v2 form exists |
| `frontend/src/components/maps/DirectionsRoute.tsx` | `GET /api/routes/{routeId}/geometry` | Legacy only; no v2 form exists |
| `frontend/src/components/passenger/PassengerBoardingView.tsx` | `POST /api/sessions/{sessionId}/join` | Legacy |
| `frontend/src/components/shared/MessagingPanel.tsx` | `POST /api/sessions/{sessionId}/messages` | Legacy |
| `frontend/src/lib/joinedRideStatus.ts` | `GET /api/sessions/{sessionId}/status` | Legacy only; no v2 form exists |
| `frontend/src/hooks/useAuth.ts` | `POST /api/users/bootstrap` | Legacy only; no v2 form exists |
| `frontend/src/lib/telemetryTrace.ts` | `GET /api/health` (trace health export) | Not applicable |
| `frontend/src/components/admin/DashboardPanel.tsx` | `POST /api/v2/ride-sessions`; `PATCH /api/shifts/delay`, `POST /api/shifts/stop`, `POST /api/sessions/{sessionId}/boarding-code`, `DELETE /api/shifts/{sessionId}/messages` | v2 for ride start, legacy for the rest |
| `frontend/src/components/admin/RideHistoryPanel.tsx` | `DELETE /api/shifts/{sessionId}/history` | Legacy |
| `frontend/src/components/admin/FleetManagementPanel.tsx` | `PUT` and `DELETE` on `/api/fleet/...` | Legacy only |
| `frontend/src/hooks/useSettings.ts` | `PATCH /api/v2/settings/global` | v2 |
| `frontend/src/components/passenger/AccountTab.tsx` | `POST /api/v2/privacy-deletion-requests` | v2 |
| `frontend/src/lib/feedbackStore.ts` | None: feedback and its review status are written to Firestore directly | Not applicable |
| Firmware | `POST /api/devices/{deviceId}/telemetry`, diagnostics and firmware endpoints | Device API, outside the web migration |

No production frontend code calls the analytics, route catalog or bus list endpoints; the browser reads that data through Firebase SDK listeners. Unknown external clients may still call them, so they remain supported.

## 4. Configuration

None of these values is configurable at run time.

| Constant | Value | Source |
|---|---|---|
| Fills per cache, waiters per fill, caller deadline | 8, 32, 3 s | `backend/src/services/apiReadCache.ts:9` |
| Entries per cache | 16 (fleet analytics: 2) | `backend/src/services/apiReadCache.ts:7`, `backend/src/routes/analytics.ts:9` |
| Largest retained value | 256 KiB | `backend/src/services/apiReadCache.ts:26` |
| Fleet analytics TTL and sample size | 10 s, 1,000 documents | `backend/src/routes/analytics.ts:9`, `backend/src/routes/analytics.ts:37` |
| Route catalog TTL and default page | 5 s, 250 routes | `backend/src/services/apiReadCache.ts:35`, `backend/src/routes/routesList.ts:18` |
| Live bus list TTL and default page | 1 s, 250 buses | `backend/src/routes/buses.ts:9`, `backend/src/routes/buses.ts:25` |
| Bus lookup bound and TTL | 51 nodes, no TTL | `backend/src/routes/buses.ts:58`, `backend/src/routes/buses.ts:10` |
| Compatibility operation list | 17 operations | `backend/src/lib/apiCompatibilityTraffic.ts:6` |

## 5. Failure modes and recovery

| Condition | Response | Recovery |
|---|---|---|
| Fill or waiter capacity is full | 503 with `Retry-After: 1` | Retry after one second. |
| The underlying read exceeds the 3 s caller deadline | 503 with `Retry-After: 1` | Retry. The dispatched SDK read keeps its fill slot until it settles, so a stalled dependency reduces capacity until it returns. |
| The read was invalidated while in flight | 503 with `Retry-After: 1` | Retry after the edit settles. |
| Any other read failure | 500 | Inspect the backend log. |
| `scope=all` over a very large history | The count query can be slow or time out. | Use the sampled default, or run the query outside peak load. |

Counters reset when a process restarts and are not summed across replicas. An empty local counter is therefore not evidence that a legacy endpoint is unused. Aggregate the exported OpenTelemetry metric across replicas and over the whole retirement window before deciding.

## 6. Verification

| Behaviour | Tests |
|---|---|
| Cache bounds, single flight and invalidation races | `backend/src/services/apiReadCache.test.ts`, `backend/src/lib/boundedSingleFlight.test.ts` |
| Bus paging and lookup | `backend/src/routes/buses.test.ts` |
| Compatibility counters | `backend/src/lib/apiCompatibilityTraffic.test.ts` |
| Operator assignment read on every ride-session request and shared only between the stages of one request | `backend/src/routes/shifts.test.ts` |
| Count aggregation, catalog paging, alias parity, authorization on cache hits | `backend/src/apiReads.integration.test.ts`, run against the Firebase emulators by `npm run test:rules` |

The emulator suite uses a disposable project and synthetic credentials. It does not measure billed usage or cloud latency. Before relying on these caches in production, compare cache fills and hits, query counts, latency and project usage over the same window.

## 7. References

[1] Google, "Summarize data with aggregation queries," firebase.google.com/docs/firestore/query-data/aggregation-queries. Accessed: 2026-10-30.

[2] Google, "Understand Cloud Firestore billing," firebase.google.com/docs/firestore/pricing. Accessed: 2026-10-30.
