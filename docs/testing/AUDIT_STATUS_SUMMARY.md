# Audit fixes and pending verification

Updated: 2026-09-13. Code published to `testing` through **7614ad5**; no merge to `main`.

## Corrected and implemented

- **Return direction:** fresh rides infer direction from the current endpoint. Old sessions/device directions cannot override A→B→A or B→A→B inference; endpoint-version handling is shared.
- **Return journeys:** completing the terminal stop can prepare the opposite journey immediately, with fresh stopped telemetry, reset trip state and every required stop in reverse order.
- **Long routes:** up to 100 stops; ordered, overlapping Google route chunks compute each travel direction separately. Failed chunks cannot publish partial geometry. Closely spaced stops advance in order.
- **Shared reroutes:** deviations route through remaining required stops. Geometry publishes before its pointer; passenger/admin maps consume it. Each bus retains its own route and ETA. Active stop-list edits remain guarded.
- **Routing latency/races:** rerouting runs independently of telemetry matching. Session/version checks reject stale results; shutdown drains workers.
- **Map stability:** bounded matched-position retention during uncertain deviation, low-speed heading stabilization, consistent marker/ETA positioning, physically bounded progress and cached geometry distances.
- **Telemetry:** moving and stopped heartbeat both 1 second; corrected the 999 ms scheduling edge case that skipped a tick. Freshness uses paired backend receipt time where available.
- **HTTP/TLS:** persistent client/socket reuse, bounded response draining, faster compatible TLS negotiation and fresh key preparation before TCP; certificate/hostname verification remains enabled.
- **Recovery:** transport/408 errors retry in 1–2 seconds. Recognized ngrok offline/upstream errors no longer trigger 60-second configuration or prolonged gateway backoff. Genuine configuration, credential and throttling policies remain protected.
- **Diagnostics/rate limits:** diagnostics use a separate worker/socket. Pre-auth telemetry and maintenance IP pools support shared NAT and configured fleet capacity; authenticated device quotas remain enforced.
- **GNSS clock:** snapshot coherent checksum-valid RMC fields; reduce unused NMEA output to prevent growing arrival delay. Receiver acknowledged configuration; short-run NTP divergence measured **131 ms**, versus the earlier ~7 seconds.
- **Trace analysis:** percentile/max timing, correlated gaps >2/>5 seconds, failures/retries, TLS counts and missing/malformed coverage. Clock jumps invalidate cross-clock estimates; raw GNSS/server subtraction is not treated as network latency.
- **GitHub failures:** corrected the response-header test and included `tls_profile.cpp` in the signed firmware CMake build.

## Verified

- **GitHub CI fully green:** web, backend container and firmware, including signed fleet compilation. [Run for 7614ad5](https://github.com/notnamansinha/Eki/actions/runs/34741032989).
- **Local checks:** 657 software tests and 35 native firmware tests passed; 7 software tests skipped. Lint and production builds passed.
- **Hardware:** development firmware flashed with hash verification; stationary GNSS, cold reboot, backend/tunnel restart and delayed/dropped HTTP-response recovery exercised. Normal tunnel restored; temporary fault proxy removed.
- **Final four-minute recovery capture:** 208 requests, 194 accepted, 14 failures; HTTP p50/p95/p99/max **590/1,443/2,265/2,814 ms**. These include intentional faults.
- Delayed/dropped responses caused **4.9/4.7-second accepted-update gaps**. Deliberate tunnel downtime produced a **27-second gap**. Connection reuse was observed during this short run.

## Pending / limits

- [ ] User-deferred **30–60-minute moving trace**, including physical A→B→A and B→A→B, long stop sequences and shared-map reroutes.
- [ ] Long stationary soak and persistent TLS reuse/idle-expiry verification.
- [ ] Deliberate Wi-Fi interruption, radio packet loss and controlled slow-network/bandwidth tests. HTTP fault injection does not substitute for these.
- [ ] Correlated GNSS→backend→RTDB→browser callback→marker-render trace, with full percentiles and all gaps. HTTP duration is not end-to-screen latency.
- [ ] Extended GNSS/NTP stability, real multipath/GNSS replay and regional latency comparison.
- [ ] Secure fleet runtime/OTA validation and deployment; CI signed compilation is not a secure-device field test.
- [ ] Review remaining acceptance results before merging to `main`.

**Zero freezes is not established.** TCP connect is limited to 1 second and HTTP read to 1.5 seconds, but cold TLS has a separate 10-second budget and DNS can exceed the TCP limit. Outages still interrupt live delivery.

Details: [route acceptance](RETURN_ROUTE_ACCEPTANCE.md) · [live measurements](LIVE_ESP32_LATENCY_RESULT.md).
