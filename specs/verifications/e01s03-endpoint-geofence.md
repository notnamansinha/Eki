# Verify evidence — e01s03 endpoint geofence single source of truth

- automaticRideDirection: split ENDPOINT_GEOFENCE_M=20 (direction inference) from ARRIVAL_RADIUS_M=75 (turnaround arrival). inference default is now the 20 m engine geofence; a bus >20 m from an endpoint stays direction_pending.
- tripStateReducer: STOP_GEOFENCE_M = ENDPOINT_GEOFENCE_M (one source of truth, no drift).
- New tests: shared-constant equality; ~4 m -> forward / ~33 m -> pending; 257 m from Z -> pending; ARRIVAL_RADIUS_M stays 75.
- backend vitest 362 passed; backend tsc clean; lint clean.
- Note: continuous direction resolution from raw telemetry for unarmed buses is NOT built here — a device-only bus has no ride to attach direction to, and it already renders pending via e01s01. Confirmed with the user as a product decision.
