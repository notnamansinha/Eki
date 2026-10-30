# Eki High-Level Design

| Document ID | Version | Status | Last updated |
|---|---|---|---|
| EKI-ARC-002 | 1.0 | Current | 2026-10-30 |

## 1. Introduction

This document describes how Eki is decomposed into subsystems, how the subsystems interact, how a ride moves through its states, who may do what, and how the system recovers from failures. It follows the design-description structure of IEEE 1016 [1].

The system context, containers, deployment, runtime flows, quality attributes and technology versions are in the [architecture description](ARCHITECTURE.md); read it first. Module-level detail is in the [low-level design](LOW_LEVEL_DESIGN.md). Map matching, rerouting, stop progression and liveness rules are in [tracking algorithms](TRACKING_ALGORITHMS.md).

## 2. Subsystem decomposition

Backend paths are relative to `backend/src/`, frontend paths to `frontend/src/`.

| Subsystem | Responsibilities | Main source | Does not |
|---|---|---|---|
| Tracker firmware | Read GNSS, reject stale or high-HDOP fixes, classify motion, queue and post telemetry, report diagnostics, apply signed firmware updates in the fleet build | `hardware/src/main.cpp`, `hardware/include/` | Choose its bus or route, hold Firebase credentials, decide stop progress |
| Device ingress | Validate the telemetry body, verify the device secret against the registry, apply the shared device rate limit, commit the fix to `activeBuses`, serve diagnostics and firmware release checks | `routes/devices.ts`, `services/deviceTelemetryService.ts`, `services/telemetryPayload.ts`, `services/deviceRateLimiter.ts` | Wait for map matching or ride admission before responding |
| Route processing | Match fixes to the directional route geometry, detect deviation, request traffic-aware departure routes and reroutes from the Routes API, publish versioned geometry | `services/telemetryRouteService.ts`, `services/routeMatching.ts`, `lib/googleMaps.ts` | Change stop progress or ride status |
| Ride sessions | Start, resume, stop and delay rides; admit automatic service from a qualified fix; restore live lifecycle fields from Firestore; boarding and ride messages | `services/rideSessionStart.ts`, `services/automaticServiceAdmission.ts`, `services/durableRideRecovery.ts`, `routes/shifts.ts`, `routes/sessions.ts` | Advance stops |
| Lifecycle worker | Evaluate each fix against the next expected stop, checkpoint progress, complete rides, arm return trips, mark silent buses offline, interrupt abandoned rides | `services/tripStateEngine.ts`, `services/tripStateReducer.ts`, `services/staleBusSweeper.ts`, `services/abandonedRideReconciler.ts` | Run in more than one process at a time |
| Public projection | Copy an allow-listed subset of each live record into route-scoped browser views and the live route catalog | `services/liveBusProjection.ts` | Expose anchors, claims, histories or device identifiers |
| Fleet and route administration | Buses, operators, devices, routes and settings; route geometry previews and saves as recoverable operations; fleet authorization reconciliation; place search | `routes/fleet.ts`, `routes/polyline.ts`, `routes/settings.ts`, `routes/places.ts`, `services/httpOperations.ts` | Edit a route while a ride uses it |
| Identity and authorization | Verify Firebase ID tokens with revocation checks, publish role claims with a rotating `authorizationVersion`, mirror it for database rules | `middleware/requireAuth.ts`, `middleware/requireAdmin.ts`, `services/authTokenVerifier.ts`, `services/userAuthorization.ts`, `syncRoleClaims.ts`, `firestore.rules`, `database.rules.json` | Accept a role stated by the browser |
| Data lifecycle | Retention sweeps, account deletion requests, administrator history deletion, each resumable after partial failure | `services/retentionSweeper.ts`, `services/rtdbRetention.ts`, `services/privacyDeletionWorker.ts`, `services/rideHistoryDeletion.ts` | Delete active rides or their locks |
| Coordination and health | Hold the worker lease and fence stale leaders, expose readiness and metrics, export OpenTelemetry data when configured | `services/workerCoordinator.ts`, `lib/workerFence.ts`, `lib/healthState.ts`, `lib/metrics.ts`, `instrumentation.ts` | Report readiness from a single failed background write |
| Web client | Passenger and administrator workspaces, live map, client-side ETA and liveness, direct feedback writes, service worker | `app/`, `components/`, `lib/liveBusStore.ts`, `lib/liveBusHealth.ts`, `lib/busEta.ts`, `lib/feedbackStore.ts`, `sw.js` | Write ride lifecycle or live state |

## 3. Interfaces between subsystems

| From | To | Mechanism | Contract |
|---|---|---|---|
| Tracker firmware | Device ingress | HTTPS `POST /api/devices/{deviceId}/telemetry` with `Authorization: Device <secret>` and a nine-field JSON body of at most 512 B; diagnostics and firmware endpoints under the same prefix | [Hardware telemetry](../hardware/HARDWARE_TELEMETRY.md), [API reference](../../backend/API.md) |
| Device ingress | Route processing | In-process scheduler keyed by bus and route that keeps one sample in flight and only the latest one pending | [Low-level design](LOW_LEVEL_DESIGN.md) |
| Device ingress | Ride sessions | In-process bounded executor for automatic admission and durable restore, run after the device response | [Automatic GNSS service](../operations/AUTOMATIC_GNSS_SERVICE.md) |
| Device ingress, route processing, ride sessions | Lifecycle worker, public projection | RTDB child events on `activeBuses/{busId}_{routeId}` | [Firebase data model](../data/FIREBASE_DATA_MODEL.md) |
| Ride sessions, lifecycle worker | Each other | Firestore transactions on `ride_sessions`, `active_rides`, `_active_bus_locks` and `bus_locations`, each guarded by the session ID | [Storage architecture](../data/STORAGE_ARCHITECTURE.md) |
| Public projection, route processing | Web client | RTDB `publicRouteBuses/route:{routeId}/buses`, `liveRouteCatalog/values`, `clientProjectionStatus/public`, `activeRouteGeometry/{busId}_{routeId}/{version}` | [Firebase data model](../data/FIREBASE_DATA_MODEL.md) |
| Web client | Backend subsystems | HTTPS REST with `Authorization: Bearer <Firebase ID token>` | [API reference](../../backend/API.md), [HTTP contract](../api/HTTP_CONTRACT.md), [ride session contract](../api/RIDE_SESSION_CONTRACT.md), [operation resources](../api/OPERATION_RESOURCES.md) |
| Web client | Firestore | SDK listeners and reads under `firestore.rules`; transactional feedback writes | [Firebase data model](../data/FIREBASE_DATA_MODEL.md) |
| Identity and authorization | All backend subsystems and database rules | Custom claims plus `_userAuthorization/{uid}` in Firestore and RTDB | [Privileged database authorization](../security/PRIVILEGED_DATABASE_AUTHORIZATION.md) |
| Route processing, fleet and route administration | Google Maps Platform | Routes API `computeRoutes`; Places API (New) `searchText` | [Reroute retry policy](../operations/REROUTE_RETRY_POLICY.md) |

## 4. Ride lifecycle

A ride session has a durable status in Firestore (`ride_sessions/{sessionId}.status`) and a live trip state in RTDB (`activeBuses/{busId}_{routeId}.tripState`). The table summarises when each status is entered; the transition diagram and exact rules are in [tracking algorithms](TRACKING_ALGORITHMS.md#6-ride-lifecycle).

| Status | Live `tripState` | Entered when |
|---|---|---|
| `pending` | `pre_departure` | A qualified fix or an operator creates the session before the fix shows which endpoint the bus is at |
| `armed` | `pre_departure` | The session is created with a known direction and waits at the origin: automatic start, Resume tracking after a pause, or the automatic return trip |
| `active` | `in_service` | A reliable moving fix leaves the origin departure radius, or an operator starts the ride at an endpoint of a bus that is not paused |
| `completed` | `completed` | The worker confirms a stopped arrival at the final stop |
| `interrupted` | None; an early end removes the ride fields, an abandoned ride has no recent live record | An administrator or the assigned operator ends the ride early (`interruptionReason: manual_end_early`), or the reconciler finds no activity for 12 h (`abandoned_session_timeout`, configurable with `ABANDONED_RIDE_THRESHOLD_HOURS`) |
| `failed` | Not claimed | The RTDB claim at creation loses to another session (`failureReason: shift_conflict`) |

Rules that hold in every state:

1. Routes are stored once, from stop A to stop Z. A ride runs `forward` (A to Z) or `reverse` (Z to A); the backend resolves the direction from endpoint evidence and never defaults to `forward`.
2. Only the next expected stop, in travel order, can advance the ride. The worker records how each stop was reached (`gnss_progress`, `passed_unobserved`, `skipped_gnss_gap` or `recovered_checkpoint`). The arrival corridor, departure radius and gap rules are in [tracking algorithms](TRACKING_ALGORITHMS.md).
3. `_active_bus_locks/{busId}` admits one non-terminal session per physical bus across all routes.
4. After a ride completes and the bus dwells stopped at the terminal (30 s by default, `AUTOMATIC_TURNAROUND_DWELL_MS`), the worker creates the return session in the opposite direction as `armed`.
5. GNSS or network loss changes the device presence (`deviceState`, `signalState`), not the ride status. A ride survives outages until it completes, is ended, or is abandoned.
6. Ending a ride early pauses automatic start for that bus. Further fixes show the device online but cannot start a ride until an administrator (Resume tracking) or the assigned operator starts the service again.

## 5. Roles and authorization

Firebase Authentication identifies people; the backend decides what they may do. The backend publishes role claims together with a new `authorizationVersion` and mirrors the version to `_userAuthorization/{uid}` in Firestore and RTDB. `requireAdmin`, the administrator branch of `POST /api/shifts/stop` and the database rules compare the token's version with the mirror, so on those paths a demoted or reassigned account loses access on its next request without waiting for the token to expire. The other ride-operation routes in `backend/src/routes/shifts.ts` and `backend/src/routes/sessions.ts` accept administrator and driver claims without this comparison ([risk SEC-03](../operations/ARCHITECTURE_RISK_REGISTER.md#38-sec-03-ride-operations-accept-stale-administrator-claims)). Trust boundaries are described in the [security architecture](../security/SECURITY_ARCHITECTURE.md).

| Role | Granted by | May |
|---|---|---|
| Passenger | Any Google account; `POST /api/users/bootstrap` creates the profile with role `passenger` | Read routes, buses, settings and route-scoped live views; board a ride near a fresh bus fix; read and send messages in rides they joined; submit feedback on a completed ride they joined, once per 24 h; request account deletion |
| Operator (role `driver`) | An administrator links the user to a `drivers` record and bus through `PUT /api/fleet/drivers/{id}`; the backend publishes `role: driver`, `driverId` and `assignedBusId` | Call the operator API to start, resume, end or delay rides of the assigned bus; read the manifests of sessions they operate. The web app has no operator workspace |
| Administrator | A project owner sets `role: admin` in the user's Firestore profile and runs `npm run sync-role-claims --workspace=backend`, which publishes `role: admin` and `admin: true` | Every fleet, device, route, settings, ride, feedback, history, privacy and recovery operation; read all public live views |
| Device | `npm run provision-device --workspace=backend` stores a salted scrypt verifier in `devices/{deviceId}` with the assigned bus and route | Post telemetry and diagnostics and check for firmware releases for its own assignment |

Both databases deny by default. No client can write RTDB, ride lifecycle, fleet configuration or internal collections. The only client writes are feedback and the matching cooldown record, which `firestore.rules` checks for ride eligibility and the 24 h interval.

## 6. Failure handling and recovery

| Failure | Detection | Response |
|---|---|---|
| GNSS fix lost or degraded | Firmware sends a fix with `motionState: uncertain`; the reducer rejects unreliable fixes | The ride keeps its state; passengers see "GPS signal lost". After the gap, a reliably reached later stop credits the stops in between as `skipped_gnss_gap` |
| Tracker loses network, or the backend is unreachable | Missing fixes; HTTP errors or timeouts on the tracker | The tracker keeps up to 100 samples in RTC memory and retries with jittered backoff from 1 to 30 s, replaying only fresh samples. Passengers see "Updates delayed" after 12 s and "Live tracking lost" after 30 s, timed in the browser on the server timeline. The stale sweep marks the bus offline after `BUS_STALE_MS` (300 s by default) without ending the ride |
| Tracker loses power | Boot after a cold start | A flash checkpoint written every 10 s restores the last committed fix; samples not yet sent can be lost ([cold power recovery](../hardware/COLD_POWER_RECOVERY.md)) |
| Backend process stops or crashes | Lease not renewed within 45 s | Another process acquires the lease with a higher generation; fencing rejects writes from the old leader. The new leader replays `activeBuses` and fleet state. Telemetry restores missing live lifecycle fields from `active_rides` ([worker leadership](../operations/WORKER_LEADERSHIP.md)) |
| Write succeeds in Firestore but not in RTDB | Live record behind the durable checkpoint | Firestore is always written first. The next fix or replay republishes the live state without moving the durable stop index backwards. Ride creation retries reuse a stable creation key and resume the same session |
| Delayed work for an old session | Session ID differs from the current owner | Every lifecycle, completion and cleanup transaction compares the session ID and aborts on mismatch |
| Ride left open | No activity for 12 h | The hourly reconciler marks the session `interrupted` and releases only its own lock and recovery record |
| Firestore or RTDB unavailable | Readiness probe fails; dependency budget of 5 s exceeded | `/health` returns 503. Telemetry returns 503 with a 1 s retry hint, and the tracker retries. A possibly committed write is reconciled on retry by the timestamp and sequence check |
| Routes API slow or failing | 3.5 s timeout; provider circuit open | The ride continues on stored geometry; reroute attempts back off per ride ([reroute retry policy](../operations/REROUTE_RETRY_POLICY.md)) |
| Work arrives faster than it can be processed | Bounded queues reach their limits or maximum queue age | Older pending samples are replaced by the latest one and expired work is dropped; the lifecycle and projection workers replay from the current live state ([work admission](../operations/WORK_ADMISSION.md)) |
| Browser loses its connection or is backgrounded | RTDB `.info/connected`, page visibility | Shared listeners resume; liveness labels keep counting from the last fix time. The service worker never serves authenticated data from cache |
| Device secret leaked or device retired | Administrator disables the device | The registry change invalidates credential caches in every process through `_deviceCredentialVersions`; the tracker stops sending after a credential rejection |

## 7. Design rationale

| Choice | Reason | Trade-off |
|---|---|---|
| Trackers push HTTPS to the backend; no message broker | A small fleet needs one observable trust boundary; the backend applies registry, rate limit and ordering checks in one place | Backend availability is on the telemetry path |
| The registry assigns bus and route to a device | A stolen device secret cannot report as another vehicle | Provisioning is an operational dependency |
| Stop progression runs only on the leader worker | Browsers and operators cannot skip or fake stops; one process cannot race another | Accuracy depends on stop placement and GNSS quality |
| Firestore first, then RTDB, both guarded by session ID | The durable record is never behind the live one, and late work for an old ride cannot change a new ride | Two writes per lifecycle change; the live view can briefly lag |
| Automatic start uses the same internal operation as the operator API | One code path owns idempotency, locks and assignment checks; the device never acts as an administrator | Setup errors surface as a blocked state on the live record, not as an HTTP error |
| Latest-pending scheduling for matching and projection | Under load, the newest position matters more than every intermediate one | Some intermediate fixes are never matched |
| Liveness computed in the browser from fix timestamps | Passengers learn that tracking is lost even when the backend is down | Depends on the browser's server clock offset |
| No dead reckoning | A guessed position presented as live would mislead passengers | The map shows an interruption instead of a moving bus |
| One route record with independently routed forward and reverse geometry | Respects one-way roads and divided carriageways without duplicating routes | Two Routes API calls when route geometry is created or repaired |
| Browsers read a projection, never `activeBuses` | Internal fields stay private and passengers download only their route | One extra write per change; see [EKI-ADR-003](TELEMETRY_STATE_PARTITION_DECISION.md) |

Constraints and open risks are listed in the [architecture description](ARCHITECTURE.md#10-constraints-and-risks).

## 8. References

[1] IEEE 1016-2009, "IEEE Standard for Information Technology: Systems Design, Software Design Descriptions."
