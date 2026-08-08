# ESP32 + NEO-M8N tracker

The firmware continuously parses NMEA on UART2 and adaptively pushes only trusted/latest GNSS state to the backend. It has no Firebase credential and cannot choose its bus/route.

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
Copy-Item include/secrets.example.h include/secrets.h
platformio run --project-dir hardware
platformio test --project-dir hardware -e native
platformio run --project-dir hardware --target upload
platformio device monitor --baud 115200
```

Fill ignored `secrets.h` with Wi-Fi, device ID/secret, HTTPS backend origin and its issuing root CA. The backend URL must begin `https://`; insecure TLS is unavailable. The secret must be the one-time value printed by backend provisioning.

Platform/library versions are pinned in `platformio.ini`. The native suite checks distance/heading math, motion hysteresis, retry bounds and publish/heartbeat decisions. Current verified build uses 14.4% RAM and 29.7% flash.

## Behavior

- NTP establishes certificate/time-stamp time; GNSS UTC is not used to set the system clock.
- UART RX buffer is 8 KiB so NMEA survives the seven-second synchronous HTTPS maximum.
- Fix requires location age ≤5 seconds and HDOP ≤4. Motion has three-reading 2.5/1.5 km/h hysteresis.
- Publish happens after at least three seconds when distance ≥5 m, heading ≥15°, speed delta ≥5 km/h or motion changes; heartbeat is 30 seconds moving/60 stopped.
- Failure closes TLS and retries latest-only data with 1–30 second exponential jitter. A buffer older than 55 seconds is dropped.
- GNSS loss publishes one `uncertain` sample at the last trustworthy coordinate; no dead-reckoned location is presented as truth.
- Wi-Fi reconnects without persisting credentials to flash, uses fastest/strongest AP selection and disables modem sleep for vehicle-powered low latency.
- A 15-second task watchdog resets a hung loop. Reset reason and request time/size/RSSI/status are logged, but SSID/secret are not.

HTTP 202 is a new fix, 200 a duplicate, 400 invalid body/time, 401 credential/registry, 429 rate and 503 dependency outage. TLS failures normally mean URL/hostname/CA/clock.

Read [Hardware telemetry](../docs/hardware/HARDWARE_TELEMETRY.md) for every parameter, failure point, metrics and bench/vehicle acceptance case. Secure Boot V2, flash encryption and signed OTA/rollback are controlled deployment procedures; test them on spare boards before irreversible eFuse work.
