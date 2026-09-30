# Eki backend

Last updated: 2026-09-14.

The TypeScript/Express backend is the authority for hardware ingestion, fleet/route/device commands and ordered ride lifecycle. It uses Firebase Admin with service-account JSON or Application Default Credentials, writes current data to RTDB and durable state to Firestore, and elects one background worker with a Firestore lease.

```powershell
npm install
Copy-Item backend/.env.example backend/.env
npm run dev --workspace=backend
```

Important configuration is fully described in `.env.example`: exact CORS origins, `FIREBASE_DATABASE_URL`, server-restricted Maps key, device/auth limits, stale/reconciliation periods, worker identity and mandatory production retention enforcement. Production should prefer Workload Identity/ADC; if `FIREBASE_SERVICE_ACCOUNT` is used, provide the complete JSON through a secret manager.

```powershell
npm run lint --workspace=backend
npm run test --workspace=backend
npm run build --workspace=backend
```

## OpenTelemetry diagnostics

The backend enables vendor-neutral traces, metrics, and structured logs when
`OTEL_EXPORTER_OTLP_ENDPOINT` or `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` is set.
It captures inbound Express requests, supported outbound clients, failed
request exceptions, correlated application logs, Node.js runtime metrics,
dependency readiness, authentication outcomes, device-ingestion health, and
background-worker failures. `/health` is excluded from request telemetry to
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

See [API reference](API.md), [LLD](../design/LOW_LEVEL_DESIGN.md), [Firebase model](../data/FIREBASE_DATA_MODEL.md), and [test strategy](../testing/TEST_STRATEGY.md).

For a first-time setup, role/workflow explanation, environment-variable
reference, troubleshooting, and the boundary between Hosting deployment and
backend/runtime deployment, read [Getting started](../GETTING_STARTED.md)
and [configuration](../CONFIGURATION.md).
