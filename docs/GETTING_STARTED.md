# Getting Started with Eki

| Document ID | Version | Status | Last updated |
|---|---|---|---|
| EKI-GEN-004 | 2.0 | Current | 2026-10-30 |

## 1. Purpose

This tutorial takes you from a clean Windows, macOS or Linux machine to a working local Eki system: the frontend on `http://localhost:3000`, the backend on `http://localhost:4000`, a development Firebase project with one route, one bus, one operator and one provisioned tracker, and a live bus on the map. It then walks through the main workflow of each role.

Commands are written for PowerShell and run from the repository root unless a step says otherwise. Every setting mentioned here is defined in the [configuration reference](CONFIGURATION.md); terms are defined in the [glossary](GLOSSARY.md).

## 2. Prerequisites

### 2.1 Software

| Tool | Version | Needed for |
|---|---|---|
| Git | Any current release | Cloning the repository |
| Node.js and npm | Node.js 24, the version CI uses; npm ships with it | Everything in this tutorial |
| Google Chrome or another Chromium browser | Current release | The app, and DevTools location override in Section 10.1 |
| Java | 21 | Only `npm run test:rules` and the emulator suites |
| Python and PlatformIO Core | Python 3.12, PlatformIO 6.2.0 (the versions CI pins) | Only firmware builds and native firmware tests |

### 2.2 Accounts and cloud resources

Create these before you start. Use a project that holds no production data.

1. A Firebase project for development with:
   - Authentication, with the Google sign-in provider enabled;
   - a Cloud Firestore default database;
   - a Realtime Database (RTDB) instance;
   - a registered web app, whose configuration values you copy in Section 5.
2. Google Maps Platform enabled on the same Google Cloud project, with billing:
   - a browser API key for the Maps JavaScript API, restricted to your local and hosted origins, and a map ID;
   - a server API key for the Routes API and Places API (New).
3. Credentials for Firebase Admin on your machine: either Application Default Credentials for the development project, or a service-account JSON key for it.
4. Three Google accounts that you can sign in with: one becomes the administrator, one the operator and one the passenger. One account cannot hold two roles: saving an operator changes that account's role to `driver`, and only a passenger account can board.

<a id="local-development"></a>

## 3. Install the repository

1. Clone the repository and install the locked dependencies:

   ```powershell
   git clone https://github.com/notnamansinha/Eki.git
   Set-Location Eki
   npm ci
   ```

   Expected result: `npm ci` finishes without errors and installs the dependencies of the root, `backend` and `frontend` workspaces from `package-lock.json`.

## 4. Configure the backend

1. Copy the backend template:

   ```powershell
   Copy-Item backend/.env.example backend/.env
   ```

2. Edit `backend/.env`. The template is a production template; change these values:

   | Variable | Local value |
   |---|---|
   | `NODE_ENV` | `development` |
   | `PORT` | `4000` |
   | `CORS_ORIGIN` | `http://localhost:3000` |
   | `FIREBASE_DATABASE_URL` | Your development RTDB URL |
   | `GOOGLE_MAPS_API_KEY` | Your server Maps key |
   | `RETENTION_SWEEPER_ENABLED` | Keep `false` |

3. Provide Firebase Admin credentials in one of two ways:
   - Application Default Credentials [1] for the development project. Leave `FIREBASE_SERVICE_ACCOUNT` unset.
   - Set `FIREBASE_SERVICE_ACCOUNT` to the complete service-account JSON on one line, in single quotes.

   Expected result: `backend/.env` names only development resources. If you leave `NODE_ENV=production`, the backend refuses to start because retention is disabled.

## 5. Configure the frontend

1. Copy the frontend template:

   ```powershell
   Copy-Item frontend/env.production.example frontend/.env.local
   ```

2. Edit `frontend/.env.local`:
   - Set the seven `NEXT_PUBLIC_FIREBASE_*` values from the Firebase web app configuration. `NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID` can stay as it is.
   - Set `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` to the browser key and `NEXT_PUBLIC_GOOGLE_MAP_ID` to the map ID.
   - Set `NEXT_PUBLIC_BACKEND_URL=http://localhost:4000`.

   Expected result: `NEXT_PUBLIC_FIREBASE_DATABASE_URL` and the backend's `FIREBASE_DATABASE_URL` name the same RTDB instance.

## 6. Prepare the Firebase project

The browser reads Firestore and RTDB directly under the repository's security rules, so the development project must run the current rules and indexes.

1. Sign in to the Firebase CLI and deploy rules and indexes to the development project. The repository's `.firebaserc` names a shared project as `default`, so always pass `--project`:

   ```powershell
   npx --yes firebase-tools@15.14.0 login
   npx --yes firebase-tools@15.14.0 deploy --project <dev-project-id> --only firestore:rules,firestore:indexes,database:rules
   ```

   Expected result: the CLI reports a successful deploy for the three targets. Index builds continue in the background for a few minutes.

2. If App Check enforcement was ever turned on for Firestore or RTDB in this project, turn it off. See [local authentication setup](CONFIGURATION.md#8-local-authentication-setup).

## 7. Start the system

1. Start the frontend and backend together:

   ```powershell
   npm run dev
   ```

   To run one side only, use `npm run dev --workspace=frontend` or `npm run dev --workspace=backend`.

2. In a second terminal, check backend readiness:

   ```powershell
   Invoke-RestMethod http://localhost:4000/health
   ```

   Expected result: `status: ok` with HTTP 200, which means the cached Firestore and RTDB probes succeed. HTTP 503 with `status: degraded` means the process runs but cannot reach Firebase; fix the credentials or RTDB URL before you continue. `GET /live` returns `status: alive` whenever the process is up.

3. Open `http://localhost:3000`.

   Expected result: the sign-in page with a **Sign In with Google** button.

<a id="create-initial-development-data"></a>

## 8. Create development data

### 8.1 Create the administrator

1. Sign in at `http://localhost:3000` with the account that will be the administrator.

   Expected result: the passenger workspace opens. The backend has created `users/<uid>` in Firestore with `role: "passenger"`.

2. In the Firebase console, open Firestore, find that `users/<uid>` document, and change `role` to `admin`.
3. Publish the role as trusted claims:

   ```powershell
   npm run sync-role-claims --workspace=backend
   ```

   Expected result: the command ends with `Synchronized <n> users; 0 failed.`

4. Sign out and sign in again.

   Expected result: the app opens `/admin` with the tabs **Live Ops**, **Routes**, **Fleet & People**, **History**, **Feedback** and **Settings**.

5. Sign in once with the operator account and once with the passenger account, in a private window or another browser profile, so that both have Firebase Auth accounts and passenger profiles.

### 8.2 Create a route

Use one of two methods:

- In **Routes**, create a route with a route ID, a display name and at least two stops in travel order, then save it. The backend computes forward and reverse road geometry with the Routes API.
- Or load the predefined Ahmedabad routes from `frontend/src/lib/predefinedRoutes.ts`:

  ```powershell
  npm run seed --workspace=backend
  ```

  Expected result: the command reports the number of routes written to the `routes` collection, for example `route_au_samras`. The seed calls the Routes API for both directions of every route, and running it again updates those route documents.

### 8.3 Create a bus and an operator

1. In **Fleet & People**, register a vehicle: enter a vehicle ID, for example `bus_01`, and a name, and assign the route.
2. Register an operator: enter an operator ID, a name, the operator account's Auth UID (from Firebase console, Authentication), and assign `bus_01`.

   Expected result: both records appear in the saved lists. The operator account now has `role: "driver"` and trusted claims for `bus_01`, and its existing sessions are revoked, so it must sign in again. Automatic service requires exactly one operator assigned to the bus.

### 8.4 Provision a tracker

Register a device for the bus and route. The route must already be assigned to the bus:

```powershell
npm run provision-device --workspace=backend -- --device-id device_01 --bus-id bus_01 --route-id <route-id>
```

Expected result: the command prints `Device provisioned` and a device secret. The secret is shown once and stored only as a salted hash; copy it to a private place. The command refuses a bus and route that already have an active ride or another device.

## 9. Send live telemetry

Choose one source of telemetry.

### 9.1 With an ESP32 tracker

A tracker cannot reach `localhost` on your machine. Expose the backend over HTTPS, fill `hardware/include/secrets.h`, then build and flash by following [local testing](operations/LOCAL_TESTING.md) and the [hardware guide](../hardware/README.md).

### 9.2 Without hardware

Send the backend the same request the firmware sends, once per second, with the bus standing at the route's first stop. Replace the placeholders with the device secret from Section 8.4 and the first stop's coordinates (for `route_au_samras`, `23.0335` and `72.5566`):

```powershell
$deviceId = "device_01"
$secret = "<device-secret>"
for ($seq = 1; $seq -le 120; $seq++) {
  $now = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  $body = @{ lat = <first-stop-lat>; lng = <first-stop-lng>; speed = 0; heading = 0; motionState = "stopped"; gpsHdop = 0.9; seq = $seq; timestamp = $now; deviceSentAt = $now } | ConvertTo-Json -Compress
  Invoke-RestMethod -Method Post -Uri "http://localhost:4000/api/devices/$deviceId/telemetry" -Headers @{ Authorization = "Device $secret" } -ContentType "application/json" -Body $body | Out-Null
  Start-Sleep -Seconds 1
}
```

Expected result: each request is accepted, `bus_01` appears in **Live Ops**, and the backend starts an automatic service: a ride session in trip state `pre_departure` with a resolved direction. When the loop ends, the passenger view changes to "Updates delayed" after 12 s and to "Live tracking lost" after 30 s.

This loop never moves the bus, so stops do not advance. Stop progress needs a real or recorded drive; see [tracking algorithms](design/TRACKING_ALGORITHMS.md).

## 10. Role walkthroughs

### 10.1 Passenger

1. Sign in with the passenger account. The **Map** tab lists the routes that currently have a live or available bus. The **Routes** tab shows the route schedules that an administrator has published (Section 10.2), whether or not a bus is running.
2. Select the route, then the bus, then a destination stop. The map shows the bus, the route in travel order and stop estimates when the bus is live.
3. To board, choose a boarding stop and press **Board**. The backend accepts the request only while the ride is `armed` or `active`, the direction is known, a fresh bus position exists, and the browser's location is within 150 m of the bus. No boarding code is needed. At a desk, set a location near the bus with Chrome DevTools, **Sensors**, **Location**.

   Expected result: the ride card shows the passenger as on board, and the ride chat opens for members of the session.

4. After a completed ride, the app asks for ride feedback. General feedback is available from **Profile**. Feedback is written directly to Firestore under security rules.
5. **Profile**, **Delete Account** sends an account deletion request; after the confirmation is dismissed, the passenger is signed out and the backend deletes the account asynchronously. See [privacy deletion](operations/PRIVACY_DELETION.md).

### 10.2 Administrator

1. **Live Ops** shows every bus on a map and in a list with its live status and delay. From a bus you can change the delay, open the ride chat, or use **End ride early**, which saves the ride as `interrupted` and pauses automatic service for that bus. **Resume tracking** restarts automatic service after such a pause.
2. **Routes** creates, edits and deletes routes and their ordered stops. **Fleet & People** manages vehicles and operators.
3. **History** lists rides, newest first, with their status and stop evidence. **Feedback** shows the latest 200 feedback records and updates their status. **Settings** holds the passenger-facing service start time, the no-bus messages and the announcement text.
4. To publish a route schedule, open **Settings** and scroll to **Passenger Routes**. Select the routes passengers may browse; they appear to passengers in the order you select them. Enter a time for every stop of each selected route, then press **Save routes**. This section saves separately from the settings above it, and leaving the tab with unsaved changes asks for confirmation.

   Expected result: the button changes to **Saved!** and then **No route changes**, and the passenger **Routes** tab shows each selected route as a timeline of its stops and times. A missing or invalid time marks the stop's field and keeps the schedule unsaved. After you delete a route or change its stops, open this section again and save: the passenger view skips deleted routes and shows "Time not set" for new stops until you do.
5. **Passenger Panel** opens the passenger workspace; **Profile**, **Admin Panel** returns.

### 10.3 Operator

The operator has no separate workspace. The operator's assignment to a bus authorizes the automatic service, and the tracker in that bus starts, advances and completes rides from its GNSS fixes:

1. The tracker sends a qualified fix (fresh, with an HDOP accuracy figure of at most 4) and the backend creates the session in `pre_departure`.
2. When the bus leaves the origin, the trip state becomes `in_service`, and each stop is marked as the bus reaches it in route order.
3. A confirmed stop at the final stop completes the ride. After the turnaround wait, a fresh stopped fix there arms the return direction.

The operator account can sign in to the passenger workspace. It cannot board a ride.

## 11. Troubleshooting

| Symptom | Cause and fix |
|---|---|
| Backend exits at startup naming `RETENTION_SWEEPER_ENABLED`, `CORS_ORIGIN` or `FIREBASE_DATABASE_URL` | `NODE_ENV` is still `production`. Set it to `development` (Section 4). |
| Backend exits naming a boolean flag, `TRUST_PROXY` or `RATE_LIMIT_SHARD_FACTOR` | The value is outside the accepted set. See [backend variables](CONFIGURATION.md#3-backend-variables). |
| `/health` returns 503 | Firebase Admin cannot reach Firestore or RTDB. Check the credentials, the project, and `FIREBASE_DATABASE_URL`. |
| "Access could not be verified" with a message about trusted Auth claim synchronization | The Firestore profile says `admin` or `driver`, but the claims were not published. Run `npm run sync-role-claims --workspace=backend` and sign in again. Editing the profile alone grants nothing. |
| "Your account is not permitted to verify this workspace" | Firestore rules denied the profile read: the project runs old rules, or the frontend and backend use different projects. Repeat Section 6 and check both configurations. |
| Firestore or RTDB permission errors in the browser console | The development project runs old rules, or App Check enforcement is on. Repeat Section 6. |
| Map is grey or shows a Maps error | Check the browser key, its referrer restriction for `http://localhost:3000`, and the map ID. |
| Telemetry request returns 401 | Wrong device ID or secret, or the device is disabled. Provision again and use the new secret. |
| Telemetry request returns 400 | A field is missing or out of range, or `timestamp` is more than 60 s old. |
| Telemetry request returns 403 | The device's bus or route assignment is not usable. Check that the route is assigned to the bus. |
| The bus is live but no ride session starts | Automatic service needs an enabled device, a bus assigned to the route, exactly one operator on that bus, a valid route and a fix with HDOP at most 4. |
| **Board** stays disabled or returns "You must be near the bus to board" | The browser's location is more than 150 m from the bus, or tracking is not live. |
| A changed `NEXT_PUBLIC_*` value has no effect | Restart `npm run dev`; the values are compiled into the bundle. |

More checks for phones, tunnels and hardware are in [local testing](operations/LOCAL_TESTING.md).

## 12. Next steps

- Read the [architecture](design/ARCHITECTURE.md) and the [data model](data/FIREBASE_DATA_MODEL.md).
- Before you change code, read [contributing](../CONTRIBUTING.md) and the [test strategy](testing/TEST_STRATEGY.md).
- For phone testing and demonstrations, use [local testing](operations/LOCAL_TESTING.md) and the [live demo runbook](operations/LIVE_DEMO_RUNBOOK.md).

## 13. References

[1] Google, "How Application Default Credentials works," cloud.google.com/docs/authentication/application-default-credentials. Accessed: 2026-10-30.
