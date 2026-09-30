# Non-moving recovery verification

Updated: 2026-09-14. Tests used the connected stationary ESP32/GNSS, local backend, and public tunnel. Raw serial logs remain under ignored `hardware/.pio`.

## Backend outage and recovery

- The backend was deliberately stopped while the ESP32 continued sampling.
- The device made 69 requests: 53 were accepted and 16 failed while the backend was unavailable.
- All 16 failures were retained/retried; the ESP32 did not reboot or lose GNSS clock discipline.
- TLS was re-established and the first eligible retained fix was accepted after the backend returned. Normal 1 Hz delivery resumed immediately afterward.
- The measured 49.036 s ingress gap is the deliberate backend outage, including the development watcher's wait for a source event. Production container restart behavior passed GitHub's container smoke test.

## ngrok restart and recovery

- ngrok was stopped and restarted on the same public hostname.
- The restarted tunnel became locally discoverable in 189 ms; its public health response was 200 in 348 ms.
- The ESP32 made 80 requests: 75 were accepted and 5 failed during the outage. All five failures were retried.
- The first accepted request reached the backend 3.336 s after ngrok was started. Subsequent delivery returned to normal cadence.
- The forced outage produced a 15.899 s maximum ingress gap. Outside that outage, ingress-gap p95 was 1.098 s. Stable delivery reused its TLS connection; reconnects occurred only while the tunnel was unavailable.

## Cold ESP32 reboot and timeout recovery

- A hardware reset produced a confirmed `POWERON_RESET`; no firmware image or configuration was changed.
- Wi-Fi connected about 1.589 s after the boot record, GNSS connected about 2.417 s after it, and the backend accepted the first fix about 3.696 s after it.
- The 75-second capture contained 68 accepted requests and one real 1.5 s HTTP read timeout.
- The first-failure retry was scheduled at 691 ms, inside the new 250–749 ms policy, and succeeded without rebooting.
- Ingress-gap p50/p95/max was 1.001/1.214/4.521 s. No gap exceeded 5 seconds, including the timeout recovery.

## Route and map simulations

- 123 focused backend tests passed, including 3,600 stationary samples in both directions, 100-stop journeys in both travel orders, long route geometry at 27/28/53/100/101 points, automatic return direction, completion/manual-stop races, and shared reroute version guards.
- 45 focused frontend map tests passed, including live reroute geometry refresh, per-bus isolation, ETA geometry, reverse geometry, stale-version rejection, and reconnect marker fallback.
- A trace activation regression found during the browser check was fixed: authentication or App Router transitions can no longer permanently cache `telemetryTrace=1` as disabled. A regression test covers the redirect sequence.

## Still requires physical or controlled-network testing

- A 30–60 minute moving A→B→A and B→A→B run.
- A real off-route drive observed concurrently on Admin and Passenger maps.
- Wi-Fi/radio loss, packet shaping, and TLS idle-expiry tests on the device network. Cold reboot and a real HTTP read-timeout recovery are verified.
- A correlated RTDB commit → browser listener → marker-render export during the moving run.

The recovery tests prove that the device resumes automatically after backend and tunnel outages. They do not make telemetry available while an upstream service is offline, so outage duration must remain separate from normal-path latency.
