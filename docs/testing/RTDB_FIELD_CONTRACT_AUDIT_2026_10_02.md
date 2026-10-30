# RTDB field contract audit: 2026-10-02

| Document ID | Version | Status | Last updated |
|---|---|---|---|
| EKI-EVD-051 | 1.0 | Historical | 2026-10-04 |

> Historical evidence: original run dates, commits, measurements and limits below remain authoritative for that run. This documentation update does not rerun the test. See [current testing gates](README.md).

Scope: writers, application readers, lifecycle recovery, authorization rules,
latency exports, and a read-only inventory of the configured testing database.
Baseline: `origin/testing` at `a12368f7`. No live records were changed. This is
an audit of the current repository contract, not proof about external clients
or every possible physical failure.

## Decisions

| Field/problem | Decision | Compatibility and evidence |
|---|---|---|
| `activeBuses/*/rtdbCommittedAt` | Retire on the next accepted fresh fix | Identical server timestamp to `receivedAt` in the same transaction. Current browsers already fall back to `receivedAt`. New exports prefer it and retain the `rtdbCommittedAtMs` export key and historical alias fallback. A malformed retired alias no longer rejects an otherwise valid bus. Issue #211. |
| `activeBuses/*/activeRoutePolyline` | Retire on the next accepted fresh fix | No current application reader or producer; both current geometry loaders use the versioned sibling store. Keeping it through object spreads repeats obsolete geometry in every live snapshot. Keep its lifecycle cleanup entry for old nodes. Issue #211. |
| `mapMatchSeq`, `mapMatchSampledAt` | Keep during telemetry; clear on context reset | Completed-without-confident-match is different from pending matching. Old sample IDs must not survive clearing the previous direction/session's results. Issue #212. |
| Invalid or oversized sibling geometry | Fall back safely | Browser decoding errors previously rejected the pending fetch batch. Catch malformed geometry and enforce the same 500,000-character limit as the backend. Retain once-per-version caching and transient-read retry behavior. Issue #213. |
| Historical sibling geometry; legacy profiles/chat | Keep pending a separate migration | No retention path exists for these copies. Removing active geometry or unidentified legacy records in bulk needs a protected pointer, reader grace period, provenance/cutoff inventory and a tested purge. Issue #214 remains open. |

Only two named obsolete fields are removed from an accepted telemetry
transaction. Do not replace preservation with a field allowlist: another
backend version or lifecycle transaction can introduce legitimate state.
Stale/equal duplicate samples still abort without mutation. No database-wide
cleanup, rule relaxation, firmware change, or reduction of durable ride history
is part of this PR.

## Field inventory and reasons to keep

The existing data-model document defines types. This table records why each
current field family is required or useful and identifies its owner/consumer.
Fields may be absent until their lifecycle or matching stage starts.

| `activeBuses` fields | Writer and reader/purpose | Removal risk |
|---|---|---|
| `busId`, `routeId` | Authenticated device assignment, shift API; fleet/maps/authority joins | Composite keys cannot be safely split when IDs contain underscores. |
| `lat`, `lng`, `speed`, `heading`, `motionState`, `gpsHdop` | Telemetry ingestion; lifecycle, matcher, freshness, admin/passenger views | Losing accepted position, movement/uncertainty or GNSS quality changes stop and plausibility decisions. |
| `timestamp`, `seq` | Device/ingestion; monotonic ordering, lifecycle, sample correlation | Device reboot can restart sequence; time orders samples, sequence breaks equal-time ties. Neither alone replaces both. |
| `deviceSentAt`, `backendReceivedAt`, `receivedAt` | Device, ingress boundary, Firebase server respectively; freshness/timing exports | Distinct clock/phase boundaries. `backendReceivedAt` is used by freshness logic; `receivedAt` is the canonical commit timestamp. |
| `rawLocation` (`lat`, `lng`, `speed`, `heading`, `gpsHdop`, `motionState`, `seq`, `sampledAt`) | Ingestion; diagnostics, marker sample identity, latency correlation | Original GNSS fix can differ from the plausibility-filtered live position. Do not substitute snapped coordinates for it. |
| `plausibilityAnchor` (`lat`, `lng`, `speed`, `gpsHdop`, `timestamp`) | Ingestion; next plausibility check | Held outliers advance live time but must not advance the last physically accepted anchor or reset reacquisition timing. |
| `deviceState`, `signalState` | Ingestion/stale worker; connectivity views and diagnostics | Device power/connectivity, GNSS uncertainty and ride ownership are different states. A missing direct UI reader does not make the diagnostic explanation obsolete. |
| `status`, `sessionId`, `driverId`, `tripState` | Shift/lifecycle/recovery worker; APIs/maps/session authority | A powered device does not establish an authorized passenger service; preserve ride identity across hardware outages. |
| `direction`, `directionState`, `directionEndpointVersion`, `originStopId`, `destinationStopId` | Shift/inference/turnaround; ordered-stop engine, maps, authority | Prevent wrong-direction progress and geometry while inference is pending; retain the endpoint snapshot used for inference. |
| `directionFirestoreSynced` | Telemetry direction projection; retry guard | One-time durable direction synchronization must retry after failure without repeating writes on every fix. |
| `currentStopIndex`, `hasDepartedOrigin`, `delayMinutes`, `delayUpdatedAt`, `lifecycleUpdatedAt` | Shift/trip engine; ordered progress, recovery, delay conflict checks | Removing checkpoint/revision state can regress progress or replay an older delay. |
| `completedAt`, `turnaroundEligibleAt`, `turnaroundSampledAt` | Completion/automatic turnaround worker | Dwell deadline and minimum fresh-fix time are separate, especially when configured dwell is zero. |
| `turnaroundClaimId`, `turnaroundClaimedAt` | Automatic-turnaround transaction | Cross-replica ownership and stale-claim recovery prevent duplicate return sessions. |
| `automaticTurnaround`, `previousSessionId` | Return-session activation; recovery/history explanation | Preserve the relationship between the completed ride and its automatic return. |
| `activeRouteId`, `routeVersion`, `routeSource`, `routeDirection`, `routeSessionId`, `routeGeometryVersion` | Matcher/reroute activation; geometry selection and context guards | Bind results to session, travel direction, configured geometry revision and dynamic reroute version. Similar IDs have distinct roles. |
| `routeState`, `offRouteSampleCount`, `routeMatchHistory` | Matcher; off-route detection/rerouting | State/hysteresis and bounded last four accepted samples prevent noisy GNSS from repeatedly triggering billable reroutes. |
| `matchedLocation` (`lat`, `lng`, `segmentIndex`, `segmentFraction`, `alongRouteDistanceM`, `distanceToRouteM`, `headingDifference`, `matchConfidence`, `seq`, `sampledAt`, `routeVersion`) | Matcher; current match/marker and previous-match continuity | Position plus segment/progress/quality and context identity prevent ambiguous snapping and using stale results. Some metadata is diagnostic; do not discard the whole result. |
| `mapMatchSeq`, `mapMatchSampledAt`, `mapMatchUpdatedAt`, `matchConfidence`, `distanceToActiveRoute` | Matcher; marker selection and diagnostics | Sample identity distinguishes completed no-match from pending; completion wall time and quality explain asynchronous results. |
| `rerouteRequestId`, `lastRerouteAttemptAt` | Reroute claim/activation | Async ownership and cooldown prevent stale responses from publishing over a newer context and prevent repeated requests. |
| `rerouteError`, `rerouteCompletedAt`, `rerouteFailedAt` | Reroute service; operator diagnostics | Useful low-volume outcome data. Stored error is a sanitized constant, not raw provider credentials or response content. |

## Other roots

| Path/fields | Decision and reason |
|---|---|
| `activeRouteGeometry/{nodeKey}/{version}/polyline` | Keep: current frontend/backend geometry loaders read it once per version. Putting it back into `activeBuses` increases every telemetry payload. |
| Geometry `routeId`, `direction`, `source`, `routeVersion` | Keep as low-frequency human-readable provenance. Current loaders select by pointer and read `polyline`; they do not validate these descriptive fields. Do not describe them as existing runtime authorization guards. Removing small immutable metadata has little hot-path benefit. Historical versions need lifecycle retention (#214). |
| `driverRouteAssignments/{driverId}/{busId}/{routeId}: true` | Keep: fleet reconciliation reads this server-only mirror and compares it with expected authorization. Claims and Firestore copies do not make the mirror write-only. |
| `_deviceRateLimits/{deviceId}/startedAt`, `count` | Keep: shared window and issued token reservations enforce the fleet ingress budget across replicas. Resetting/removing them can issue a second budget in the same minute. |
| `_deviceCredentialVersions/{deviceId}/nonce`, `updatedAt` | Keep: changed nonce invalidates cached credentials across replicas, even if successive changes share a millisecond. `updatedAt` provides operator audit timing. Removing the root can impair prompt revocation. |
| Legacy `users`, `messages` | No current repository application readers/writers; client reads/writes are denied by default. Populated legacy copies require a provenance/timestamp migration before deletion (#214). Current profiles/chat live in Firestore. |
| `.info/connected`, `.info/serverTimeOffset` | Firebase-managed connection and clock-offset metadata. Do not treat these as user-owned stored fields or purge targets. |

Client rules allow authenticated reads of `activeBuses` and
`activeRouteGeometry`; every client write is denied. The other listed roots
are server-only or denied by the default rules. These rules do not restrict
Admin SDK access. Device secrets/credential hashes belong in protected
Firestore device records, not the readable live projection.

## Observed database and impact

Read-only inventory at **2026-10-02 17:12:11 UTC**:

| Root | Top-level records | Estimated JSON bytes |
|---|---:|---:|
| `activeBuses` | 1 | 694 |
| `activeRouteGeometry` | 0 | 4 (`null`) |
| `driverRouteAssignments` | 1 | 37 |
| `_deviceRateLimits` | 1 | 52 |
| `_deviceCredentialVersions` | 1 | 76 |
| Legacy `users` | 3 | 867 |
| Legacy `messages` | 5 | 2,365 |

The live node had the duplicate timestamp and no inline route polyline. Thus
the immediate observed saving is only one timestamp member per live update;
the larger geometry saving applies to historical inline-populated nodes.
The regression fixture proves an obsolete 160,000-character inline value is
removed while current matching, lifecycle and unknown fields survive.
JSON byte counts exclude transport framing, compression, billing and browser
work. They do **not** prove a measured end-to-end latency reduction.

The ignored private `temp/rtdb-field-inventory.json` records only field names,
types/counts and byte totals; no coordinate, message, UID, token or credential
values are committed with this report. Earlier serial/network/profiler captures
remain in the original ignored live-audit directory.

## Validation and dependencies

Regression tests cover retirement from old nodes, preserved state, route-context
sample-ID cleanup, canonical/legacy/conflicting receipt timing, malformed retired
aliases, corrupt/oversized geometry, valid-version recovery and existing
transient network retry behavior. Run backend/frontend tests, script contract
tests, lint, backend type compilation and the strict production CI build.

Local results: 551 backend tests passed (7 emulator-only skips), 230 frontend
tests passed, and 50 script tests passed. Lint, backend compilation, OpenAPI
coverage and UI contracts passed. The first parallel backend run hit an
existing five-second diagnostic pool-test timeout; running with two workers
passed without changing its assertions or timeout. GitHub CI provides the
strict production build and emulator/firmware gates for the PR's final commit.

This branch carries the identical small feedback-page extraction from PR #210
(issue #208) because `testing` still contains unsupported Next.js page props.
That prerequisite makes this PR independently buildable; it does not carry
PR #210's ride recovery or 180-day retention implementation. Keep that PR's
retention work: this audit does not replace it. Issue #214 remains a distinct
RTDB legacy/history retention gap.
