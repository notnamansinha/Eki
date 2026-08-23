# Storage architecture summary

The exhaustive field/access/relationship dictionary is [Firebase data model](FIREBASE_DATA_MODEL.md).

| Store | Use | Main paths |
|---|---|---|
| RTDB | Latest pushed live state | `activeBuses/{busId}_{routeId}`, server-only assignment mirror |
| Firestore | Durable configuration, access metadata, recovery, locks, messages and history | `users`, `routes`, `buses`, `drivers`, `devices`, `active_rides`, `_active_bus_locks`, `ride_sessions`, `completed_trips`, feedback/settings/internal jobs |

RTDB contains one current point, not coordinate history. Firestore receives lifecycle/stop/delay/session changes, not every GNSS fix. This avoids duplicate high-frequency writes and keeps recovery/history queryable.

ESP32 devices have no Firebase credentials. The backend is the only writer to RTDB live state and backend-only Firestore collections. Browsers read through constrained rules and use protected APIs for fleet/route/device/shift mutations. Passenger manifest, messaging, feedback and settings are the only narrowly permitted client writes.

`active_rides` restores an interrupted live projection. `_active_bus_locks` enforces one active session per physical bus. `ride_sessions` is detailed history; `completed_trips` is a compact analytics projection; `bus_locations` is compact fleet lifecycle state.

Retention removes terminal sessions/feedback/completion/operation logs in pages. Production startup requires it to be explicitly enabled; development and tests remain disabled by default. Active rides/locks are released by completion or conservative abandonment reconciliation, not age-only retention. Privacy deletion is separately queued and worker-owned.
