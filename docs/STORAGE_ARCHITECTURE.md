# Storage Architecture

Eki uses each Firebase database for the kind of data it handles best. The two
stores are complementary; they must not mirror one another's live data.

| Store | Source of truth | Data kept there |
| --- | --- | --- |
| Realtime Database (RTDB) | Live operational state | Current GPS fix, speed, heading, freshness timestamp, current stop, delay, ETA and active-session link at `activeBuses/{busId}_{routeId}`. |
| Firestore | Durable application records | Routes, buses, driver assignments, user profiles, ride sessions/messages, feedback, settings and compact fleet lifecycle state. |

## Live bus flow

1. The hardware device authenticates with a custom Firebase token and writes
   GPS telemetry to its assigned RTDB bus-route node.
2. The driver console creates one Firestore `ride_sessions` record per shift
   and stores its `sessionId` in the matching RTDB node. It can change
   operational fields such as the stop index or delay, but never rewrites GPS
   coordinates.
3. The backend observes RTDB, calculates trip state and ETA, and writes only
   derived live fields back to that RTDB node.
4. The backend writes a small `bus_locations/{busId}` Firestore document only
   when fleet lifecycle state changes (route, driver, status, device state or
   trip state). This supports analytics without copying every GNSS update into
   Firestore.
5. Passenger, driver and admin screens subscribe to RTDB for live updates.

## Authentication and authorization

Every passenger, driver and administrator must explicitly sign in before the
application mounts its protected screens or opens their RTDB listeners.
Firebase keeps that signed-in session in browser-local persistence across
navigation, reloads and installed-PWA restarts. Explicit sign-out clears both
the Firebase session and the cached workspace/role hints immediately.

Drivers and administrators use Firebase custom claims; both Firestore and RTDB
rules enforce their bus/driver assignments on every write. The rules remain the
authorization boundary; no client-side role value grants additional access.
