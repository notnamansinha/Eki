# Storage architecture summary

Last updated: 2026-10-04 14:20 IST (UTC+05:30).

The exhaustive field/access/relationship dictionary is [Firebase data model](FIREBASE_DATA_MODEL.md).

| Store | Use | Main paths |
|---|---|---|
| RTDB | Latest pushed live state | `activeBuses/{busId}_{routeId}`, server-only assignment mirror |
| Firestore | Durable configuration, access metadata, recovery, locks, messages and history | `users`, `routes`, `buses`, `drivers`, `devices`, `active_rides`, `_active_bus_locks`, `ride_sessions`, `completed_trips`, feedback/settings/internal jobs |

RTDB contains one current point, not coordinate history. Firestore receives lifecycle/stop/delay/session changes, not every GNSS fix. This avoids duplicate high-frequency writes and keeps recovery/history queryable.

ESP32 devices have no Firebase credentials. The backend is the only writer to RTDB live state and the Firestore `bus_locations` fleet projection. Browsers read through constrained rules and use protected APIs for fleet/route/device/shift mutations. Passenger manifest has narrowly permitted client writes; messaging, feedback and settings mutations use protected backend APIs.

`active_rides` restores an interrupted live projection. `_active_bus_locks` enforces one active session per physical bus. `ride_sessions` is detailed history; `completed_trips` is a compact analytics projection; `bus_locations` is compact fleet lifecycle state.

Stop progression commits the active checkpoint and every newly crossed stop in one Firestore transaction before publishing the next index to RTDB. Existing stop names and arrival timestamps are preserved. If Firestore is ahead after an interrupted RTDB publication, the next event repairs the live projection without moving the durable index backwards. Completion retries reuse the original completion time and leave a replacement ride's lock untouched.

A ride is readable through the following fields, without decoding the composite document ID:

| Field | Meaning |
| --- | --- |
| `sessionId`, `busId`, `routeId`, `driverId` | Ride and its assigned bus, route and driver |
| `direction`, `originStopId`, `destinationStopId` | Immutable travel direction and endpoints |
| `status`, `startTime`, `endTime` | Lifecycle and recorded start/end time |
| `stopsReached/{index}` | Travel-ordered stop ID, name and recorded timestamp |
| Stop `evidence` | `gnss_progress` for newly observed progression; `recovered_checkpoint` for an older checkpoint repaired later |

Recovered stop timestamps record when the missing history was repaired; they are not invented original arrival times. Multiple stops crossed between fixes share the observation time. A cloud checkpoint survives device power loss, but only facts committed to the backend can be recovered. The bounded RTC queue is for recent live fixes and validates its checksum/configuration on boot; it is not a persistent archive of every GPS point. Complete loss of device power can discard unsent fixes. Controlled watchdog/brownout acceptance remains tracked in [#60](https://github.com/notnamansinha/Eki/issues/60).

Admin history deletion also persists a separate `_ride_history_deletion_jobs` reference until session descendants and completion projections are gone. The endpoint and worker retry it even after a partially deleted parent disappears. Failed deletion is reported to the caller; the independent job remains available for recovery.

Routes are stored once in A-to-Z order. On initial service arm the backend infers `forward` near A or `reverse` near Z from a fresh stopped endpoint fix; active sessions restore that immutable choice. After completion and a stopped endpoint dwell, an RTDB claim plus Firestore bus lock atomically arms the opposite direction. The backend derives travel-ordered stops (`A…Z` or `Z…A`) for GNSS progression, boarding, ETAs, history and directional completion statistics. Moving, stale, mid-route and ambiguous fixes cannot select direction. Devices remain assigned to the route identity and never need a second credential or duplicated return route.

Retention keeps terminal ride sessions and completed-trip projections for 180 days from their respective end/completion times, then deletes them on the next successful daily sweep. Session subcollections are removed recursively. An independent `_retention_deletion_jobs` record survives partial deletion, allowing the next sweep to remove remaining children even if the parent document is gone. Feedback defaults to 180 days and operational logs to 90 days. Production startup requires retention to be explicitly enabled and deployment overrides to match the schedule; development and tests remain disabled by default. Active rides/locks are released by completion or conservative abandonment reconciliation, not age-only retention. Privacy deletion is separately queued and worker-owned.
