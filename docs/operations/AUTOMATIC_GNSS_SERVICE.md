# Automatic GNSS service lifecycle

A qualified authenticated receiver fix automatically establishes its protected service. Routine service startup does not require an open admin tab or a Start service action. The existing ride-session API remains available for compatible clients and explicit recovery from an intentionally paused service.

## Admission and authorization

The receiver must have an enabled canonical device assignment, an active bus assigned to the route, exactly one eligible operator assigned to that bus, a valid ordered route, and a fresh fix with known HDOP no greater than 4. Uncertain or stale fixes do not create a new session. Every creation transaction checks the current assignment revision and canonical configuration again.

Device admission calls the same internal session operation as the authenticated operator API. It does not impersonate an administrator. Stable idempotency bindings and the durable per-bus lock prevent duplicate sessions across retries and backend instances. A bounded per-bus executor keeps startup reads and writes outside the telemetry acknowledgement path. Blocked configuration retries have a bounded cache; credential invalidation releases the relevant block after a repair.

Presence can arrive before the protected-session transaction completes. Public readiness/catalog and route-detail subscriptions remain distinct from the receiver's ingress acknowledgement. Compare matching sequence numbers when investigating delivery timing; an HTTP 200 page response alone does not establish live rendering.

## Direction, progress and recovery

A stationary qualified fix can make the bus live before direction is known. Endpoint evidence or the existing conservative first-leg departure history resolves direction. A midpoint boot must not claim unobserved stops were served. Direction-dependent ETA and progress remain gated until their required evidence exists.

Stop arrivals retain the 2.5 m boundary and existing quality/ordering/dwell checks. Outside a GNSS gap only the next expected stop advances. After a gap (more than 10 s without a fix, an untrusted fix, or a segment longer than 250 m), a reliably observed later stop credits the stops in between as `skipped_gnss_gap` instead of leaving the ride stuck before them; the terminal still needs its confirmed stopped arrival. Turnaround retains the completion and return-dwell policy. Session creation must not substitute for these observations.

The service survives temporary GPS, tunnel and backend outages. UI status distinguishes retained lifecycle from current telemetry: an offline/delayed session is paused rather than counted as a live service. Passengers see an offline ride exactly like an offline device: it leaves the map and route list once its telemetry expires and is not counted as an active route service, and it returns if the receiver reconnects while the session is retained. Live Ops keeps every bus at its last reported location while it is offline, including after its ride ended; once the server removes the live presence record, the last accepted fix from `bus_locations` keeps the bus on the map as Offline with its last-seen time. Default frontend expiry is five minutes in both development and production, matching the backend's five-minute default; signal-delay indication starts after 90 seconds. Explicit environment overrides remain supported and must be kept consistent by the deployment operator. The backend's 90-second value is its minimum configurable stale interval, not its development default.

An incomplete automatic setup carries a server-owned `serviceSetupPending` marker. Later accepted fixes repair the same session and durable projections, then clear the marker. A queued newer fix is retained while a startup attempt settles. Configuration backoff must not suppress recovery after a session-projection conflict. `serviceSetupPending` is internal and is not in the public projection allowlist.

## Deliberate stop and resume

End ride early remains an authenticated operator action. It records interrupted history, releases only the matching lock, and persists an automatic-start pause only while that session still owns the bus. Retrying an old stop cannot pause a replacement session. Further telemetry can show an online device but cannot recreate the ended ride. A ride cut short without that operator action, such as one closed by abandoned-ride cleanup or a failed return, does not pause the bus: the next qualified fix starts a fresh automatic service under a new start key and never revives the ended ride. The new start key is opened by a compare-and-swap on the epoch (and, for a failed return, on the marker being released), so replicas that handle the same bus at once produce one epoch bump and one ride; a replica that loses the swap re-reads the bus, at most twice per attempt, instead of reporting it paused. A pause set meanwhile still refuses the swap. Live Ops exposes Resume tracking for intentionally paused receivers. This authorized action uses the protected session API and a stable retry key, starts in pre-departure, and does not claim an unobserved origin arrival. Provisioning and driver/bus/route authorization remain necessary.

A failed consumed return requires explicit recovery rather than waiting forever for that ended session. An unconsumed completion intent still follows normal turnaround recovery and dwell; it does not expose a shortcut that bypasses the return policy.

## Passenger map

Reconnect and failure messages reserve layout space above tracking controls. In-map notices leave a separate column for map controls. Preview defaults to route overview so a distant bus cannot shrink the configured route to an unreadable cluster. Center on bus and Show route overview allow explicit camera changes. Map fitting measures the visible sheet inset. Ordinary stop names appear on selection/focus; next-stop and destination labels take priority. The shared upright bus marker has a separate heading cue and an uncertain appearance.

## Fleet reconciliation lock

The fleet-authorization mutex is independent of normal telemetry projection. Restarting npm does not clear it, and age alone does not establish that its owner stopped. Follow [the guarded recovery procedure](../api/OPERATION_RESOURCES.md) to inspect the lock and establish executor shutdown before exact-owner recovery. Automatic expiry or direct document deletion can overlap unfinished Auth mutations and is not a repair strategy. This change does not clear an existing live lock.

## Verification

Run the root unit/script/lint/build checks, Firebase integration/rules suite, emulator-backed browser acceptance, passenger layout/progress tests, and the opt-in real Maps replay. The real Maps replay uses simulated input and cached route geometry; it must not be described as physical GNSS movement acceptance. Its map resource allowlist includes `mapsresources-pa.googleapis.com` from [Google's Maps domain documentation](https://developers.google.com/maps/domains).

Keep test accounts and destructive lifecycle scenarios on the disposable emulator project. A stationary physical smoke test can confirm freshness and connectivity. Physical stop-radius, moving-route color progression and ETA accuracy still require a moving receiver run.
