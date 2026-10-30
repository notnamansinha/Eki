# Realtime Transport Measurements

| Document ID | Version | Status | Last updated |
|---|---|---|---|
| EKI-OPS-016 | 1.0 | Current | 2026-10-30 |

## 1. Purpose

This procedure measures chat delivery, RTDB reconnect intervals, listener payload size and logical watch counts in signed-in browsers, together with the Firebase usage of the same window. The results are compared with the preregistered targets in the [realtime transport decision](../design/REALTIME_TRANSPORT_DECISION.md).

Sample-to-marker latency is measured in the same run with the [telemetry latency baseline](TELEMETRY_LATENCY_BASELINE.md). Existing stationary captures are summarized in the [evidence audit](../testing/REALTIME_TRANSPORT_EVIDENCE_AUDIT.md); they do not replace the browser and usage captures below.

## 2. Prerequisites

- A deployed backend and frontend from one recorded commit, and a device sending telemetry on an active ride.
- At least two signed-in accounts that can open the same ride chat: one sender and one recipient.
- Access to Firebase console or Cloud Monitoring for the project, to read peak RTDB connections, RTDB downloaded bytes and Firestore document reads for the window.
- A way to throttle or cut the browser's network (for example Chrome DevTools network conditions).
- Familiarity with the [browser telemetry trace](BROWSER_TELEMETRY_TRACE.md), which defines the console API and the record fields.

## 3. Steps

1. Record the commit, deployed versions, Firebase project and region, browser and device, number of active buses, tab count, network profile, the cost ceiling and any change to the decision record's targets, with the reason.
   Expected result: a run header written before capture starts.
2. Open the map tab and the chat tabs with `?telemetryTrace=1` in the URL from the first page load, so tracing attaches before the listeners. Do not call `clear()` afterwards: it discards the watch baseline.
   Expected result: each tab shows **Download telemetry trace**.
3. Before each phase, set the same label in every tab, for example:

   ```javascript
   window.__ekiTelemetryTrace.setScenario("moving_normal")
   ```

   Use `moving_normal`, `moving_weak_network`, `reconnect` and `stopped`.
   Expected result: a `browser_scenario` record in each tab.
4. Collect at least 1,000 accepted moving samples across the normal and weak-network phases. Send at least 100 new chat messages per profile with the recipient tab open. The backend allows each sender 10 messages per minute and 60 per hour in one ride, with at least 3 s between messages, so plan more than one hour or several sender accounts.
   Expected result: no 429 responses in the sender tab.
5. Run at least 10 controlled offline and recovery cycles. For each cycle, note the time the network was restored and the time the first fresh marker was painted. The first offline period at page load is not a reconnect.
   Expected result: one `realtime_connection` false-to-true pair per cycle.
6. Where capacity permits, repeat with 1, 10 and 50 tabs. Keep unrelated activity out of the Firebase usage window, or record its contribution. Save the console or monitoring captures of peak RTDB connections, RTDB downloaded bytes and Firestore document reads, and note their aggregation delay and whether they are project totals.
   Expected result: one usage capture per load profile.
7. Before any tab reaches 25,000 records, download one complete export per tab:

   ```javascript
   window.__ekiTelemetryTrace.download("realtime-sender.json")
   ```

   Expected result: one JSON file per tab and run. The analyzer removes duplicate records by run and event ID, but a truncated export cannot prove complete watch counts.

## 4. Analysis

Run sample-to-marker analysis with `npm run telemetry:analyze` as described in the [telemetry latency baseline](TELEMETRY_LATENCY_BASELINE.md).

For the realtime measurements, run from the repository root:

```powershell
npm run realtime:analyze -- --browser realtime-sender.json --browser realtime-recipient.json --usage usage.json --out realtime-report.json
```

`--usage` is optional. The usage file is JSON with `windowStart` and `windowEnd` (ordered date strings), a non-empty `evidenceRef` naming the restricted capture, and non-negative numbers `rtdbConnectionsPeak`, `rtdbDownloadedBytes` and `firestoreDocumentReads`. Without it the report has `usage: null`; that is not a zero cost. The analyzer makes no network calls.

The report gives samples, average, p50, p95, p99 and maximum per scenario:

| Metric | Definition | It does not measure |
|---|---|---|
| Chat delivery | HTTP send start to the first server-backed listener event for the returned message ID, in the same tab and run. Only HTTP 201 creates count; HTTP 200 idempotent replays, error responses, attempts without a response and creates without a listener event are counted separately. | Backend commit time or delivery to other recipients. |
| Reconnect | RTDB `connected=false` to `connected=true` after the connection was first established, including the intentional offline time. Unfinished outages are flagged. | Network restoration to a fresh painted marker; use the operator notes and render records for that target. |
| Payload | UTF-8 size of the application JSON per callback, excluding cache-only callbacks. | Wire bytes, billed bytes or document reads. |
| Watch peaks | Peak logical `active_buses` and `messages` watch groups per run. The three RTDB child listeners of one store count as one group. | Physical sockets or other SDK listeners. |

Cross-tab recipient latency needs validated clock alignment and separate analysis. Traced chat subscriptions enable metadata callbacks; report that overhead.

## 5. Archive and cleanup

1. Store raw exports, serial logs, health snapshots, usage captures, operator notes and reports in the restricted operational evidence archive under the approved retention period. Exports contain session, message and device identifiers and timing, though no message text, coordinates or tokens. Do not commit raw captures.
2. Report counts and percentiles per network and load profile, missing correlations, clock uncertainty, restoration times, fresh paints, Firebase usage, cost assumptions and instrumentation overhead. Leave unmeasured items explicit.
3. Compare the results with the decision record's targets and update its conclusion. Public reports contain aggregate results and redacted evidence references only.
4. Sign the test accounts out and remove `?telemetryTrace=1` from any bookmarked URLs.
