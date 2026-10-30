# HTTP resource migration for issue #192

Last updated: 2026-10-29 08:40 IST (UTC+05:30).

This is the compatibility contract for the six method/path changes on `testing`.
The existing handlers remain available. The v2 routes call those same handlers,
so validation, Firebase authorization, persistence, and response bodies stay
consistent. Device telemetry, diagnostics, and firmware URLs do not change.

| Existing endpoint | v2 endpoint | Input | Success response | Handler errors | Authorization and limits |
| --- | --- | --- | --- | --- | --- |
| `PUT /api/settings` | `PATCH /api/v2/settings/global` | Non-empty partial JSON object with only `serviceStartTime`, `noBusesMessage`, `noBusesSubMessage`, `announcementText`, `announcementActive` | `200 {"saved":true}` | `400` invalid/unknown fields; `500` save failure | Firebase admin; global 200/min and write 30/min limits |
| `POST /api/plan` | `GET /api/v2/routes/:routeId/segments?from=<startStopId>&to=<endStopId>&via=<viaStopId>` | Safe route/stop IDs, `via` optional; no other query keys | `200` route metadata, ordered stops, direction, and encoded segment polyline, with the same JSON shape as the old endpoint | `400` bad IDs, stop order or query; `404` missing route/stop; `422` unusable route geometry; `500` internal failure | Firebase user; global 200/min and route planning 30/min limits |
| `GET /api/routes-list` | `GET /api/v2/routes` | None | `200 {"routes":[...]}`; at most 250 route records, with metadata and stops but no geometry | `500` list failure | Firebase user; global 200/min limit |
| `POST /api/devices/:deviceId/disable` | `PATCH /api/v2/devices/:deviceId` | Exactly `{"enabled":false}` on v2; no body on legacy | `200 {"disabled":true}` | `400` invalid ID or v2 body; `404` unknown device (no registry entry is created); `500` disable/invalidation failure | Firebase admin; global 200/min and write 30/min limits |
| `PATCH /api/feedback/:feedbackId/status` | `PATCH /api/v2/feedback/:feedbackId` | Exactly `{"status":"new"|"reviewed"|"resolved"}` | `200 {"updated":boolean,"status":string}` | `400` invalid ID/body; `404` missing feedback; `500` update failure | Firebase admin; global 200/min and write 30/min limits |
| `POST /api/privacy/deletion-request` | `POST /api/v2/privacy-deletion-requests` | No body on v2; UID comes from the token; resubmission preserves retry history | `202 {"accepted":true}`; request record is keyed by UID | `400` unexpected v2 body; `409` operator/admin account; `503` uncertain/unavailable queue acknowledgement | Firebase passenger; global 200/min and write 30/min limits |

All six routes can also return `401` for missing or invalid Firebase credentials,
`403` for an insufficient role where applicable, `413` for a JSON body above the
16 KiB server limit, or `429` from the applicable limiter. The v2 planning GET
uses the same cached Firestore route and stored-polyline slicing as the old POST;
neither calls Google Routes. The v2 routes and their shared legacy handlers set
`Cache-Control: no-store` on handled responses. Authenticated route data must
not be cached by a shared proxy.

`PUT /api/v2/settings/passenger-routes` (admin-approved passenger route
schedules) is a new v2-only settings resource, not one of the six migrations.
It has no legacy alias and no retirement plan; see
[`API.md`](API.md).

The device PATCH intentionally supports only disabling. Assignment changes
remain on `PUT /api/devices/:deviceId`, including its existing active-ride and
bus-lock reassignment checks. Both disable paths invalidate the device credential
cache. The feedback PATCH can change only review status and retains server audit
metadata. Privacy requests remain keyed to the authenticated UID and do not
accept a client-supplied identity.

The segment response has `routeId`, `routeName`, and `routeColor` strings;
`startStop` and `endStop` stop objects; `viaStop` as a stop object or `null`;
`stopsOnSegment` as ordered stop objects; `polyline` as an encoded string;
`totalStops` as a number; and `direction` as `forward` or `reverse`. A stop
contains `id`, `name`, `shortName`, `lat`, and `lng` (and may contain
`waypointIndex`). The routes collection contains records with only `id`,
`name`, `color`, and `stops`. Handler errors use `{"error":string}`; limiter
responses may also include `retryAfterMs` and `Retry-After`.

## Rollout and retirement

1. Deploy the backend with both old and v2 routes. Run authorization, validation,
   rate-limit, and response-parity checks in staging before changing any caller.
2. The frontend source now uses v2 for settings (`PATCH`), feedback status
   (`PATCH`), and privacy deletion requests (`POST`). Deploy this frontend only
   after the compatible backend passes step 1. Preparing these caller changes
   does not establish that staging acceptance or frontend deployment is done.
   The current frontend does not call the HTTP planning and routes-list endpoints.
3. Keep legacy routes for at least 90 days after the frontend migration and
   until traffic shows 30 consecutive days without supported clients using them.
   Record the removal in a separate change with client and deployment evidence.
   The three firmware endpoints have no migration or retirement in this issue.

Method and path naming by itself changes neither payload size nor server work.
No latency improvement is claimed. Measure latency only if a later change alters
response projection, cache behavior, or upstream calls.

Health and bus snapshots, fleet bus/driver operations, route CRUD and geometry,
passenger request PATCH/DELETE, feedback creation, and user bootstrap already
have suitable resource or ensure-profile semantics and are unchanged. Device
telemetry is an authenticated ingestion command; route compute and fleet
reconcile are server-run operations whose durable status design belongs to
#194. Ride-session command and lifecycle names belong to #193.
