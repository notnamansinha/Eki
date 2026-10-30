# Eki Glossary

| Document ID | Version | Status | Last updated |
|---|---|---|---|
| EKI-GEN-006 | 2.0 | Current | 2026-10-30 |

## 1. Purpose

This glossary defines the project terms a new contributor meets in the code, the user interface and the documentation. Eki documents use each term with exactly this meaning. Identifiers in backticks are literal values from the code. The [configuration reference](CONFIGURATION.md) defines environment variables, and the [data model](data/FIREBASE_DATA_MODEL.md) defines every stored field.

## 2. Terms

Terms are sorted alphabetically, ignoring case and backticks.

| Term | Definition |
|---|---|
| Abandoned ride | A `pending`, `armed` or `active` ride session with no activity for `ABANDONED_RIDE_THRESHOLD_HOURS` (default 12 h). The worker ends it as `interrupted`. |
| `active` | Ride-session status while the trip state is `in_service`. The live record uses `status: active` for both `pre_departure` and `in_service`. |
| Active bus lock | The Firestore document `_active_bus_locks/<busId>`. A ride session holds it while it runs, so one physical bus cannot run two sessions at once. |
| Active ride | The Firestore document `active_rides/<busId>_<routeId>`: the durable checkpoint of a running ride (session, direction, trip state, stop index, delay). The backend restores live progress from it after a restart and deletes it when the ride ends. |
| `activeBuses` | The backend-only RTDB node that holds the live records. Browsers cannot read it. |
| Administrator | A user whose Firebase Auth token carries `role: "admin"`, `admin: true` and a current `authorizationVersion`. Administrators use the `/admin` workspace. |
| Admission | The checks the backend applies to a request before a route handles it. Browser admission authenticates every browser `/api` request and limits each user to 200 reads and 30 writes per minute, divided across backend replicas (`backend/src/lib/browserAdmission.ts`). Device telemetry has its own credential checks and queues; see [work admission](operations/WORK_ADMISSION.md). |
| App Check | A Firebase attestation service. Eki does not use it; the Deploy workflow turns its enforcement off for Firestore and RTDB. |
| Application Default Credentials (ADC) | Google credentials found in the runtime environment. The backend uses them for Firebase Admin when `FIREBASE_SERVICE_ACCOUNT` is unset. |
| `armed` | Ride-session status while the direction is known and the trip state is `pre_departure`. Passengers can board an `armed` or `active` session. |
| Arrival corridor | The area within 15 m of a stop. A stop counts as reached, in route order, when a reliable fix, or the segment between two consecutive reliable fixes, enters it. |
| `atStopIndex` | The index of the stop the bus is at now. The backend publishes it while a fresh fix is inside that stop's arrival corridor, and passengers see "At" that stop. |
| `authorizationVersion` | A random identifier in a user's claims, mirrored in Firestore and RTDB under `_userAuthorization/<uid>`. Every role or assignment change issues a new value, so a token carrying an older value loses privileged access wherever the version is compared: `requireAdmin` and the database rules. Some ride-operation routes do not compare it yet ([risk SEC-03](operations/ARCHITECTURE_RISK_REGISTER.md#38-sec-03-ride-operations-accept-stale-administrator-claims)). |
| Automatic service | A ride session that the backend starts from a qualified tracker fix, with no action in the browser. It needs an enabled device, a bus assigned to the route, exactly one operator on that bus, a valid route, and a fresh fix with HDOP at most 4. |
| Blaze plan | The Firebase pay-as-you-go billing plan. It includes the Spark no-cost allowances and bills usage above them; see the [cost model](cost/COST_MODEL.md). |
| Boarding | A passenger joining a ride session through `POST /api/sessions/<sessionId>/join` with a boarding stop and an alighting stop. The backend requires a passenger profile, stops in travel order, a fresh bus fix and the browser's location within 150 m of the bus. |
| Boarding code | An eight-character code that Live Ops can show for a session. Boarding does not require it. |
| Bus | A record in the Firestore `buses` collection with its assigned routes. The user interface calls it a vehicle. |
| Carriageway | One side of a divided road. Traffic keeps left, so the backend does not credit a stop that lies more than 6 m to the right of a moving bus: that stop is on the opposite carriageway. |
| Claims | Custom fields in a Firebase Auth ID token that only the backend sets: `role`, `admin`, `driverId`, `assignedBusId` and `authorizationVersion`. Security rules and backend middleware trust these, never the Firestore profile. |
| `completed` | The trip state and ride-session status after the bus reaches the final stop and stopped fixes there span `TERMINAL_ARRIVAL_CONFIRMATION_MS` (default 2 s). |
| CSP | Content Security Policy: the `Content-Security-Policy` header in `firebase.json` that limits where the web app may load scripts from and connect to. The build regenerates its script hashes (`scripts/update-csp.mjs`). |
| Deadline | The time budget for one telemetry request: 8 s for the response and 5 s per stage (`backend/src/lib/executionDeadline.ts`). Work not yet dispatched when it expires is dropped and the device receives 503; see [telemetry deadlines](operations/TELEMETRY_DEADLINES.md). |
| Device | An ESP32 tracker with a NEO-M8N GNSS receiver, identified by its `DEVICE_ID`. |
| Device registry | The Firestore `devices` collection. Each record maps a device ID to a bus and a route, an enabled flag and a salted hash of the device secret. The backend takes the bus and route from here, never from the telemetry payload. |
| Device secret | A random credential printed once by `npm run provision-device`. The firmware sends it as `Authorization: Device <secret>`. |
| `deviceState` | `online` or `offline` on a live record. After `BUS_STALE_MS` without a fix, the worker marks a bus with a running ride `offline` and removes the record of any other bus. |
| Direction | The order in which a session travels the route's stops: `forward` (first stop to last) or `reverse`. It is `null` while the backend waits for a stopped fix within 10 m of exactly one route endpoint. |
| Documentation mirror | A generated copy under `docs/` of a Markdown file kept beside the code, such as `docs/backend/API.md`. `npm run docs:sync` regenerates mirrors. |
| Driver | The role and code name for an operator: the `driver` role, the `drivers` collection and the `driverId` claim. |
| Emulator | The Firebase Local Emulator Suite. `npm run test:rules` and the QA suites run it against the disposable project `demo-eki-qa`. |
| ETA | Estimated time of arrival at a stop, computed in the browser for buses whose `liveBusHealth` is `live` or `delayed` (`frontend/src/lib/busEta.ts`). The formula is in [tracking algorithms](design/TRACKING_ALGORITHMS.md#8-arrival-time-estimates). |
| `failed` | Terminal ride-session status for a session that could not start, for example after losing a start conflict. |
| Fence | The in-process token of one worker lease acquisition, carrying the lease generation. Worker writes check it, and worker Firestore transactions read the lease, so a process that lost the lease cannot commit. |
| Firestore | Cloud Firestore. Eki keeps routes, buses, operators, devices, ride sessions, feedback and internal worker state there. |
| Fix | One position solution from the GNSS receiver: latitude, longitude, speed, heading, HDOP and capture time. The firmware sends one fix per second, moving or stopped. |
| Fleet lock | The Firestore document `_fleet_reconciliation_locks/singleton`. It serializes fleet operations that change user authorization. |
| GNSS | Global Navigation Satellite System, such as GPS. The NEO-M8N receives several GNSS constellations. |
| GNSS gap | A stretch of a ride with more than 10 s between fixes, an untrusted fix, or a segment longer than 250 m between fixes. |
| `gnss_lost` | The `signalState` and passenger health state when the latest packet carries no trustworthy fix. The firmware sends one loss packet (last coordinates, HDOP 99, motion `uncertain`) and then stays silent until GNSS returns. |
| HDOP | Horizontal dilution of precision, reported by the receiver. Lower is better; automatic service and direction inference need 4 or less. |
| Idempotency key | The `Idempotency-Key` header that `POST /api/v2/ride-sessions`, `POST /api/v2/route-geometry-previews` and `POST /api/v2/fleet-reconciliation-jobs` require. A retry with the same key reaches the same operation instead of starting another. |
| `in_service` | Trip state after origin departure. Stops advance only in this state. |
| `interrupted` | Terminal ride-session status for a ride ended before its final stop, by **End ride early** or by abandoned-ride cleanup. It never counts as completed. |
| Lease | The Firestore document in `_worker_leases` that elects one backend process as the worker. The owner renews it every 15 s; it expires after 45 s. |
| Live Ops | The administrator tab that shows every bus and its ride, with delay, chat, **End ride early** and **Resume tracking** controls. |
| Live record | The child of `activeBuses` for one bus and route: the latest accepted fix, motion and signal state, and ride lifecycle fields. |
| `liveBusHealth` | The passenger-facing answer to "is this location live?", computed in the browser from packet age and signal state: `live`, `delayed` after 12 s, `lost` after 30 s, `gnss_lost` or `offline`. It works even when the backend is down. |
| `liveRouteCatalog` | The RTDB node that lists which routes have live or available buses. The passenger route list reads it. |
| Manifest | The `passengers` map in a ride session: each boarded passenger with their boarding and alighting stops. |
| Map load | One billed use of the Google Maps Dynamic Maps SKU. Eki counts a map load for each `google.maps.Map` the browser constructs; every map sets `reuseMaps`, so a page constructs at most one and later map views on that page reattach it ([EKI-ADR-004](design/GOOGLE_MAP_REUSE_DECISION.md)). |
| `motionState` | The motion reported with each fix: `moving`, `stopped` or `uncertain`. `uncertain` marks a fix that cannot be trusted. |
| NEO-M8N | The u-blox GNSS receiver module in each tracker. |
| ngrok tunnel | A hosted tunnel service that gives the backend on a workstation a fixed public HTTPS address. Trackers and browsers reach the backend through it until managed hosting exists; see [ngrok tunnel](operations/NGROK_TUNNEL.md). |
| `OFF_ROUTE` | Route state after two consecutive reliable moving samples do not match the route, or after one reliable moving sample at least 120 m from it. It triggers a reroute. |
| Operator | The person assigned to drive a bus. The record in the `drivers` collection links a Firebase Auth UID to one bus, and the account's role is `driver`. |
| Origin departure | The point at which a ride leaves `pre_departure`: 50 m from the first stop, or half the distance to the second stop if that is shorter, but at least 10 m. |
| OTA update | An over-the-air firmware update: a signed image that a fleet device downloads when `GET /api/devices/<deviceId>/firmware` offers a newer release. The six `FIRMWARE_RELEASE_*` variables describe the release; the backend withholds it while the bus has an active ride. |
| `passed_unobserved` | Stop evidence for a stop the bus missed while telemetry was running. The backend credits it once the bus reaches one of the next two stops in its direction of travel; it never counts as an arrival. |
| Passenger projection | The passenger-safe copy of live records that the worker writes to `publicRouteBuses`, together with `liveRouteCatalog`. Browsers read the projection, never `activeBuses`. |
| `pending` | Ride-session status while the session exists but its direction is not yet resolved. |
| `POSSIBLE_OFF_ROUTE` | Route state for an ambiguous match, for example at a junction, or for a first sample that does not match. Passengers are not warned; only `OFF_ROUTE` and `REROUTING` are shown as deviations. |
| `pre_departure` | Trip state from session creation until origin departure. |
| `publicRouteBuses` | The RTDB node, one child per route, that holds the passenger-safe projection of live records. The worker writes it with an allowlist of fields. |
| PWA | Progressive web app. The frontend is a static export with a web app manifest and a service worker (`frontend/src/sw.js`, prepared by `scripts/generate-sw.mjs`), so it can be installed on a phone. |
| Reroute | The backend's request to the Google Routes API for a new path from the bus position after `OFF_ROUTE`. The route state is `REROUTING` while it runs and `ON_NEW_ROUTE` once the new path is published. |
| Retention sweep | The worker's daily deletion of records older than their retention period. It runs only when `RETENTION_SWEEPER_ENABLED=true`. |
| Ride session | The Firestore document `ride_sessions/<sessionId>` for one trip of one bus on one route in one direction. Statuses: `pending`, `armed`, `active`, `completed`, `interrupted` and `failed`. |
| Role | `passenger`, `driver` or `admin`, held in claims. A first sign-in creates a `passenger` profile; other roles come only from the backend. |
| Route schedule | A route that an administrator publishes in the passenger **Routes** tab, with a 24-hour `HH:mm` time for each stop. The approvals and times are stored in `settings/passengerRoutes`; names and stop order come from the route itself. A route schedule is a fixed timetable, unrelated to live tracking or ETAs. |
| Route state | The route-matching field `routeState` on a live record: `ON_ROUTE`, `POSSIBLE_OFF_ROUTE`, `OFF_ROUTE`, `REROUTING` or `ON_NEW_ROUTE`. |
| RTDB | Firebase Realtime Database. Eki keeps live records, the passenger projection and authorization mirrors there. |
| `serviceSetupPending` | An internal marker on a live record while an automatic service start is incomplete. Later fixes finish the setup and clear it. |
| `signalState` | Signal state on a live record: `connected`, `gnss_lost`, or `lost` once the worker marks the bus offline. |
| `skipped_gnss_gap` | Stop evidence for a stop passed during a GNSS gap, credited when the bus is later observed at a following stop. |
| Spark plan | The Firebase no-cost plan. When a product exceeds its Spark quota, Firebase turns that product off until the quota resets or the project moves to the Blaze plan. |
| Staging | The Firebase project `bustrack-be165`, which receives the frontend and rules after every green push to `main`. The Deploy workflow names a production project, `eki-production`, deployed only by manual dispatch, but that project and its GitHub environment are not yet provisioned; see [CI, deployment and releases](operations/CI_CD_AND_RELEASES.md). |
| Stop evidence | How a passed stop was established, as recorded in ride history: `gnss_progress` (observed arrival), `passed_unobserved`, `skipped_gnss_gap` or `recovered_checkpoint`. |
| Telemetry | The HTTPS requests a device sends to `POST /api/devices/<deviceId>/telemetry`, each carrying one fix. |
| Terminal arrival confirmation | The rule that a ride completes only after reliable stopped fixes at the final stop span `TERMINAL_ARRIVAL_CONFIRMATION_MS`. |
| Trip state | The lifecycle field `tripState` on a live record: `pre_departure`, `in_service` or `completed`. |
| Turnaround | The start of the return trip after a completed ride. After `AUTOMATIC_TURNAROUND_DWELL_MS`, a fresh stopped fix within 75 m of the terminal arms a session in the opposite direction, marked `automaticTurnaround: true`. |
| Worker | The background work that runs in the one backend process holding the lease: the trip state engine, the passenger projection, stale-bus sweeping, abandoned-ride cleanup, fleet authorization reconciliation, retention and privacy deletion. |
| Workspace | One of the two browser areas: `/passenger` for every signed-in user and `/admin` for administrators. |
