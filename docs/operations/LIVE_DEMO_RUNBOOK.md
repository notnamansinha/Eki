# Live Demo Runbook

| Document ID | Version | Status | Last updated |
|---|---|---|---|
| EKI-OPS-005 | 1.1 | Current | 2026-11-02 |

## 1. Purpose

This runbook prepares and runs a live demonstration of Eki on a bus: one device, one route, a laptop-hosted backend reached through ngrok, and the deployed frontend on viewers' phones. The deployed staging frontend calls the Cloud Run backend, not a laptop, so Section 4 points it at the tunnel for the demonstration and restores the Cloud Run URL afterwards. Complete every blocking step before passengers board. A demonstration is not university acceptance; that is defined in the [deployment checklist](UNIVERSITY_DEPLOYMENT_CHECKLIST.md).

To measure latency during a rehearsal, also follow the [telemetry latency baseline](TELEMETRY_LATENCY_BASELINE.md). To record evidence, follow [field capture](FIELD_CAPTURE.md).

## 2. Roles and prerequisites

| Role | Responsibility |
|---|---|
| Operator | Runs the laptop, the backend, the tunnel and the admin view; records evidence |
| Driver | Drives the bus; never operates the laptop or the web app while the bus moves |
| Observer | Watches the passenger and admin views during the ride |

Prerequisites: the repository set up as in [getting started](../GETTING_STARTED.md); an ngrok assigned domain ([ngrok tunnel](NGROK_TUNNEL.md)); one ESP32 with a GNSS receiver; a hotspot that the device joins automatically; administrator and passenger accounts.

## 3. Freeze the demo data

1. Choose one bus ID, one device ID, one route and one operator record. Expected: the four IDs are written down.
2. In the admin Routes tab, create the route with the real stops in the order the bus visits them. Place each pin on the kerb where the bus stops, on the bus's left for its direction of travel, and place stop 1 and the final stop within 10 m of where the bus parks, so that a stopped fix there resolves the direction. Expected: the route shows the stops in order with road geometry.
3. Keep consecutive stops more than 100 m apart. The bus leaves stop 1 after 50 m only when stop 2 is at least 100 m away, and stops within 30 m of each other count as one place.
4. In Fleet & People, assign the route to the bus and exactly one operator to the bus. Expected: the bus lists the route and one operator.
5. Drive or walk the route once and move any pin that is more than a few metres off the kerb. Expected: arrivals register at each stop in the rehearsal (Section 7).

Record the non-secret values:

| Item | Value |
|---|---|
| Firebase project | |
| Bus ID | |
| Route ID | |
| Operator record ID | |
| Device ID | |
| Backend HTTPS origin | |

## 4. Prepare the backend and the tunnel

1. Run `npm ci`, then `npm run verify`. Expected: lint, tests, build and the runtime dependency audit pass.
2. Run `py -m platformio run --project-dir hardware -e esp32dev` and keep the RAM and flash report. Expected: the build succeeds.
3. Keep the defaults `AUTH_REVOCATION_CACHE_MS=15000` and `BUS_STALE_MS=300000` in `backend/.env`. Setting `AUTH_REVOCATION_CACHE_MS=0` adds a Firebase Auth round trip to every protected request.
4. Start the backend and the tunnel with `TRUST_PROXY=loopback` and the deployed frontend origin in `CORS_ORIGIN` ([ngrok tunnel](NGROK_TUNNEL.md#4-start-the-backend-and-the-tunnel)). Expected: `https://<assigned-domain>/health` returns `status: ok` from a phone on mobile data.
5. Point the deployed frontend at this backend origin: the staging secret `NEXT_PUBLIC_BACKEND_URL` names the Cloud Run service, so change it to `https://<assigned-domain>` and redeploy ([CI, deployment and releases](CI_CD_AND_RELEASES.md#8-release-procedure)). Then run `node scripts/check-stationary-runtime.mjs --frontend https://bustrack-be165.web.app --backend https://<assigned-domain>`. Expected: every check passes. The script checks the frontend page, backend health and CORS for the frontend origin; it does not check which backend the frontend calls. After the demonstration, restore the Cloud Run URL in the secret and redeploy.
6. Connect the laptop charger, disable sleep and automatic restarts for the demonstration window.

Viewers use the deployed frontend. Exposing the laptop frontend needs a second stable domain, a Firebase Auth authorized domain and a `CORS_ORIGIN` entry ([DNS and domains](DNS_AND_DOMAINS.md#4-firebase-authentication-domains)); test sign-in on every intended phone before relying on it.

## 5. Provision and flash the device

1. Provision the device after the bus and route exist:

   ```powershell
   npm run provision-device --workspace=backend -- --device-id <device-id> --bus-id <bus-id> --route-id <route-id>
   ```

   Expected: `Device provisioned` and the secret, printed once. The command stores only a salted verifier and publishes a credential cache invalidation. If it reports that invalidation failed, restore RTDB connectivity and run it again before flashing.
2. Copy `hardware/include/secrets.example.h` to the ignored `hardware/include/secrets.h` and set the hotspot name and password, the device ID and secret, the tunnel origin and its verified root CA ([ngrok tunnel](NGROK_TUNNEL.md#5-provision-tls-trust-in-the-firmware)). Do not paste the secret into chat, screenshots, shell history or Git.
3. Build and flash `esp32dev` for a demonstration board, as in [local testing](LOCAL_TESTING.md#33-prepare-a-device). A vehicle in university service uses only `esp32dev-secure` under [hardware security provisioning](../security/HARDWARE_SECURITY_PROVISIONING.md); its first boot burns eFuses irreversibly.
4. Open the serial monitor at 115200 baud. Expected: Wi-Fi joins, time synchronises, a GNSS fix appears and telemetry returns `200` or `202`, with no credential printed. A `401` means the ID, secret or registry entry is wrong; a TLS error means the URL, hostname, clock or root CA is wrong.

## 6. Install the hardware in the bus

- [ ] Power the ESP32 from a fused 12 V to 5 V automotive buck converter; measure the output before connecting.
- [ ] Mount the GNSS antenna with a clear sky view, away from large metal surfaces and noisy power wiring.
- [ ] Secure the ESP32, receiver, antenna cable and power cable so that braking cannot disconnect them.
- [ ] Confirm hotspot and laptop battery and mobile data for the whole window.

## 7. Rehearsal

Open the deployed frontend in two signed-in sessions: one administrator (Live Ops) and one passenger.

1. With the bus parked at stop 1 and the device on. Expected: Live Ops shows the bus online and, after a fresh fix, the card shows `Direction Pending` or `Awaiting Stop 1` without any start action. The passenger route list shows the bus.
2. Board as the passenger within 150 m of the bus: choose the destination stop and boarding stop, then `Board`. Expected: `On board`.
3. Drive away from stop 1. Expected: the card shows `In Service` after about 50 m.
4. Stop at each intermediate stop. Expected: the passenger header shows `At <stop>` on arrival, then `Next: <stop>` after departure.
5. Parked at an intermediate stop, disconnect the GNSS antenna. Expected: the passenger view shows `GPS signal lost` at once. Reconnect it. Expected: the live state returns.
6. Parked, unplug the device for more than five minutes. Expected: the passenger view shows `Updates delayed` after 12 s and `Live tracking lost` after 30 s, and Live Ops shows `Service paused`; after five minutes the ride leaves the passenger map, while Live Ops keeps the bus at its last position with `Last seen`. Restore power. Expected: the same ride and its stop progress return without any admin action.
7. Parked, stop the backend for one minute, then start it again. Expected: the passenger view shows the same delay and loss states, then the same ride recovers. Refresh both browsers. Expected: the same ride and progress appear.
8. In a safe dry run, drive past one intermediate stop without entering 15 m of it. Expected: after the bus reaches one of the next two stops, the missed stop shows `Passed · not confirmed`, never as an arrival.
9. Stop within 15 m of the final stop for at least 2 s. Expected: the ride completes on both views and appears in History. After the 30 s turnaround wait, a stopped fix at the final stop starts the return service in the opposite direction.

Repeat the full rehearsal after any change to the domain, root CA, Wi-Fi or device credentials, firmware, or route pins.

## 8. Demonstration day

1. Start the hotspot, the laptop backend and the ngrok agent with the same `--url` as the rehearsal. Expected: public `/health` returns `status: ok`.
2. Power the device. Expected: serial telemetry `200` or `202`; Live Ops shows the bus online.
3. Sign in to the admin and passenger views on the demonstration phones.
4. Explain to viewers: the service starts by itself from the device's fix, signal loss does not end the ride, and only the final stop completes it.
5. Drive the stops in order while the observer watches both views.
6. Save screenshots, the serial log, the `/health` output and the completed ride in History.

## 9. Go or no-go

Do not run the live demonstration if public HTTPS, a GNSS fix, correct assignments, two signed-in views or a complete rehearsal is missing.

Carry a spare ESP32, USB cable and power lead, a second hotspot, a charger, a printed stop list and a screen recording of the successful rehearsal. Present the recording as a record of the rehearsal, not as the live system.

| Problem during the demonstration | Action |
|---|---|
| Public `/health` fails | Restart the ngrok agent with the same `--url`; then the backend ([ngrok tunnel](NGROK_TUNNEL.md#9-troubleshooting)) |
| Live Ops shows `Assignment required` | Check the bus route and the single operator in Fleet & People |
| Live Ops shows `Tracking paused` | The ride was ended early; select `Resume tracking` ([automatic GNSS service](AUTOMATIC_GNSS_SERVICE.md#6-ending-pausing-and-resuming-a-service)) |
| No fix | Move the bus to open sky; wait for a fix with HDOP of 4 or less |

## 10. After the demonstration

1. Stop the device, the ngrok agent and, if no one else uses it, the backend.
2. If the device secret left the private store, rotate it with `provision-device` and reflash.
3. Archive the evidence privately; publish only redacted results.
