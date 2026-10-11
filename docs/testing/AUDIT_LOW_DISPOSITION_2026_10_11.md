# Readiness audit Low findings: 11 October 2026

This is a disposition of the grouped Low list in `eki-testing-prod-readiness-audit (1).md`, section 5. The audit is input to review, not an instruction to change every behavior. "Open" means the observation still needs work or acceptance; "retained" means the present behavior is intentional under the current contract. None of these entries substitutes for the live acceptance list in #245.

## Backend (30)

| Finding | Disposition |
| --- | --- |
| Unbounded no-query `GET /api/buses` | Open compatibility cost: the no-query legacy response still reads the full node. Indexed, bounded pages are available; retire the legacy shape only after the R20 caller windows. |
| TTL-zero bus lookup cache | Retained: single-flight coalesces concurrent calls; zero TTL keeps deletion and reassignment visible on the next request. |
| Unchecked feedback rating | Resolved: `feedbackService` validates the rating range before storage. |
| Device `enabled` coercion | Resolved: device assignment requires a boolean and has a regression case. |
| `/bootstrap` stale-profile demotion | Resolved in PR #297: fresh privileged Auth claims survive a stale passenger profile; bootstrap returns the current Auth role without demotion or revocation. Dedicated authorization workflows still own offboarding. |
| App Check default off | Open rollout gate: backend enforcement exists but requires registered browser/provider, supported-consumer inventory and deployed verification before switching mode. |
| Plan endpoint per-user throttling | Retained server limit uses verified user identity and sharded route-compute budget; edge/global admission remains a #245 deployment gate. |
| Route-save key-order hash | Withdrawn for the route-save API: it reconstructs fixed-order payload and validated stop objects before hashing, so incoming JSON property order cannot alter the operation hash. The generic helper is not an arbitrary public JSON hashing contract. |
| `routeSegment` `?? 0` | Resolved: missing selected endpoints throw; a via stop outside the saved stop list is explicitly snapped to the polyline and checked for ordering. |
| Optimal-vs-aware routing preference | Retained: the signature identifies stored route geometry/configuration under the optimal contract; live reroute uses the lower-latency aware policy and checks that the source configuration has not changed. Provider/cost measurements remain #245. |
| LRU `clear`/throwing eviction hook | Retained `clear` intentionally drops entries without firing eviction work; trip-state shutdown settles deferred work explicitly. Throwing hooks could still interrupt `set`; review per caller before altering cache semantics. |
| Haversine NaN | Resolved by finite-coordinate validation and tests. |
| Service-account `JSON.parse` | Retained fail-closed startup on malformed explicitly supplied credentials; managed runtime uses ADC. Do not log raw credential text. |
| Google Maps error parse/coordinate validation | Resolved for request inputs and non-2xx responses: `computeRouteGeometry` validates finite in-range coordinates and reports the upstream HTTP status without parsing an error body. Malformed successful provider payloads remain a separate integration concern. |
| Shard-factor typo | Resolved: invalid values fail configuration validation rather than silently using a different budget. |
| Logger Bearer redaction | Resolved for whitespace-separated Bearer tokens by case-insensitive redaction; structured field/sensitive-log review remains a release practice. |
| Scheduler double-count metric | Retained overlapping totals: `processed` counts every settled attempt and `failed` is its failure subset. They must not be added; the interface now documents this meaning. |
| Revoked-token cache window | Retained deliberate bounded window; immediate revocation requires an explicit operational refresh/restart path. |
| Fleet lock no-expiry takeover | Retained deliberate fail-closed lock; recover only after proving the original executor stopped. |
| Chat/feedback skewed retry duration | Resolved in PR #297: future stored timestamps still deny admission, with retry hints capped to the existing cooldown rather than inflated by clock skew. |
| Global 24-hour feedback cooldown | Retained anti-spam policy; change requires product decision. |
| API read cache lacks negative caching | Retained: miss coalescing is bounded and subsequent requests see newly created buses. |
| `routesForBus` cache never evicted | Bounded by one 100-driver reconciliation page and discarded after the job; open if page scope is later enlarged. |
| Diagnostic document-ID validation | Resolved: ingestion checks `SAFE_DEVICE_ID` before credential lookup or document access, including direct service callers. |
| Sixteen-restore skip | Resolved in PR #296 with a pending queue and 24-ride regression; deployed and saturation acceptance remains #245. |
| RTDB retirement before Firestore commit | Open process-failure/failover rehearsal in #245. |
| Geometry cache has no TTL | Retained bounded version-keyed cache; invalidation and memory cap govern it. |
| Lease renewal delays re-election | Open real-replica failure timing and worker-lease acceptance in #245. |
| Privacy deletions concurrency one | Retained conservative destructive sequencing; throughput and late-write acceptance remain #245. |
| Oversized RTDB records exempt from retention | Open inventory, bounded backfill/quarantine and failure rehearsal in #245. |

## Frontend UI (10)

| Finding | Disposition |
| --- | --- |
| Eight-second auth restoration timeout | Retained bounded restoration deadline: slow providers surface a recoverable error and later successful verification clears it. Affected-account/slow-network acceptance remains #245. |
| Missing pulse keyframe | Withdrawn: `pulse-dot` is defined in `src/app/globals.css`. |
| Silent RTDB read failure | Resolved for dashboard/fleet consumers: both pass `onReadError`/`onReadRecovered` and render a visible error state. Offline recovery still needs deployed acceptance. |
| Double stop-rename commit | Resolved in PRs #290–#294; one draft update is made. |
| Fleet save pending state | Withdrawn for the cited buttons: `saving` disables and labels the save controls. |
| Ride-history delete success feedback | Resolved: acknowledged deletion sets a visible `role=status` notice. |
| Feedback status writes serialized globally | Retained conservative mutation order; per-record concurrency is optional UI throughput work rather than an incorrect stored result. |
| Chat 409 generic error | Resolved in PR #297: reused request IDs get a specific conflict message and preserve the draft; an unknown outcome is never represented as accepted. |
| Equal boarding/destination stops | Withdrawn: the destination selector excludes the boarding stop and the join handler rejects equal IDs before a request. |
| Raw Google `photoURL` in image | Informational; controlled by Firebase account profile and browser image/CSP policy. Avoid treating it as a demonstrated script injection. |

## Frontend library (7)

| Finding | Disposition |
| --- | --- |
| `node:` bus-key prefix | Resolved by `busIdFromNodeKey`. |
| Route-save failed status HTTP 200 | Withdrawn for the current path: the failed operation endpoint returns non-2xx and the client surfaces it; retain uncertainty reconciliation for in-flight saves. |
| Reverse polyline fallback | Retained legacy fallback uses the stored route polyline and clears directional quality, forcing authenticated geometry repair for a verified road path. |
| Nonfinite stop coordinates | Resolved by finite-coordinate filtering. |
| Missing timestamp becomes epoch zero | Retained fail-stale representation; it cannot make the bus appear fresh. |
| Stale tunnel CSP origin | Resolved in committed `firebase.json`; the deployed Hosting response still contains the old tunnel and needs a controlled deployment (#245). |
| Shared ten-second App Check acquisition budget | Retained bounded failure behavior; affected browser/provider acceptance remains #245. |

## Hardware (5)

| Finding | Disposition |
| --- | --- |
| Unauthenticated first-boot NTP | Open physical first-boot TLS/GNSS corroboration trial; pinned CA and fresh GNSS cross-check mitigate it. |
| Fleet sequence fixed at one | Open release process: each signed fleet build must advance the sequence and pass monotonicity checks. No fleet signing key exists for this board. |
| Checkpoint sealing pauses offline | Retained: never replace the only committed checkpoint with an unauthenticated or stale record. |
| Development HTTP transport | Retained for local development only; fleet build requires HTTPS at compile and boot. |
| Crypto/TLS/NMEA/OTA host coverage | PR #297 adds real AES-GCM production-codec tampering/recovery, pinned TinyGPSPlus parsing/freshness, production TLS wrapper configuration/task-owned ECDH keys, and actual fleet-artifact signature rejection in CI. Deterministic radio/task/entropy adapters do not certify ESP entropy/acceleration, WiFiClientSecure certificate/hostname transport, OTA installation or rollback; those remain #245. |

## Documentation/configuration (8)

| Finding | Disposition |
| --- | --- |
| Committed CSP tunnel | Resolved in source; old live Hosting revision remains #245. |
| Route-save 202 header description | Resolved: HTTP contract names `Location` and `Retry-After`. |
| Storage architecture client permissions | Resolved: docs distinguish narrow passenger manifest writes from backend fleet projection. |
| `activeBuses` auth-readable claim | Resolved: model says client read/write denied and names `publicRouteBuses`. |
| CI index deployment gate omitted | Resolved: release guide documents index-first readiness. |
| Browser write to `bus_locations` | Withdrawn: current Firestore rules deny all client writes. |
| Missing security scans/SBOM | PR #297 adds CodeQL, blocking fixed HIGH/CRITICAL runtime-image scan and CycloneDX artifact; GitHub secret scanning/push protection are enabled. |
| RTDB route-key shorthand | Resolved: security guide names `route:{routeId}`. |

The unresolved entries stay in #246 or its deployed/hardware tracker #245. No motion, destructive privacy drill, fleet provisioning or production cutover is claimed by this review.
