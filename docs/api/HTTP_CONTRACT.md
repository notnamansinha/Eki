# HTTP Contract

| Document ID | Version | Status | Last updated |
|---|---|---|---|
| EKI-API-002 | 2.1 | Current | 2026-11-01 |

## 1. Purpose

This document describes how the backend HTTP contract is defined and checked, the rules for changing it without breaking clients, and which data the web app exchanges through Firebase SDKs instead of HTTP. The operations themselves are specified in the [API reference](../../backend/API.md).

## 2. Contract artifacts

| Artifact | Role |
|---|---|
| [`backend/openapi.json`](../../backend/openapi.json) | Machine-readable contract in OpenAPI 3.1.1 [1]. Schemas use the default JSON Schema 2020-12 dialect [2]. All references are internal. |
| [`backend/API.md`](../../backend/API.md) | Human reference. Must name every operation in the contract and no other. |
| `backend/test-support/openapi.ts` | Test helper that validates real HTTP responses against the contract |

Each operation in `openapi.json` declares `security` explicitly (`FirebaseBearer`, `DeviceCredential` or none) and carries these extensions:

| Extension | Content |
|---|---|
| `x-auth-class` | Caller class beyond token validity, for example `admin`, `operator-or-admin` or `passenger` |
| `x-body-limit-bytes` | Maximum raw request body |
| `x-rate-limit` | Limiters that apply to the operation |
| `x-cache-policy` | Response cache headers and server-side caching |
| `x-timeout-policy` | Receipt, upstream and client deadlines |
| `x-retry-policy` | Which failures are retryable and how |
| `x-idempotency` | Replay key or convergent behaviour |
| `x-compatibility-alias-of` | Optional. On an original path, the resource-style path of the same pair |

A `FirebaseBearer` requirement means only that a valid ID token is needed; role and assignment rules are in `x-auth-class` and the operation description.

## 3. Validation

### 3.1 Route inventory check

`npm run verify:openapi` runs `scripts/verify-openapi.mjs`. It reads the TypeScript sources without starting the server or contacting Firebase:

1. It parses `backend/src/server.ts`, follows every router imported from `backend/src/routes` through its mount prefixes, and lists each registered method and path.
2. It fails when a registered operation is missing from `openapi.json`, when `openapi.json` lists an operation that is not registered, or when an operation is registered twice.
3. It validates the document structure with Swagger Parser, with external references disabled, and compiles every component schema with Ajv.
4. For every operation it requires a unique `operationId`, explicit `security`, all seven required extensions, a declaration for each path parameter, a JSON schema for every response except 204, and no body on 204.
5. It requires every `/api` operation to declare 400, 413, 415 and 429, which the shared body parser and limiters can return before the handler runs, and every `FirebaseBearer` operation to declare 401 and 503 as well.
6. It checks that every `x-compatibility-alias-of` target exists.
7. It extracts every `METHOD /path` mention from `backend/API.md`, with `:param` read as `{param}`, and fails on an operation the reference omits or one the contract lacks.

Registration styles the parser cannot resolve fail the check instead of being skipped: computed paths or mount prefixes, `router.route()`, `router.all()`, a middleware chain mounted without a path, and a router created by calling a factory from `backend/src/routes`. Automatic `HEAD` handling and CORS `OPTIONS` responses are not counted as operations.

`scripts/verify-openapi.test.mjs` tests the checker itself, including new unregistered handlers, removed operations, changed mount prefixes, dynamic paths and missing policy metadata.

### 3.2 Response conformance tests

The backend route tests send real HTTP requests to the Express application with Firebase and Google replaced by test doubles. They issue requests through `contractFetch` from `backend/test-support/openapi.ts`, which finds the operation template for the URL and fails when the response status is not declared, a JSON body does not match the declared schema, a declared header has an invalid value, or a 204 response has a body. `backend/src/openapiContract.test.ts` also checks that the telemetry schemas accept and reject the same payloads as the firmware payload parser.

JSON Schema covers shape and ranges. Checks that depend on stored data (stop order, version conflicts, time windows relative to the server clock, assignment and membership) stay in the handlers and are described in the operation text. Acknowledgement bodies and firmware payloads use closed schemas; stored projections such as live records allow extra fields.

These tests do not prove that a deployment is reachable, that real firmware transport works or how fast Firebase and Google respond.

### 3.3 Web and backend release check

`npm run verify:web-backend-contract` runs `scripts/verify-web-backend-contract.mjs`:

1. It reads `NEXT_PUBLIC_BACKEND_URL` from the shell or the frontend `.env` files and fails unless its origin is in the `connect-src` directive of the Hosting Content-Security-Policy in `firebase.json`. With `EKI_STRICT_PRODUCTION_BUILD=true` a missing URL is an error; otherwise the check is skipped.
2. With `EKI_RUNTIME_SMOKE=1` it also calls the live backend: `GET /health` must return 200 with `status: ok` and allow `EKI_FRONTEND_ORIGIN` in CORS, and a CORS preflight for `POST /api/users/bootstrap` must allow that origin, the `POST` method and the `authorization` and `content-type` headers. The preflight creates nothing.

### 3.4 Hosting rewrite check

`npm run verify:hosting-rewrites -- --hosting <origin> [--direct <origin>]` runs `scripts/verify-hosting-rewrites.mjs` against the Firebase Hosting rewrites to the Cloud Run backend (issue #372). It sends GET requests only:

1. `/live` and `/health` must reach the backend and return JSON without a redirect. With `--require-ready`, `/health` must also report `status: ok`.
2. An unauthenticated `/api` request must return the backend's JSON 401 with `Cache-Control: no-store`. A request with `Authorization: Bearer invalid` must return a different 401 body, which shows that Hosting forwards the header. The backend logs that request as a failed token verification.
3. An unknown `/api` path must be answered by the backend as JSON.
4. `/`, `/passenger`, `/admin`, `/sw.js` and `/__/auth/handler` must still come from Hosting, and a page that does not exist must return the Hosting 404, so the rewrite is not a catch-all.
5. It reports the p50, p95 and p99 latency of `/live` through Hosting, and with `--direct` against the service URL, alternating the two. `--max-added-p95-ms` fails the run when Hosting adds more than that to the p95.

Hosting has no rewrite to the backend yet, so the check fails against the live site until the rewrites are added. Run it against a Hosting preview channel before the rewrites are released.

### 3.5 Where the checks run

| Check | Runs in |
|---|---|
| `npm run verify:openapi` | CI step "Verify OpenAPI schemas and registered route coverage", and `npm test` |
| Checker tests and backend route tests | `npm test`, which CI runs on every push and pull request |
| Static web and backend check | `npm run build` |
| Runtime web and backend check | Deploy workflow, before each staging and production release |
| Hosting rewrite check | Manually: against a Hosting preview channel before the rewrites are released, and against the live site after |

## 4. Compatibility rules

1. Change the route, `openapi.json`, [API.md](../../backend/API.md) and a contract-validated test in the same change. `npm run verify:openapi` blocks a change that does not.
2. Deploy the backend before any client sends a new request form. The backend must accept both the old and the new form until no supported client sends the old one.
3. Do not remove or rename a path, field or status code that a supported client uses. Add a resource-style alias or an optional field instead. Removing an original path follows the conditions in the [resource migration](../../backend/API_RESOURCE_MIGRATION.md).
4. The backend accepts the current, previous and legacy telemetry schemas. Remove an older firmware schema only after device diagnostics show that no device sends it.
5. Adding a field to a closed response schema is a contract change: the web app validates acknowledgement bodies and must be checked before such a change ships.
6. Keep role and assignment checks identical on both paths of an alias pair.

## 5. HTTP and Firebase SDK boundary

The web app reads most live and configuration data through Firebase SDK subscriptions, which Firebase security rules govern independently of the backend. These channels are not HTTP operations and are not in `openapi.json`. Writes that need server-side validation or authority go through HTTP; feedback is the exception.

| Channel | Access by the web app | Purpose | Writes |
|---|---|---|---|
| RTDB `publicRouteBuses` and `publicRouteBuses/route:{routeId}/buses` | Listener | Live bus positions and status | Backend projection from telemetry |
| RTDB `liveRouteCatalog/values`, `clientProjectionStatus/public` | Listener | Routes with live service; readiness of the public projection | Backend |
| RTDB `activeRouteGeometry/{nodeKey}/{version}` | One-time read | Geometry of a live reroute | Backend |
| RTDB `.info/connected`, `.info/serverTimeOffset` | Listener | Connection state and clock offset | Firebase |
| Firestore `settings/global` | Listener | Service hours and announcements | `PATCH /api/v2/settings/global` |
| Firestore `settings/passengerRoutes` | Listener | Passenger route schedules: approved routes and a `HH:mm` time per stop. The browser drops malformed entries and skips routes and stops that no longer exist | `PUT /api/v2/settings/passenger-routes`, full replacement |
| Firestore `routes`, `buses`, `bus_locations`, `drivers` | Listener | Route catalog and fleet views | Route and fleet HTTP operations; `bus_locations` also by telemetry ingestion |
| Firestore `users/{uid}` | One-time read | Profile and role | `POST /api/users/bootstrap` |
| Firestore `ride_sessions` queries and `ride_sessions/{id}/messages`, `archivedMessages` | Listener | Ride history and chat | Ride session and chat HTTP operations |
| Firestore `feedbacks`, `feedbackCooldowns` | Transaction write (passenger), one-time read of the latest 200 and status update (administrator) | Feedback | Web app directly, under security rules |

Feedback is written directly so that it works while the backend is unreachable. Firestore rules enforce the same profile requirement, ride eligibility, 24-hour cooldown and admin-only review as `POST /api/feedback`. The backend feedback operations remain for other clients.

The application defines no Server-Sent Events, WebSocket, GraphQL or webhook interface. The choice of Firebase subscriptions for live data is recorded in the [realtime transport decision](../design/REALTIME_TRANSPORT_DECISION.md). Stored records are described in the [Firebase data model](../data/FIREBASE_DATA_MODEL.md), and rule design in the [security architecture](../security/SECURITY_ARCHITECTURE.md).

## 6. References

[1] OpenAPI Initiative, "OpenAPI Specification v3.1.1," spec.openapis.org/oas/v3.1.1.html. Accessed: 2026-10-30.

[2] JSON Schema, "Draft 2020-12," json-schema.org/draft/2020-12. Accessed: 2026-10-30.
