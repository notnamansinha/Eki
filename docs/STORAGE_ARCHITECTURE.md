# Storage architecture

| Store | Purpose | Important paths |
|---|---|---|
| Realtime Database | Low-latency live projection read by signed-in web apps | `activeBuses/{busId}_{routeId}` |
| Firestore | Durable configuration, authorization, recovery, history, and messages | `routes`, `buses`, `drivers`, `devices`, `active_rides`, `ride_sessions`, `completed_trips` |

## Write ownership

- ESP32 devices call the authenticated HTTPS backend and have no Firebase
  credentials.
- The backend is the only writer of live GNSS and lifecycle data.
- Browsers may read signed-in live data but cannot write `activeBuses`.
- `devices` and `active_rides` are Admin-SDK-only.
- Route, fleet, shift, and delay changes go through role/assignment-checked
  backend endpoints.

## Live and durable data

`activeBuses` contains the latest coordinates, signal/motion state, lifecycle,
current ordered stop, delay, and session link. It is optimized for RTDB push
updates and is not trip history.

`active_rides` contains the minimum canonical state needed to restore an
interrupted ride: bus, route, driver, session, lifecycle, current stop,
departure evidence, and delay. It does not store each coordinate.

`ride_sessions` and `completed_trips` contain durable stop/completion history.
`bus_locations` receives compact fleet lifecycle changes for analytics; it is
not a second telemetry stream.

Completed/failed sessions, feedback, completion summaries, and operation logs
are removed by configured retention jobs. Active rides are intentionally not
expired by time; they complete only after the final ordered stop.
