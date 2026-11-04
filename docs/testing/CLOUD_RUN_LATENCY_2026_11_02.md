# Cloud Run staging latency: 2 November 2026

| Document ID | Version | Status | Last updated |
|---|---|---|---|
| EKI-EVD-061 | 1.0 | Historical | 2026-11-03 |

First latency evidence after the backend moved from the demo laptop and its ngrok tunnel to Cloud Run, and the Realtime Database moved from `us-central1` to `asia-southeast1`. The tracker was stationary at night, so this run compares transport and processing legs, not moving-drive behaviour. No issue was edited or closed, no service was armed, and nothing was written to the database by the observers.

## Setup

- Backend: Cloud Run service `eki-backend-staging`, region `asia-south2`, one instance at most, `WORKER_ENABLED=true` on the live revision. Runtime values are described in the [staging runtime configuration](../operations/STAGING_RUNTIME_CONFIG.md).
- Database: `bustrack-be165-asia-rtdb` in `asia-southeast1`.
- Tracker: `esp32dev` development build from `main` at `f925ebd`, with `BACKEND_URL` set to the Cloud Run origin and `BACKEND_ROOT_CA` set to GTS Root R1. A local build does not prove the exact flashed image. The tracker reported a valid fix (HDOP about 1) and reached the internet through a phone hotspot. Route and device identifiers and the location stay private.
- Observer: a Windows laptop on separate home Wi-Fi. Its clock was 153 ms ahead of `time.google.com` (four `w32tm` samples, 145 to 156 ms), and listener timestamps are corrected by that amount.
- Window: between 23:38 IST on 2 November and 00:05 IST on 3 November. The tracker sent one accepted request per second throughout.

## Results

All values are milliseconds. "Now" is this run; "Before" is the closest tracked measurement from the laptop, ngrok and `us-central1` setup.

| Leg | Now: samples, p50 / p95 / p99 | Before: samples, p50 / p95 | Before: source |
|---|---|---|---|
| Device HTTP round trip (device monotonic clock) | 10, 227 / 429 / 429 | 276, 584 / 1455 | [Moving capture, 19 October](MOVING_GNSS_CAPTURE_2026_10_19.md) |
| Backend time per telemetry request | 710, 85 / 238 / 359 | 293, 419 / 1156 (tunnel inspector) | [Moving capture, 19 October](MOVING_GNSS_CAPTURE_2026_10_19.md) |
| Backend receipt → raw bus node at a remote listener | 119, 78 / 228 / 321 | 975, 416 / 996 (receipt to RTDB timestamp) | [Live latency audit, 2 October](LIVE_LATENCY_RECOVERY_AUDIT_2026_10_02.md) |
| Capture → raw bus node at a remote listener, uncorrected | 119, 365 / 521 / 609 | 1077, 553 / 1284 (clock-corrected) | [Balcony readiness, 8 October](BALCONY_READINESS_2026_10_08.md) |
| Same, corrected by the median clock offset | 119, about 169 / 325 / 413 | | |
| Raw node → passenger projection at the same listener | 119, 157 / 166 / 253 | 84, 942 / 1609 | [Balcony readiness, 8 October](BALCONY_READINESS_2026_10_08.md) |
| Capture → passenger projection at a remote listener, uncorrected | 119, 524 / 683 / 762 | 84, 1652 / 2246 (clock-corrected) | [Balcony readiness, 8 October](BALCONY_READINESS_2026_10_08.md) |
| **Same, corrected by the median clock offset** | **119, about 328 / 487 / 566** | | |

Capture legs cross the tracker and observer clocks. The baseline corrected them per sample with the four-timestamp estimator. This run shows them both uncorrected and with a constant correction by the median offset (see [Limits](#limits)). Even uncorrected, the capture-to-passenger leg is about three times faster at the median and p95. Two changes explain most of it. The tunnel added about 290 ms to each request (tunneled `/health` p50 297.5 ms against 5.6 ms locally in the 19 October capture), and that hop no longer exists. Each backend round trip to the database is now regional: the laptop's response time from the Singapore instance was 81 ms p50 against 289 ms from the `us-central1` instance in this run (15 sequential requests each, HTTP 401 by design), which matches the 94.2 ms against 293.0 ms recorded in the [region decision](../design/RTDB_REGION_LATENCY_DECISION.md).

### Laptop probes

| Probe, 15 new connections each | TCP connect p50 | TLS p50 | Response after TLS p50 / p90 | Total p50 / p90 |
|---|---:|---:|---:|---:|
| Cloud Run `/health` (HTTP 200) | 19 | 63 | 73 / 82 | 193 / 201 |
| Singapore RTDB front door (HTTP 401) | 19 | 107 | 81 / 88 | 235 / 455 |
| `us-central1` RTDB front door (HTTP 401) | 16 | 316 | 289 / 316 | 642 / 762 |

The Cloud Run chain verified against GTS Root R1 alone with RSA and ECDSA signature algorithms (leaf, WR2, GTS Root R1), which is the trust anchor the tracker now carries.

## Backend observations

- Cloud Run request logs held 712 telemetry requests from 23:38:40 to 23:50:37 IST: 710 returned 202 and 2 returned 503. The first 503 was the tracker's first request; the second came six minutes later. 503 is a retryable response for the firmware, unlike 401. The cause of these two was not investigated.
- 158 of the 710 accepted requests (22%) took more than 200 ms. About every fifth request takes about 235 ms against a typical 85 ms, which suggests a periodic heavier write. It sets the p90 and p95 of the backend leg.
- Overnight the service scales to zero, so the first request after a quiet period pays a cold start. Cloud Scheduler holds one instance from 06:00 to 22:00 IST.

## Method

- Backend time: `httpRequest.latency` from Cloud Run request logs for `/api/devices/<id>/telemetry`, measured at Google's front end. The baseline came from the ngrok inspector, which also included the tunnel's leg to the laptop.
- Device round trip: `[TelemetryTrace]` `device_http` lines read from the tracker's serial port at 115200 baud, with DTR and RTS held low so that opening the port did not reset it. Only 10 lines in 120 seconds parsed cleanly because the per-second capture traces interleave on the port; one garbled line was skipped. The 710 server-side samples are the stronger evidence for this window.
- Database legs: a read-only server-sent events stream of the raw bus node and the passenger projection through the RTDB REST API, authenticated with an OAuth token. Each sample is matched by sequence number; 119 consecutive samples arrived with no gaps on either stream.

## Limits

- **Clock skew.** The tracker's clock ran a median 196 ms behind the backend clock (range 114 to 235 ms, estimated from the four timestamps of 10 round trips). Uncorrected capture legs include that skew. The corrected rows subtract the median as a constant, which is less precise than the per-sample correction the baselines used; the offset range suggests about 60 ms of uncertainty either way. The 19 October capture reported per-sample clock uncertainty of 81.5 / 172.5 ms p50 / p95. The [realtime transport decision](../design/REALTIME_TRANSPORT_DECISION.md) states that cross-clock estimates with uncertainty above 100 ms do not establish its marker-paint gate, so this run does not establish it.
- **Not a moving drive.** The tracker was parked and reported `stopped`. Moving behaviour, poor-network periods and reconnects were not exercised.
- **No browser.** The listener was a REST stream on a laptop, not the website. Browser listener and marker paint time are not included; the 19 October capture measured that step at 28.7 / 366.4 ms p50 / p95 (passenger listener to React snapshot).
- **Small device sample.** The device round trip rests on 10 samples.
- **One vehicle and one route** on staging data.
