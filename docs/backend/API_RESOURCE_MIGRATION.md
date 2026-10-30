# HTTP Resource Migration

| Document ID | Version | Status | Last updated |
|---|---|---|---|
| EKI-API-005 | 2.0 | Current | 2026-10-30 |

## 1. Purpose

The backend serves its original command-style paths (for example `POST /api/shifts/start`) and, next to them, resource-style paths under `/api/v2/`. This document maps each original path to its resource-style alias, records which of the two the web app calls today, and states the conditions for removing an original path. Request and response details for every path are in the [API reference](API.md).

## 2. Rules

1. An alias and its original path call the same handler. Validation, authorization, persistence and response bodies are identical unless Section 3 lists a difference. The last two rows are the exception: the resource-style path runs the same computation as a durable operation with its own status resource ([operation resources](../api/OPERATION_RESOURCES.md)).
2. Both paths stay served. No removal date is set.
3. Device ingestion paths (`/api/devices/:deviceId/telemetry`, `/diagnostics`, `/firmware` and `/firmware/installation`) are compiled into the firmware and have no alias.
4. Renaming a path changes neither payload size nor server work, so the migration makes no latency claim.

## 3. Path mapping

| Original path | Resource-style path | Difference | Web app calls |
|---|---|---|---|
| `PUT /api/settings` | `PATCH /api/v2/settings/global` | None; both merge a partial object | Resource-style |
| `POST /api/plan` | `GET /api/v2/routes/:routeId/segments` | Body fields `startStopId`, `endStopId`, `viaStopId` become query `from`, `to`, `via`; other query keys return 400 | Neither |
| `GET /api/routes-list` | `GET /api/v2/routes` | None | Neither; routes are read from Firestore |
| `POST /api/devices/:deviceId/disable` | `PATCH /api/v2/devices/:deviceId` | Body must be exactly `{"enabled":false}` | Neither |
| `PATCH /api/feedback/:feedbackId/status` | `PATCH /api/v2/feedback/:feedbackId` | None | Neither; status is written to Firestore |
| `POST /api/privacy/deletion-request` | `POST /api/v2/privacy-deletion-requests` | Rejects a non-empty body | Resource-style |
| `POST /api/shifts/start` | `POST /api/v2/ride-sessions` | Requires `Idempotency-Key`; returns `Location` | Resource-style (Resume tracking) |
| `PATCH /api/shifts/delay` | `PATCH /api/v2/ride-sessions/:sessionId` | Body is only `delayMinutes`; bus, route and operator come from the session; a failed assignment check returns 403 instead of 400 | Original |
| `POST /api/sessions/:sessionId/boarding-code` | `POST /api/v2/ride-sessions/:sessionId/boarding-code` | None | Original |
| `POST /api/sessions/:sessionId/join` | `PUT /api/v2/ride-sessions/:sessionId/passengers/me` | None | Original |
| `POST /api/sessions/:sessionId/messages` | `POST /api/v2/ride-sessions/:sessionId/messages` | None | Original |
| `DELETE /api/shifts/:sessionId/messages` | `DELETE /api/v2/ride-sessions/:sessionId/messages` | None | Original |
| `DELETE /api/shifts/:sessionId/history` | `DELETE /api/v2/ride-sessions/:sessionId` | None | Original |
| `PUT /api/routes/:routeId` | `PUT /api/v2/routes/:routeId` | `Location` points to the v2 status path | Original |
| `GET /api/routes/:routeId/save-operations/:saveId` | `GET /api/v2/routes/:routeId/save-operations/:saveId` | v2 always returns a 200 snapshot; the original returns 202 while processing and a stored failure with its original status | Original |
| `POST /api/routes/compute-polyline` | `POST /api/v2/route-geometry-previews` | v2 is a durable operation with `Idempotency-Key`, 202 and a status resource | Neither |
| `POST /api/fleet/reconcile` | `POST /api/v2/fleet-reconciliation-jobs` | v2 is a durable operation; the cursor moves from the query to the body | Neither |

All resource-style paths set `Cache-Control: no-store`.

These operations have no alias: `POST /api/shifts/stop` (End ride early), `GET /api/sessions/:sessionId/status`, the health endpoints, live bus reads, device registry and diagnostics administration, route geometry reads and deletion, fleet bus and operator administration, analytics, Places search, passenger requests, profile bootstrap and feedback submission. These operations exist only under `/api/v2/`: `GET /api/v2/ride-sessions/:sessionId`, `GET /api/v2/feedback`, `PUT /api/v2/settings/passenger-routes` (passenger route schedules), privacy deletion monitoring and recovery, and durable operation status and recovery. They have no original path to retire.

## 4. Current status

- Both generations of every pair in Section 3 are implemented and listed in [`openapi.json`](openapi.json).
- The web app calls three resource-style paths: settings, privacy deletion and ride start. It calls the original path for every other pair it uses. It also calls the v2-only `PUT /api/v2/settings/passenger-routes` from the administrator settings tab.
- The backend counts requests by generation and result class for every pair except device disable and fleet reconciliation, and also for End ride early and geometry reads (`backend/src/lib/apiCompatibilityTraffic.ts`). The counts are process-local, reset on restart, and appear in `telemetry.apiCompatibility` of `GET /api/health` and in the OpenTelemetry metric `eki.api.compatibility.requests`. They contain no client identifiers.

Caller inventory and read optimizations are recorded in [API reads and retirement](../operations/API_READS_AND_RETIREMENT.md).

## 5. Removing an original path

An original path may be removed only in a separate change that:

1. shows, from persistent metrics rather than process-local counters, at least 30 consecutive days without supported-client traffic on that path;
2. is made at least 90 days after the web app stopped calling the path;
3. updates [`openapi.json`](openapi.json), [API.md](API.md), this document and the route tests in the same change;
4. is announced to the owners of any other clients.

The compatibility rules for changing the contract are in the [HTTP contract](../api/HTTP_CONTRACT.md).
