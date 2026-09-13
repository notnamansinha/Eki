# Stationary readiness checks — 2026-09-13

Baseline: `7614ad5`. The attached admin/passenger brief was used as a QA reference;
its proposed product changes are not all implemented by this test run.

## Live stationary evidence

**LIVE RUNTIME VERIFIED:** ten-minute serial capture with the connected ESP32/GNSS,
plus an independent three-minute RTDB subscription. No synthetic rides, telemetry
or chat messages were sent to the live database.

| Measurement | Result |
|---|---|
| Parsed HTTP requests | 594; 593 accepted, 1 read timeout |
| Motion state | All parsed requests reported stopped |
| HTTP p50 / p95 / p99 / max | 450 / 1,065 / 1,271 / 2,150 ms |
| RTDB observer | 176 events |
| RTDB update-gap p50 / p95 / p99 / max | 980 / 1,661 / 1,953 / 4,821 ms |
| RTDB gaps >2 seconds | One: 4,821 ms; none >5 seconds |
| Device system-minus-RMC offset | p95 23 ms; maximum 33 ms in parsed records |

One malformed telemetry JSON line and duplicate/fragmented serial output limit
exact counts. Device system/RMC agreement is not an independent NTP accuracy test.
RTDB observer timing is not browser rendering latency. The observed timeout and
4.8-second update gap remain evidence against a zero-freeze claim.

## Simulations and automated checks

**UNIT/INTEGRATION VERIFIED:**

- Added forward/reverse 3,600-sample origin-jitter simulations: no false departure
  or completion. Added 3,600-sample mid-route stops: no skipped required stop.
- Added 3,600-update passenger checks for stopped pre-departure and in-service rides:
  visibility and session selection stay stable at zero speed.
- Added stopped-chat HTTP tests for both service states; membership remains required.
- Existing tests exercise 100-stop travel in both orders, fresh-session direction,
  automatic turnaround, completion history writes, reroute races, route chunking,
  per-bus geometry, message moderation and firmware scheduling/retry policies.
- **670 software tests passed, 7 skipped; 35 native firmware tests passed.**
  Lint and production build passed.

These accelerated updates exercise state transitions; they are not an hour of
real elapsed-time testing, RF simulation or proof of browser layouts.

## Browser finding and fix

**BROWSER + LIVE RUNTIME VERIFIED:** Search Stop initially reproduced “backend
could not be reached.” Health returned 200 and OPTIONS returned 204 with the
correct CORS origin, but a browser-style GET received ngrok's `ERR_NGROK_6024`
warning response without CORS headers.

The shared API client now supplies ngrok's documented programmatic-request header
only for recognized ngrok hosts, preserving authentication headers. Five regression
cases cover supported hosts and unrelated/lookalike domains. See [ngrok's API
guidance](https://ngrok.com/docs/errors/err_ngrok_6024).

After the fix, the signed-in browser searched Ahmedabad University and selected
the real result into a draft with coordinates. The draft was discarded; no route
was saved. This verifies localhost through the current tunnel, not deployed Hosting.

**BROWSER VERIFIED:** admin Live Ops shows one online, stopped device and zero
services, with chat locked because the ride is unarmed. Passenger view shows no
active service. This is current lifecycle gating, not a speed-filter failure.

## Repeatable checks

```powershell
npm test
platformio test --project-dir hardware -e native
node scripts/check-stationary-runtime.mjs --frontend http://localhost:3000 --backend https://rigging-everglade-tidal.ngrok-free.dev
```

The runtime script checks frontend/backend reachability, CORS preflight and the
Places authentication boundary without tokens or database writes. All four checks
passed. Raw traces remain in ignored `hardware/.pio`; the generated trace report
is in Downloads/Eki-final-audit/STATIONARY-READINESS-TRACE.md.

## Before / during physical testing

- Arm a real service with the assigned vehicle/route at the appropriate endpoint;
  verify passenger visibility and member chat while still stopped.
- Capture the deferred 30–60-minute physical return journey, stop order, direction,
  rerouting and correlated browser rendering. Keep the observed stationary gap as
  the baseline to investigate, not a passed zero-latency requirement.
- Still unverified: deliberate Wi-Fi loss, TLS idle expiry, controlled RF loss or
  bandwidth, extended clock stability, signed-fleet runtime and deployed CSP.
- Brief product work still pending: online-only passenger availability, End Ride
  Early, post-Z shared labels, route-type removal, touch controls, fleet scrolling,
  admin presentation and full responsive/browser E2E coverage.

**Verdict:** useful baseline for a controlled physical test; full field acceptance
and all admin/passenger brief requirements are not complete.
