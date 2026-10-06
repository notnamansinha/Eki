# Eki backend

Last updated: 2026-10-05 17:01 IST (UTC+05:30).

The TypeScript/Express backend is the authority for hardware ingestion, fleet/route/device commands and ordered ride lifecycle. It uses Firebase Admin with service-account JSON or Application Default Credentials, writes current data to RTDB and durable state to Firestore, and elects one background worker with a Firestore lease.

```powershell
npm ci
Copy-Item backend/.env.example backend/.env
```

For local use, change the copied values to `NODE_ENV=development`, `PORT=4000`
and `CORS_ORIGIN=http://localhost:3000`. Fill the development RTDB URL and
Firebase credentials; keep `RETENTION_SWEEPER_ENABLED=false`. The template
uses production mode and port `8080`, and production intentionally refuses
startup while retention is disabled.

```powershell
npm run dev --workspace=backend
```

Important configuration is fully described in `.env.example`: exact CORS origins, `FIREBASE_DATABASE_URL`, server-restricted Maps key, device/auth limits, stale/reconciliation periods, worker identity and mandatory production retention enforcement. Production should prefer Workload Identity/ADC; if `FIREBASE_SERVICE_ACCOUNT` is used, provide the complete JSON through a secret manager.

```powershell
npm run lint --workspace=backend
npm run test --workspace=backend
npm run build --workspace=backend
```

Check `http://localhost:4000/health`: `200`/`status: ok` means Firestore and
RTDB probes are ready; `503`/`status: degraded` means dependency readiness is
failing. RTDB requires a true `.info/connected` snapshot. Probes run every 30s
with a 5s response deadline, at most one unsettled call per store, and 65s
monotonic freshness. Late results cannot restore readiness. `/live` returns
`200`/`status: alive` independently of Firebase. Docker/container restart probes
use `/live`; load-balancer traffic readiness uses `/health`. All health responses
are no-store. The admin-only `/api/health` contains detailed diagnostics.

## API and jobs

- `bootstrap.ts` initializes optional instrumentation before the server.
- Device routes authenticate per-device credentials and preserve current plus
  previous telemetry schemas during fleet rollout.
- Browser HTTP routes verify Firebase ID tokens; privileged routes additionally
  check trusted claims and assignments. Admin feedback reads use
  `GET /api/v2/feedback`, returning at most 200 timestamp-ordered records.
- The lease-owned worker advances ordered ride progress and runs recovery,
  privacy and retention. Terminal deletion is resumable; active ownership and
  current geometry pointers are protected.
  [Worker leadership](../docs/operations/WORKER_LEADERSHIP.md) defines independent
  monotonic expiry, destination fencing, clock tolerance and side-effect limits.
- `npm run retention:rtdb --workspace=backend -- --dry-run` inventories RTDB
  retention without mutation. Follow [retention](../docs/operations/RTDB_RETENTION.md)
  before applying cleanup or enabling legacy-tree retirement.

## OpenTelemetry diagnostics

The backend enables vendor-neutral traces, metrics, and structured logs when
`OTEL_EXPORTER_OTLP_ENDPOINT` or `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` is set.
It captures inbound Express requests, supported outbound clients, failed
request exceptions, correlated application logs, Node.js runtime metrics,
dependency readiness, authentication outcomes, device-ingestion health, and
background-worker failures. `/health` and `/live` are excluded from request telemetry to
keep probe traffic from obscuring real failures.

Start the local Collector and Jaeger UI, then run the backend with the endpoint
from `.env.example` enabled:

```powershell
docker compose -f observability/docker-compose.yml up -d
npm run dev --workspace=backend
```

Open `http://localhost:16686`, select `eki-backend`, and search for traces with
the Error tag. Stop the local stack with:

```powershell
docker compose -f observability/docker-compose.yml down
```

The included stack is for local diagnosis and uses in-memory trace storage;
metrics and logs are printed by the local Collector's debug exporter. Point the
same OTLP variables at Grafana Cloud, Alloy, or another persistent Collector in
deployed environments. Grafana's complete authorization header belongs in a
secret manager, never source control. Set `OTEL_SDK_DISABLED=true` to disable
all three signals immediately.

Provision a device only after bus and route records exist:

```powershell
npm run provision-device --workspace=backend -- `
  --device-id device_01 --bus-id bus_01 --route-id route_01
```

This transaction rejects duplicate assignment/active ride/active bus lock, generates a random secret, stores only its salted scrypt verifier, and prints the plaintext once.

See [API reference](API.md), [LLD](../docs/design/LOW_LEVEL_DESIGN.md), [Firebase model](../docs/data/FIREBASE_DATA_MODEL.md), and [test strategy](../docs/testing/TEST_STRATEGY.md).

For a first-time setup, role/workflow explanation, environment-variable
reference, troubleshooting, and the boundary between Hosting deployment and
backend/runtime deployment, read [Getting started](../docs/GETTING_STARTED.md)
and [configuration](../docs/CONFIGURATION.md).

Worker/KDF admission has fixed process-local active, waiting and five-second
queue-age ceilings. Durable FIFO work and replaceable matching use separate
pools; rejected lifecycle events trigger bounded authoritative-state replay.
Admin health exposes anonymous queue counters. See
[work admission](../docs/operations/WORK_ADMISSION.md) for limits, recovery,
uncertain-commit safety and the synthetic memory acceptance command.

[Telemetry deadlines](../docs/operations/TELEMETRY_DEADLINES.md) define bounded
service responses/dependency stages, per-device execution and unknown-commit
retry behavior. A timed-out dispatched SDK call keeps its slot until settlement.

Durable preview/fleet work has bounded admission/execution and persisted progress.
After an executor crash, use paginated discovery and the audited recovery APIs in
[operation resources](../docs/api/OPERATION_RESOURCES.md). Verify the previous
executor stopped; unknown billable/Auth work is never automatically replayed.
The emulator suite kills a disposable child after a real claim/effect commit.

Reconciliation and per-bus guards/repairs visit all document-ID pages of 100 with bounded pipelines and targeted RTDB reads. Workers persist fenced page checkpoints; all fleet Auth-changing paths share a durable recovery mutex. See [continuation and recovery](../docs/operations/RECONCILIATION.md); actual Auth/replica/latency acceptance remains staged.

Passenger deletion now preserves resubmission history, uses bounded fair chunks and backoff, and exposes admin recovery for failed/interrupted claims. See [privacy deletion](../docs/operations/PRIVACY_DELETION.md); live Auth, staging indexes and concurrent-client quiescence remain acceptance gates.

Live matching and pending directions share a watcher-populated, versioned read-only route catalog, with bounded LRU entries and coalesced monotonic freshness reads. Telemetry never repairs missing configured geometry through Google. See [route catalog](../docs/operations/ROUTE_CATALOG.md) for edit/deletion fences, uncertain direction commits and staging limits.

Passenger geometry reads are cached and read-only; explicit versioned admin saves perform legacy repair through bounded computation. See [geometry read/repair contract](../docs/operations/ROUTE_GEOMETRY_READS.md) for fixed bounds, independent quotas and staging limits.

Authenticated analytics/catalog/live HTTP reads now coalesce within fixed work and memory budgets. Optional full-count analytics uses idempotent native read-time aggregation; sampled responses and legacy adapters remain supported. See [API reads and retirement](../docs/operations/API_READS_AND_RETIREMENT.md) for paging, cache freshness, assignment revocation, measurements and caller evidence.
