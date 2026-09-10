# Telemetry ingestion load test

Use this staging-only procedure to compare request acknowledgement latency and
rate-limit transaction contention before and after the token-lease change. The
load writes valid stopped telemetry into every configured device's live bus
node, so never point it at production.

## Contract under test

The pre-auth IP limiter remains process-local and sharded by the configured
replica count. After device authentication and assignment validation:

- `distributed` mode reserves up to
  `HTTPS_DEVICE_RATE_LIMIT_LEASE_SIZE` tokens in one RTDB transaction and
  consumes them locally. The RTDB count is the fleet-wide upper bound across
  replicas. Lost or unused leases can reduce capacity until the fixed minute
  ends but cannot increase it.
- `local` mode performs no rate-limit database operation. Startup accepts it
  only when both `HTTPS_DEVICE_RATE_LIMIT_MODE=local` and the explicit
  `RATE_LIMIT_SHARD_FACTOR=1` are present.
- A 202 acknowledgement follows a committed ordered transaction on
  `activeBuses/{busId}_{routeId}`. A 200 acknowledgement is a safe duplicate.
  Route matching and lifecycle repair run after that durable acceptance point.

Raw telemetry and matched-route writers both transact on the same live node.
The raw writer rejects older capture-time/sequence pairs and spreads current
lifecycle and match fields into its result. The matcher commits only when the
raw timestamp and sequence it processed are still current, then spreads the
latest lifecycle state. Concurrent callbacks therefore retry against current
state instead of replacing newer telemetry or ride progress.

## Prepare staging

Deploy the baseline and candidate to equivalent staging revisions with the
expected production replica count. Set `RATE_LIMIT_SHARD_FACTOR` correctly on
every replica. Use `distributed` mode for a replicated deployment. Keep the
same Firebase region, runtime size, minimum instances, and load-balancer route
for both revisions.

Create a private JSON file outside the repository with 1–500 staging devices.
Each device must already have a valid registry assignment and secret:

```json
[
  {
    "deviceId": "load_device_001",
    "secret": "replace-with-a-staging-secret",
    "lat": 23.034,
    "lng": 72.55
  }
]
```

Use an ephemeral admin Firebase ID token to capture `/api/health` immediately
before and after the run. Keep it in the process environment rather than the
command or report:

```powershell
$env:EKI_BENCHMARK_ADMIN_TOKEN = "<ephemeral-staging-admin-token>"
```

Health counters are process-local. Pin the health requests to the tested
replica or capture every replica separately when the load balancer does not
provide affinity.

## Run the comparison

Use the expected active fleet size and cadence. Repeat each revision at least
three times after a warm-up run. The explicit flag is a guard against an
accidental production invocation:

```powershell
npm run telemetry:load -- `
  --confirm-staging `
  --base-url https://candidate-staging.example.edu `
  --devices C:\private\eki-load-devices.json `
  --seconds 60 `
  --rate-per-device 1 `
  --out candidate-run-1.json
```

Run the same command against the baseline revision. Clear the token afterward:

```powershell
Remove-Item Env:EKI_BENCHMARK_ADMIN_TOKEN
```

The report excludes device secrets and coordinates. It includes HTTP status
counts, acknowledgement latency p50/p95/p99/max, before/after health snapshots,
and deltas for local decisions, lease hits, shared-store transactions, and
transaction retries. Archive reports with commit, deployment identity, region,
replica count, fleet size, cadence, and test time. Never archive the private
device input file with the report.

## Acceptance record

| Item | Baseline | Candidate |
|---|---:|---:|
| Commit/deployment | | |
| Replica count and region | | |
| Devices × requests/second | | |
| HTTP 202 / 200 / 429 / 5xx | | |
| Acknowledgement p50 | | |
| Acknowledgement p95 | | |
| Acknowledgement p99 | | |
| Rate-limit store transactions | One per authenticated request | |
| Rate-limit transaction retries | | |
| Live-node write p50/p95/p99 | | |

Investigate any 5xx response, accepted count mismatch, ordering regression, or
lifecycle rollback before selecting a lease size. Do not tune the lease merely
to improve the transaction count; availability lost to unused reservations is
part of the decision.
