# ESP32 + NEO-M8N tracker

The firmware continuously parses NMEA on UART2, captures trusted GNSS state into a bounded RTC-memory queue and publishes it from a separate FreeRTOS task. It has no Firebase credential and cannot choose its bus/route.

## Wiring

| ESP32 | NEO-M8N |
|---|---|
| `5V/VIN` | `VCC` (only if module supports 5 V) |
| `GND` | `GND` |
| `GPIO16 (RX2)` | `TX` |
| `GPIO17 (TX2)` | `RX` |

Use fused automotive 12 V-to-5 V conversion, secure cabling/enclosure and clear-sky antenna placement.

## Configure/build/flash

```powershell
Copy-Item hardware/include/secrets.example.h hardware/include/secrets.h
platformio run --project-dir hardware
platformio test --project-dir hardware -e native
platformio run --project-dir hardware --target upload
platformio device monitor --project-dir hardware --baud 115200
```

Fill ignored `secrets.h` with Wi-Fi, a unique 12-63 character recovery-AP password, device ID/secret, HTTPS backend origin and its issuing root CA. Never reuse the device API secret or campus Wi-Fi password for recovery access. The backend URL must begin `https://`; insecure TLS is unavailable. The device secret must be the one-time value printed by backend provisioning. If any template placeholder remains, firmware stops at boot with an explicit configuration error instead of attempting a misleading request to `your-backend.example`.

Platform/library versions are pinned in `platformio.ini`. The native suite checks UTC conversion/discipline, Wi-Fi escalation and LED patterns, distance/heading math, motion hysteresis, HTTP response/retry policy, publish/heartbeat decisions, queue wraparound, newest-first recovery, retries, overflow and stale eviction. Re-run the build for the exact release candidate instead of relying on historical size figures; the 120-sample RTC no-init queue occupies 5,808 bytes.

## Behavior

- Fresh, calendar-valid GNSS date/time establishes and disciplines the system clock with `settimeofday`, even when NTP is blocked. NTP starts after Wi-Fi connects as a six-hour cross-check/fallback; a discrepancy of at least 1.5 seconds is corrected back to fresh GNSS UTC at a bounded one-minute cadence.
- NMEA parsing/evaluation remains on the Arduino loop task. Wi-Fi, NTP, TLS and HTTP run in a dedicated FreeRTOS publisher task on core 0, so network stalls do not block UART consumption.
- UART RX remains 8 KiB as protection against scheduler/diagnostic jitter. HardwareSerial buffer-full/FIFO-overflow events and TinyGPSPlus checksum failures are counted and reported every 30 seconds.
- Fix requires location age ≤5 seconds and HDOP ≤4. Motion has three-reading 2.5/1.5 km/h hysteresis.
- Capture happens after at least three seconds when distance ≥5 m, heading ≥15°, speed delta ≥5 km/h or motion changes; heartbeat is 30 seconds moving/60 stopped. Capture state is independent of delivery state, so an outage does not bypass this sampling policy.
- The RTC no-init ring holds 120 samples (at least six minutes at the maximum three-second capture rate), survives software/watchdog resets and drops the oldest sample on overflow. Its device/backend identity tag prevents replay after reconfiguration.
- On recovery, the publisher sends the newest sample first. Transport errors, HTTP 408/425/429 and 5xx keep that sample queued with backoff. HTTP 429 honors bounded `Retry-After`; permanent HTTP rejections remove only the rejected sample. Samples older than the 55-second safety margin are counted and removed before they can violate the backend's 60-second timestamp contract.
- GNSS loss queues one `uncertain` sample at the last trustworthy coordinate; no dead-reckoned location is presented as truth.
- Wi-Fi retries with bounded 5-60 second exponential backoff, uses fastest/strongest AP selection and disables modem sleep for vehicle-powered low latency. After a continuous two-minute outage it starts the WPA2-protected `Eki-Recovery-*` AP and local `http://192.168.4.1` Wi-Fi form while station retries continue. A valid replacement network is stored as a fixed-size, versioned, checksummed NVS record; its SSID/password are never returned or logged. NVS confidentiality still requires the flash-encryption deployment gate.
- GPIO2 is the status LED: two short pulses every two seconds mean Wi-Fi recovery mode; three mean a latched device-credential fault. A successful station connection stops the recovery AP automatically.
- A 25-second task watchdog covers both the GNSS loop and publisher while allowing bounded connect-plus-request latency. Reset reason, active fault code, queue health, request time/size/RSSI/status and overflow counters are logged, but SSID/secret are not.

HTTP 202 is a new fix, 200 a duplicate, 400 invalid body/time, 401/403 credential/registry, 429 rate and 503 dependency outage. A 401/403 removes the rejected sample and latches publishing off until credentials are repaired and the device restarts, instead of retrying a doomed credential forever. HTTP 429 honors the backend's bounded `Retry-After`; transport and 5xx failures retain the newest eligible sample. Negative HTTPClient values include the library error string and a secret-safe DNS/hostname/CA/clock/reachability checklist.

Read [Hardware telemetry](../docs/hardware/HARDWARE_TELEMETRY.md) for every parameter, failure point, metrics and bench/vehicle acceptance case. Secure Boot V2, flash encryption and signed OTA/rollback are controlled deployment procedures; test them on spare boards before irreversible eFuse work.
