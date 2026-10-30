# Live Reroute Retry Policy

| Document ID | Version | Status | Last updated |
|---|---|---|---|
| EKI-OPS-018 | 1.0 | Current | 2026-10-30 |

## 1. Purpose

When a bus is confirmed off its route, the backend asks Google Routes for new geometry from the bus to the remaining stops. This document describes how the backend limits those billable requests after failures, per ride and per process.

## 2. Scope

The document covers the per-ride backoff stored in RTDB, the process-wide provider circuit, recovery of lost claims, and the checks on returned geometry. The departure route (bus to the first stop), switched by `LIVE_DEPARTURE_ROUTES_ENABLED` (default `true`), uses the same queue and circuit and is attempted at most three times per ride context. How a bus becomes `OFF_ROUTE` is described in [tracking algorithms](../design/TRACKING_ALGORITHMS.md). Admin route computation uses a separate pool, described in [route geometry reads](ROUTE_GEOMETRY_READS.md).

## 3. Behaviour

### 3.1 Trigger

Only a fresh accepted fix can start a reroute. There are no retry timers, old positions are never replayed, and ingestion never waits for routing. At most two reroutes run at once per process (Section 4); for each ride only the newest pending fix is kept.

### 3.2 Per-ride backoff

Each active ride stores `rerouteRetry` in its live record: a context fingerprint, the consecutive attempt count `failures`, and `nextAttemptAt` in server milliseconds. The fingerprint covers the session, direction, live route version, route configuration version and geometry signature.

The claim transaction moves the ride from `OFF_ROUTE` to `REROUTING` and reserves the next delay before the provider call, so a lost failure write or a restart cannot shorten it. A failed request extends the delay from its completion time. The jitter value is chosen once, outside the transaction callback, because RTDB can rerun the callback.

The delay uses equal jitter: a random value between half and all of an exponential ceiling.

| Consecutive failures | Delay before the next attempt |
|---|---|
| 1 | 5 to 10 s |
| 2 | 10 to 20 s |
| 3 | 20 to 40 s |
| 4 | 40 to 80 s |
| 5 | 80 to 160 s |
| 6 or more | 150 to 300 s |

The count saturates at 32. Telemetry keeps updating during the backoff, and the backoff survives process restarts and is shared by all replicas because it lives in RTDB.

These events clear `rerouteRetry`: a published reroute, a confident return to the route, and a change of session, direction or route geometry. A queued request carries its expected session, so a replacement session cannot inherit it even when the route version matches. Request ID, session, version, active status and direction are rechecked before a failure or success is written.

### 3.3 Provider circuit

A process-wide circuit opens after five consecutive failed provider operations. The first pause is 30 to 60 s. While open, requests are rejected without a provider call. After the pause one probe may run; success closes the circuit and a failure doubles the pause, up to 150 to 300 s. A late response from an earlier circuit generation cannot close a newer one.

A rejected RTDB claim, an invalid itinerary and a geometry publication error do not count as provider failures. Calls already dispatched may finish after the circuit opens. The circuit is local to each replica and resets on restart: it is a failure budget, not a global billing quota. One operation can contain several provider calls for a long itinerary.

### 3.4 Lost claims

A `REROUTING` claim whose `lastRerouteAttemptAt` is missing or more than 60 s old is treated as lost, for example after a replica restarted between claim and release. The next accepted fix evaluates the ride as `OFF_ROUTE`, so a ride that is still off route can claim a new request, subject to the backoff and the circuit. A late result from the lost request fails its request-ID check.

### 3.5 Geometry checks

The backend publishes provider geometry only when it decodes to at least two points and, for a deviation reroute, the triggering fix matches it within the 45 m route match distance. Otherwise the request is released as failed under the ride backoff, although the provider call counts as a success for the circuit. Without this check, geometry that did not start at the bus would be published, the next fix would be off route again, and because publication clears the backoff, every fix would dispatch a new billable request. If stop progress changes while the request is in flight, the result is not published and the ride retries the current itinerary under the same backoff.

## 4. Configuration

None of these values is configurable at run time.

| Item | Value | Source |
|---|---|---|
| Backoff base and maximum | 10 s ceiling after the first failure, 300 s maximum | `backend/src/services/rerouteRetry.ts:1`, `backend/src/services/rerouteRetry.ts:2` |
| Equal jitter | 50 % to 100 % of the ceiling | `backend/src/services/rerouteRetry.ts:12` |
| Failure count cap | 32 | `backend/src/services/rerouteRetry.ts:18` |
| Circuit threshold and pause | 5 failures; 60 s ceiling doubling to 300 s, 50 % to 100 % jitter | `backend/src/services/rerouteRetry.ts:47`, `backend/src/services/rerouteRetry.ts:49` |
| Lost claim age | 60 s | `backend/src/services/telemetryRouteService.ts:288` |
| Route match distance for publication | 45 m | `backend/src/services/routeMatching.ts:8` |
| Reroute queue | 2 active, 64 waiting rides, newest fix per ride | `backend/src/services/telemetryRouteService.ts:1335` |
| Provider timeout per live request | 3.5 s | `backend/src/lib/googleMaps.ts:24` |

## 5. Failure modes and recovery

| Symptom | Where to look | Action |
|---|---|---|
| Rides stay `OFF_ROUTE` without new geometry | `telemetry.routeProcessing.rerouting.provider` in admin health: `failures`, `rejected`, `probing`, `retryAfterMs` | Check the Google Routes key, quota and status. A restored provider is probed on the next eligible fix after both the ride backoff and the circuit pause. |
| Rerouting errors in background failures | `backgroundTasks.sources` entry `devices.rerouting` | Inspect the backend log for the request. |
| A ride stuck in `REROUTING` | `lastRerouteAttemptAt` on the live record | None: after 60 s the next fix treats the claim as lost. |

Changing a ride does not bypass an open circuit.

## 6. Verification

| Behaviour | Tests |
|---|---|
| Backoff values, jitter, caps and circuit states | `backend/src/services/rerouteRetry.test.ts` |
| A minute of provider failures dispatches three requests instead of twelve; restart persistence; clearing on success, recovery, edits and direction change; one recovery probe; session boundaries; lost claims; rejected geometry | `backend/src/services/rerouteBackoff.integration.test.ts` |
| Reroute context and claim checks | `backend/src/services/telemetryRouteService.test.ts`, `backend/src/lib/liveRouteContext.test.ts` |

Run them from `backend/`:

```powershell
npx vitest run src/services/rerouteRetry.test.ts src/services/rerouteBackoff.integration.test.ts src/services/telemetryRouteService.test.ts src/lib/liveRouteContext.test.ts
```

These tests run the real matcher and scheduler with mocked Firebase and provider dependencies. They make no provider calls and are not a production cost estimate.
