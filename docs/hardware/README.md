# ESP32 + NEO-M8N tracker

The firmware continuously parses NMEA on UART2, captures trusted GNSS state in
a bounded RTC-memory queue, and publishes it from a separate FreeRTOS task. It
has no Firebase credential and cannot choose its bus or route.

## Before you start

The tracker is not self-configuring. Prepare the backend, the device registry,
the network, and the firmware configuration before connecting power.

### Required software and files

From the repository root, install Node dependencies and PlatformIO. The
backend must be configured from [`backend/.env.example`](../../backend/.env.example)
into the ignored `backend/.env`; the frontend is configured separately from
[`frontend/env.production.example`](../../frontend/env.production.example) when
you need the browser workspace. Hardware flashing does not require the
frontend build, but the backend URL must be reachable by the device.
Use PlatformIO 6.1.19 or a compatible current release, a data-capable USB
cable, and a stable power source. The secure fleet path additionally requires
an ESP32 ECO3-or-newer board and the university-controlled RSA-3072 signing key
at `hardware/keys/secure_boot_signing_key.pem`; that key must exist only in the
approved signing environment.

```powershell
npm install
py -m pip install --upgrade platformio
Copy-Item backend/.env.example backend/.env
Copy-Item hardware/include/secrets.example.h hardware/include/secrets.h
```

For the backend, set Firebase Admin credentials or ADC,
`FIREBASE_DATABASE_URL`, and an appropriate `GOOGLE_MAPS_API_KEY` when routes
will be seeded or edited. Production also requires exact `CORS_ORIGIN` and an
HTTPS deployment; see [configuration](../CONFIGURATION.md). Never copy
real service-account JSON into the repository.

The device cannot reach a backend configured as `localhost` or
`127.0.0.1`. For a bench/demo device use a reachable LAN hostname or an
approved HTTPS tunnel; for fleet use a managed HTTPS DNS name. The issuing CA
in `BACKEND_ROOT_CA` must match that hostname's certificate.

For the firmware, `hardware/include/secrets.h` must define all six values from
`secrets.example.h`:

| Definition | What to enter | Validation and when it changes |
|---|---|---|
| `WIFI_SSID` | The 2.4 GHz Wi-Fi/hotspot name | 1–32 characters; changing the network requires a reflash |
| `WIFI_PASS` | Wi-Fi password | 8–63 printable ASCII characters; changing it requires a reflash |
| `DEVICE_ID` | The exact provisioned device ID | 1–128 letters, digits, `_` or `-`; changing it requires backend reprovisioning and a reflash |
| `DEVICE_SECRET` | The one-time secret printed by the backend provisioner | 20–128 letters, digits, `_` or `-`; changing it requires backend rotation/reprovisioning and a reflash |
| `BACKEND_URL` | Reachable backend origin (development may use HTTP or HTTPS; `esp32dev-secure` fleet builds require `https://`), with no `/api` path, query or credentials | Maximum 256 characters; changing host requires a reflash |
| `BACKEND_ROOT_CA` | PEM certificate chain that issues the backend certificate | Required and validated for HTTPS; CA rotation requires a reflash |

Keep the PEM line breaks as `\n` inside the C++ string. Do not put a Firebase
API key, service-account credential, bearer token, route ID, bus ID, or private
signing key in `secrets.h`. The ignored file contains device and Wi-Fi secrets;
never commit, print, upload, or retain it in an unencrypted artifact.

### Backend and route preparation order

Complete these steps before building the device image:

1. Start the backend with its environment file and verify reachability with
   `GET /health` (development may use any reachable origin; production/fleet
   requires HTTPS).
2. Create the route and its ordered stops. Use `npm run seed --workspace=backend`
   for the predefined development routes or the admin route editor for a
   managed route. Route geometry requires the server Maps key.
3. Create a bus and assign the route to `assignedRoutes`. Create the driver
   record/Auth assignment if the route will be operated.
4. Provision the device against that existing bus/route:

   ```powershell
   npm run provision-device --workspace=backend -- `
     --device-id device_01 --bus-id bus_01 --route-id route_01
   ```

   Capture the printed secret once in the controlled signing environment. The
   backend stores only a salted verifier and rejects conflicting active rides,
   locks, or duplicate device assignments.
5. Put the provisioned `DEVICE_ID` and one-time `DEVICE_SECRET` into the
   ignored `hardware/include/secrets.h`, together with Wi-Fi, backend origin,
   and issuing root CA.

### What is route-specific and what must be flashed

The firmware does **not** contain route geometry, stops, bus IDs, driver IDs,
service times, delays, or passenger data. It sends only `DEVICE_ID`, position,
motion, and timestamp. The backend registry supplies the device's current
`busId` and `routeId`.

| Change | Backend action | Reflash required? |
|---|---|---|
| Add/edit route name, stops, waypoints, color or polyline | Seed or save the route in the backend; validate stop order and walk/drive it | No |
| Assign the same device to another approved bus/route | Update the device registry/admin assignment while no active ride/lock exists; restart the backend after direct CLI provisioning to clear credential caches | No, if device ID/secret/network/backend/CA stay the same |
| Change bus/route while the current ride is active | Stop at a safe terminal state and clear the approved lifecycle conflict first | No hardware change, but the backend correctly rejects unsafe reassignment |
| Change Wi-Fi name/password | Update `WIFI_SSID`/`WIFI_PASS` | Yes |
| Change device ID | Provision the new ID, update `DEVICE_ID` | Yes |
| Rotate/replace device secret or disable a lost device | Rotate/disable the backend registry record, update `DEVICE_SECRET` | Yes for the replacement secret; a disabled device remains halted until corrected and restarted |
| Change backend hostname, TLS certificate issuer/root CA or port/origin | Update the backend and `BACKEND_URL`/`BACKEND_ROOT_CA` | Yes |
| Change firmware policy, dependency, security mode or telemetry timing | Rebuild the intended PlatformIO environment | Yes |

Changing a route in Firestore does not update firmware. Conversely, reflashing
firmware does not change the backend's bus/route assignment; keep those two
operations synchronized through the registry and the provisioning record.

## Build and flash checklist

Choose exactly one build path:

| Purpose | Command | Use |
|---|---|---|
| Host policy tests | `platformio test --project-dir hardware -e native` | Safe repeatable tests; no board or secrets required by the native target |
| Bench/development board | `platformio run --project-dir hardware -e esp32dev` then `platformio run --project-dir hardware -e esp32dev --target upload` | Local testing only; never install this image in a production vehicle |
| Signed fleet board | Follow [fleet security provisioning](../operations/HARDWARE_SECURITY_PROVISIONING.md) and use `esp32dev-secure` | Production-capable artifact; requires the signing key, ECO3+ board, witnessed first boot and physical evidence |

After flashing, open the monitor at 115200 baud and verify, without exposing
credential values:

1. Compile-time validation passes for all six configuration definitions.
2. The board reports the expected firmware environment and connects to the
   configured Wi-Fi network.
3. GNSS time/fix becomes valid and the backend receives telemetry with `200` or
   `202` responses.
4. The backend's authenticated diagnostics endpoint receives a report. An
   admin can inspect it at `GET /api/devices/:deviceId/diagnostics`.
5. Admin-authenticated `/api/health` shows accepted telemetry and no sustained background failures; public `/health` reports readiness only.
6. A controlled Wi-Fi/backend outage recovers without a recovery portal, stale
   replay, or a second ride session.

If a boot validation message names `WIFI_SSID`, `WIFI_PASS`, `DEVICE_ID`,
`DEVICE_SECRET`, `BACKEND_URL`, or `BACKEND_ROOT_CA`, correct that definition in
the ignored file and rebuild. A 401/403 is a backend registry/credential or
assignment problem; update the registry and flash the corrected device secret
when required. A TLS error is a hostname, clock, certificate-chain, or root-CA
problem; do not bypass certificate validation.

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
platformio run --project-dir hardware -e esp32dev --target upload
platformio device monitor --project-dir hardware --baud 115200
```

`secrets.h` is the firmware's only configuration source. Wi-Fi, device ID,
device secret, backend origin, and root CA are validated at boot. The firmware
does not contain a recovery portal, recovery password, application key-value
store, or remotely editable configuration. Configuration and credential changes
still require a controlled reflash. Signed application-only releases can use
the secure fleet OTA path described below. Never commit, log, or archive `secrets.h` or an
unencrypted development firmware image because credentials are embedded in the
binary.

`esp32dev` is development-only. Fleet artifacts must use `esp32dev-secure`,
which requires the ignored university RSA-3072 signing key and enables Secure
Boot V2, release-mode flash encryption, and ROM-download lockdown. Fleet builds
also require HTTPS and disable Wi-Fi driver persistence. Follow the witnessed
[fleet security procedure](../operations/HARDWARE_SECURITY_PROVISIONING.md)
on spare ECO3-or-newer boards before irreversible first boot.

The secure profile has two 1,966,080-byte application slots and bootloader
rollback enabled. After two minutes of idle, stopped operation with an empty
telemetry queue, the device asks its configured backend for a newer release by
using the existing device authorization header. The backend returns no release
while that device's bus has an active ride. Release metadata must name an exact
HTTPS object, size, SHA-256 digest, version and strictly increasing sequence.
The signed application descriptor uses `s<sequence>-<name>` and must exactly
match both manifest fields, so an older signed image cannot be relabelled as a
new sequence.
The artifact request never receives the device credential. The device verifies
the stream digest before activating the slot, and Secure Boot V2 rejects an
image not signed by the fleet key. A candidate becomes permanent only after an
authenticated telemetry or diagnostics response; otherwise the bootloader
rolls it back after five minutes. The artifact host certificate must chain to
`BACKEND_ROOT_CA`.

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
- Moving fixes are captured on a one-second cadence; the stopped heartbeat is
  60 seconds. A 120-sample RTC ring survives resets, evicts oldest on overflow,
  sends newest first after outages, compacts acknowledged older fixes, and
  discards samples outside the backend's 55-second safety margin.
- Wi-Fi retries indefinitely with bounded 5-60 second exponential backoff,
  strongest-AP fast scan, auto-reconnect, and modem sleep disabled.
- HTTP 200/202 succeeds. Transport errors, 408/425/429, and 5xx retain the
  newest eligible sample with bounded backoff. Other permanent rejection drops
  that sample. A 401/403 latches publishing off, disables the station radio,
  and emits three GPIO2 pulses every two seconds; correction requires updating
  `secrets.h` and reflashing.
- A 25-second watchdog covers both tasks. Authenticated remote diagnostics send
  bounded health state every five minutes while idle and never send credentials.
- Fleet OTA checks are locally idle/stopped and server-gated against active
  rides. Downloaded candidates are size/digest checked, secure-boot verified,
  installed into the inactive slot and health-confirmed with automatic rollback.

Read [Hardware telemetry](HARDWARE_TELEMETRY.md) for parameters,
failure points, and physical acceptance cases. A production release still
requires controlled signing, immutable HTTPS hosting, backend release metadata,
and spare-board rollout/rollback evidence.
