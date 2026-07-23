# Eki Backend API Reference

The backend exposes authenticated REST endpoints. Live bus telemetry and
passenger updates use Firebase RTDB/Firestore listeners directly; Socket.IO is
not part of the deployed application.

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
| POST | `/api/devices/auth` | Device secret | Exchanges a device credential for a scoped Firebase custom token. |
| POST | `/api/devices/hash-secret` | Admin | Hashes and stores a device credential. |
