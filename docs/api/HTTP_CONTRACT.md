# HTTP contract and compatibility checks

Last updated: 2026-10-08 08:22 IST (UTC+05:30).

The machine-readable contract is [`backend/openapi.json`](../../backend/openapi.json),
in OpenAPI 3.1.1 JSON format. [`backend/API.md`](../../backend/API.md) remains the
human-oriented guide. The contract includes #197 compatibility, #193
ride-session resources, #194 operation resources and the admin feedback list.
Use `npm run verify:openapi` for the actual operation count and registered-route
coverage. These routes are implemented on `testing`; verify deployment before
migrating an independently deployed client. Endpoint renaming alone does not
improve latency; measure only changes in response shape, caching, or transport.

Run from the repository root:

```sh
npm run verify:openapi
npm test
```

The production verification workflow runs the contract check explicitly, and
`npm test` runs it too. The checker parses TypeScript registrations in
`backend/src/server.ts`, follows imported default/named routers and their
mount prefixes, and compares method/path pairs in both directions. It never
boots the server, starts workers, or reads Firebase. New routes, stale spec
entries, duplicate registrations, broken references, missing path parameters,
and missing policy metadata fail the gate. Dynamic paths/mounts, mountless
middleware chains, `router.route()` and `router.all()` fail until the inventory
supports them explicitly. Automatic
Express HEAD handling and CORS OPTIONS responses are middleware behavior,
not separately registered business operations. TRACE/CONNECT are rejected
with 405; authenticated unknown API routes return 404, while missing or invalid
browser credentials fail first with 401.

OpenAPI structural validation uses Swagger Parser; response and payload
conformance uses Ajv's JSON Schema 2020 validator. The parser remains on 12.x
because the repository pins the 4.x js-yaml API; 13.x requires a different
js-yaml API. The pinned yaml patch is updated to 4.3.2. Validation resolves only
internal references and has no network dependency. JSON Schema expresses
shape/range constraints; database eligibility, normalized string limits,
relative timestamps, stop order, and cross-field/version checks remain in
handlers and are documented in operation descriptions.

Each operation declares `security` and these `x-` extensions:

| Extension | Meaning |
|---|---|
| `x-auth-class` | Public, Firebase user, admin, passenger, assigned operator, or session member policy beyond token validity |
| `x-body-limit-bytes` | Maximum raw JSON bytes parsed, not the normalized object size |
| `x-rate-limit` | Global, mount-level, dedicated and durable budgets actually applied |
| `x-cache-policy` | Actual response headers and private server cache behavior |
| `x-timeout-policy` | Receipt/upstream/client deadlines; no invented whole-handler SLA |
| `x-retry-policy` | Retryable failures and reconciliation guidance |
| `x-idempotency` | Actual replay key or convergent behavior, including repeated side effects |
| `x-compatibility-alias-of` | Replacement operation for a supported legacy URL |

Bearer security identifies a Firebase ID token; it does not imply admin rights.
Device security is a header API key whose complete value is
`Authorization: Device <secret>`. Device credentials are never bearer tokens.
Responses omit credentials and stacks. Typical errors have `error`; route and
Places errors may additionally carry `code`, `phase`, version/outcome details.
Parser and authentication failures can precede handler-specific headers/errors.
On detailed health, 503 can be a readiness snapshot or authentication-busy error.

Public `GET /live` returns `200 {"status":"alive"}` without querying dependencies.
Docker/container restart probes use it. Load-balancer readiness uses `/health`:
RTDB must return `snapshot.val() === true` and Firestore must succeed. Cached
per-store probes run every 30s, have a 5s response deadline and 65s monotonic
freshness. An unsettled call keeps its single-flight slot after a response
timeout, preventing repeated probes from accumulating. Late completion cannot
publish success. All three health endpoints return `Cache-Control: no-store`.
Admission and route/admin middleware reuse a verified token only within the
same HTTP request. This avoids duplicate privileged Auth checks; every new
request still follows the revocation-aware policy. An injected `req.user` or a
different token cannot establish that request-scoped verification.

The server applies strict JSON parsers: 16 KiB generally, telemetry 512 bytes,
diagnostics 1 KiB. CORS/preflight precedes the 1,000/normalized-IP/minute browser ingress guard.
Verified-UID quotas separately allow 200 reads/minute and 30 mutations/minute;
GET/HEAD polling never consumes mutation tokens. Public GET/HEAD probes and
exact device ingress paths are exempt from browser ingress; detailed admin
health stays authenticated and exempt from the user read quota. `/api/routes` applies the 10/UID/minute
compute budget to mutations including deletion; geometry and save-operation reads skip
that budget. Segment planning uses 30/verified UID/minute. Places uses a replica-sharded
20/verified UID/minute limiter. Device ingress has separate pre-auth IP pools and an
authenticated telemetry budget. Read the per-operation policies before
designing polling or retries; edge rate protection remains a deployment concern.

HTTP requestTimeout bounds receipt of a request body, not service execution.
Places uses a 5-second whole-response upstream deadline. Google Routes chunks
use 10-second deadlines; route save has a 30-second operation lease and the
browser reconciles unknown outcomes using the same save ID. Current 202 route
responses carry `retryAfterMs`; they do not yet emit `Location` or `Retry-After`.
Fleet audit fingerprints are audit records, not durable HTTP replay guarantees.

Device authentication cache misses have a separate 5s monotonic response budget
and bounded single-flight capacity: 16 unsettled fills, 64 waiting callers per
digest. Timeout preserves the underlying slot until actual settlement, and
expired/invalidation-fenced fills cannot publish authorization. Positive/negative
TTLs are at most 60s/5s from fill start and are never extended by cache access.
Capacity/deadline failures are transient 503; this budget does not yet bound
every subsequent ingestion dependency (R03). See the device operation policies.

## Realtime channels are Firebase SDK subscriptions

These channels are deliberately excluded from OpenAPI `paths`. HTTP remains
the authoritative surface for bounded writes. Authentication, Firebase rules,
and App Check configuration for SDK reads apply independently of HTTP auth.

| SDK channel | Data and audience | Recovery |
|---|---|---|
| RTDB `publicRouteBuses/route:{routeId}/buses` | Authenticated canonical compact per-route browser view; raw `activeBuses` is backend-only | SDK reconnect, bounded worker replay, compatible schema readiness and receipt-based frontend freshness checks |
| Firestore `settings/global` | Service configuration and announcements | SDK listener snapshot/reconnect |
| Firestore `routes` | Route configuration allowed by security rules | SDK listener snapshot/reconnect |
| Firestore `ride_sessions/{id}/messages` | Authorized session chat | SDK listener reconnect; writes use idempotent HTTP message creation |
| Firestore ride history queries | User/admin views constrained by query shape and rules | SDK listener reconnect; writes remain backend-authoritative |

Admin feedback review uses bounded `GET /api/v2/feedback` HTTP reads, rather
than a browser Firestore feedback listener. Both feedback views share the same
panel; old-session reads/writes are aborted or ignored on auth changes.

No application-owned SSE/WebSocket/GraphQL/webhook interface is introduced.
Transport decisions and measurements remain #195. Ride-session compatibility
is specified by #193; operation contracts extend #172 under #194.

## Compatibility and rollout

| Supported legacy operation | Compatible v2 operation | Mapping |
|---|---|---|
| `PUT /api/settings` | `PATCH /api/v2/settings/global` | Same nonempty partial settings object; PUT remains a historical partial merge |
| `POST /api/plan` | `GET /api/v2/routes/{routeId}/segments` | `startStopId/endStopId/viaStopId` become query `from/to/via` |
| `GET /api/routes-list` | `GET /api/v2/routes` | Same bounded metadata/stops projection; no geometry |
| `POST /api/devices/{deviceId}/disable` | `PATCH /api/v2/devices/{deviceId}` | v2 accepts only `{ "enabled": false }` |
| `PATCH /api/feedback/{feedbackId}/status` | `PATCH /api/v2/feedback/{feedbackId}` | Same status-only object and server audit |
| `POST /api/privacy/deletion-request` | `POST /api/v2/privacy-deletion-requests` | Token-derived queue entry; v2 accepts absent body or `{}` only |

1. Deploy the compatible backend first, and smoke-test both
   legacy and v2 paths with their actual role/credential classes.
2. Only after compatible deployment, move browser callers in the #192 follow-up.
   Keep legacy paths throughout the documented compatibility window and rollback.
3. Preserve firmware-called telemetry, diagnostics POST, and firmware GET paths.
   Firmware keeps the current nine-field and previous eight/six-field schemas
   until physical fleet diagnostics confirm rollout. Never remove compatibility
   just because the web frontend migrated.
4. Retirement requires supported-client traffic evidence, fleet inventory,
   announced release notes and owner approval. The #197 policy requires at least
   90 days after frontend migration and 30 consecutive days without supported
   clients using legacy URLs; no calendar removal date is
   scheduled here. Add a separate removal change and update the spec and tests.

## Contract test boundaries

Existing route suites validate real local HTTP responses against the published
schemas for telemetry/diagnostics acknowledgements, OTA descriptors and 204s,
ride boarding and shift lifecycle/delay, route-save replay/processing/conflicts,
settings partial merge, feedback status, route planning and v2 compatibility.
Those suites keep their authorization, validation, race, idempotency and
rate-limit assertions. They use mocked Firebase/upstream services; they do not
prove deployment, real firmware transport, or Google/Firebase latency.

Payload conformance tests compare current/previous firmware shapes and bounded
settings inputs against the actual parsers/handlers. Negative tests demonstrate
that undocumented statuses, malformed responses and route drift fail. Flexible
stored Firestore/RTDB projections permit extra fields where existing records
vary; closed firmware and status/settings request shapes remain strict.

When adding a route, update the spec in the same change, preserve role and
service semantics, provide a schema-backed route test for risky behavior, and
update the human guide when client guidance changes. Avoid introducing a runtime
validator into production just to satisfy this documentation issue.

Ride-session lifecycle, creation-key retention and migration decisions are defined
in [RIDE_SESSION_CONTRACT.md](RIDE_SESSION_CONTRACT.md).

Operation states, budgets, retention and crash recovery are documented in
[OPERATION_RESOURCES.md](OPERATION_RESOURCES.md).

Admin health includes the closed `ExecutionQueueStatus` schema in
`telemetry.workQueues`, with anonymous KDF/lifecycle/intake counters and the
25-item recovery status. Public probes retain their existing shapes. Matcher
and rerouter counters remain in the extensible `routeProcessing` object.
[Work admission](../operations/WORK_ADMISSION.md) defines process-local ceilings,
five-second undispatched expiry, retry behavior and real-settlement ordering.

Telemetry 503 responses now use the closed `TelemetryUnavailable` schema:
`error`, fixed `retryAfterMs: 1000` and `commitState: not_dispatched|unknown`,
with `Retry-After: 1`. Both telemetry aliases share the execution deadline
policy; detailed health adds `workQueues.ingestion`. See
[telemetry deadlines](../operations/TELEMETRY_DEADLINES.md).

Fleet continuation: v2 reconciliation jobs accept optional cursor and return bounded nextCursor/timeBudgetExceeded; each settled page uses a new key. Legacy reconciliation accepts query cursor with CORS-exposed X-Reconciliation-Complete/X-Next-Cursor headers and unchanged aggregate body. Fleet mutations can return retryable 409 while the shared durable mutex is held or 503 on bounded admission/audit failure. See [reconciliation](../operations/RECONCILIATION.md).

Privacy admission has a three-second response budget and per-UID transactional resubmission preserving retry state. Admin GET `/api/v2/privacy-deletion-requests` pages twenty records; POST `/{uid}/recovery` compares executor/generation and audits deliberate retry. Current Auth plus durable membership checks protect claim-less passenger requests. See [privacy recovery](../operations/PRIVACY_DELETION.md).

Stored geometry GET is read-only and private/no-store. Legacy/invalid geometry returns 409 GEOMETRY_REPAIR_REQUIRED; use an authorized versioned admin save. Read/negative caching is bounded to 100 documents/60 monotonic seconds, raw fills 16, waiters 32 and response 3 seconds. Shared admin computations admit two raw pipelines/eight waiting/two-second queue age (up to four ordered chunks per pipeline). Capacity/expiry responds 503 with Retry-After: 1. See [read/repair procedure](../operations/ROUTE_GEOMETRY_READS.md).

R20 adds compact/paged read options and fixed operation/generation traffic evidence while preserving supported aliases. See [API read behavior and caller inventory](../operations/API_READS_AND_RETIREMENT.md); local counter absence does not satisfy the retirement window.
