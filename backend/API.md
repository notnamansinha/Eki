# Backend API

Browser endpoints use `Authorization: Bearer <Firebase ID token>`. Admin
endpoints require the trusted admin custom claim.

| Method | Path | Access | Purpose |
|---|---|---|---|
| GET | `/health` | Public | Firebase, worker, and HTTPS-ingestion health. |
| POST | `/api/devices/:deviceId/telemetry` | Device secret | Validate and accept the closed GNSS payload. |
| PUT | `/api/devices/:deviceId` | Admin | Bind a device to an existing bus/route. |
| POST | `/api/devices/:deviceId/disable` | Admin | Disable ingestion for a device. |
| GET | `/api/buses` | Signed in | Read live bus snapshots. |
| GET | `/api/buses/:busId` | Signed in | Read one live bus snapshot. |
| POST | `/api/shifts/start` | Assigned driver | Arm or resume the assigned ride. |
| POST | `/api/shifts/stop` | Assigned driver | Idempotently acknowledge an already completed ride; active rides return 409. |
| PATCH | `/api/shifts/delay` | Assigned driver | Update delay for the active assigned ride. |
| DELETE | `/api/shifts/:sessionId/messages` | Admin | Clear one ride's messages. |
| GET | `/api/analytics/fleet` | Admin | Read durable fleet statistics. |
| PUT/DELETE | `/api/fleet/buses/:id` | Admin | Manage vehicles and assignments. |
| PUT/DELETE | `/api/fleet/drivers/:id` | Admin | Manage drivers and claims. |
| POST | `/api/fleet/reconcile` | Admin | Repair assignment/claim mirrors. |
| POST | `/api/routes/compute-polyline` | Admin | Compute and persist route geometry. |
| POST | `/api/plan` | Signed in | Plan from stored route geometry. |
| GET | `/api/routes-list` | Signed in | List route metadata. |
| GET | `/api/places/search?q=…` | Admin | Bounded server-side stop search. |

Telemetry body fields are exactly `lat`, `lng`, `speed`, `heading`,
`motionState`, and `timestamp`, with a maximum serialized size of 512 bytes.
