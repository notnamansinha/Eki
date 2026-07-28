# Eki Backend API Reference

The backend exposes authenticated REST endpoints and consumes hardware
telemetry from MQTT. Browsers read live state from RTDB/Firestore; devices
cannot access Firebase.

All authenticated endpoints expect `Authorization: Bearer <Firebase ID token>`.
Administrator endpoints require the trusted `admin: true` Firebase custom claim.

| Method | Path | Access | Description |
|---|---|---|---|
| GET | `/health` | Public | Firebase connectivity health check. |
| GET | `/api/buses` | Signed-in | Snapshot of active RTDB bus nodes. |
| GET | `/api/buses/:busId` | Signed-in | Current state of one active bus. |
| PATCH | `/api/buses/:busId` | Admin | Changes an active bus trip state. |
| GET | `/api/analytics/fleet` | Admin | Durable fleet lifecycle statistics. |
| PATCH | `/api/requests/:id` | Admin | Updates a passenger-request status. |
| DELETE | `/api/requests/:id` | Admin | Deletes a passenger request. |
| POST | `/api/routes/compute-polyline` | Admin | Computes validated, stored route geometry. |
| POST | `/api/plan` | Signed-in | Creates a route-plan segment from stored geometry. |
| GET | `/api/routes-list` | Signed-in | Lists route metadata. |
| GET | `/api/places/search?q=…` | Admin | Proxies bounded stop-location search. |
| POST | `/api/shifts/start` | Assigned driver | Creates or resumes a session and initializes backend-owned lifecycle state. |
| POST | `/api/shifts/stop` | Assigned driver | Ends the authorized session and live service state. |
| PUT | `/api/fleet/buses/:id` | Admin | Creates or updates a vehicle and synchronizes assignments. |
| DELETE | `/api/fleet/buses/:id` | Admin | Deletes a vehicle and revokes stale assignments. |
| PUT | `/api/fleet/drivers/:id` | Admin | Creates or updates an operator and synchronizes claims. |
| DELETE | `/api/fleet/drivers/:id` | Admin | Deletes an operator and immediately revokes driver access. |
| PUT | `/api/devices/:deviceId` | Admin | Stores a validated device-to-bus/route registry assignment. |
| POST | `/api/devices/hash-secret` | Admin | Stores a one-way credential verifier for inventory/rotation checks. |
| POST | `/api/devices/:deviceId/disable` | Admin | Disables application-side ingestion; broker revocation is also required. |
| POST | `/api/fleet/reconcile` | Admin | Repairs claims and assignment mirrors after a partial provider failure. |
