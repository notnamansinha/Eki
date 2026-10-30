# Moving-Marker Simulation

| Document ID | Version | Status | Last updated |
|---|---|---|---|
| EKI-PKG-009 | 1.0 | Current | 2026-10-30 |

## 1. Purpose

This manual fixture measures how the live bus marker selects and animates positions in the browser. It uses the application's real position selection (`useLiveBusMarkerPosition`), smoothing (`useSmoothPosition`) and render trace hooks, fed by a loopback Server-Sent Events producer with synthetic moving samples. No Firebase call, bus write, credential, Google Maps tile or board movement is involved.

## 2. Run

1. From the repository root, start the fixture:

   ```powershell
   node node_modules/vite/bin/vite.js --config e2e/motion/vite.config.mts
   ```

2. Open `http://127.0.0.1:3150/?telemetryTrace=1` and select **Run all 12 scenarios**. Keep the tab visible: background-tab throttling changes the results. A full run takes about three minutes.

3. When the run finishes, the page posts a JSON capture to the fixture server, which writes it to `temp/motion-captures/` (ignored by Git). The server accepts only same-origin captures of up to 2 MB.

## 3. Scenarios

The twelve scenarios are six delivery profiles, each run with 250 ms and 120 ms smoothing. Each profile sends twelve synthetic moving samples.

| Profile | Delivery |
|---|---|
| `matched` | Matched position arrives with the fix |
| `delayed` | Matched position arrives 500 ms later |
| `stalled` | No matched position; the 2 s match-pending hold (`MATCH_PENDING_HOLD_MS`) expires |
| `burst` | Samples 80 ms apart |
| `disconnect` | A 3.5 s delivery gap |
| `context` | A new ride context |

The `disconnect` gap simulates missing deliveries. It does not exercise the Firebase connection or the EventSource reconnect protocol.

## 4. Reading the capture

An arrival means the browser state came within 5 cm of the current target. Held, older-context and superseded targets must not acknowledge a new fix. Coalesced sub-metre targets may never produce an arrival because the application skips sub-pixel motion; missing arrivals are reported, not invented.

Each scenario records visibility and `requestAnimationFrame` gaps. A frame-gap p95 near one second means the browser throttled animation, and the run cannot support a comparison of smoothing durations.

When the operating system prefers reduced motion, the real hook ignores smoothing durations. The **Use standard animation in this simulation** checkbox overrides the media query inside the fixture only, so the normal animation branch can be measured. The capture records both the real and the simulated preference; compare durations only in standard mode.

## 5. Limits

Delivery timing uses the computer's wall clock and animation timing uses the browser's monotonic clock. The results do not establish mobile network latency, GNSS accuracy, Google Maps compositor paint timing or performance on slower devices.
