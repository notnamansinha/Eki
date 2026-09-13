# Return journeys, long routes, and live reroutes

Implemented on 2026-09-12 in the working tree based on `d8d69fd`.

The missing tracking improvements from audited snapshot `965d376` were restored before correcting the remaining defects. This includes nullable direction handling, pending-match marker retention, smooth marker movement, adaptive GNSS filtering, and ambiguity handling.

## Behavior

- A new shift infers its direction from its own current endpoint fix. A completed or device-only direction cannot override it. Existing sessions keep their own direction.
- Shift creation, telemetry inference, and return creation use the same endpoint-version contract. Device-only directions remain provisional and can change at the other endpoint.
- Completing the last required stop makes the return trip eligible immediately by default. A fresh stopped terminal fix arms a new session with opposite direction, swapped endpoints, index zero, and cleared old match/reroute state. There is no default two-minute delay. An explicit positive `AUTOMATIC_TURNAROUND_DWELL_MS` still supports a scheduled wait.
- The terminal fix is correlated by its sample timestamp, avoiding an artificial extra wait caused by accepted device clock skew when no dwell is configured.
- Routes support up to 100 stops. The same configured stop sequence is visited in reverse order on the return. Google computes the legal road geometry separately for each direction; the return need not occupy the same carriageway.
- Closely spaced stops crossed between two accepted samples can advance sequentially in the same update. A downstream stop cannot bypass an unreached required stop. Departure distance adapts for nearby first stops.
- A deviation reroutes from the bus toward all remaining required stops. It does not change the configured stop list or silently skip mandatory stops. Administrative stop-list edits during an active ride remain guarded.
- Google calculation runs in a separate queue so new GPS fixes continue to be matched. Both queues drain before Firebase shutdown.
- A reroute writes its geometry before publishing its live pointer. The version is distinct from previous trips' cached versions. A late outbound result cannot replace a return trip, a completed trip, or a bus that rejoined the configured route. An older matcher cannot overwrite a newly published route version.
- Passenger and admin maps use the published geometry. Different buses retain their own paths and ETA geometry. Available geometry is published to the UI without waiting for every other bus's request.
- Unconfirmed deviation retains the last matched marker for a bounded two-second window; confirmed deviation uses accepted GPS. Low-speed heading is held. ETA uses the same stateful position-selection policy as the marker.
- Route-progress jumps are bounded by elapsed time, speed, and positional uncertainty. Cumulative geometry distances are cached; ambiguity selection avoids sorting all route segments on every sample.
- Browser transport freshness prefers a valid paired backend receipt timestamp while preserving the device timestamp for sample ordering.

## Timing and capacity

| Policy | New value |
|---|---|
| Moving/stopped publication heartbeat | 1,000 ms / 1,000 ms |
| Firmware TCP connect / HTTP read / TLS handshake limits | 1,000 ms / 1,500 ms / 10 seconds; separate phase limits, not a total deadline |
| Live Google calculation budget | 3,500 ms per request; long-route chunks run concurrently |
| Reroute retry gate | 5,000 ms from previous attempt |
| Default automatic-return delay | 0 ms; reliable stopped terminal telemetry still required |
| Pre-auth IP ingress budget | 15 requests/device/10 seconds, configured for 100 devices/IP by default; separate maintenance pools, before replica sharding |
| Authenticated per-device budget | Existing 90/minute policy retained |
| Maximum configured stop count | 100 |

Google supports at most 25 intermediate waypoints per request. Long-route computation uses chunks of at most 27 points, sharing a boundary stop, and joins the results in order. A 100-stop configured route uses four requests per direction. Failure of any chunk prevents publication of partial geometry. [Google waypoint documentation](https://developers.google.com/maps/documentation/routes/intermed_waypoints).

One-second cadence is not a zero-latency guarantee. GNSS motion confirmation, radio/TLS transport, Firebase operations, Google computation, and client rendering still take time. A shorter timeout favors recovering with the newest fix over waiting for a slow request; validate it on the deployed network.

## Automated evidence

- Main web/backend/script suite passes, including new-session direction regression checks at both endpoints and with both historical and unified endpoint versions.
- Long-route tests cover 27, 28, 53, 100, and 101 routing points (the extra point is a live bus origin), forward/reverse stitching, and chunk failure.
- HTTP route-save coverage accepts 100 stops and computes both directions through eight requests.
- Lifecycle coverage exercises automatic return in both directions. Reducer coverage completes all 100 stops in both orders and handles multiple close stops crossed in one segment.
- Live RTDB/Google mock integration verifies newer samples are matched while routing is pending, all remaining stops are supplied, geometry precedes its pointer, and old-session results are rejected.
- Fleet geometry tests verify rerouted/configured buses do not share ETA paths incorrectly.
- Strict production build and lint pass. Production build regenerates service-worker assets and CSP hashes.
- Native firmware policy suite: 23 passed. ESP32 `esp32dev` development firmware build passes.

## Deployment and physical acceptance

This work does not establish a real-drive latency percentile or GPS accuracy guarantee. Backend/frontend deployment and firmware flashing are still needed for devices and passengers to receive the changes. The compiled `esp32dev` image is a development artifact, not a signed fleet release. No database region migration was performed.

Before fleet release, drive the full configured route and its return, stop briefly at the terminal, and check that direction, stop order, geometry, and ETA switch together. Include close stops, a wrong turn, parallel roads, two buses on different paths, lost connectivity, recovery, and starting a new shift at each endpoint. Capture sample/send/server/database/listener/render timing with the existing trace tooling, then report p50/p95/p99 and error rates. Singapore staging remains a separately measured infrastructure change.


## Follow-up network review

Stopped and moving telemetry both use a 1-second heartbeat. TLS handshake now has
an explicit 1-second limit (Arduino defaults to 120 seconds independently of
HTTPClient). Connect is 1 second, HTTP read 1.5 seconds. Diagnostics run on a separate FreeRTOS worker with a single bounded request
queue and a dedicated socket, using 500 ms connect/read limits. The publisher
queues a copied payload and collects the result without waiting for HTTP.
Credential faults, retry counters and OTA acceptance remain publisher-owned. Telemetry retains its reusable socket.
These are phase limits: DNS, sequential phases, retry backoff, active OTA downloads,
and tunnel/backend outages can still delay delivery. They are not an end-to-end
1-second delivery guarantee. Diagnostic HTTP cannot hold the publisher loop. Firmware release checks and
active OTA installation still run synchronously and require separate maintenance
acceptance. Concurrent TLS memory use and worker stack headroom require hardware
measurement before fleet flashing. Signed OTA downloads retain their
separate transfer timeout and must be validated in a maintenance window.

The pre-auth IP capacity derives from HTTPS_INGRESS_DEVICES_PER_IP (default 100),
with 10 seconds of 1 Hz traffic plus 50% headroom. Diagnostics and manifests have
separate pools. Unverified IDs cannot evade the IP budget. Verified per-device
90/minute distributed limits remain unchanged. Replica sharding is conservative
and requires capacity for traffic imbalance; edge-wide protection remains required.

The new audit's field drive, real GNSS replay and Singapore staging percentile
checks remain open. No deployment, tunnel replacement or device flashing was
performed; those operational checks cannot be inferred from passing unit tests.

Follow-up verification: 434 backend tests passed (7 skipped), 23 native firmware tests passed; backend build/lint and ESP32 development image build passed.


## Freeze-path follow-up

Transport failures and HTTP 408 now retry after 1,000-1,999 ms with fleet jitter,
instead of escalating to a 30-second pause. Server failures retain exponential
backoff; explicit throttling delays still take precedence. This does not add
retry traffic above 60 attempts/minute for transport failures.

Five read-only /health probes each against localhost:8080 and the device's
configured backend URL failed from this workstation. Configured endpoint probes
used a 3-second socket timeout. Results are in network-probe-local.json; these
are reachability failures, not successful latency samples or a region comparison.
No attached serial port was detected. A reachable backend and physical ESP32/GNSS
trace are required to measure actual freeze duration and validate TLS/worker memory.

## Audit closure matrix

| Finding | Current status |
|---|---|
| Fresh session inherits old direction | Fixed; both endpoints and provisional/version mismatch regressions |
| Endpoint-version formats disagree | Fixed; shared version helper |
| Stopped 1 Hz telemetry | Implemented; firmware policy tests |
| Possible-off-route raw-point flash | Fixed; bounded matched-position hold |
| Per-bus reroute/ETA leakage | Fixed; per-bus geometry selection tests |
| Shared-NAT pre-auth throttling | Redesigned; separate short-window pools and NAT tests |
| Low-speed heading jitter | Fixed in both maps |
| ETA differs from matched marker | Fixed; same stateful position policy |
| Physically impossible route progress | Bounded by speed, elapsed time and uncertainty; tests |
| Return through all previous stops | Implemented for up to 100 stops, both directions; tests |
| Reroute blocks matching or overwrites next trip | Independent queue and version/session guards; integration tests |
| Real drive / real GNSS replay / Singapore percentiles | Open: live environment and physical trace unavailable |
| Zero freezes under network failure | Not established; outage cannot deliver live positions |


## Superseding live verification (2026-09-13)

The ESP32 was connected, flashed and tested through the running tunnel. The earlier
unreachable-device status above is historical. See LIVE_ESP32_LATENCY_RESULT.md
and LIVE_BENCH_METRICS.json for live findings, clock-skew limits and exact metrics.
The live test additionally fixed HTTPClient destruction defeating connection reuse,
slow TLS negotiation for this endpoint, and the accidental two-second capture tick.
Cold TLS now has a 10-second budget; maintenance connect/read is 1.5 seconds.
