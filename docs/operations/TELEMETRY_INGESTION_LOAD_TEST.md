# Telemetry Ingestion Load Test

| Document ID | Version | Status | Last updated |
|---|---|---|---|
| EKI-OPS-024 | 1.0 | Current | 2026-10-30 |

## 1. Purpose

This procedure measures telemetry acknowledgement latency and device rate-limit contention on a staging deployment, so that two revisions or two rate-limit lease sizes can be compared. The load writes valid stopped telemetry into the live record of every listed device. Never point it at production.

### 1.1 Rate-limit contract under test

After device authentication and assignment checks, each device may make `HTTPS_DEVICE_RATE_PER_MINUTE` accepted requests per fixed minute (default 90).

- In `distributed` mode (the default) a replica reserves up to `HTTPS_DEVICE_RATE_LIMIT_LEASE_SIZE` tokens (default 5) in one RTDB transaction on `_deviceRateLimits/{deviceId}` and spends them locally. The RTDB count is the fleet-wide ceiling: a lost or unused lease can reduce capacity until the minute ends but never increase it.
- In `local` mode no database operation is made. The backend starts in this mode only when `HTTPS_DEVICE_RATE_LIMIT_MODE=local` and `RATE_LIMIT_SHARD_FACTOR=1` are both set explicitly.

A 202 acknowledgement follows a committed, ordered transaction on `activeBuses/{busId}_{routeId}`; a 200 means the sample was not newer than the stored one. Route matching and lifecycle repair run after that point. The raw telemetry writer and the matcher both use transactions on the same node: the writer rejects older capture time and sequence pairs, and the matcher commits only while the sample it processed is still current, so concurrent callbacks retry against current state instead of replacing newer data. Request deadlines are described in [telemetry deadlines](TELEMETRY_DEADLINES.md).

## 2. Prerequisites

- Two equivalent staging revisions (baseline and candidate) with the expected production replica count, the same Firebase region, runtime size, minimum instances and load-balancer route. `RATE_LIMIT_SHARD_FACTOR` equals the replica count on every replica, and replicated deployments use `distributed` mode.
- The load generator sends from one IP address. Set `HTTPS_INGRESS_DEVICES_PER_IP` (default 100) on staging to at least the number of load devices; otherwise the per-IP ingress limiter (15 requests per device per 10 s, divided by the shard factor) answers with 429 and the run measures that limiter instead.
- A private JSON file outside the repository listing 1 to 500 staging devices, each already provisioned with a registry assignment and secret:

  ```json
  [
    {
      "deviceId": "load_device_001",
      "secret": "<staging-device-secret>",
      "lat": 23.034,
      "lng": 72.55
    }
  ]
  ```

- An ephemeral Firebase ID token for a staging administrator, to capture `GET /api/health` before and after each run. Health counters are per process: pin the health requests to the tested replica, or capture every replica separately when the load balancer has no affinity.

## 3. Steps

1. Store the admin token in the process environment, not in the command line or the report:

   ```powershell
   $env:EKI_BENCHMARK_ADMIN_TOKEN = "<ephemeral-staging-admin-token>"
   ```

   Expected result: the variable is set in the current PowerShell session only.
2. From the repository root, run one warm-up run against the candidate, then at least three measured runs, using the expected fleet size and cadence. `--confirm-staging` is required:

   ```powershell
   npm run telemetry:load -- `
     --confirm-staging `
     --base-url https://candidate-staging.example.edu `
     --devices C:\private\eki-load-devices.json `
     --seconds 60 `
     --rate-per-device 1 `
     --out candidate-run-1.json
   ```

   `--base-url` must be an HTTPS origin without path, query or credentials (`http://localhost` and `http://127.0.0.1` are also accepted). `--seconds` accepts 1 to 600 and `--rate-per-device` accepts more than 0 and at most 5 requests per second; above 1.5 requests per second a device exceeds the default 90 per minute and receives 429.
   Expected result: `Wrote candidate-run-1.json`, with mostly 202 responses.
3. Repeat step 2 against the baseline revision with the same arguments and a different `--out` file.
   Expected result: one report per run for each revision.
4. Clear the token:

   ```powershell
   Remove-Item Env:EKI_BENCHMARK_ADMIN_TOKEN
   ```

## 4. Analysis

Each report contains status counts, acknowledgement latency (samples, average, p50, p95, p99 and maximum) overall and per status, the before and after health snapshots, and the deltas of the rate-limit counters `localDecisions`, `leaseHits`, `storeTransactions` and `storeTransactionRetries`. It contains no device secrets or coordinates. A request that fails or takes longer than 15 s is counted under the status `transport-error`. Without `EKI_BENCHMARK_ADMIN_TOKEN` the report has no health snapshots and the counter deltas are `null`. Read live record write latency from `telemetry.rtdbWriteLatencyMs` in the health snapshots.

Record the results in this table:

| Item | Baseline | Candidate |
|---|---:|---:|
| Commit and deployment | | |
| Replica count and region | | |
| Devices and requests per second | | |
| HTTP 202 / 200 / 429 / 5xx | | |
| Acknowledgement p50 | | |
| Acknowledgement p95 | | |
| Acknowledgement p99 | | |
| Rate-limit store transactions | | |
| Rate-limit transaction retries | | |
| Live record write p50 / p95 / p99 | | |

Investigate any 5xx response, accepted-count mismatch, ordering regression or lifecycle rollback before choosing a lease size. Do not tune the lease only to reduce the transaction count: capacity lost to unused reservations is part of the decision.

## 5. Cleanup

1. Archive each report with the commit, deployment identity, region, replica count, fleet size, cadence and test time. Never archive the private device file with the reports.
2. The load leaves stopped telemetry in the staging live records. After `BUS_STALE_MS` without telemetry the [stale presence sweep](MATCHING_AND_LIFECYCLE_SCANS.md) removes them, or marks them offline when a ride is active. End any ride the test started from the admin **Live Ops** tab.
3. Restore `HTTPS_INGRESS_DEVICES_PER_IP` on staging if it was raised for the test.
