# ESP32 + NEO-M8N tracker

The firmware continuously parses NMEA on UART2, captures trusted GNSS state in
a bounded RTC-memory queue, and publishes it from a separate FreeRTOS task. It
has no Firebase credential and cannot choose its bus or route.

## Wiring

| ESP32 | NEO-M8N |
|---|---|
| `5V/VIN` | `VCC` (only if the module supports 5 V) |
| `GND` | `GND` |
| `GPIO16 (RX2)` | `TX` |
| `GPIO17 (TX2)` | `RX` |

Use fused automotive 12 V-to-5 V conversion, secure cabling/enclosure, and
clear-sky antenna placement.

## Configure, build, and flash

Copy `include/secrets.example.h` to the ignored `include/secrets.h`, replace all
placeholders, then build and flash:

```powershell
Copy-Item hardware/include/secrets.example.h hardware/include/secrets.h
platformio test --project-dir hardware -e native
platformio run --project-dir hardware -e esp32dev
platformio run --project-dir hardware --target upload
platformio device monitor --project-dir hardware --baud 115200
```

`secrets.h` is the firmware's only configuration source. Wi-Fi, device ID,
device secret, backend origin, and root CA are validated at boot. The firmware
does not contain a recovery portal, recovery password, application key-value
store, or field-update path. Every configuration change requires rebuilding
and reflashing the device. Never commit, log, or archive `secrets.h` or an
unencrypted development firmware image because credentials are embedded in the
binary.

`esp32dev` is development-only. Fleet artifacts must use `esp32dev-secure`,
which requires the ignored university RSA-3072 signing key and enables Secure
Boot V2, release-mode flash encryption, and ROM-download lockdown. Fleet builds
also require HTTPS and disable Wi-Fi driver persistence. Follow the witnessed
[fleet security procedure](../docs/operations/HARDWARE_SECURITY_PROVISIONING.md)
on spare ECO3-or-newer boards before irreversible first boot.

Arduino-ESP32 2.x unconditionally initializes a small framework system
partition during startup. Eki never opens it or stores configuration there;
`WiFi.persistent(false)` is selected before driver initialization, and the
secure build disables ESP32 Wi-Fi key-value persistence. Removing that final
framework partition requires replacing/forking the Arduino core and cannot be
done safely while retaining the current Wi-Fi stack.

## Behavior

- Fresh, calendar-valid GNSS UTC establishes and disciplines the system clock.
  NTP starts after Wi-Fi connects as a six-hour cross-check/fallback.
- NMEA parsing stays on the Arduino loop task. Wi-Fi, NTP, TLS, and HTTP run in
  a publisher task on core 0 so network stalls do not block UART consumption.
- The 8 KiB UART RX buffer and hardware/TinyGPSPlus error counters make parser
  pressure observable without noisy periodic serial output.
- A fix requires location age at most five seconds and HDOP at most 4. Motion
  uses three-reading 2.5/1.5 km/h hysteresis.
- Changed fixes are captured after a three-second floor; moving/stopped
  heartbeats are 30/60 seconds. A 120-sample RTC ring survives resets, evicts
  oldest on overflow, sends newest first after outages, and discards samples
  outside the backend's 55-second safety margin.
- Wi-Fi retries indefinitely with bounded 5-60 second exponential backoff,
  strongest-AP fast scan, auto-reconnect, and modem sleep disabled.
- HTTP 200/202 succeeds. Transport errors, 408/425/429, and 5xx retain the
  newest eligible sample with bounded backoff. Other permanent rejection drops
  that sample. A 401/403 latches publishing off, disables the station radio,
  and emits three GPIO2 pulses every two seconds; correction requires updating
  `secrets.h` and reflashing.
- A 25-second watchdog covers both tasks. Authenticated remote diagnostics send
  bounded health state every five minutes while idle and never send credentials.

Read [Hardware telemetry](../docs/hardware/HARDWARE_TELEMETRY.md) for parameters,
failure points, and physical acceptance cases. Signed OTA/rollback remains a
separate deployment prerequisite.
