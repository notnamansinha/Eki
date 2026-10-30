# Telemetry Latency Baseline

| Document ID | Version | Status | Last updated |
|---|---|---|---|
| EKI-OPS-025 | 1.0 | Current | 2026-10-30 |

## 1. Purpose

This procedure measures the latency of one device's samples from GNSS capture to the first painted marker update in the admin and passenger views. It produces correlated timing records without coordinates and does not change the normal live data.

## 2. Prerequisites

- Backend, frontend and firmware built and deployed from the same commit.
- One device per capture, so sample sequences correlate without ambiguity. Its firmware must print `[TelemetryTrace]` serial records: the `esp32dev` PlatformIO environment prints them by default; the `esp32dev-quiet` environment does not, and the secure fleet build prints them only when built with `EKI_ENABLE_FLEET_TRACES=1`. See the [hardware README](../../hardware/README.md).
- PlatformIO on the laptop that captures serial output at 115200 baud.
- A signed-in administrator tab and a signed-in passenger tab. The trace console API and record fields are described in the [browser telemetry trace](BROWSER_TELEMETRY_TRACE.md).
- For moving phases, a second person who operates the laptop and controls. Do not handle the laptop or phone while driving.

## 3. Steps

1. Record the commit, backend instance, device ID, bus ID, route ID, firmware version, browser version, network and date.
   Expected result: a run header written before capture starts.
2. Start the serial capture from the repository root:

   ```powershell
   platformio device monitor --project-dir hardware --baud 115200 | Tee-Object -FilePath telemetry-device.log
   ```

   Expected result: `[TelemetryTrace]` `device_http` lines whose `serverReceivedAtMs` and `serverRespondedAtMs` are numbers. These come from the `X-Eki-Server-Received-At` and `X-Eki-Server-Responded-At` response headers; `null` values mean the timing headers did not reach the device.
3. Open the admin and passenger pages with `?telemetryTrace=1` appended to each URL.
   Expected result: each tab shows **Download telemetry trace**.
4. In each tab's developer console, reset the buffer and name the first phase:

   ```javascript
   window.__ekiTelemetryTrace.clear()
   window.__ekiTelemetryTrace.setScenario("stopped")
   ```

5. In the admin tab, save the initial backend health snapshot:

   ```javascript
   await window.__ekiTelemetryTrace.downloadHealth("health-before.json")
   ```

   Expected result: `health-before.json` is downloaded. An error means the signed-in user is not an administrator.
6. Capture each phase, setting the same scenario in every traced tab before it starts, for example `window.__ekiTelemetryTrace.setScenario("moving")`:

   | Scenario | Conditions |
   |---|---|
   | `stopped` | Stationary with healthy GNSS and network. |
   | `moving` | Normal route operation in both directions. Include parallel roads, buildings, intersections and one safe route deviation where practical. |
   | `poor-network` | Controlled weak or throttled connectivity while the device stays powered. |
   | `reconnect` | Network loss followed by recovery, with the same trace still running. |

   Collect at least 100 accepted moving samples plus useful stopped and recovery periods. Keep operator notes with wall-clock times.
   Expected result: no tab approaches the 25,000-record buffer limit.
7. Download each trace and the final health snapshot:

   ```javascript
   window.__ekiTelemetryTrace.download("telemetry-admin.json")
   await window.__ekiTelemetryTrace.downloadHealth("health-after.json")
   ```

   In the passenger tab, run `window.__ekiTelemetryTrace.download("telemetry-passenger.json")`. Then stop the serial capture.
   Expected result: two trace files, two health files and one serial log.

## 4. Analysis

Run the analyzer from the repository root, repeating `--browser` and `--health` for every captured file:

```powershell
npm run telemetry:analyze -- --device telemetry-device.log --browser telemetry-admin.json --browser telemetry-passenger.json --health health-before.json --health health-after.json --out telemetry-baseline.md
```

The Markdown report gives samples, p50, p95, p99 and maximum, overall and per scenario, for device queueing, the HTTP round trip, backend processing, the RTDB commit, browser listener delivery, rendering, marker settling, end-to-end latency and update gaps, together with correlation coverage. Always report coverage with the percentiles: missing listener, render or clock records can make a result look faster than it is.

### 4.1 Clocks

| Phase | Clock | Evidence |
|---|---|---|
| GNSS capture and HTTP attempt | Device clock, disciplined by GNSS time | `[TelemetryTrace]` serial records |
| Request ingress and response start | Backend clock | Timing headers copied into the serial record |
| RTDB commit | Firebase server clock | `receivedAt` on the live record, exported as `rtdbCommittedAtMs` |
| Listener delivery and marker paint | Browser wall and monotonic clocks | Browser trace export |

The analyzer estimates the device clock offset from the four request and response timestamps with the NTP midpoint method and reports half the network-only round trip as its uncertainty. Read every cross-clock latency as an estimate within that bound. Device queue time, HTTP round trip, backend request time, ingress gaps and listener-to-render time each use a single clock. Listener delivery excludes the initial snapshot, and a render is recorded in the first animation frame after the React commit, so RTDB-to-listener and listener-to-render times are reported separately.

The admin health summaries are per process, keep at most 512 values per metric and reset when the replica restarts. `networkLatencyMs` and `deviceToServerLatencyMs` are wall-clock estimates; use the correlated trace when clock skew matters.

### 4.2 Freshness and clock skew

The firmware does not publish until it has a trusted time from GNSS UTC or its NTP fallback. The backend accepts a capture time only from 60 s behind to 10 s ahead of its own clock at the request boundary, and clamps an accepted future time to its own clock, so a fast device clock cannot keep a live record fresh. Other times receive HTTP 400.

The browser judges freshness by the backend receipt time compared with `serverNow()`, the browser clock corrected by the RTDB `.info/serverTimeOffset` estimate (offset 0 until the first estimate arrives). A store replays its cached snapshot when the estimate moves by 1 s or more, so a viewer with a wrong clock still sees correct liveness. The liveness states and their thresholds are specified in [tracking algorithms](../design/TRACKING_ALGORITHMS.md#9-live-bus-health). Because the device, backend, Firebase and browser use different clocks, use the trace's offset and uncertainty to diagnose a freshness rejection; a raw wall-clock difference is not transport latency.

### 4.3 Acceptance record

Fill this in after the drive; do not choose tuning thresholds in advance.

| Item | Result |
|---|---|
| Commit and deployment | |
| Accepted and correlated samples | |
| Moving p50 / p95 / p99 end to end | |
| Stopped p50 / p95 / p99 end to end | |
| Poor-network p50 / p95 / p99 end to end | |
| Reconnect p50 / p95 / p99 end to end | |
| Update-gap p50 / p95 / p99 by phase | |
| Clock offset and uncertainty | |
| Browser listener-to-render delay | |
| Proposed latency targets | |
| Evidence archive | |

## 5. Archive and cleanup

1. Archive the report, serial log, browser exports, health snapshots, operator notes, commit and deployment identity together as restricted operational evidence under the approved retention period. The files contain device, bus, route, session and timing identifiers.
2. Do not commit raw captures.
3. Reload the tabs without `?telemetryTrace=1` to stop tracing.
