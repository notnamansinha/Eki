# Low-level design (LLD)

This document maps runtime behavior to source modules. Tests beside a module exercise its pure/security-sensitive behavior.

## Backend composition

`server.ts` loads environment first, configures Helmet/CORS/body/rate limits, mounts routes, maintains a cached 30-second Firestore/RTDB health probe, starts the HTTP listener and worker coordinator, and drains HTTP/worker/Firebase resources on SIGTERM/SIGINT. Telemetry bypasses the broad global limit but has its own IP and device limits. Body parsing is 512 bytes on telemetry and 16 KiB elsewhere.

### Backend module catalog

| File/group | Responsibility |
|---|---|
| `lib/firebaseAdmin.ts` | One Admin app; service-account JSON or ADC; Firestore/Auth/RTDB handles |
| `lib/geo.ts` | Geographic distance/segment calculations used by geofences |
| `lib/googleMaps.ts` | Server-key Routes and Places requests, response validation/timeouts |
| `lib/polylineUtils.ts` | Google encoded-polyline encode/decode and nearest index |
| `lib/routeSegment.ts` | Direction-safe stored-polyline slicing, via constraint and travel-order stops |
| `middleware/requireAuth.ts` | Bearer extraction, revocation-aware token verification, request claims |
| `middleware/requireAdmin.ts` | Admin custom-claim enforcement |
| `routes/devices.ts` | Device telemetry endpoint and admin registry update/disable |
| `routes/shifts.ts` | Driver authorization, delay, start/resume, completion acknowledgement, message/history deletion |
| `routes/fleet.ts` | Admin buses/drivers, Auth claims, RTDB assignment mirrors, reconciliation |
| `routes/polyline.ts` | Admin route geometry create/update/delete with active-use guards |
| `routes/plan.ts` | Authenticated route segment from stored polyline; no Maps call |
| `routes/routesList.ts` | Bounded cached route list |
| `routes/places.ts` | Admin place search proxy with limiter |
| `routes/buses.ts` | Authenticated current RTDB snapshots |
| `routes/analytics.ts` | Admin fleet lifecycle summary from `bus_locations` |
| `routes/requests.ts` | Admin mutation of passenger request status/removal |
| `routes/privacy.ts` | Passenger deletion-request queue |
| `services/telemetryPayload.ts` | Closed schema, ranges and timestamp freshness |
| `services/deviceTelemetryService.ts` | scrypt credentials/cache, device limit, RTDB transaction, recovery and rolling metrics |
| `services/authTokenVerifier.ts` | SHA-256 keyed bounded token verification coalescing/cache |
| `services/tripStateReducer.ts` | Pure ordered geofence state transition and segment crossing |
| `services/tripStateLifecycle.ts` | Identifier/live-record normalization and dynamic shutdown draining |
| `services/tripStateEngine.ts` | RTDB handlers, route cache, serialized per-node work, durable lifecycle/completion/stale sweep |
| `services/workerCoordinator.ts` | Firestore lease acquisition/renewal and leader job ownership |
| `services/abandonedRideReconciler.ts` | Rechecks and interrupts stale non-terminal sessions |
| `services/abandonedRideReconciliationLogic.ts` | Pure timestamp/session decision logic |
| `services/privacyDeletionWorker.ts` | Paged deletion of a queued passenger's personal documents/auth account |
| `services/retentionSweeper.ts` | Explicit opt-in, paged time-based terminal-data removal |
| `services/rideHistoryDeletion.ts` | Terminal-only recursive session/completed-trip deletion |
| `seed.ts` | Writes predefined routes only after Maps geometry succeeds |
| `provisionDevice.ts` | Transactional registry/assignment conflict checks and one-time secret generation |
| `syncRoleClaims.ts` | Synchronizes Firestore user roles into Auth claims |
| `types/express.d.ts`, `types/index.ts` | Request augmentation and shared data shapes |

`*.test.ts`, `rulesIntegration.test.ts`, `securityConfig.test.ts`, and `testSetup.ts` are test harnesses described in [Test strategy](../testing/TEST_STRATEGY.md). `Dockerfile`, `.dockerignore`, `tsconfig.json`, and ESLint/package files are build/runtime configuration.

## Telemetry service detail

Credential cache entries hold `{assignment, secretDigest, expiresAt}`; positive TTL is 60 seconds, negative TTL 5 seconds, and capacity 1,000. A SHA-256 digest makes cached comparisons constant-size; the durable store remains scrypt. Rate buckets are per device, one minute, default 30 accepted attempts, capacity 2,000.

The RTDB transaction compares `sample.timestamp` to the existing timestamp. Older/equal samples abort and return duplicate success. New data merges the sample without overwriting an existing active lifecycle, adds server `receivedAt`, and derives `deviceState`/`signalState`. A missing active session schedules one coalesced Firestore recovery read per node with a 30-second negative cache.

Metrics retain only the latest 512 in-memory samples. Restart resets counters; metrics are diagnostic rather than billing/history.

## Trip-state detail

Normalized live data is processed serially per RTDB child. Routes are cached from a Firestore snapshot listener; missing IDs have a 60-second negative cache and listener reconnect uses 1–30 second backoff. `processedTelemetry` accepts only increasing timestamps.

The reducer receives current/previous points, next stop, motion state and existing lifecycle. It can advance one expected stop per fix and never skips ahead. Lifecycle writes are fingerprinted and serialized per bus/ride. Completion uses a Firestore transaction to write history and delete only recovery/lock documents matching the completing session; RTDB writes also compare session ID. Terminal live nodes remain briefly for UI observation and then become offline.

The coordinator stores `_worker_leases/trip-state` with owner and expiry. Only the lease holder runs the engine, abandoned reconciliation, privacy worker and retention. Shutdown stops intake, drains dynamic queues, forces pending completion cleanup, releases the lease conditionally, and then closes Firebase.

## Frontend composition

The Next.js App Router produces a static export. `layout.tsx` installs global metadata, service-worker registration and `Providers`; protected layouts wrap client `RoleGuard` and map context. The landing route is public; passenger, driver, admin and feedback routes are authenticated/no-index.

### Frontend module catalog

| File/group | Responsibility |
|---|---|
| `app/page.tsx` | Public landing/sign-in and workspace routing |
| `app/passenger/*` | Passenger map, boarding, messages, account/feedback workflow |
| `app/driver/*` | Assigned ride arming, map, delay, messages and profile |
| `app/admin/*` | Accessible active-tab shell; only active panel is mounted |
| `app/feedback/*` | Admin feedback review/status workflow |
| `app/manifest.ts`, `robots.ts`, `sitemap.ts` | PWA and public-index metadata |
| `app/globals.css` | Tokens, responsive layout, focus/motion rules; reduced motion disables decoration |
| `components/Providers.tsx` | Auth/App Check and top-level client providers |
| `components/MapProviders.tsx` | Single Maps API provider/load per workspace |
| `components/ServiceWorkerRegistrar.tsx` | SW registration/update check and controlled one-time reload |
| `components/maps/DirectionsRoute.tsx` | Draw stored decoded polyline |
| `components/maps/DriverMap.tsx` | Driver live location/route/ride controls |
| `components/maps/PassengerMap.tsx` | RTDB route filtering, snapping, heuristic ETA and marker UI |
| `components/maps/PassengerTrackingMap.tsx` | Passenger tracking composition |
| `components/admin/*Panel.tsx` | Dashboard, routes, fleet/personnel, history and settings |
| `components/driver/*` | Trip setup and driver profile |
| `components/passenger/*` | Boarding, route timeline/carousel/sheet and account |
| `components/shared/RoleGuard.tsx` | Presentation guard and auth/access states; not the security boundary |
| `components/shared/MessagingPanel.tsx` | Session-scoped Firestore messaging/rate-record transaction |
| `components/shared/FeedbackModal.tsx` | Feedback transaction and cooldown |
| `components/ui/*` | Accessible native select and focus-contained alert/confirm dialogs |
| `hooks/useAuth.ts` | Firebase auth observer, profile/claim normalization and cache clearing |
| `hooks/useCollection.ts` | Auth-ready singleton/bounded collection listener pattern |
| `hooks/useBuses.ts`, `useDrivers.ts`, `useRoutes.ts`, `useSettings.ts` | Typed shared Firestore subscriptions |
| `hooks/useRTDBResume.ts`, `rtdbResumeState.ts` | Online/visibility recovery state machine |
| `hooks/useSmoothPosition.ts` | Bounded rAF interpolation; bypassed for reduced motion |
| `hooks/useDialogFocus.ts` | Top-dialog focus trap, Escape, scroll lock and focus restoration |
| `lib/firebaseCore/Auth/Database/Firestore/AppCheck.ts` | Split client SDK initialization to limit route dependencies |
| `lib/authState.ts` | Resolves first auth event before protected listeners attach |
| `lib/liveBusStore.ts` | One RTDB `onValue` listener and freshness pruning for all consumers |
| `lib/liveBusFreshness.ts`, `liveBusSnapshot.ts` | Coordinate/timestamp/signal validity and expiry |
| `lib/polyline.ts`, `polylineDistance.ts`, `snapToPolyline.ts`, `mapUtils.ts` | Pure map math, distance index, snapping/interpolation |
| `lib/rideHistory.ts`, `rideFeedbackEligibility.ts` | Pure historical normalization/eligibility |
| `lib/predefinedRoutes.ts` | Seed source geometry/stops |
| `config/maps.ts`, `config/passenger.ts`, `etaConstants.ts` | Central public/runtime tuning |
| `sw.js` | Precache static export; cache public maps/fonts/images; network-only Firebase/auth/backend/unknown |

Tests beside pure frontend libraries exercise freshness, RTDB sharing, route distance/snapping, resume state, history and feedback eligibility.

## Firmware detail

`hardware/src/main.cpp` is a single deterministic loop because it has one UART and one network output. It drains UART on every pass, feeds the watchdog, reconnects Wi-Fi, synchronizes NTP, drops nearly stale buffered fixes, retries the latest buffered fix, evaluates GNSS each second, and warns if no NMEA arrives. `hardware/include/telemetry_policy.h` contains the shared, host-testable distance, heading, motion-hysteresis, retry and publish decisions; the native Unity suite executes those exact production helpers.

`TelemetryFix` is the only queued object; replacement intentionally keeps latest data rather than building an unbounded history. HTTPS 200/202 updates comparison state. Transport errors, 408/425/429 and 5xx retain the latest sample only while it can remain inside the 55-second freshness margin; stale samples are dropped, and bounded `Retry-After` is honored. Permanent HTTP rejection drops that sample and delays the next fresh attempt. GNSS loss sends one `uncertain` sample at the last verified point; it never invents movement. Invalid compile-time configuration halts before networking, and a 401/403 disables the station radio until the applicable configuration or backend registry repair is followed by a restart.

`platformio.ini` pins Espressif32 7.0.1, TinyGPSPlus 1.1.0 and ArduinoJson 7.4.3 and defines native, development, and signed fleet environments. `firmware_config.h` validates the ignored compile-time `secrets.h` contract. `sdkconfig.defaults` enables Secure Boot V2, release-mode flash encryption, ROM-download lockdown, and RAM-only Wi-Fi state for the hybrid Arduino/ESP-IDF fleet build. The ignored RSA-3072 signing key is mandatory for signed fleet artifacts; native tests and regular `esp32dev` builds do not use it. Fleet runtime halts unless both hardware protections are active and the backend origin is HTTPS.

## Configuration/build files

- Root `package.json` is the npm workspace orchestrator. `package-lock.json` is the reproducible dependency graph.
- `scripts/build-production.mjs` enables strict public-variable validation. `generate-sw.mjs` injects the Workbox manifest. `update-csp.mjs` hashes emitted inline scripts into `firebase.json`.
- `firebase.json`, `.firebaserc`, rules and indexes define Hosting/Firebase deployment. Generated CSP changes after builds are intentional and must be committed with the output-producing code.
- GitHub workflows install, test/build, run emulators where configured, and scan dependencies/code. Dependabot owns scheduled update proposals.

## Consistency model

RTDB is the immediate latest-value projection; Firestore is durable truth for configuration and recovery/history. A small window can exist between RTDB claim and Firestore active projection. Session IDs and conditional transactions make retries/reconciliation idempotent. Clients must display interruption/staleness rather than infer lifecycle from coordinates alone.
