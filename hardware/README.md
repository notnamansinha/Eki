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
platformio run --project-dir hardware
platformio test --project-dir hardware -e native
platformio run --project-dir hardware --target upload
platformio device monitor --project-dir hardware --baud 115200
```

There is no compile-time credential file. Remove any legacy local `hardware/include/secrets.h`; fleet builds reject it and other compile-time credential definitions. On an empty device, monitor the controlled serial connection and record the random per-device recovery password. Connect to the WPA2 `Eki-Recovery-*` access point, open `http://192.168.4.1`, and submit Wi-Fi, provisioned device ID/secret, HTTPS backend origin, and issuing root CA. The form never returns stored values. The complete configuration is validated and atomically stored as one versioned, checksummed NVS record before restart.

`esp32dev` is development-only. Fleet artifacts must use `esp32dev-secure`, which requires the ignored university RSA-3072 signing key and enables Secure Boot V2, release-mode flash encryption, NVS encryption, and ROM-download lockdown. Fleet compilation fails if any required build-time protection is disabled, and fleet firmware halts before reading configuration or starting networking unless both hardware protections report active. Follow the witnessed [fleet security procedure](../docs/operations/HARDWARE_SECURITY_PROVISIONING.md) on spare ECO3-or-newer boards before irreversible first boot.

Platform/library versions are pinned in `platformio.ini`. The native suite checks UTC conversion/discipline, Wi-Fi escalation and LED patterns, distance/heading math, motion hysteresis, HTTP response/retry policy, publish/heartbeat decisions, queue wraparound, newest-first recovery, retries, overflow and stale eviction. Re-run the build for the exact release candidate instead of relying on historical size figures; the 120-sample RTC no-init queue occupies 5,808 bytes.

## Behavior

- Fresh, calendar-valid GNSS date/time establishes and disciplines the system clock with `settimeofday`, even when NTP is blocked. NTP starts after Wi-Fi connects as a six-hour cross-check/fallback; a discrepancy of at least 1.5 seconds is corrected back to fresh GNSS UTC at a bounded one-minute cadence.
- NMEA parsing/evaluation remains on the Arduino loop task. Wi-Fi, NTP, TLS and HTTP run in a dedicated FreeRTOS publisher task on core 0, so network stalls do not block UART consumption.
- UART RX remains 8 KiB as protection against scheduler/diagnostic jitter. HardwareSerial buffer-full/FIFO-overflow events and TinyGPSPlus checksum failures are counted for authenticated remote diagnostics; routine counter snapshots are not repeated on serial.
- Fix requires location age ≤5 seconds and HDOP ≤4. Motion has three-reading 2.5/1.5 km/h hysteresis.
- Capture happens after at least three seconds when distance ≥5 m, heading ≥15°, speed delta ≥5 km/h or motion changes; heartbeat is 30 seconds moving/60 stopped. Capture state is independent of delivery state, so an outage does not bypass this sampling policy.
- The RTC no-init ring holds 120 samples (at least six minutes at the maximum three-second capture rate), survives software/watchdog resets and drops the oldest sample on overflow. Its device/backend identity tag prevents replay after reconfiguration.
- On recovery, the publisher sends the newest sample first. Transport errors, HTTP 408/425/429 and 5xx keep that sample queued with backoff. HTTP 429 honors bounded `Retry-After`; permanent HTTP rejections remove only the rejected sample. Samples older than the 55-second safety margin are counted and removed before they can violate the backend's 60-second timestamp contract.
- GNSS loss queues one `uncertain` sample at the last trustworthy coordinate; no dead-reckoned location is presented as truth.
- Wi-Fi retries with bounded 5-60 second exponential backoff, uses fastest/strongest AP selection and disables modem sleep for vehicle-powered low latency. An unprovisioned device starts the protected local portal immediately; a configured device exposes it after a continuous two-minute outage or an API credential rejection. Replacing configuration requires every field, writes one closed NVS record, and restarts so old identity state cannot leak into the new assignment.
- The recovery AP password is generated once at first boot and printed over the controlled serial connection only while unprovisioned. It can be rotated from the authenticated portal (`POST /rotate-recovery` with the page CSRF token): the portal returns the new password once, then the device restarts so the AP adopts it. Save the new value before the restart; the old password stops working when the restart completes.
- GPIO2 is the status LED: two short pulses every two seconds mean Wi-Fi recovery mode; three mean a latched device-credential fault. A successful station connection stops the recovery AP automatically.
- A 25-second task watchdog covers both the GNSS loop and publisher while allowing bounded connect-plus-request latency. Serial output is reserved for actionable transitions and failures; successful watchdog setup, publisher startup, clock setup, HTTP delivery, and periodic health snapshots stay quiet. Every five minutes, an idle publisher sends bounded health state plus firmware version, heap, and hardware-security status to the device-authenticated diagnostics endpoint; it never sends credentials.

HTTP 202 is a new fix, 200 a duplicate, 400 invalid body/time, 401/403 credential/registry, 429 rate and 503 dependency outage. A 401/403 retains the rejected sample in the bounded queue, latches publishing off, and enables protected local reprovisioning instead of retrying a doomed secret forever; normal freshness eviction still applies. HTTP 429 honors the backend's bounded `Retry-After`; transport and 5xx failures retain the newest eligible sample. Negative HTTPClient values include the library error string and a secret-safe DNS/hostname/CA/clock/reachability checklist.

To rotate from a controlled PowerShell workstation connected to the recovery AP, fetch the one-time form token and immediately submit it. Record the returned password before the device restarts:

```powershell
$page = Invoke-WebRequest http://192.168.4.1/
$csrf = [regex]::Match($page.Content, 'name="csrf" value="([0-9a-f]{16})"').Groups[1].Value
$rotation = Invoke-RestMethod -Method Post -Uri http://192.168.4.1/rotate-recovery -Body @{ csrf = $csrf }
$rotation.recoveryPassword
```

Read [Hardware telemetry](../docs/hardware/HARDWARE_TELEMETRY.md) for every parameter, failure point, metrics and bench/vehicle acceptance case. Signed OTA/rollback remains a separate deployment prerequisite; the committed build and runtime gates do not replace physical spare-board acceptance.
