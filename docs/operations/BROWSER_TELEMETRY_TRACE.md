# Browser Telemetry Trace

| Document ID | Version | Status | Last updated |
|---|---|---|---|
| EKI-OPS-013 | 1.0 | Current | 2026-10-30 |

## 1. Purpose

The browser telemetry trace is an opt-in, in-memory record of what one browser tab received and rendered. This document describes how to enable and export it, what each record contains, and how to read the passenger and admin liveness states that appear during a capture.

## 2. Scope

The trace is used by the [telemetry latency baseline](TELEMETRY_LATENCY_BASELINE.md) and the [realtime transport measurements](REALTIME_TRANSPORT_MEASUREMENTS.md); those procedures say when to start, label and export it. Serial and cloud evidence for a physical capture is described in the [field capture guide](FIELD_CAPTURE.md).

## 3. Behaviour

### 3.1 Enabling and exporting

Open any signed-in Eki page with `?telemetryTrace=1` in the URL. Once the tab has seen the flag, tracing stays on for that tab until the page is reloaded without it, so an in-app navigation cannot truncate a capture. A signed-in user with a role then sees a **Download telemetry trace** button.

The trace also installs a console API on `window.__ekiTelemetryTrace`:

| Function | Effect |
|---|---|
| `clear()` | Starts a new run with a new `runId` and an empty buffer. The last server time offset is kept and no extra observers are added. |
| `setScenario(name)` | Labels every later record with `name` (1 to 40 characters of `a-z`, `0-9`, `_` or `-`) and records a `browser_scenario` event. |
| `snapshot()` | Returns the current export object. |
| `download(filename?)` | Saves the export as JSON. The default name is `eki-telemetry-<runId>.json`. |
| `downloadHealth(filename?)` | Saves the response of `GET /api/health`. The signed-in user must be an administrator. |

### 3.2 Record contents

Every record carries `version`, `eventId`, `runId`, `scenario`, `browserWallAtMs`, the visibility state (`visible`, `hidden` or `unknown`), the `navigator.onLine` hint and the reduced-motion preference. A value the browser cannot supply is `unknown` or `null`. Timing events also carry `browserMonotonicAtMs`.

| Event | Recorded when |
|---|---|
| `browser_listener` | An RTDB live bus listener delivers a value. Carries the node key, bus, route and session identifiers, motion and route state, sequence numbers and the device, backend and RTDB timestamps, plus the server time offset. |
| `browser_render`, `browser_marker_settled` | A marker is drawn in the first animation frame after the React commit, and when it settles within 0.05 m of its target. |
| `browser_lifecycle` | A `visibilitychange`, `online`, `offline`, `pagehide` or `pageshow` event. Page events include the browser's `persisted` flag (back/forward cache). |
| `realtime_watch`, `realtime_payload`, `realtime_connection` | A logical `active_buses` or `messages` watch attaches or detaches, a snapshot arrives (UTF-8 JSON size only), or `.info/connected` changes. |
| `message_attempt`, `message_write`, `message_listener` | A chat message is sent, its HTTP response arrives, and the message appears in the listener. |

The export never contains coordinates, message text or credentials. It does contain bus, route, session and message identifiers and timing, so treat it as restricted evidence.

### 3.3 Buffer

A tab keeps at most 25,000 records. When the buffer is full the oldest record is dropped. Export before that point: a truncated run cannot prove complete watch counts or correlation coverage.

### 3.4 Liveness states during a capture

The screens a trace records show the live bus health states specified in [tracking algorithms](../design/TRACKING_ALGORITHMS.md#9-live-bus-health): passengers see **GPS signal lost** as soon as a packet reports GNSS loss, **Updates delayed** after 12 s without a backend receipt, **Live tracking lost** after 30 s and **Bus offline** once the backend marks the device offline. ETAs and boarding stay available while updates are only delayed and are withheld in every other degraded state. The admin dashboard uses only the 30 s threshold, re-evaluated every 15 s, and then shows **Live location updates delayed** and, for an active ride, **Service paused**. Client-side timers apply these thresholds, so the states change even when no data and no backend are reachable. The trace records deliveries and renders, not the state changes. Silence alone does not identify whether the GNSS receiver, Wi-Fi, the backend or the browser failed.

## 4. Configuration

| Constant | Value | Source |
|---|---|---|
| Query parameter | `telemetryTrace=1` | `frontend/src/lib/telemetryTrace.ts:5` |
| Buffer size | 25,000 records | `frontend/src/lib/telemetryTrace.ts:6` |
| Scenario name rule | `^[a-z0-9_-]{1,40}$` | `frontend/src/lib/telemetryTrace.ts:117` |
| Marker settled tolerance | 0.05 m | `frontend/src/hooks/useTelemetryRenderTrace.ts:50` |

## 5. Limits of the evidence

- The `navigator.onLine` hint does not prove that Firebase, the backend or Google Maps is reachable.
- A lifecycle event is not proof of operating-system suspension or of a display paint.
- A long interval between records needs recording coverage, clock and foreground context before it is called a delay. A missing event is not a zero delay.
- An export that lacks the lifecycle and visibility fields cannot be backfilled.
- The trace does not replace a Chrome network (HAR) or performance trace, an independent position or timing instrument, genuine role accounts, or live provider and field acceptance.

## 6. Verification

| Behaviour | Tests |
|---|---|
| Trace enablement, lifecycle records and export (the 25,000-record bound has no test) | `frontend/src/lib/telemetryTrace.test.ts` |
| Render and marker-settled records | `frontend/src/hooks/useTelemetryRenderTrace.test.tsx` |
| Realtime records consumed by the analyzer | `scripts/analyze-realtime-trace.test.mjs` |
| Listener and render records consumed by the analyzer | `scripts/analyze-telemetry-trace.test.mjs` |
