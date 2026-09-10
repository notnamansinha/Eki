# Telemetry latency baseline

Use this procedure to measure one device from GNSS capture through the first
painted marker update. It produces correlated, location-free timing records;
the normal RTDB live data remains unchanged.

## What the timestamps mean

| Phase | Clock | Evidence |
|---|---|---|
| GNSS capture and HTTP attempt | Device GNSS-disciplined clock | `[TelemetryTrace]` serial records |
| Request ingress and response start | Backend clock | Authenticated response timing headers copied into the serial record |
| RTDB commit | Firebase server clock | `rtdbCommittedAt` on the live node |
| Listener delivery and marker paint | Browser wall and monotonic clocks | Browser trace export |

The analyzer uses the four request/response timestamps to estimate the device
clock offset using the NTP midpoint method. It reports half of the network-only
round trip as uncertainty. Treat a cross-clock latency as an estimate with that
bound. Device queue time, HTTP round-trip time, backend request time, server
ingress gaps, and browser listener-to-render time each use a single clock.

The admin `/api/health` summaries are process-local rolling windows of at most
512 values and reset whenever that backend replica restarts. `networkLatencyMs`
and `deviceToServerLatencyMs` are wall-clock estimates; use the correlated trace
when clock skew matters.

## Freshness and an untrusted device clock

The firmware does not publish until it has a trusted epoch from fresh GNSS UTC
or its NTP fallback. At ingestion, the backend accepts a capture timestamp only
from 60 seconds behind through 10 seconds ahead of its request-boundary clock.
An accepted future timestamp is clamped to that boundary before it is stored,
so it cannot keep an RTDB node fresh indefinitely. Timestamps outside the
window receive HTTP 400 and never update the live node.

The browser independently treats timestamps more than 10 seconds in the future
or older than `NEXT_PUBLIC_BUS_EXPIRY_MS` as non-live. Active rides may keep
their lifecycle record visible, but stale telemetry still reports signal loss
and cannot satisfy backend actions that require a fresh fix. Because these
guards compare different clocks, use the trace's offset and uncertainty when
diagnosing a freshness rejection; do not treat the raw wall-clock difference as
transport latency.

## Listener behavior

The measurement hook observes the existing `onChildAdded`, `onChildChanged`,
and `onChildRemoved` RTDB subscriptions. It adds no telemetry polling. Cached
bootstrap values are excluded from listener-delivery measurements, and marker
rendering is recorded in the first animation frame after the corresponding
React commit. The report therefore lists RTDB-to-listener and listener-to-render
time separately.

## Prepare the run

1. Record the exact commit, backend instance, device ID, bus ID, route ID,
   firmware version, browser version, network, and test date. Use one device for
   each capture so sequence correlation remains unambiguous.
2. Build and deploy the backend, frontend, and firmware from the same commit.
   Confirm that accepted telemetry responses contain
   `X-Eki-Server-Received-At` and `X-Eki-Server-Responded-At`.
3. Start a 115200-baud serial capture. In PowerShell, for example:

   ```powershell
   platformio device monitor --project-dir hardware --baud 115200 |
     Tee-Object -FilePath telemetry-device.log
   ```

4. Open the signed-in admin and passenger pages with
   `?telemetryTrace=1` appended to each URL. The trace stays in memory, excludes
   coordinates and credentials, and is limited to 25,000 records per tab.
5. In each tab's developer console, reset the buffer and name the first phase:

   ```javascript
   window.__ekiTelemetryTrace.clear()
   window.__ekiTelemetryTrace.setScenario("stopped")
   ```

6. From the admin tab, download the initial backend health snapshot:

   ```javascript
   await window.__ekiTelemetryTrace.downloadHealth("health-before.json")
   ```

## Capture scenarios

Run long enough to collect at least 100 accepted moving samples plus useful
stopped and recovery periods. A second person must operate the laptop and test
controls while the vehicle is moving.

- `stopped`: stationary with healthy GNSS and network.
- `moving`: normal route operation in both directions.
- `poor-network`: controlled weak or throttled connectivity while the device
  remains powered.
- `reconnect`: loss followed by network recovery; keep the same trace running.

Before each phase, set the same scenario in every traced browser tab:

```javascript
window.__ekiTelemetryTrace.setScenario("moving")
```

Include parallel roads, buildings, intersections, and one safe route deviation
when practical. Record operator notes with wall-clock times so visible behavior
can be matched to the report. Do not handle the laptop or phone while driving.

At the end, download each browser trace and the final health snapshot:

```javascript
window.__ekiTelemetryTrace.download("telemetry-admin.json")
await window.__ekiTelemetryTrace.downloadHealth("health-after.json")
```

Repeat `download` in the passenger tab with a distinct filename, then stop the
serial capture.

## Produce the report

Run the analyzer from the repository root. Repeat `--browser` and `--health`
for every captured file:

```powershell
npm run telemetry:analyze -- `
  --device telemetry-device.log `
  --browser telemetry-admin.json `
  --browser telemetry-passenger.json `
  --health health-before.json `
  --health health-after.json `
  --out telemetry-baseline.md
```

The report contains overall and per-scenario p50/p95/p99/max values for device
queueing, HTTP, backend, RTDB, browser delivery, rendering, end-to-end latency,
and update gaps. Correlation coverage must be reported with the percentiles;
missing listener, render, or clock records can otherwise make a fast-looking
result misleading.

Archive the report, raw serial log, browser exports, health snapshots, operator
notes, exact commit, and deployment identity together. The trace files contain
device, bus, route, session, and timing identifiers. Store them as restricted
operational evidence and apply the approved retention period.

## Acceptance record

Fill this after the drive instead of choosing tuning thresholds in advance.

| Item | Result |
|---|---|
| Commit and deployment | |
| Accepted/correlated samples | |
| Moving p50/p95/p99 end-to-end | |
| Stopped p50/p95/p99 end-to-end | |
| Poor-network p50/p95/p99 end-to-end | |
| Reconnect p50/p95/p99 end-to-end | |
| Update-gap p50/p95/p99 by phase | |
| Clock offset and uncertainty | |
| Browser listener-to-render delay | |
| Proposed latency targets | |
| Evidence archive | |
