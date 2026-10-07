# API read reduction and compatibility inventory (R20)

## Read behavior

All caches are private to a backend process. Authentication/RBAC runs before each
handler, including cache hits. Responses use `Cache-Control: no-store`. No
principal, membership, assignment or session authorization decision is cached
across requests.

| Read | Compatibility behavior | Optimized behavior |
| --- | --- | --- |
| `GET /api/analytics/fleet` | Same first 1,000 fleet documents and completed trips; existing directional sample counts and `sampleLimit: 1000` retained | Select only the fields used for counts; successful summary cached 10 seconds with `statistics.sampled`, `sampleLimit` and `generatedAt` |
| Same path with `?scope=all` | Explicit opt-in; not substituted for existing sampled callers | Six Firestore native counts in one read-only transaction, including a union of offline/uncertain signals; no history download or retry-sensitive counter writes; `sampleLimit: null` and `sampled: false` |
| `GET /api/routes-list` and `/api/v2/routes` | No-query shape and 250-record limit retained; aliases share the same fill/cache | `select(name,color,stops)`, document-ID ordering, 5-second cache, optional `limit`/`after` pages with `nextCursor` |
| `GET /api/buses` | No-query full-fleet response retained for unknown external clients | 1-second server cache; optional `routeId` filter and `limit`/`after` pages (max 250, one lookahead record) avoid downloading unrelated buses |
| `GET /api/buses/{busId}` | Same first indexed bus record, same inactive 404 | Indexed query limited to one record; simultaneous requests coalesce; no result TTL so later lookups see deletions/session changes |
| Driver-session GET | Genuine driver access still reads driver and bus assignment documents on each request | Already-authorized admins/passenger members skip irrelevant driver checks; ordinary driver GET remains two fresh assignment reads |
| v2 session PATCH | Same operator/assignment predicates | The two handler stages share the identical assignment check within that request only (four document reads become two); later requests recheck immediately |

Native read-time aggregation is idempotent without write markers or migrations:
setting the same completed-trip ID repeatedly counts it once, edits change its
bucket, and deletion/retention/privacy removal stops counting it. All six count
queries share one consistent read-only snapshot. A trip with missing/invalid
direction goes into `unresolved = total - forward - reverse`. Signal-loss OR
counts a bus once even when both flags are set. These are counts of records in
current storage, not lifetime totals including deleted history.

Each read cache bounds eight underlying fills and 32 waiters per fill. Caller
response deadlines are three seconds; a timed-out dispatched SDK read retains
its slot until settlement. Failed, expired or invalidated fills never publish
cache entries. Up to 16 entries of at most 256 KiB are retained per catalog/live
cache (two small analytics summaries); larger legacy responses are served
without retention. TTLs are monotonic. Route save/delete and the existing route
watcher invalidate catalog pages through `invalidateRouteGeometryRead`; delayed
in-flight results cannot undo that invalidation. Other replicas/external edits
are visible within five seconds even without the worker watcher.

Page cursors use stable IDs/RTDB keys. Concurrent insertion before a cursor may
require refreshing from the first page; pages are not a cross-request snapshot.
A page exactly at the limit uses one lookahead record. Invalid/repeated query
parameters fail with 400. Busy/stalled/invalidated read work returns 503 with
`Retry-After: 1`. Full aggregation over large history can scan many index entries;
SDK settlement continues to occupy its bounded slot after a caller deadline.

## Evidence and limits

Run `npm test`, `npm run test:rules`, `npm run lint` and the production build.
The actual loopback integration test uses a separate disposable project and
installs committed RTDB indexes into its isolated namespace. It exercises real
Firestore count aggregation/read-only transactions and RTDB filtered pagination;
HTTP credentials are synthetic and existing middleware tests cover real token
verification behavior. No cloud project or application data is accessed.

The fixture has 1,200 completed trips and 10 fleet records. The original read
shape downloads 1,010 documents (1,036,353 bytes of document JSON) per request; a 32-request full-scope burst now
executes six aggregation queries in one shared fill, counts all 1,200 trips and
retains no history payload. Default sampling still reports 1,000 trips. Repeated
writes and deletion demonstrate idempotency. Additional assertions cover OR
bucket overlap, authenticated cache-hit denial, catalog edit/deletion and alias
paging, route-local bus pages, fresh deleted-bus 404, stalled fill bounds and
invalidation races. Fresh driver reassignment denies the next GET/PATCH;
request-local PATCH reuse reduces four assignment document reads to two.

Firestore native count charges depend on index entries scanned, rather than
returning every matching document. See [Firebase aggregation documentation](https://firebase.google.com/docs/firestore/query-data/aggregation-queries)
and [Firestore billing](https://firebase.google.com/docs/firestore/pricing).
Emulator query/row/payload measurements are not billed production usage or
cloud latency. Native queries still cost reads and very large counts can time
out; caches reduce repeated work, not authorization checks. Roll out and compare
same-window cache fills/hits, SDK query counts, latency and actual project usage.

Detailed admin health adds `telemetry.apiReads` (bounded fill/cache activity) and
`telemetry.apiCompatibility` (fixed operation/generation request and success
counts). Counters are process-local and reset on restart. Exported OTel
`eki.api.compatibility.requests` labels only fixed operation, legacy/v2 and
status class. No token, user, route, bus, session or raw URL is retained.

## Caller inventory and retirement

Repository inventory at the `testing` base `41ffbc7`:

| Caller | Current API | Retirement status |
| --- | --- | --- |
| `routeSaveClient.ts` | Legacy PUT route and GET save-operation reconciliation | Still supported; client retains same save ID and uncertain-commit recovery |
| `RouteManagementPanel.tsx` | Legacy route deletion and compute/save flows | Still supported; admin mutations not removed |
| `PassengerBoardingView.tsx` | Legacy session join | Still supported |
| `MessagingPanel.tsx` | Legacy session message POST | Still supported |
| `DirectionsRoute.tsx` | Legacy `/api/routes/{routeId}/geometry` | Still supported; readonly geometry fetching is not retired |
| `FleetManagementPanel.tsx`, `DashboardPanel.tsx`, `RideHistoryPanel.tsx` | Legacy fleet mutations/reconciliation, shift/history actions and device administration | Still supported; some commands have no equivalent migration contract |
| Settings, privacy and feedback panels | v2 settings/privacy request/feedback status | Existing legacy adapters still supported for external clients |
| Firmware | Device telemetry, diagnostics POST and firmware GET | Unchanged; web migration never authorizes firmware retirement |
| Analytics/catalog/bus HTTP reads | No direct production frontend caller found for these list/analytics endpoints; browser also uses Firestore/RTDB SDK listeners | Unknown external consumers are not assumed absent |

Fixed traffic counters cover catalog, route save/status/preview, boarding/code,
chat, shift start/delay/stop, settings, feedback status and privacy adapters plus
available v2 counterparts. Failures are recorded separately from successful
traffic via status-class metric labels. Export aggregation across replicas and
retain history across restarts; an empty local counter is not retirement evidence.
Existing `http.server.request.count` by route covers other fleet/admin APIs.

No adapter is removed and no frontend protocol is migrated in this PR. The
existing #197 policy requires at least 90 days after frontend migration, 30
consecutive days without supported legacy callers, external/fleet inventory,
release communication and owner approval before a separate removal change.
Repository search cannot establish external-client absence; that deployment
acceptance remains pending. See [HTTP compatibility policy](../api/HTTP_CONTRACT.md).
