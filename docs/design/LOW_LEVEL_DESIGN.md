# Low-level design (LLD)

Last updated: 2026-10-27 12:00 IST (UTC+05:30).

This document maps runtime behavior to source modules. Tests beside a module exercise its pure/security-sensitive behavior.

## Backend composition

`bootstrap.ts` loads environment and optional instrumentation before `server.ts`; the server configures Helmet/CORS/body/rate limits, mounts routes, maintains bounded single-flight Firestore/RTDB probes every 30 seconds (5-second response budget, 65-second monotonic freshness, true RTDB connected value) and separate process liveness, starts the HTTP listener and worker coordinator, and drains HTTP/worker/Firebase resources on SIGTERM/SIGINT. CORS/preflight precedes the generous browser IP ingress guard. Browser authentication then selects separate verified-UID read (200/minute) and mutation (30/minute) quotas; GET/HEAD never consumes writes. Route computation, planning and Places limits also use the verified UID. These process budgets are replica-sharded; edge protection supplies the fleet-wide cap. Exact device ingress paths retain separate IP/device authentication and budgets, including firmware installation reservations. Public probes are exempt, while detailed health retains admin authorization. Body parsing is 512 bytes on telemetry, 1 KiB on diagnostics and 16 KiB elsewhere. After every route mount, a terminal handler answers unmatched paths/methods with 404 JSON, then `lib/requestErrors.ts` maps parser/router client errors to fixed 400/413/415 messages and everything else to an opaque, logged 500.

### Backend module catalog

| File/group | Responsibility |
|---|---|
| `lib/firebaseAdmin.ts` | One Admin app; service-account JSON or ADC; Firestore/Auth/RTDB handles |
| `lib/geo.ts` | Geographic distance/segment calculations used by geofences |
| `lib/googleMaps.ts` | Server-key Routes and Places requests, response validation/timeouts |
| `lib/polylineUtils.ts` | Google encoded-polyline encode/decode and nearest index |
| `lib/routeSegment.ts` | Direction-safe stored-polyline slicing: stops are projected in travel order with non-decreasing vertex indices (loop/out-and-back safe), via constraint, travel-order stops |
| `middleware/requireAuth.ts` | Bearer extraction, revocation-aware token verification, request claims |
| `middleware/requireAdmin.ts` | Admin custom-claim enforcement |
| `middleware/verifiedRequest.ts` | Private request/token-scoped verification reuse; later requests still follow revocation policy |
| `lib/requestErrors.ts` | JSON 404 for unmatched paths/methods, bounded 400/413/415 parser and path errors, opaque last-resort 500 |
| `lib/boundedSingleFlight.ts` | Credential-fill and waiting-caller ceilings, monotonic response budget, retained unsettled slots and invalidation fencing |
| `routes/devices.ts` | Device telemetry/diagnostics, ride-gated signed-release metadata, and admin registry update/disable |
| `routes/shifts.ts` | Driver authorization, delay, start/resume, early interruption, message/history deletion |
| `routes/feedback.ts` | Admin feedback list/status and server-authoritative passenger submission |
| `routes/rideSessions.ts` | Versioned session resources and idempotent creation/member commands |
| `routes/fleet.ts` | Admin buses/drivers, Auth claims, RTDB assignment mirrors, reconciliation; bus saves merge editable catalog fields, preserve metadata and explicitly remove the legacy assignment |
| `routes/polyline.ts` | Admin route geometry create/update/delete with active-use guards |
| `routes/plan.ts` | Authenticated route segment from stored polyline; no Maps call |
| `routes/routesList.ts` | Bounded cached route list |
| `routes/places.ts` | Admin place search proxy with limiter |
| `routes/buses.ts` | Authenticated current RTDB snapshots |
| `routes/analytics.ts` | Admin fleet lifecycle summary from `bus_locations` |
| `routes/requests.ts` | Admin mutation of passenger request status/removal |
| `routes/privacy.ts` | Passenger deletion-request queue |
| `services/telemetryPayload.ts` | Closed schema, ranges and timestamp freshness |
| `services/firmwareRelease.ts` | Fail-closed signed release descriptor parsing and sequence validation |
| `services/deviceRateLimiter.ts` | Explicit single-instance local limiting or bounded leases from a shared per-device RTDB budget |
| `services/deviceTelemetryService.ts` | Bounded device/digest credential fills, monotonic positive/negative cache TTL, invalidation fences, scrypt, ordered live-node transaction, recovery and rolling metrics |
| `services/durableRideRecovery.ts`, `durableRideRecoveryPolicy.ts` | Single-flight recovery of a lock-owned non-terminal session; completed-predecessor/claim guards, new-claim miss-cache bypass, telemetry/delay preservation and shutdown drain |
| `services/routeMatching.ts` | Pure projection, direction/heading/continuity scoring and off-route hysteresis |
| `services/telemetryRouteService.ts` | Per-node bounded latest-pending matching, versioned route catalog invalidation, reroute orchestration and stale-result guards |
| `services/authTokenVerifier.ts` | SHA-256 keyed bounded token verification coalescing/cache |
| `services/tripStateReducer.ts` | Pure ordered geofence state transition and segment crossing |
| `services/tripStateLifecycle.ts` | Identifier/live-record normalization and dynamic shutdown draining |
| `services/tripStateEngine.ts` | RTDB handlers, route cache, serialized per-node work, durable lifecycle/completion/stale sweep |
| `services/workerCoordinator.ts` | Firestore lease acquisition/renewal and leader job ownership |
| `services/abandonedRideReconciler.ts` | Rechecks and interrupts stale non-terminal sessions |
| `services/abandonedRideReconciliationLogic.ts` | Pure timestamp/session decision logic |
| `services/privacyDeletionWorker.ts` | Fair twenty-record queue traversal, bounded chunks, claim/lease fencing and backoff/dead-letter state |
| `services/privacyDeletionRequests.ts` | Current passenger eligibility, transactional resubmission, admin monitoring and audited recovery |
| `services/fleetMutationLock.ts` | Shared non-expiring fleet/privacy Auth mutation mutex and raw-settlement ownership |
| `services/retentionSweeper.ts` | Production-required, paged time-based terminal-data removal; day values capped at 36,500; each category settles independently and the RTDB sweep always runs before failures are rethrown |
| `services/rtdbRetention.ts`, `firebaseRtdbRetention.ts`, `rtdbRetentionCli.ts` | Dry-run/apply RTDB inventory, age/fingerprint guards, legacy opt-in and current-geometry protection |
| `services/rideHistoryDeletion.ts` | Terminal-only recursive session/completed-trip deletion |
| `seed.ts` | Writes predefined routes only after Maps geometry succeeds |
| `provisionDevice.ts` | Transactional registry/assignment conflict checks and one-time secret generation; a flag value starting with `--` is treated as missing |
| `syncRoleClaims.ts` | Synchronizes Firestore user roles into Auth claims; every failing driver path still publishes the plain driver claim and removes mirrors, so stale admin claims cannot survive |
| `types/express.d.ts`, `types/index.ts` | Request augmentation and shared data shapes |

`*.test.ts`, `rulesIntegration.test.ts`, `securityConfig.test.ts`, and `testSetup.ts` are test harnesses described in [Test strategy](../testing/TEST_STRATEGY.md). `Dockerfile`, `.dockerignore`, `tsconfig.json`, and ESLint/package files are build/runtime configuration.

## Telemetry service detail

Credential cache entries hold `{assignment, secretDigest, expiresAt}`; positive TTL is 60 seconds, negative TTL 5 seconds, and capacity 1,000 verified entries plus a separate 1,000 rejected entries, so guessed device IDs or secrets cannot evict verified fleet credentials. A SHA-256 digest makes cached comparisons constant-size; the durable store remains scrypt. Credential verification runs before a request takes a slot in the ingestion executor, bounded by the credential fills and KDF limiter, so unauthenticated requests stalled on scrypt cannot occupy ingestion capacity. Firestore-reserved `__…__` device IDs are rejected as invalid credentials without a registry read, and a reserved registry `busId`/`routeId` is treated as unassigned (403). Rate buckets are per device and one minute with a default budget of 90. Distributed mode reserves five tokens per shared transaction by default and bounds local leases to 1,000 devices. Local mode also tracks at most 1,000 devices and fails closed when that table is full.

The RTDB transaction compares `sample.timestamp` plus sequence to existing telemetry. Older/equal samples abort and return duplicate success. New data merges the accepted sample without overwriting an existing active lifecycle, preserves the authenticated fix in `rawLocation`, adds server timing, and derives `deviceState`/`signalState`. A missing active session schedules one coalesced Firestore recovery read per node with a 30-second negative cache.

Accepted fixes schedule (but never await) per-node route processing. Stored forward and reverse polylines come from the versioned read-only telemetry catalog; legacy missing geometry requires authorized administration rather than live repair. Watcher snapshots seed positive/negative data, pending directions share five-minute monotonic freshness/coalesced reads, and edit/deletion generations fence callbacks. Current-route transaction reads bind durable direction; definitive refusals clear only provisional state while unknown commits reconcile on later fixes. See [route catalog](../operations/ROUTE_CATALOG.md). Projection scores distance, heading, backwards progress and segment jumps. A competing candidate makes a match ambiguous only when reaching it means travelling clearly farther along the route than its straight-line distance (a loop, crossing or out-and-back leg); repeated or densely sampled vertices of one road form a single continuous leg. Each completed pass stamps its sample identity. Confident current-sample matches populate `matchedLocation`; while an on-route sample is still pending, clients retain the previous confident match for at most two seconds before showing the accepted raw coordinate. Low-confidence, off-route, route-context-change and reconnect states use raw GNSS immediately and are marked uncertain. Two ordinary reliable moving deviations, or one measured reliable deviation at least 120 m from the route, transition `ON_ROUTE → POSSIBLE_OFF_ROUTE → OFF_ROUTE → REROUTING`. The Routes request includes the next required stops, and activation requires the same request ID, route version, direction and session before incrementing the version and publishing `ON_NEW_ROUTE`. Provider geometry with fewer than two points, or deviation geometry that the triggering fix does not match, is released as a failed attempt under the per-ride backoff; a `REROUTING` claim older than 60 seconds is treated as lost so the next fix can claim again. See [reroute retry policy](../operations/REROUTE_RETRY_POLICY.md).

Metrics retain only the latest 512 in-memory samples. Restart resets counters; metrics are diagnostic rather than billing/history.

## Trip-state detail

Normalized live data is processed serially per RTDB child. Routes are cached from a Firestore snapshot listener; missing IDs have a 60-second negative cache and listener reconnect uses 1–30 second backoff. `processedTelemetry` accepts only increasing timestamps.

The reducer receives current/previous points, next stop, motion state and existing lifecycle. Only the next expected stop can advance, and the reducer skips ahead only after a GNSS gap (over 10 s without a fix, an untrusted fix, or a segment over 250 m): while that persisted `gnssGap` is open, a reliably observed later stop credits the unobserved stops before it as `skipped_gnss_gap`, and observing any stop closes the gap. A later stop whose location coincides with a stop already passed (out-and-back or loop routes) is never credited after a gap, and no stop is credited while the fix is still at a passed stop's location, so the gap stays open instead; several closely spaced stops crossed by one bounded segment are consumed in travel order. Departure needs a moving fix beyond the origin radius (`min(150 m, max(10 m, half the first leg))`) or, when stop 1 lies inside that radius, a moving crossing of stop 1. Intermediate stops crossed by the departure segment are consumed in the same update; the terminal stop still requires a later confirmed fix. Lifecycle writes are fingerprinted and serialized per bus/ride. Completion uses a Firestore transaction to write history and delete only recovery/lock documents matching the completing session; RTDB writes also compare session ID. When a new session loses the RTDB claim, marking it failed and releasing its matching bus lock commit in one transaction, so a failed session never keeps the lock. The abandoned-ride reconciler skips and reports sessions whose bus/route IDs cannot address a document or node instead of failing the page. The stale sweeper discards a scheduled wait longer than its own bound, so a backwards wall-clock step cannot postpone presence cleanup. Terminal live nodes remain briefly for UI observation and then become offline.

The coordinator stores `_worker_leases/trip-state-worker` with a unique process owner, persistent generation and expiry. A separate monotonic cutoff revokes the context even if renewal stalls; late responses cannot revive it. Worker Firestore transactions/batches validate that lease in their read set, while RTDB retries check local expiry and surviving projections reject older `_workerGeneration` values. Auth calls and recursive deletion already dispatched cannot be recalled; fleet reconciliation retains its durable lock until settlement. Shutdown stops intake before cleanup and does not wait for a hung renewal. Clock skew is limited to 2 seconds. See [worker leadership](../operations/WORKER_LEADERSHIP.md) for the cross-store and live-acceptance boundaries.

## Frontend composition

The Next.js App Router produces a static export. `layout.tsx` installs global metadata, service-worker registration and `Providers`; protected layouts wrap client `RoleGuard` and map context. The landing route is public; passenger, admin and feedback routes are authenticated/no-index.

### Frontend module catalog

| File/group | Responsibility |
|---|---|
| `app/page.tsx` | Public landing/sign-in and workspace routing |
| `app/passenger/*` | Passenger map, boarding, messages, account/feedback workflow |
| `app/admin/*` | Accessible active-tab shell; operations include ride arming, delay, boarding codes and messaging |
| `app/feedback/*` | Admin feedback review/status workflow |
| `app/manifest.ts`, `robots.ts`, `sitemap.ts` | PWA and public-index metadata |
| `app/globals.css` | Tokens, responsive layout, focus/motion rules; reduced motion disables decoration |
| `components/Providers.tsx` | Auth/App Check and top-level client providers |
| `components/MapProviders.tsx` | Single Maps API provider/load per workspace |
| `components/ServiceWorkerRegistrar.tsx` | SW registration/update check and controlled one-time reload |
| `components/maps/DirectionsRoute.tsx` | Draw active direction/version stored geometry; missing legacy geometry requires admin repair, and a repaired road fallback is used only until trusted stored geometry exists |
| `components/maps/PassengerMap.tsx`, `lib/busEta.ts` | RTDB route filtering, matched/raw marker policy, dynamic route overlay and heuristic ETA; unchanged bus objects and marker props retain identity, while per-map stop projections use bounded route/version/direction keys and verify path and stop coordinates before reuse |
| `components/admin/DashboardPanel.tsx` | Live Ops matched markers, per-bus route overlays and raw/match/version diagnostics |
| `components/maps/PassengerTrackingMap.tsx` | Passenger tracking composition |
| `components/admin/*Panel.tsx` | Operations, dashboard, routes, fleet/personnel, history and settings |
| `components/passenger/*` | Boarding, route timeline/carousel/sheet and account |
| `components/shared/RoleGuard.tsx` | Presentation guard and auth/access states; not the security boundary |
| `components/shared/MessagingPanel.tsx` | Firestore message reads (latest 200) and idempotent server-authorized message submission; unread counts track seen message IDs, so new messages still count once the window is full |
| `components/shared/FeedbackModal.tsx`, `components/admin/FeedbackPanel.tsx` | Server-authoritative feedback submission/cooldown; shared admin HTTP list/status review with auth-generation guards |
| `components/ui/*` | Keyboard-accessible in-app listboxes and focus-contained alert/confirm dialogs |
| `hooks/useAuth.ts` | App Check/role verification before user/readiness publication; account/sign-out generation guards and cache disposal |
| `hooks/useCollection.ts` | Auth-ready singleton/bounded collection listener pattern |
| `hooks/useBuses.ts`, `useDrivers.ts`, `useRoutes.ts`, `useSettings.ts` | Typed shared Firestore subscriptions |
| `hooks/useRTDBResume.ts`, `rtdbResumeState.ts`, `lib/liveBusRetry.ts` | Confirmed-disconnect/30-second suspension gates, 1–1.5 second debounce, 5-second cooldown and capped exponential equal-jitter retries; healthy short tabs preserve cache |
| `hooks/useSmoothPosition.ts` | Bounded rAF interpolation; bypassed for reduced motion |
| `hooks/useDialogFocus.ts` | Top-dialog focus trap, Escape, scroll lock and focus restoration |
| `lib/firebaseCore/Auth/Database/Firestore/AppCheck.ts` | Split client SDK initialization to limit route dependencies |
| `lib/firebaseAuthDomain.ts` | Normalizes primary project Hosting domains; custom/secondary domains require explicit auth-helper configuration |
| `lib/authState.ts` | Tracks verified auth readiness and generations before protected listeners attach |
| `lib/liveBusStore.ts` | Shared initial RTDB snapshot followed by child deltas, route-scoped subscriptions and freshness pruning |
| `lib/liveBusFreshness.ts`, `liveBusSnapshot.ts` | Coordinate/timestamp/signal validity and expiry, measured on the server timeline; ride retention requires a non-empty `sessionId` |
| `lib/serverClock.ts`, `serverClockSync.ts` | `serverNow()`: device clock corrected by RTDB `.info/serverTimeOffset`, kept current by the live-bus stores and route catalog |
| `lib/polyline.ts`, `polylineDistance.ts`, `snapToPolyline.ts`, `mapUtils.ts` | Pure map math, distance index, snapping/interpolation |
| `lib/liveBusMarkerPosition.ts`, `markerHeading.ts` | Client-side jump hold/reacquisition and wrap-safe marker heading presentation |
| `lib/rideHistory.ts`, `rideFeedbackEligibility.ts` | Pure historical normalization/eligibility |
| `lib/feedback.ts` | Validated admin list/status response parsing |
| `lib/predefinedRoutes.ts` | Seed source geometry/stops |
| `config/maps.ts`, `config/passenger.ts`, `etaConstants.ts` | Central public/runtime tuning |

Passenger ETAs project stops once per route geometry, version, direction and ordered stop set. A changed path reference or stop coordinate forces reprojection even before a version update arrives. The map holds at most 16 stop-projection entries and discards them with the route view. Exact same-point continuity reuse is safe; moved or ambiguous positions use the full polyline search. See [R18 synthetic evidence](../testing/PASSENGER_MAP_PER_BUS_WORK.md) for counters and the remaining live boundary.
| `sw.js` | Precache static export; cache same-origin images/chunks and readable (status 200) fonts; navigation HTML keyed per path without query string, capped at 10 entries/7 days; network-only Google Maps (opaque responses hide upstream errors), Firebase/auth/backend/unknown; activation deletes the previous deployment's navigation HTML and legacy `eki-google-maps` caches |

Tests beside pure frontend libraries exercise freshness, RTDB sharing, route distance/snapping, resume state, history and feedback eligibility.

## Firmware detail

`hardware/src/main.cpp` separates continuous UART/GNSS capture on the Arduino
loop (core 1) from the network publisher (core 0). A bounded 100-sample RTC
ring survives warm resets. Publishing selects the newest eligible fix, retains
retryable work, compacts acknowledged older samples, and discards captures
outside the 55-second freshness margin. Diagnostics and maintenance run
separately without evicting queued telemetry.

The shared telemetry policy evaluates each second, uses three-reading motion
hysteresis, one-second moving/stopped heartbeats, a one-second HTTP connect
timeout, 1.5-second request timeout and separate ten-second TLS handshake bound.
These are separate budgets; none promises universal end-to-end latency.
Publisher/diagnostic HTTPS resolution uses `bounded_dns_resolver.h`: one retained
lwIP callback slot and a one-second monotonic caller wait. A timeout cannot free
the underlying slot or amplify retries, and network epochs fence old results.
The SDK DNS TTL cache and original hostname passed to owner-task TLS remain;
healthy persistent sockets bypass connection setup. See
[cold-connect scheduling and limits](../hardware/DNS_COLD_CONNECT.md).

Cold power loss can restore one compatible encrypted flash checkpoint, with
its original sequence. Warm RTC state wins; checkpoints are scheduled every
ten seconds and uncommitted newer fixes can be lost. The journal verifies
storage layout/collision safety. `esp32dev-journal` is the legacy-board app-only
acceptance profile; normal development uses `partitions_development.csv`.
See [cold-power recovery](../hardware/COLD_POWER_RECOVERY.md).

GNSS loss queues one uncertain fix at the last verified point. Invalid compile-
time configuration halts before networking; HTTP 401 latches publishing
off and disables the radio until credential repair/restart. HTTP 403 keeps
the radio on and retries after assignment repair. Header policies
and checkpoint/response tests run on the native host. Physical GNSS, power,
radio, TLS, Secure Boot and OTA acceptance require the hardware runbooks.

`platformio.ini` pins Espressif32 7.0.1, TinyGPSPlus 1.1.0 and ArduinoJson 7.4.3 and defines native, development, and signed fleet environments. `firmware_config.h` validates the ignored compile-time `secrets.h` contract. `sdkconfig.defaults` enables Secure Boot V2, release-mode flash encryption, ROM-download lockdown, and RAM-only Wi-Fi state for the hybrid Arduino/ESP-IDF fleet build. The ignored RSA-3072 signing key is mandatory for signed fleet artifacts; native tests and regular `esp32dev` builds do not use it. Fleet runtime halts unless both hardware protections are active and the backend origin is HTTPS.

## Configuration/build files

- Root `package.json` is the npm workspace orchestrator. `package-lock.json` is the reproducible dependency graph.
- `scripts/build-production.mjs` enables strict public-variable validation. `generate-sw.mjs` injects the Workbox manifest. `update-csp.mjs` hashes emitted inline scripts and injects connect/frame directives into `firebase.json`; it matches each managed directive anywhere in the policy, including the last one, and fails the build when one is missing. `script-src` lists only hosts the app loads scripts from and never a callback-reflecting JSONP host such as `www.google.com`; RTDB script sources (wildcards and the configured instance) are scoped to the `/.lp` long-poll path, because the bare RTDB origin also serves REST `?callback=` JSONP.
- `scripts/verify-web-backend-contract.mjs` verifies the backend origin and Firebase Auth same-origin frame helper (`frame-src 'self'`) in CSP. Both scripts load `frontend/.env*` through `scripts/load-frontend-env.mjs` (`@next/env`, as `next build` does), so they check the URL the bundle was compiled with, not only the shell's.
- `scripts/rtdb-instance-config.mjs` verifies matching RTDB instances and expected region configuration (`verify:rtdb-instance`).
- `firebase.json`, `.firebaserc`, rules and indexes define Hosting/Firebase deployment. Generated CSP changes after builds are intentional and must be committed with the output-producing code.
- GitHub workflows install, test/build, run emulators where configured, and audit runtime and development dependencies. CI also runs the synthetic admin browser suite and legacy journal firmware build.

## Consistency model

RTDB is the immediate latest-value projection; Firestore is durable truth for configuration and recovery/history. A small window can exist between RTDB claim and Firestore active projection. Session IDs and conditional transactions make retries/reconciliation idempotent. Clients must display interruption/staleness rather than infer lifecycle from coordinates alone.

The fleet authorization safety sweep reads the RTDB assignment mirror once and coalesces Firestore bus-route lookups by bus ID while retaining per-driver Auth checks. If the bulk mirror read fails, it falls back to the original per-driver lookup path so an optimization outage cannot disable repair.

### Bounded work admission

KDF execution is 4 active/32 waiting; ordered intake and the shared durable
writer pool each allow 8 active/256 waiting/32 waiting per key. Matching allows
8 active/256 waiting keys, rerouting 2 active/64 waiting keys, plus one newest
follow-up per active key. Undispatched age is five seconds. Dispatched slots
remain held through actual settlement. Fair FIFO dispatch preserves caller
contexts. Rejected lifecycle work requests one paginated 25-item authoritative
reread; it preserves current ownership and already committed progress. See
[work admission](../operations/WORK_ADMISSION.md) for recovery and evidence limits.

Telemetry uses a bounded 8-pipeline/32-waiter executor, one active/one waiting
per device, two-second queue age, eight-second monotonic service response and
five-second dependency stages capped by remaining time. Caller expiry leaves
raw SDK permits/order occupied; every quota/telemetry retry callback rechecks
the captured deadline. Capture timestamp/sequence ordering remains transactional.
[Telemetry deadlines](../operations/TELEMETRY_DEADLINES.md) define uncertain
commit responses and the distinction from HTTP request receipt timeouts.

Preview/fleet HTTP operations use 2 active/8 queued executor slots and a
2-second monotonic queue age; durable admission/control fills each cap at
16 with 32 coalesced callers and 3-second response budgets. Raw dispatched
work keeps slots through settlement. Firestore checkpoints and terminal writes
compare process UUID/generation. Admin discovery scans 25-document pages and
exposes expired claims after restart; selected status reads persist classification; explicit recovery audits abandonment
and conditional fleet-lock release after verified executor termination.
[Operation resources](../api/OPERATION_RESOURCES.md) defines the external
Auth/Google fencing boundary and staging gates.

Reconciliation bounds queries/results/caches to 100 records and uses four per-session or ten fleet Auth pipelines. Hourly session and ten-minute fleet scans persist document-ID checkpoints through the worker lease transaction; a held SDK call retains scan ownership across leadership changes. Admin jobs expose continuation, while per-bus device/driver guards visit every page. All fleet Auth mutations share the no-takeover mutex and record bounded audit progress. See [reconciliation](../operations/RECONCILIATION.md) for partial mutation and cross-store limits.

Passenger geometry GET uses bounded cached read-only documents; watcher edits and local saves/deletions invalidate it. All admin geometry pipelines share two raw slots/eight waiting with undispatched queue expiry; no passenger GET invokes Google. See [geometry read/repair contract](../operations/ROUTE_GEOMETRY_READS.md).
