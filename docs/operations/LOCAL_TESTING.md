# Local web, phone and ESP32 testing

Last updated: 2026-10-27 04:10 IST (UTC+05:30).

Use this runbook after [local setup](../GETTING_STARTED.md#local-development). Run commands from the repository root. Use a development Firebase project and disposable test records.

## 1. Start and check the services

Set backend `NODE_ENV=development`, `PORT=4000` and `CORS_ORIGIN=http://localhost:3000`. When phones or the ESP32 reach this backend through a local ngrok agent, also set `TRUST_PROXY=loopback` so each tunnelled client gets its own pre-auth rate-limit bucket (see [ngrok tunnel](NGROK_TUNNEL.md)). Set frontend `NEXT_PUBLIC_BACKEND_URL=http://localhost:4000`. Configure Auth as described in [configuration](../CONFIGURATION.md#local-auth-setup).

```powershell
npm run dev
```

Keep that terminal open. In another terminal:

```powershell
Invoke-RestMethod http://localhost:4000/health
```

Expect HTTP `200` and `status: ok`. If it is degraded, repair backend Firebase credentials/RTDB configuration before testing rides. Open `http://localhost:3000`, sign in, and verify the intended workspace and catalogs.

## 2. Expose the backend to phones and hardware

A remote client cannot use laptop `localhost`. Follow the [ngrok runbook](NGROK_TUNNEL.md) to configure an assigned HTTPS domain and its certificate trust. Start its tunnel in a separate terminal:

```powershell
$TestDomain = '<assigned-domain>'
ngrok http 4000 --url "https://$TestDomain"
```

Verify the public `/health` from another network. Keep the backend, tunnel and laptop awake throughout the test.

| Consumer | Configuration | Apply the change |
|---|---|---|
| Local frontend opened by a phone | `NEXT_PUBLIC_BACKEND_URL` in ignored `frontend/.env.local` | Restart frontend |
| Hosted frontend | Backend origin in the production build environment | Strict build, regenerated CSP and approved Hosting deploy |
| ESP32 | `BACKEND_URL` and verified `BACKEND_ROOT_CA` in ignored `hardware/include/secrets.h` | Rebuild/reflash |
| Backend | `CORS_ORIGIN` lists frontend origins | Restart backend |

Prefer an existing approved Firebase Hosting frontend for phones. A frontend tunnel needs its own eligible domain, Firebase Auth authorized-domain/redirect configuration, provider configuration and backend CORS entry. Normal tunnel restarts on the same origin do not require reflashing; a hostname, root CA, credential or firmware change does.

## 3. Prepare a device

Create route and bus records first, then provision the test device:

```powershell
npm run provision-device --workspace=backend -- `
  --device-id device_01 --bus-id bus_01 --route-id route_01
Copy-Item hardware/include/secrets.example.h hardware/include/secrets.h
```

Fill all six firmware definitions with the test Wi-Fi, device credential, HTTPS backend origin and issuing root CA. The plaintext device secret is printed once; store it privately. Follow the [hardware guide](../../hardware/README.md) for wiring and target selection.

```powershell
py -m platformio device list
py -m platformio test --project-dir hardware -e native
py -m platformio run --project-dir hardware -e esp32dev
py -m platformio run --project-dir hardware -e esp32dev --target upload --upload-port COM3
py -m platformio device monitor --project-dir hardware --port COM3 --baud 115200
```

Replace `COM3` with the detected port. An older board using the original partition layout needs the [journal acceptance procedure](../hardware/COLD_POWER_RECOVERY.md); do not replace its partition table as an incidental test step. Fleet builds follow the separate [security provisioning procedure](HARDWARE_SECURITY_PROVISIONING.md).

## 4. Exercise the workflows

1. Confirm the device registry, bus routes and driver assignment refer to the same IDs.
2. Verify fresh hardware coordinates and honest stopped/moving status in Live Ops and Passenger.
3. Choose a passenger destination before boarding; verify it remains selected when boarding opens.
4. Arm the assigned ride with valid endpoint evidence. Use a second authenticated passenger session to join with the boarding code and ordered stops.
5. Check delay, messaging, ordered stop progress, final-stop completion, feedback and history. Early termination must appear as an interrupted ride.
6. Perform the separate outage/physical cases in [test strategy](../testing/TEST_STRATEGY.md). Record commit, device build, conditions, timestamps and limits of the result.

## 5. Diagnose and finish

| Symptom | First checks |
|---|---|
| ESP32 DNS/transport failure | Local health, public health, running tunnel, exact compiled hostname, clock and CA |
| Browser cannot reach backend | Browser-visible backend origin, backend process, CORS and hosted CSP |
| Security verification fails | Provider key/debug-token registration, development-only opt-out and Firebase enforcement |
| Wrong live route | Device registry and bus assignment; live key is `{busId}_{routeId}` |
| Changes have no effect | Restart the changed service, rebuild hosted frontend or reflash changed firmware configuration |

At test completion, stop device traffic, dev servers and tunnel agents. Stop the optional local telemetry stack with `docker compose -f observability/docker-compose.yml down`. Remove test-only external dashboards, alerts, reserved endpoints and secret-store credentials only after checking their ownership and other consumers. Keep application instrumentation and test fixtures while they remain supported features. Preserve redacted evidence; keep raw serial logs, credentials and location screenshots private.
