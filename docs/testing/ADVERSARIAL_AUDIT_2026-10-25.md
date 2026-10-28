# Adversarial component audit — 25 October 2026

Last updated: 2026-10-27 12:00 IST (UTC+05:30).

Branch: `fix/audit-tdd-2026-10-25`, based on `6e8604f77dbf7cc5fbaf34dd262cbfbde576206d`
and ending at `8fc7ef068c848f75d6429a4a2c3d135a235e9bfe` before this documentation
update (PR #382). The branch carries 68 commits: 64 fix and test commits
(including the CodeQL follow-up), two documentation commits and two regenerated
CSP-hash commits. SHAs below are the commits on this branch; per-area work
branches were integrated without conflicts.

This is a software audit. It does not replace the physical, moving-route,
deployed-provider or institutional gates in the [testing index](README.md).

## Scope

Sixteen areas were attacked independently: `ingest`, `routing`,
`ride-lifecycle`, `recovery-worker`, `http-security`, `admin-api`,
`privacy-retention-cli`, `frontend-auth`, `frontend-passenger`,
`frontend-admin`, `feedback-messaging`, `rules`, `pwa-sw-build`, `firmware`,
`e2e-browser` and `live-probe`.

## Method

- **TDD fix per defect.** Each defect was first reproduced with a failing test,
  then fixed in its own Conventional Commit; many commit bodies describe the
  failure scenario. Behaviour that looked wrong but is documented design was
  recorded, not changed.
- **Independent skeptic review per area.** A second agent re-ran each area's
  tests, reverted only the source change of every fix to confirm its test then
  failed, checked contract/doc/QA-map impact and kept, reverted or completed each
  commit. Follow-up commits from review are listed with their area.
- **Live probing was non-mutating.** The running development backend (`:4000`
  and its tunnel) and frontend (`:3000`) received only read-only or rejected
  requests (about 230 in total). No writes were made to real Firebase; rules,
  integration and browser work used synthetic adapters or `demo-eki-qa`
  emulators on loopback.

## Results by area

### ingest

| Commit | Fix |
|---|---|
| `398268f` | Credentials are verified before a telemetry request takes an ingestion slot; a guessed-ID flood waiting on scrypt no longer answers every verified device with 503 |
| `13102e4` | Undecodable request bodies answer 4xx instead of 500 (folded into the shared handler; see below) |
| `8314e0a` | Firestore-reserved `__x__` device IDs are rejected as invalid credentials (401) instead of a 503 dependency failure |
| `53546c3` | A missing or non-JSON telemetry body answers 400, not 413 |
| `0bb9f0d` | A reserved `__x__` bus/route ID in the device registry is treated as unassigned (403) instead of a 503 every second |
| `65d6eba` | `provision-device` no longer provisions the next flag (`--bus-id`) as an ID |
| `6ee6245` | Verified and rejected credentials are cached in separate 1,000-entry pools, so guesses cannot evict verified devices |
| `5c92f7d` | Test-only lint follow-up |

Held: NaN/Infinity/out-of-range fields, bad timestamps and sequences, closed
schema and `__proto__` keys, duplicate/out-of-order fixes with a correct clock,
authorization header variants, unknown/disabled/unassigned devices, deviceId
injection, gzip bombs (limit applies after inflation), per-device burst
back-pressure and the one-hop `trust proxy` key.

### routing

| Commit | Fix |
|---|---|
| `942ab81` | A repeated polyline vertex no longer marks a match ambiguous |
| `1846176`, `797c2c9` | A live reroute stranded in `REROUTING` after a lost claim is released after 60 seconds (with docs) |
| `d9ea542` | Empty reroute geometry, or geometry that does not start at the bus, is released as a failed attempt; one bus on an unmapped road no longer makes 60 billable calls per minute |
| `961ed01` | Densely sampled vertices (1–5 m apart) no longer mark every fix ambiguous |
| `92e5980` | Reroute race fixtures now start at the bus so they still reach their guards |
| `f3c9676` | Review follow-up: covers empty and single-point departure geometry |

Held: empty/degenerate polylines, truncated encodings, antimeridian/pole math,
non-finite headings and bounds, out-and-back roads with 5 m carriageways, loops,
figure-8s and hairpins in simulation, stationary jitter and poor-HDOP motion (no
provider calls), 10-minute provider outage (6 billable calls under backoff),
missing dynamic geometry after restart, and bounded remaining-stop handling.

### ride-lifecycle

| Commit | Fix |
|---|---|
| `f9707f7` | A closely spaced first stop crossed by the departure segment is consumed instead of stranding the ride at stop 1 |
| `26c07ca` | Moving through a first stop that lies inside the minimum departure radius counts as departure; parked jitter still does not |

The reviewer **rejected and reverted** one fix, "keep the pending-direction fix
as the first resolved segment start" (`08e4d65`, reverted by `ab7c114` on the work
branch; neither is on this branch). Production delivers the direction-resolving
fix twice with the same timestamp, first pending and then resolved, so caching
the pending copy made the resolved delivery look like a duplicate and the reducer
never ran for it. The defect it targeted remains open (below).

Held: full forward and reverse runs, skipped and revisited stops, same-spot and
3 m stops in one fix, two-stop and 8 m routes, one-stop routes, uncertain and
poor-HDOP fixes, stale/future/NaN timestamps, two-fix terminal confirmation,
forged terminal evidence, out-of-range indices, direction inference that never
defaults to forward, and 300-bus admission overload.

### recovery-worker

| Commit | Fix |
|---|---|
| `0c0c907` | Abandoned-ride reconciliation skips unaddressable session IDs instead of failing the page and pinning its cursor |
| `ae52374` | The stale-bus sweeper resumes after the wall clock steps backwards |
| `7f93fdb` | A conflicted new session is failed and its bus lock released in one transaction, so a failed session can never keep the lock |

Held: bounded executors, LRU, worker fences and generations, lease takeover
during a partitioned leader, reconciler dry runs and legacy timestamps, durable
ride recovery under overload, transient failures and revoked leadership, and
compare-before-delete on every lock release.

### http-security

| Commit | Fix |
|---|---|
| `f1f3b43` | Unsupported encodings (415), corrupt gzip (400) and undecodable path parameters (400) are client errors, not logged 500s |
| `9d1681b` | Unmatched paths and methods answer 404 `{"error":"Not found."}` instead of an HTML page that echoes the path; `server.http.test.ts` boots the real `server.ts` |

Held: exact-origin CORS (including on 401/429), forged and expired tokens,
header variants and 15 KB tokens, partial admin claims, `X-Forwarded-For`
spoofing and IPv6 /56 grouping, path-normalisation bypass attempts, device-ingress
auth skip, minimal public probes, prototype pollution, deep nesting, request
smuggling, opaque 500s and Helmet headers.

### admin-api

| Commit | Fix |
|---|---|
| `5dbe894` | Malformed vehicle route assignments answer 400 instead of clearing or dropping routes |
| `f9e218f` | Clearing every route from a vehicle with an operator is 409 before any write; deleting an operator whose Auth account is gone succeeds |
| `f73d3af` | An uncommitted unknown-outcome route save can be retried with the same `saveId` |
| `9daf83f` | `GET /api/buses/:busId` finds a live bus past retired route tombstones |
| `88b30e2` | A reassignment that omits `enabled` keeps a disabled device disabled |
| `6c0d086` | Disabling an unknown device answers 404 instead of creating a phantom registry entry |

Held: fleet/route/settings/pagination validation, active-ride and bound-device
409s, route-save version and idempotency conflicts, lease coalescing, history
deletion guards and device reassignment conflicts.

### privacy-retention-cli

| Commit | Fix |
|---|---|
| `d1b4f26` | Retention windows are capped at 36,500 days so a "keep forever" value cannot abort every daily sweep |
| `a08f11d` | Retention categories settle independently and the RTDB sweep always runs; failures are rethrown afterwards (several as an `AggregateError`) |
| `86faf0a` | `syncRoleClaims` drops stale admin claims when a demoted driver's bus is missing, route-less or malformed |

Held: retention flag and day parsing, the RTDB retention CLI's flag handling and
dry run, timestamp formats, nesting limits, query/index alignment, privacy
deletion refusals and poison-request fairness, and denial of client profile
writes.

### frontend-auth

| Commit | Fix |
|---|---|
| `14e7180` | Sign-in and sign-out keep working when browser storage is blocked or full |
| `1736c56` | An unrecognised legacy profile role is treated as passenger |
| `09a2a8c` | The landing page offers Sign out on a permanent access error and survives blocked storage |
| `a4e29e8` | Test typing follow-up |

Held: popup close/block/slow/double-click, mobile and PWA redirect flows,
redirect errors and lost sessions, auth-restore and claims timeouts with bounded
retry, permanent token errors, partial admin claims, offline bootstrap, other-tab
sign-out, account switches mid-verification, double logout and saved-workspace
abuse.

### frontend-passenger

| Commit | Fix |
|---|---|
| `6eee862` | Live rides with an empty `sessionId` are not retained |
| `af09c2c` | A stale store dispose cannot evict its route successor and open a duplicate RTDB listener |
| `4ea1f02` | Trusted stored geometry replaces a repaired road fallback without a remount |

Held: malformed RTDB fields and children, pending direction, completion
handling, pruning without busy loops, finite ETAs and progress paths on degenerate
and loop routes, a 12,000-step marker fuzz, 50 rapid route scopes, throwing
subscribers, versioned dynamic geometry and a 5,000-bus snapshot.

### frontend-admin

| Commit | Fix |
|---|---|
| `c3aeaea` | A cancelled route save that completes later no longer closes a newer draft |
| `5af09c4` | Fleet registration refuses an existing vehicle/operator ID instead of overwriting it |
| `d8a61d5` | Settings editing is blocked when stored settings fail to load |
| `052ef91` | Editing a vehicle keeps its legacy `assignedRouteId` route |
| `69dfdf2` | Live-ops delay changes are tracked per ride |
| `1fbede5` | Switching admin sections asks before discarding unsaved route/settings edits |
| `ac14ab5` | Failed fleet deletions are shown outside the confirmation dialog |
| `17fe64f` | Failed End ride early / Clear Messages are shown outside their dialogs |
| `bd99b45` | Ride history stays on screen while older rides load |
| `0603bc4` | The live-ops chat follows the receiver's live state |
| `ebbf37b` | Review follow-up: the chat closes when its receiver drops or the ride changes |

Held: typed API errors, route-save reconciliation and stale-version messages,
double-submit guards, form validation, non-Latin route names, empty states,
concurrent settings edits, operator UID conflicts, idempotent boarding codes and
route deletion guards.

### feedback-messaging

| Commit | Fix |
|---|---|
| `54c48fc` | A server cooldown persists across refresh and reopen; a local cooldown is capped at one day |
| `e7bcb9e` | Trimming pasted feedback to the word limit keeps line breaks |
| `36f9b48` | Unread chat messages are counted by ID, so the 200-message window cannot hide them |

Held: idempotent double submit, inert rendering of HTML/script names, offline
retry, per-user cooldown keys, account switch during submit, emulator rules for
cooldowns, ownership and multilingual limits, admin permission errors and the
200-item cap.

### rules

No defects. Thirty scenarios held on a local emulator, including profile
self-escalation, partial and stale admin claims, backend-only collections,
driver/passenger session scoping, RTDB root/deep/multi-path writes, public
projection metadata, and feedback/cooldown abuse. The canonical
`npm run test:rules` wrapper was not re-run because other agents held its fixed
ports; the same rule files ran on private ports (17 existing tests plus 26
probes).

### pwa-sw-build

| Commit | Fix |
|---|---|
| `6099e54` | A newly activated service worker deletes the previous deployment's navigation HTML, so an offline fallback cannot serve HTML whose chunks are gone |
| `33efa36` | `update-csp` fails the build when it cannot write a managed directive (final or missing directive) |
| `9a9ba91` | `verify-openapi` fails closed on a router built by a route-module factory call |
| `93e860f` | Review follow-up: security config test tracks the new CSP helper |

Held: network-only routing for Firebase, auth and backend URLs, no cross-account
cache entries in real Chrome, lookalike Maps hosts, offline navigation fallbacks,
update waiting until tabs close, a real CSP hash check with a negative control,
precache coverage and size, and the verifier's other fail-closed cases.

### firmware

| Commit | Fix |
|---|---|
| `41def84` | Out-of-range GNSS coordinates are no fix instead of a backend 400 that pauses delivery for 30 s |
| `72f265a` | A negative receiver HDOP is no fix |
| `0eb0670` | A stale RMC fix is latched invalid so a `millis()` rollover cannot revive it |
| `93d5cd7` | Threshold table documents the field envelope and latch |

Held: bad-checksum NMEA and UART noise, speed/course bounds, NaN guards,
`Retry-After` saturation, bounded backoff counters, rollover-safe timers, unset
clock gating, offline queue overflow and sequence wrap, response-length parsing,
manifest validation and fail-closed TLS. Native suite 88/88; `esp32dev` builds.

### e2e-browser

| Commit | Fix |
|---|---|
| `4af1bb7` | A null place-search body is reported as unavailable instead of a raw script error |
| `1105df5` | A failed route deletion is shown outside the confirmation dialog |
| `9d7caa8` | New `e2e/production-audit/resilience.spec.ts` (13 cases at three viewports) |
| `b69ad0c` | New `e2e/admin-access/resilience.spec.ts` (10 cases) |

Held: place-search 500/502/malformed/429/offline handling, stale slow responses,
invalid coordinates, hostile names, save 500 and dropped-save reconciliation with
the same `saveId`, single PUT on double activation, passenger offline/resize, two
tabs, reload, back/forward and admin feedback races.

### live-probe

| Commit | Fix |
|---|---|
| `fd29d2c` | Bad charset/encoding and undecodable path parameters answer 4xx instead of 500 |

Held: minimal `/live` and `/health`, 401 for every one of 71 operations without a
token or with a forged `alg=none` admin token, parser 400/413 limits including
gzip bombs, traversal and oversize IDs, prototype pollution, TRACE 405, CORS
through the tunnel, 431 for huge headers and frontend security headers.
The running development backend serves the main checkout, so it keeps returning
500 for these probes until it runs this branch.

## Error-handler consolidation (415 vs 400)

Three areas fixed the same defect independently: body-parser's own 4xx errors
(unknown charset or `Content-Encoding`, corrupt compressed bodies) and the
router's undecodable path parameters reached the last-resort handler and became
logged 500s. The ingest fix answered the encoding cases with the existing 400
`Invalid JSON body.`, because the contract then documented only 400 and 413.
The live-probe fix answered 415 `Unsupported request body encoding.` and
documented it. The http-security fix used stricter detection.

Integration kept one module, `backend/src/lib/requestErrors.ts`:

- 415 for an unsupported charset or encoding, since it is the accurate status and
  distinguishes a bad encoding from malformed JSON;
- http-security's detection: only exposable body-parser 4xx errors and the
  router's 400 `URIError` are client errors, so an upstream error that merely
  carries a status stays an opaque 500;
- the generic `Invalid request.` message for other client errors, plus the 404
  `notFoundHandler` and last-resort 500 handler.

The duplicate `requestBodyErrors` helper was dropped and its test now exercises
the shared handler. This documentation update adds the 415 response to the 69
OpenAPI operations that already declare the parser's 413.

## Final gate results

On the integrated branch:

| Check | Result |
|---|---|
| `npm run lint` | Pass |
| Backend Vitest | 1,346 passed, 73 skipped (emulator cases) |
| Frontend Vitest | 826 passed |
| Script tests | 164 passed |
| `npm run verify:openapi` | 71 operations verified |
| `npm run qa:check` | Pass; the catalog verdict `NOT_RELEASE_READY` is informational |
| `npm run build` | Pass |
| CodeQL on PR #382 | Two false-positive URL-substring alerts in a CSP test, fixed in `8fc7ef0` |

`npm run qa:browser` and the canonical `npm run test:rules` wrapper were not run
in the audit because other agents' emulators held their ports.

## Open defects needing a product decision

None of these is fixed on this branch. Severity is the audit's estimate.

### High

- **A stop passed during a short GNSS loss is lost permanently (ride-lifecycle).**
  A reliable fix before stop k, one queued uncertain or poor-HDOP sample, then a
  reliable fix past stop k: the poor sample becomes the segment start, the reducer
  rejects it, and the ride never passes stop k unless the bus returns to its 2.5 m
  circle. A fix that kept the last reliable fix as the segment start broke the
  deliberate TRIP06 acceptance rule (withhold passage for poor-quality fixes and
  their recovery segment), so it was dropped. Decide whether "GNSS loss never
  changes ride truth" outranks TRIP06.
- **A pending-direction fix that crosses stop 1 can still strand the ride
  (ride-lifecycle).** When direction resolves from the departure trajectory, the
  crossing segment can be lost. The attempted fix was reverted (see above); a
  correct one needs a separate pending-previous slot and must still reduce the
  same-timestamp resolved delivery.
- **Resolved 2026-10-27: passengers whose device clock is more than 10 s slow
  saw no active rides (frontend-passenger).** Server-clamped timestamps looked
  future-dated and the store's ±10 s skew allowance dropped every bus at once. A
  clock more than about 60 s fast also emptied the route catalog, and on admin
  Live Ops a clock 10 s slow or 90 s fast marked every ride "Service paused" and
  zeroed the In Service, Awaiting Start and Direction Pending counts. Freshness
  now uses `serverNow()` (`frontend/src/lib/serverClock.ts`, corrected by RTDB
  `.info/serverTimeOffset`), and the store no longer prunes future-looking
  entries. Regression tests: `serverClock.test.ts`,
  `liveBusStoreServerClock.test.ts`, the "viewer clock skew" cases in
  `liveBusFreshness.test.ts`, `liveBusStore.test.ts` and
  `useLiveRouteCatalog.test.tsx`.
- **An admin can strip another admin's privileges by registering their UID as an
  operator (admin-api).** `PUT /api/fleet/drivers/:id` with an admin's `authUid`
  publishes `role: driver` and removes the admin claim, including for the caller.
  The docs do not say whether admin accounts may become operators.

### Medium

- **GNSS gap longer than 250 m past a stop (ride-lifecycle).** The stop is never
  credited and the ride stays in service even at the terminal; recovery depends on
  the operator or reconciler. The 250 m bounded segment is a deliberate rule.
- **Same loop run twice never anchors (routing).** Every fix is ambiguous, so
  the ride stays `POSSIBLE_OFF_ROUTE`; distinguishing laps needs a design change.
- **Wrong-way travel is `ON_ROUTE` (routing).** A bus driving the forward geometry
  backwards scores 0.6 confidence; whether that is off-route is a policy question.
- **`/api/plan` picks the wrong pass on out-and-back geometry (routing).**
  `closestPolylineIndex` ignores stop order, so a segment can be reversed or omit
  a stop; a fix changes the plan endpoint's contract.
- **A valid 100-stop route save can exceed the 16 KiB body cap (admin-api).**
  Realistic names and coordinates give about 19.7 KB; the cap and the 100-stop
  maximum are both documented.
- **Fleet vehicle/operator edits are last-write-wins (frontend-admin).** The PUTs
  carry no version precondition; fixing needs an `expectedVersion` contract.
- **Fast device clocks break duplicate and out-of-order detection (ingest).** The
  +10 s future clamp makes a retry look newer (202 instead of 200) and lets an
  older queued fix overwrite the live timestamp; fixing needs a separate ordering
  key in the payload and RTDB schema.
- **Unauthenticated floods can still saturate the 4-slot scrypt limiter (ingest).**
  Eviction is fixed (`6ee6245`), but a verified device whose 60 s cache entry
  expired can get 503 during a flood; a full fix needs a separate KDF budget or
  pre-scrypt filtering.
- **Passenger chat unread badge (feedback-messaging).** The panel mounts only while
  chat is open, so messages arriving while closed are never counted and a message
  read in the open chat shows as unread after closing, contrary to plan item
  CHAT13. Fixing needs a background listener or a hidden mounted panel.
- **`syncRoleClaims` leaves claims on profiles with a missing or unknown role
  (privacy-retention-cli).** An admin whose `users/{uid}.role` is removed by hand
  keeps the admin claim; downgrading such users needs security sign-off.
- **`NODE_ENV` with trailing whitespace bypasses the production retention
  requirement (privacy-retention-cli).** `production ` (as produced by Windows
  `set NODE_ENV=production &&`) starts with retention disabled; every backend
  `NODE_ENV` check uses the same strict comparison.
- **Browser/hardware back leaves the passenger page (e2e-browser).** Passenger
  views live in React state without history entries; needs a history-integration
  decision.

### Low

- `CONNECT` closes the socket instead of returning the documented 405
  (http-security); decide between raw-socket handling and changing the API wording.
- The last-resort handler does not delegate when headers are already sent, adding
  a second log line; no route streams before failing today (http-security).
- `SAFE_ID` accepts Firestore-reserved `__x__` IDs on admin endpoints, which would
  give 503/500 instead of 400; tightening is a cross-cutting contract change
  (admin-api).
- The abandoned reconciler retires a 12 h-stale live node before the Firestore
  re-check; fresh session activity in between leaves an active session without a
  live node until the next device fix (recovery-worker).
- `releaseActiveBusLock` is now unused (recovery-worker cleanup).
- A node with terminal evidence from an ended session keeps it when claimed by a
  new manual session; the next non-terminal fix clears it (ride-lifecycle,
  theoretical).
- Lists and the registration duplicate check are capped at 250 documents
  (frontend-admin).
- Fleet inline and registration drafts are not covered by the unsaved-changes guard
  (frontend-admin).
- The settings form briefly shows old values after a successful save
  (frontend-admin, cosmetic).
- Mid-session claim revocation is not reflected until refresh or re-sign-in; the
  backend and rules still enforce (frontend-auth, by design).
- Admin feedback "Total" shows the capped 200 (feedback-messaging).
- A device clock more than 24 h ahead skips the client cooldown check and shows a
  misleading denial message; rules still enforce (feedback-messaging).
- Defence-in-depth gaps that are not reachable today: fleet-scope route clears rely
  on `routeId`, `sliceRoadPath` with NaN bounds, the PassengerMap direction gate
  ignoring `directionState`, and a `NEXT_PUBLIC_BUS_EXPIRY_MS` above about 24.8
  days spinning the timer (frontend-passenger).
- A corrupt non-numeric `failures` field on a privacy request retries forever;
  ISO timestamps without a zone are read in server local time; a blank
  `RTDB_LATENCY_SAMPLES` is rejected rather than defaulted (privacy-retention-cli).
- Maps CacheFirst caches opaque responses for 7 days; a crash between two build
  steps can replay a mismatched cached worker; offline `/passenger/` falls back
  to the sign-in shell; `eki-navigations` has no expiration plugin, now bounded
  per deployment (pwa-sw-build).
- A checkpoint append after an unclean reboot can overwrite a torn slot, losing
  one 10 s checkpoint; a checksummed non-standard RMC talker can re-stamp a fix up
  to 5 s old, and an RMC with empty coordinates commits (0,0) (firmware).
- Place search has no explicit retry control; changing the query recovers
  (e2e-browser).

### Recorded as intended design

- Mobile sign-in on a non-matching auth domain (localhost, tunnel, custom domain)
  uses a popup rather than a redirect (frontend-auth).
- A single NTP response that disagrees with GNSS by more than 1.5 s pauses TLS and
  telemetry for up to 10 minutes, as `hardware/README.md` specifies (firmware).

### Test and tooling notes

- `npm run test:rules` can end `BLOCKED` (ETIMEDOUT) under load because the runner
  gives the whole suite 240 s (rules).
- Load-related timeouts appeared in full backend and frontend runs
  (`qaTelemetrySequences`, scrypt, jsdom component files) and passed on rerun;
  intermittent `ERR_ABORTED` in the admin-access fixture came from a shared Vite
  cache under parallel agents.
