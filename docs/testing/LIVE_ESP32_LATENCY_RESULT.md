# ESP32 live bench result (2026-09-13)

The attached ESP32 on COM3 has been flashed with the current development build.
Its configured HTTPS URL was corrected to the running ngrok endpoint. The original
board had Secure Boot and flash encryption disabled; no eFuses were changed.
Flash upload and hash verification passed. The old firmware backup failed twice
with serial read corruption, so there is no verified backup of the old image.

## What the live test found and fixed

- A local HTTPClient was destroyed after every POST, closing the supposedly
  reusable TLS connection. The publisher now retains that client and drains
  bounded acknowledgement bodies before reusing the socket.
- The original TLS handshake spent roughly 4.4 seconds verifying the certificate
  chain. Repeated complete connection failures took about 6.7-9.8 seconds.
- A desktop TLS probe through this tunnel succeeded with a 0.5-second handshake
  pause but failed with a 1-second pause. This establishes an observed timeout
  along this path, not a universal ngrok service guarantee.
- The firmware now negotiates ECDHE-RSA with AES-GCM and P-256. It generates a fresh
  ephemeral key before opening TCP and imports that single-use key with mbedTLS's
  ECDH API. Certificate and hostname validation remain enabled. Atomic ownership
  isolates the publisher and diagnostic worker's prepared keys; each is freed
  after the connection attempt. The profile requires a server with these suites.
- The one-second evaluation loop could measure 999 ms from the end of its previous
  capture and skip the next tick. Capture scheduling now uses the evaluation
  timestamp, restoring the intended one-second stopped cadence.
- Diagnostic HTTP runs on its own worker/socket. Its read/connect budget is now
  1.5 seconds. Telemetry uses 1-second TCP connect and 1.5-second HTTP read limits.
  Cold TLS has a separate 10-second budget, not a total end-to-end deadline.

Temporary TLS-library instrumentation was removed and the installed SDK file was
verified identical to its saved original. One temporary instrumentation build
caused rebooting because of a null diagnostic string; it was corrected and replaced.
The final successful tests used the restored SDK and repository-owned TLS profile.

## Measurements

| Window / measurement | Result |
|---|---|
| Stationary serial capture | 63 requests, all HTTP 202 |
| HTTP duration | p50 565 ms; p95 1,122 ms; maximum 1,863 ms |
| Backend processing from response headers | p50 416 ms; p95 974 ms |
| Independent RTDB observer | 66 events |
| RTDB gaps after the first live event | p50 926 ms; p95 1,678 ms; maximum 1,760 ms |
| Clean reboot follow-up | 58 requests, all HTTP 202 |
| First request after clean reboot, including cold TLS | 2,946 ms |
| Separate 10-read RTDB probe | p50 323.1 ms; maximum 371.1 ms |

The RTDB observer initially received an old snapshot and then waited 23,671 ms
before live updates resumed during setup/recovery. That startup interval is
recorded separately, not hidden inside the steady-state statistics. These short
windows establish successful stationary delivery and absence of the repeated
7-9 second request stalls in those windows, not a zero-latency guarantee.

GNSS/NTP divergence of about seven seconds was observed. Raw subtraction of device
UTC from server UTC would therefore mislabel clock skew as network latency. The
reported HTTP durations use the ESP32 monotonic timer; server processing uses
paired server timestamps. See the 2026-09-13 follow-up below for the receiver correction and its measured scope.

No moving drive, physical A-to-B-to-A journey, real multipath replay, browser paint
trace or Singapore-versus-current-region comparison was performed. The earlier
route, stop-order and per-bus reroute fixes retain their automated coverage.

Native firmware policy tests: 23 passed. Backend suite: 434 passed, 7 skipped.
Development firmware build/upload passed; this is not a signed secure fleet build.
Aggregate results and image hash are in LIVE_BENCH_METRICS.json. Raw serial and
observer data remain under ignored hardware/.pio because they contain device
identifiers and location/timing evidence.


## Stationary recovery follow-up, 2026-09-13

The receiver now snapshots UTC/date/position/speed/course immediately when a
checksum-valid active RMC sentence commits. A later GGA can no longer mix a new
time with the previous date. Current-port UBX-CFG-MSG requests keep RMC and GGA
and disable unused GLL/GSA/GSV/VTG output at 9600 baud. These settings are volatile;
no receiver flash configuration or baud rate is changed. The connected receiver
acknowledged all six commands. The format follows the [u-blox M8 protocol manual,
section 32.10.18](https://content.u-blox.com/sites/default/files/products/documents/u-blox8-M8_ReceiverDescrProtSpec_UBX-13003221.pdf).

In a 180-second cold-boot capture, 179 valid RMC fixes had system-minus-RMC offsets
between -5 and +153 ms. NTP independently reported 131 ms divergence. Before the
message-rate change, an empty ESP32 RX buffer accompanied about 0.8 seconds of
additional RMC arrival delay over 70 seconds. The comparison supports receiver
output congestion as the growing-delay cause. This is a short stationary
verification, not PPS-level UTC accuracy or a long-run clock guarantee.

Wi-Fi was initially unavailable and reconnected during the capture without a
reflash. A watched backend restart changed its serving PID and telemetry resumed.
A tunnel restart exposed an additional defect: ngrok's offline endpoint returns
HTTP 404 with `Ngrok-Error-Code: ERR_NGROK_3200`, which previously triggered the
60-second configuration backoff. Firmware now classifies only that explicit
404/error-code pair as transient, with the 1-2 second transport retry. Genuine
404, credential errors, other gateway errors and rate limits retain their policies.
The exact offline header was measured against the running tunnel; ngrok documents
the offline error in its [error reference](https://ngrok.com/docs/errors/reference).

The trace analyzer reports p50/p95/p99/max, every correlated gap above two seconds,
HTTP failures/retries and telemetry TLS attempts separately from diagnostics.
It rejects four-timestamp latency estimates when the device wall clock steps
during a request. Device-only reports explicitly retain missing browser coverage.
Use one device per input trace. Raw serial files contain occasional malformed
lines; those lines cannot establish complete failure/gap counts.

Latest automated checks: 657 web/backend/script tests passed, 7 skipped; all 35
native firmware tests passed. Full lint, backend build and production frontend
build passed. The development image compiled successfully. No merge to main.

Still open: final patched tunnel-restart retest, deliberate Wi-Fi interruption,
TLS idle-expiry and controlled packet-loss/slow-network scenarios, browser
callback-to-render trace, long stationary soak and the user-deferred 30-60 minute
moving-route run. Cold TLS still has a separate 10-second handshake budget and DNS
can exceed the TCP connect limit. Do not interpret the shorter steady-state
measurements as a hard two-second maximum or zero freezes under outages.
