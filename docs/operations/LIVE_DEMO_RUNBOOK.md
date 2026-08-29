# My live bus demo runbook

This is the checklist for the student operating the professor demonstration.
Complete every blocking item before inviting passengers onto the bus.

## 1. Freeze the demo data

- [ ] Choose one demo bus ID, one driver account, one device ID, and one route.
- [ ] In the admin panel, create the route with the real boarding stops in the
  exact order the bus will visit them.
- [ ] Put stop 1 where the ride should visibly start and the final stop where
  it should end. Keep consecutive stops more than 150 m apart for this demo.
- [ ] Assign that route to the bus and assign the driver account to the bus.
- [ ] Walk/drive the route once and correct inaccurate stop pins before the
  professor session.

Record the final non-secret values:

| Item | Final value |
|---|---|
| Firebase project | |
| Bus ID | |
| Route ID | |
| Driver email | |
| Device ID | |
| HTTPS backend URL | |

## 2. Prepare the laptop backend

- [ ] Install dependencies with `npm install`.
- [ ] Fill `backend/.env` and `frontend/.env.local`; do not commit either file.
- [ ] Keep `AUTH_REVOCATION_CACHE_MS=15000` for the demo; `0` is a
  troubleshooting option that adds a Firebase Auth network round trip to every
  protected backend action.
- [ ] For the bus test, keep `BUS_STALE_MS=300000`; passenger ETA updates
  automatically from the live telemetry stream.
- [ ] Run `npm run verify` successfully.
- [ ] Run `platformio run --project-dir hardware` successfully and archive the
  RAM/flash report.
- [ ] Run `npm run dev`; confirm frontend `http://localhost:3000` and backend
  `http://localhost:4000/health`.
- [ ] Prevent laptop sleep, connect the charger/power bank, and disable
  automatic OS restarts for the demonstration window.

The ESP and professor phones cannot call laptop `localhost`. Give the backend
an HTTPS address:

- **Preferred campus option:** university DNS and a valid certificate pointing
  to the laptop/backend.
- **Demo option:** the approved ngrok development domain assigned to the demo
  account, forwarding to `http://localhost:4000`.

Configure the ngrok account once, then start the backend endpoint with the same
explicit URL before every rehearsal:

```powershell
ngrok config add-authtoken <YOUR_NGROK_AUTHTOKEN> # one-time, outside the repo
ngrok http 4000 --url https://<assigned-domain>
```

- [ ] Record only the stable ngrok/public HTTPS backend origin for the
  device-specific firmware configuration; do not add a path or query.
- [ ] Verify and export the issuing root CA used by that hostname for the
  ignored firmware `secrets.h`; never pin the renewable leaf certificate.
- [ ] Test the public URL from a phone on mobile data:
  `https://<backend-host>/health`.
- [ ] Record admin-authenticated `/api/health.telemetry` processing, device-to-server and RTDB-write
  p50/p95/p99 during rehearsal; empty values before telemetry are expected.
- [ ] Keep the tunnel process running for the entire ride.

Prefer the deployed Firebase Hosting frontend for professor phones. If the
laptop frontend must be exposed, provision a **second eligible stable HTTPS
domain** to `http://localhost:3000`; the free ngrok account's single assigned
development domain should remain dedicated to the backend:

- [ ] Put the backend HTTPS URL in `NEXT_PUBLIC_BACKEND_URL` before starting
  the frontend.
- [ ] Put the frontend HTTPS origin in backend `CORS_ORIGIN`.
- [ ] Add the frontend tunnel hostname to Firebase Authentication authorized
  domains.
- [ ] If App Check enforcement is enabled, register a temporary debug token and
  set `NEXT_PUBLIC_FIREBASE_APPCHECK_DEBUG_TOKEN` only for this local demo.
- [ ] Restart both dev servers after environment changes, then open the frontend
  HTTPS URL on the laptop and each professor phone.

The assigned backend domain must remain unchanged across rehearsals. Restarting
ngrok with the same `--url` does not require reflashing. A domain, issuing-root,
Wi-Fi/device-credential, or firmware change does; repeat the complete rehearsal
after any such change. Follow the [ngrok tunnel runbook](NGROK_TUNNEL.md).

## 3. Register and flash the ESP32

After creating the bus and route, provision the demo device from the repository
root:

```powershell
npm run provision-device --workspace=backend -- `
  --device-id <DEVICE_ID> --bus-id <BUS_ID> --route-id <ROUTE_ID>
```

The command generates a random secret, stores only its salted verifier, and
prints the plaintext once. Transfer it only into the ignored
`hardware/include/secrets.h` in the controlled build workspace; do not paste it
into this document, chat, screenshots, shell history, or Git.

- [ ] Restart the local backend after provisioning so no old credential cache
  remains.

- [ ] Use a bus Wi-Fi/hotspot that the ESP can reconnect to automatically.
- [ ] Copy `hardware/include/secrets.example.h` to the ignored `secrets.h` and
  set hotspot name/password, device ID/secret, HTTPS backend origin, and CA.
- [ ] In the witnessed signing environment, run
  `platformio run --project-dir hardware -e esp32dev-secure`.
- [ ] Connect the ESP32 and run
  `platformio run --project-dir hardware -e esp32dev-secure --target upload`.
- [ ] Open the 115200-baud serial monitor and confirm the firmware accepts the
  compile-time configuration without printing any credential value.
- [ ] Confirm Wi-Fi, time sync, GNSS fix, remote diagnostics,
  and HTTP 200/202 responses. Any 401 means the ID/secret/registry is wrong;
  any TLS error means URL, hostname, clock, or CA is wrong.

## 4. Install hardware in the bus

- [ ] Use a fused 12 V-to-5 V automotive buck converter; verify stable voltage
  before connecting the ESP32.
- [ ] Mount the GNSS antenna with a clear sky view, away from large metal
  obstructions and noisy power wiring.
- [ ] Secure the ESP32, GNSS, antenna cable, and power cable so braking cannot
  disconnect them.
- [ ] Ensure the hotspot and laptop have adequate mobile data and battery.
- [ ] Do not operate or inspect the laptop while driving; use a separate
  operator.

## 5. Full rehearsal

Open two signed-in browser sessions through the frontend HTTPS URL:
passenger and admin.

- [ ] Before arming, all panels show the correct bus/route assignment.
- [ ] Arm the assigned ride in the admin Operations panel while a fresh GNSS fix is available.
- [ ] Attempt to arm another route for the same bus in a second request/session;
  confirm the durable bus lock returns a conflict and no second ride appears.
- [ ] Confirm the ride is `pre_departure`; it must not start merely because it
  was armed.
- [ ] Enter stop 1 and confirm both panels change to `in_service`.
- [ ] Visit every stop in order and confirm progress advances one at a time.
- [ ] At an intermediate stop, unplug ESP power for over five minutes. Confirm
  the ride remains active and panels show signal interruption.
- [ ] During a controlled bench rehearsal (not while driving), simulate a loop
  stall and verify the 25-second watchdog reset/recovery and logged reset reason.
- [ ] Restore power. Confirm the same session and stop progress return without
  arming a new ride.
- [ ] Refresh each web app and restart the local backend once during a second
  rehearsal; confirm the same active ride recovers.
- [ ] Visit a later stop before an expected stop in a safe dry run; confirm it
  does not skip progress.
- [ ] Reach the final stop last. Confirm automatic completion on all panels and
  a completed-trip record.

## 6. Professor-day sequence

1. Start hotspot/network, backend, the stable ngrok backend endpoint, and the
   Firebase-hosted (or separately tunneled) frontend.
2. Check `/health`; check ESP serial response 200/202.
3. Sign in to passenger and admin panels.
4. Select the assigned bus and route; arm once.
5. Tell professors: the first ordered stop starts the ride, signal loss does
   not end it, and only the final ordered stop completes it.
6. Drive all stops in order while a second person watches both panels.
7. Save screenshots, serial log, `/health` output, and final completed trip.
8. Confirm the final ride has no matching `active_rides` or
   `_active_bus_locks` record before another arm test.

## 7. Go/no-go rule and fallback

Do not run the live demonstration if HTTPS, GNSS fix, correct assignments,
two signed-in panels, or a full ordered rehearsal is missing.

Carry a spare ESP32/USB cable/power lead, hotspot, charger, printed stop list,
and a screen recording of a successful rehearsal. The recording is evidence
of prior success, not a substitute for claiming the live system worked.

After the demo, stop the tunnel and rotate the device secret and any temporary
App Check debug token.
