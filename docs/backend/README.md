# Eki Backend

| Document ID | Version | Status | Last updated |
|---|---|---|---|
| EKI-PKG-001 | 1.2 | Current | 2026-11-02 |

## 1. Purpose

The `backend` workspace is the Node.js and Express server of Eki. It authenticates GNSS devices and ingests their telemetry, owns the ride session lifecycle, and executes fleet, route, device and account commands for the web app. It uses the Firebase Admin SDK: live state is written to the Realtime Database (RTDB) and durable state to Firestore. One backend process at a time also runs the background worker, elected through a Firestore lease.

This guide covers building, running and operating the package. The HTTP interface is specified in [API.md](API.md); the design is described in the [architecture](../design/ARCHITECTURE.md) and [low-level design](../design/LOW_LEVEL_DESIGN.md). Environment variables are listed in the [configuration reference](../CONFIGURATION.md) and are not repeated here.

## 2. Prerequisites

- Node.js 24 and npm. CI and the container image both use Node.js 24.
- Dependencies installed from the repository root with `npm ci` (the backend is an npm workspace).
- A Firebase project with Firestore and RTDB, and Firebase Admin credentials: either a service-account JSON in `FIREBASE_SERVICE_ACCOUNT` or Application Default Credentials.
- `backend/.env`, created from `backend/.env.example`. The template targets production (`NODE_ENV=production`, `PORT=8080`). For local work, follow [Getting started](../GETTING_STARTED.md) to switch it to development, port 4000 and the local frontend origin.
- Java, only for the Firebase emulator suites.

A production process refuses to start without `CORS_ORIGIN`, without `FIREBASE_DATABASE_URL`, or with the retention sweeper disabled.

## 3. Scripts

Run each script from the repository root as `npm run <script> --workspace=backend`.

| Script | Command | Purpose |
|---|---|---|
| `dev` | `tsx watch src/bootstrap.ts` | Start the server with reload on change |
| `build` | `tsc` | Compile `src/` to `dist/` |
| `start` | `node dist/bootstrap.js` | Start the compiled server |
| `lint` | `eslint src --ext .ts` | Lint the sources |
| `test` | `vitest run src` | Run unit and HTTP tests (no Firebase access) |
| `test:rules-integration` | `vitest run` on the emulator suites | Firebase emulator integration tests. Run them through `npm run test:rules` from the root, which starts the emulators first. |
| `seed` | `tsx src/seed.ts` | Write the predefined routes, with Google route geometry, to Firestore |
| `sync-role-claims` | `tsx src/syncRoleClaims.ts` | Publish Firestore user roles as Firebase Auth custom claims |
| `provision-device` | `tsx src/provisionDevice.ts` | Register a device and print its one-time secret. Usage: `-- --device-id <id> --bus-id <id> --route-id <id>`. See [hardware provisioning](../security/HARDWARE_SECURITY_PROVISIONING.md). |
| `measure:rtdb` | `tsx src/measureRtdbLatency.ts` | Measure RTDB read latency (`RTDB_LATENCY_SAMPLES`, 10 to 500) |
| `retention:rtdb` | `tsx src/rtdbRetentionCli.ts` | RTDB retention sweep: `-- --dry-run` (default) or `-- --apply`. See [RTDB retention](../operations/RTDB_RETENTION.md). |

The root `npm run verify:openapi` checks [`openapi.json`](openapi.json) against the registered routes and against [API.md](API.md). See the [HTTP contract](../api/HTTP_CONTRACT.md).

## 4. Source layout

| Path | Contents |
|---|---|
| `src/bootstrap.ts` | Process entry point: loads `.env`, starts OpenTelemetry, installs the log bridge, then imports `server.ts` |
| `src/server.ts` | Express application: middleware order, router mounts, health endpoints, worker start and graceful shutdown |
| `src/routes/` | HTTP routers, one file per resource area |
| `src/middleware/` | `requireAuth` (any verified Firebase user) and `requireAdmin` (current administrator authority) |
| `src/services/` | Domain logic: telemetry ingestion, trip state engine, route matching, ride start, durable operations, privacy deletion, retention, worker coordination |
| `src/lib/` | Shared utilities: rate limiting, admission, request errors, health state, metrics, logging, geometry |
| `src/instrumentation.ts`, `src/telemetrySdk.ts` | OpenTelemetry start-up and SDK configuration |
| `src/*.ts` (other) | Command-line tools listed in Section 3 |
| `openapi.json` | Machine-readable HTTP contract (OpenAPI 3.1.1) |
| `test-support/`, `test-fixtures/` | Test helpers, including the OpenAPI response validator |
| `Dockerfile` | Container image (Section 8) |

## 5. Start-up and shutdown

`bootstrap.ts` starts OpenTelemetry before any application module loads, so that HTTP, Express, gRPC and `undici` calls are instrumented. It then imports `server.ts`, which:

1. validates its configuration (for example boolean flags, `TRUST_PROXY`, `RATE_LIMIT_SHARD_FACTOR`, the device rate-limit settings and the production requirements in Section 2) and exits on an invalid value;
2. builds the middleware chain and mounts the routers (see [API.md](API.md) for the request pipeline);
3. starts the Firestore and RTDB readiness probes;
4. listens on `PORT` (default `4000`) on `0.0.0.0` and logs `[Operations] Executor identity: <uuid>`, the identity that durable operation records carry;
5. starts the route catalog watcher and the worker coordinator.

The worker coordinator competes for the `_worker_leases` lease (45 s lease, renewed every 15 s). The leader runs the trip state engine, the live bus projection, the retention sweeper, the privacy deletion worker, the abandoned-ride reconciler and fleet reconciliation every 10 minutes. `WORKER_ENABLED=false` keeps a process out of the election. Lease fencing and expiry rules are in [worker leadership](../operations/WORKER_LEADERSHIP.md).

HTTP server limits: request receipt timeout 15 s, header timeout 70 s, keep-alive 65 s, at most 100 requests per socket.

On `SIGTERM` or `SIGINT` the process stops accepting connections, stops the workers, drains durable operations, fleet mutations, privacy deletions, route processing and ride recovery, flushes telemetry and closes Firebase. A 10 s backstop forces exit with status 1.

## 6. Health and liveness

| Endpoint | Caller | Response |
|---|---|---|
| `GET /live` | Container health check | Always `200 {"status":"alive"}`; never reads Firebase |
| `GET /health` | Load balancer, release workflow | `200 {"status":"ok"}` when both stores are ready, otherwise `503 {"status":"degraded"}` |
| `GET /api/health` | Admin | Store status plus process-local telemetry, queue and background-failure counters. See [API.md](API.md). |

All three send `Cache-Control: no-store`. Readiness comes from cached probes, not from a database read per request. Every 30 s the backend runs a one-document query on the Firestore `_health` collection and reads the RTDB `.info/connected` flag; RTDB is ready only when that flag is `true`. Each probe has a 5 s deadline and a result stays valid for 65 s. A probe that completes after its deadline cannot mark the store ready. Background-task failures are reported by `/api/health` but do not affect readiness.

Use `/live` to decide whether to restart the process and `/health` to decide whether to route traffic to it. With placeholder or unreachable Firebase settings, `/health` returns 503 while `/live` returns 200.

## 7. Logging and tracing

The backend writes structured JSON logs to standard output through `pino`, at the level set by `LOG_LEVEL` (default `info`). `console` calls are routed through the same logger. Keys that name credentials, tokens, e-mail addresses, phone numbers or coordinates are replaced with `[REDACTED]`, and bearer values in messages are masked.

OpenTelemetry traces, metrics and logs are exported over OTLP when `OTEL_EXPORTER_OTLP_ENDPOINT` or `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` is set and `OTEL_SDK_DISABLED` is not `true`. The default service name is `eki-backend` and 10% of new root traces are sampled unless `OTEL_TRACES_SAMPLER` is set. Span URLs are redacted, and `/health` and `/live` requests are not traced.

To inspect traces locally, start the Collector and Jaeger stack, set `OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318` in `backend/.env`, and start the backend:

```powershell
docker compose -f observability/docker-compose.yml up -d
npm run dev --workspace=backend
```

Open `http://localhost:16686` and select the `eki-backend` service. Stop the stack with `docker compose -f observability/docker-compose.yml down`. The local stack keeps traces in memory only.

## 8. Container image

Build from the repository root so that npm can use the workspace lockfile:

```powershell
docker build -f backend/Dockerfile -t eki-backend .
```

| Property | Value |
|---|---|
| Base image | `node:24.21.0-alpine3.23`, pinned by digest, for both build and runtime stages |
| Contents | Compiled `dist/`, production dependencies only; npm and npx are removed from the runtime stage |
| Environment | `NODE_ENV=production`, `PORT=8080` |
| Port | `8080` |
| User | `nodejs` (UID 1001, GID 1001), not root |
| Health check | `wget -qO- http://127.0.0.1:8080/live` every 30 s, 5 s timeout, 15 s start period, 3 retries |
| Command | `node dist/bootstrap.js` |

`.dockerignore` excludes `.env` files, so supply configuration and credentials at run time. The CI job `backend-image` builds this image on every push, boots it with placeholder settings, expects `/live` to return 200 and `/health` to return 503 with `degraded`, and scans it for critical and high vulnerabilities.

## 9. Deployment and exposure

The deploy workflow can deploy the backend to Cloud Run only through the optional manual job `deploy-backend-staging`, which deployed the staging service on 2026-11-01. It also publishes the web app to Firebase Hosting and deploys Firestore indexes and the Firestore and RTDB security rules. Before it releases, it runs `npm run verify:web-backend-contract` against the origin in `NEXT_PUBLIC_BACKEND_URL` and stops unless `/health` returns `ok` (retrying for up to 90 s while the backend starts) and the backend accepts the Hosting origin in CORS, including the preflight of an authenticated request. Firebase Hosting has no rewrite to the backend.

For bench tests and demonstrations the backend can still run on a workstation and be reached through a stable ngrok domain; the staging web app no longer uses that setup. Set `TRUST_PROXY=loopback` in that setup so that each tunnelled client gets its own pre-authentication rate-limit bucket. The procedure is in the [ngrok tunnel runbook](../operations/NGROK_TUNNEL.md). The staging service and the remaining steps (Hosting rewrites, the worker handoff and the device reflash) are described in [backend hosting](../operations/CI_CD_AND_RELEASES.md#7-backend-hosting). A hosted deployment needs the items in the [university deployment checklist](../operations/UNIVERSITY_DEPLOYMENT_CHECKLIST.md), including an edge rate limit and `RATE_LIMIT_SHARD_FACTOR` equal to the replica count.

## 10. Related documents

| Topic | Document |
|---|---|
| HTTP operations | [API.md](API.md) |
| Contract validation and compatibility | [HTTP contract](../api/HTTP_CONTRACT.md), [resource migration](API_RESOURCE_MIGRATION.md) |
| Security design | [Security architecture](../security/SECURITY_ARCHITECTURE.md), [browser API security](../security/BROWSER_API_SECURITY.md) |
| Data written by the backend | [Firebase data model](../data/FIREBASE_DATA_MODEL.md) |
| Bounded work queues | [Work admission](../operations/WORK_ADMISSION.md), [telemetry deadlines](../operations/TELEMETRY_DEADLINES.md) |
| Background jobs | [Reconciliation](../operations/RECONCILIATION.md), [privacy deletion](../operations/PRIVACY_DELETION.md), [RTDB retention](../operations/RTDB_RETENTION.md) |
| Route reads | [Route catalog](../operations/ROUTE_CATALOG.md), [route geometry reads](../operations/ROUTE_GEOMETRY_READS.md), [API reads](../operations/API_READS_AND_RETIREMENT.md) |
| Tests | [Test strategy](../testing/TEST_STRATEGY.md) |
