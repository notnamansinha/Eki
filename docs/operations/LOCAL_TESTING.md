# Local Web, Phone and Device Testing

| Document ID | Version | Status | Last updated |
|---|---|---|---|
| EKI-OPS-004 | 1.1 | Current | 2026-11-02 |

## 1. Purpose

This procedure runs Eki on a developer workstation and exercises it end to end with a browser, a phone and an ESP32 device. Use a development Firebase project and disposable test records. For a rehearsed demonstration on a bus, use the [live demo runbook](LIVE_DEMO_RUNBOOK.md) instead.

## 2. Prerequisites

- The repository installed and both environment files configured as in [getting started](../GETTING_STARTED.md): `backend/.env` with `NODE_ENV=development` and `PORT=4000`, `frontend/.env.local` with `NEXT_PUBLIC_BACKEND_URL=http://localhost:4000`.
- Firebase Authentication configured for local sign-in ([configuration](../CONFIGURATION.md)).
- For phones and devices: an ngrok assigned domain ([ngrok tunnel](NGROK_TUNNEL.md)).
- For devices: PlatformIO, an ESP32 with a GNSS receiver ([hardware guide](../../hardware/README.md)) and a Wi-Fi network that the device can join.

Run every command from the repository root.

## 3. Procedure

### 3.1 Start the services

1. Start the frontend and the backend together:

   ```powershell
   npm run dev
   ```

   Expected: the frontend listens on `http://localhost:3000` and the backend logs `BusTrack backend running on port 4000`. Keep this terminal open.
2. In another terminal, check backend readiness:

   ```powershell
   Invoke-RestMethod http://localhost:4000/health
   ```

   Expected: `status: ok`. A `503` with `status: degraded` means the backend cannot reach Firestore or RTDB; fix the credentials or `FIREBASE_DATABASE_URL` before testing rides.
3. Open `http://localhost:3000` and sign in. Expected: the account reaches its workspace (Admin or Passenger) and the routes and fleet records load.

In development the backend allows `http://localhost:3000` without a `CORS_ORIGIN` entry.

### 3.2 Expose the backend to phones and devices

A phone or a device cannot reach the workstation's `localhost`.

1. Start the tunnel as described in [ngrok tunnel](NGROK_TUNNEL.md#4-start-the-backend-and-the-tunnel), with `TRUST_PROXY=loopback` in `backend/.env`. Expected: `https://<assigned-domain>/health` returns `status: ok` from a phone on mobile data.
2. Point each consumer at the tunnel origin ([ngrok tunnel](NGROK_TUNNEL.md#6-point-the-consumers-at-the-tunnel)). Expected: the phone's frontend reaches the backend without CORS errors.

The deployed Firebase Hosting frontend calls the staging Cloud Run backend, not this workstation. To exercise the workstation backend from a phone, use a frontend build that names the tunnel origin. Keep the workstation awake for the whole test.

### 3.3 Prepare a device

1. In the admin Routes and Fleet & People tabs, create the route, the bus with that route assigned, and one operator assigned to the bus. Expected: the bus lists the route and exactly one operator.
2. Register the device and print its secret:

   ```powershell
   npm run provision-device --workspace=backend -- --device-id <device-id> --bus-id <bus-id> --route-id <route-id>
   Copy-Item hardware/include/secrets.example.h hardware/include/secrets.h
   ```

   Expected: `Device provisioned` followed by the secret, printed once. The command refuses a bus and route that already have an active ride or another device.
3. In `hardware/include/secrets.h`, set all six definitions: `WIFI_SSID`, `WIFI_PASS`, `DEVICE_ID`, `DEVICE_SECRET`, `BACKEND_URL` (the HTTPS tunnel origin) and `BACKEND_ROOT_CA` ([ngrok tunnel](NGROK_TUNNEL.md#5-provision-tls-trust-in-the-firmware)). Store the secret privately; the file is ignored by Git.
4. Find the port, test, build, flash and monitor:

   ```powershell
   py -m platformio device list
   py -m platformio test --project-dir hardware -e native
   py -m platformio run --project-dir hardware -e esp32dev
   py -m platformio run --project-dir hardware -e esp32dev --target upload --upload-port COM3
   py -m platformio device monitor --project-dir hardware --port COM3 --baud 115200
   ```

   Replace `COM3` with the listed port. Expected: the native tests pass and the serial log shows telemetry responses `200` or `202`.

A board that still uses the original partition layout needs the [journal acceptance procedure](../hardware/COLD_POWER_RECOVERY.md); do not change its partition table as part of this test. Vehicle builds follow [hardware security provisioning](../security/HARDWARE_SECURITY_PROVISIONING.md).

### 3.4 Exercise the workflows

1. Power the device with a clear view of the sky. Expected: Live Ops shows the bus online. Once a fresh fix with HDOP of 4 or less arrives, the service starts by itself and the card shows `Direction Pending` or `Awaiting Stop 1`. There is no start action. `Assignment required` means the device, bus, route or operator records do not match ([automatic GNSS service](AUTOMATIC_GNSS_SERVICE.md#3-admission-conditions)).
2. Move away from stop 1. Expected: the card shows `In Service` once the bus is about 50 m from stop 1 (less when stop 2 is closer).
3. In a second browser session signed in as a passenger, choose a destination stop and a boarding stop, then select `Board` while within 150 m of the bus. Expected: the passenger is `On board`; no boarding code is requested.
4. Pass each stop in order. Expected: the passenger header shows `At <stop>` on arrival and `Next: <stop>` afterwards. A stop missed while telemetry continued shows `Passed · not confirmed`.
5. Change the delay from Live Ops, send a ride message, and reach the final stop. Expected: the ride completes, the passenger can leave ride feedback, and History lists the ride.
6. Repeat with `End ride early` from Live Ops. Expected: History shows the ride as `Ended early`, no new service starts, and Live Ops offers `Resume tracking` for that bus while the device is online.
7. Run the outage and physical cases in the [test strategy](../testing/TEST_STRATEGY.md) that the change affects.

## 4. Verification

Record the commit, the device build, the date, the route, the conditions and the steps that passed or failed. A local run is development evidence; it does not replace the field acceptance in the [deployment checklist](UNIVERSITY_DEPLOYMENT_CHECKLIST.md#7-acceptance-test).

## 5. Troubleshooting

| Symptom | First checks |
|---|---|
| Device DNS or TLS failure | Local and public `/health`, the running tunnel, the compiled hostname, the device clock and the root CA |
| Device receives `401` | Device ID and secret in `secrets.h` match the last `provision-device` run; the device is enabled |
| Browser cannot reach the backend | The backend URL compiled into the frontend, the backend process, `CORS_ORIGIN` and, on Hosting, the CSP |
| Sign-in works but admin data is denied | Role claims and the authorization version ([privileged database authorization](../security/PRIVILEGED_DATABASE_AUTHORIZATION.md)) |
| Service never starts | Live Ops state label; fix freshness (60 s) and HDOP; one operator on the bus ([automatic GNSS service](AUTOMATIC_GNSS_SERVICE.md#7-troubleshooting)) |
| Wrong bus or route on the map | Device registry and bus assignment; the live key is `{busId}_{routeId}` |
| A change has no effect | Restart the changed service, rebuild the frontend, or reflash changed firmware configuration |

## 6. Finish the test

1. Stop the device, the dev servers and the ngrok agent.
2. If you started the local telemetry stack, stop it with `docker compose -f observability/docker-compose.yml down`.
3. Delete test-only dashboards, alerts, domains and credentials only after confirming that nothing else uses them.
4. Keep redacted evidence. Keep raw serial logs, credentials and location screenshots private.
