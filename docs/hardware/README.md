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

Fill ignored `secrets.h` with Wi-Fi, device ID/secret, HTTPS backend origin and its issuing root CA. The backend URL must begin `https://`; insecure TLS is unavailable. The secret must be the one-time value printed by backend provisioning. If any template placeholder remains, firmware stops at boot with an explicit configuration error instead of attempting a misleading request to `your-backend.example`.

Platform/library versions are pinned in `platformio.ini`. The native suite checks distance/heading math, motion hysteresis, HTTP response/retry policy, publish/heartbeat decisions, queue wraparound, newest-first recovery, retries, overflow and stale eviction. Current verified build uses 8.1% regular RAM and 17.5% flash; the 120-sample RTC no-init queue occupies 5,808 bytes.

## Behavior

- NTP establishes certificate/time-stamp time; GNSS UTC is not used to set the system clock.
- NMEA parsing/evaluation remains on the Arduino loop task. Wi-Fi, NTP, TLS and HTTP run in a dedicated FreeRTOS publisher task on core 0, so network stalls do not block UART consumption.
- UART RX remains 8 KiB as protection against scheduler/diagnostic jitter. HardwareSerial buffer-full/FIFO-overflow events and TinyGPSPlus checksum failures are counted and reported every 30 seconds.
- Fix requires location age ≤5 seconds and HDOP ≤4. Motion has three-reading 2.5/1.5 km/h hysteresis.
- Capture happens after at least three seconds when distance ≥5 m, heading ≥15°, speed delta ≥5 km/h or motion changes; heartbeat is 30 seconds moving/60 stopped. Capture state is independent of delivery state, so an outage does not bypass this sampling policy.
- The RTC no-init ring holds 120 samples (at least six minutes at the maximum three-second capture rate), survives software/watchdog resets and drops the oldest sample on overflow. Its device/backend identity tag prevents replay after reconfiguration.
- On recovery, the publisher sends the newest sample first. Transport errors, HTTP 408/425/429 and 5xx keep that sample queued with backoff. HTTP 429 honors bounded `Retry-After`; permanent HTTP rejections remove only the rejected sample. Samples older than the 55-second safety margin are counted and removed before they can violate the backend's 60-second timestamp contract.
- GNSS loss queues one `uncertain` sample at the last trustworthy coordinate; no dead-reckoned location is presented as truth.
- Wi-Fi reconnects without persisting credentials to flash, uses fastest/strongest AP selection and disables modem sleep for vehicle-powered low latency.
- A 25-second task watchdog covers both the GNSS loop and publisher while allowing bounded connect-plus-request latency. Reset reason, queue health, request time/size/RSSI/status and overflow counters are logged, but SSID/secret are not.

HTTP 202 is a new fix, 200 a duplicate, 400 invalid body/time, 401 credential/registry, 429 rate and 503 dependency outage. Negative HTTPClient values are transport failures; serial output includes the library error string and a secret-safe DNS/hostname/CA/clock/reachability checklist.

Read [Hardware telemetry](HARDWARE_TELEMETRY.md) for every parameter, failure point, metrics and bench/vehicle acceptance case. Secure Boot V2, flash encryption and signed OTA/rollback are controlled deployment procedures; test them on spare boards before irreversible eFuse work.
