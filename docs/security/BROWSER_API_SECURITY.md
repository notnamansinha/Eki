# Browser API Security

| Document ID | Version | Status | Last updated |
|---|---|---|---|
| EKI-SEC-003 | 1.0 | Current | 2026-10-30 |

## 1. Introduction

### 1.1 Purpose

This specification defines how a browser client authenticates to the Eki backend API, which principal each kind of operation requires, and the security-relevant response behaviour. It is for frontend developers who call the API and reviewers who change its middleware. Individual endpoints, bodies and status codes are in the [Backend API reference](../../backend/API.md); the threat model and the database rules are in [Security architecture](SECURITY_ARCHITECTURE.md).

### 1.2 Access policy

- Any user signed in with a Google account through Firebase Authentication may read live bus positions, routes, buses and global settings. Institutional affiliation is not checked.
- Signing in does not make a bus bookable. A passenger can board only a ride whose session is boarding and whose bus has a fresh hardware fix.
- Driver and administrator authority comes only from custom claims that the backend publishes. Profile edits, browser storage and request bodies cannot grant a role.

## 2. Conventions

### 2.1 Authentication

Every request under `/api` carries a Firebase ID token as a bearer token [2]:

```http
Authorization: Bearer <Firebase ID token>
```

The backend mounts `requireAuth` on `/api` before any router (`backend/src/lib/browserAdmission.ts`), so a request without a valid token fails before route code runs. The exceptions are the four tracker paths, which use device credentials instead (Section 4). `/health` and `/live` are outside `/api` and need no token.

Verification calls `verifyIdToken(token, true)` [1], which rejects an invalid signature, an expired token, a disabled account and a revoked token. The backend caches a successful verification for `AUTH_REVOCATION_CACHE_MS` (default 15 000 ms, maximum 60 000 ms), keyed by the SHA-256 of the token. A token that carries `admin`, `role: "admin"`, `role: "driver"`, `driverId` or `assignedBusId` is verified again on every request.

Firebase App Check is not used. The browser sends no `X-Firebase-AppCheck` header and the backend does not read one.

### 2.2 Principals

| Principal | Token requirement | Server-side check | Example operations |
|---|---|---|---|
| Signed-in user | Valid ID token | None | `GET /api/buses`, `GET /api/routes-list`, `POST /api/users/bootstrap` |
| Passenger | `role` absent or `passenger` | Existing `users/{uid}` profile; own manifest entry for ride-scoped actions | `PUT /api/v2/ride-sessions/{sessionId}/passengers/me`, `POST /api/v2/ride-sessions/{sessionId}/messages`, `POST /api/v2/privacy-deletion-requests` |
| Driver | `role: "driver"`, `driverId`, `assignedBusId` | `drivers/{driverId}.authUid` equals the UID, the driver's `assignedBusId` matches the bus, and the bus lists the route | `POST /api/v2/ride-sessions`, `PATCH /api/v2/ride-sessions/{sessionId}`, `POST /api/shifts/stop` |
| Administrator | `role: "admin"`, `admin: true`, `authorizationVersion` | `requireAdmin` reads `_userAuthorization/{uid}` in Firestore and RTDB on every request, without a positive cache, and requires both versions to match the token | `/api/fleet/*`, `PUT /api/devices/{deviceId}`, `PUT /api/settings`, `DELETE /api/v2/ride-sessions/{sessionId}`, `GET /api/health` |

The `POST /api/users/bootstrap` call creates a missing profile with role `passenger` and repairs only a missing passenger claim. [Privileged database authorization](PRIVILEGED_DATABASE_AUTHORIZATION.md) describes how driver and administrator claims and records are published and revoked.

Driver checks on HTTP routes do not compare `authorizationVersion`. Ride start, delay, stop and the v2 ride read also require the driver registry record, so its reassignment or removal ends the authority there; chat, the legacy boarding code and legacy ride status compare only the token's `driverId` and `assignedBusId` with the session, and rely on the token revocation that every reassignment performs. Operator code paths that also admit administrators (`backend/src/routes/shifts.ts`, `backend/src/routes/sessions.ts`) accept either `role: "admin"` or `admin: true` without the version check, except the administrator ride stop in Section 3.1.

### 2.3 Errors

| Status | Meaning | Client action |
|---|---|---|
| 401 | Missing, malformed, invalid, expired or revoked token. `requireAdmin` adds `code` `AUTH_REQUIRED` or `AUTH_INVALID` and `phase: "authentication"`. | Refresh the token or sign in again. |
| 403 | Valid token without the required role, assignment or membership. `requireAdmin` adds `code: "ADMIN_REQUIRED"`. | Do not retry with the same token. |
| 429 | Rate limit exceeded. The response carries `RateLimit-*` headers. | Wait for the reset time. |
| 503 with `Retry-After: 1` | Token verification capacity is exhausted, or the authorization records are unreadable. `requireAdmin` adds `code` `AUTH_BUSY` or `AUTH_UNAVAILABLE`. | Retry after the delay; the user is still signed in. |

Unhandled errors return a generic body (`Internal server error.`) without stack traces.

### 2.4 Transport and caching

- The backend allows only the origins in `CORS_ORIGIN`, plus `http://localhost:3000` outside production, with `credentials: false`. A production backend refuses to start when `CORS_ORIGIN` is empty.
- The browser sends credentials only in the `Authorization` header, never in cookies.
- Responses that contain private data carry `Cache-Control: no-store`, and the service worker sends every API request to the network.
- `TRACE` and `CONNECT` return 405. JSON bodies are parsed in strict mode with a 16 KB limit, except route saves (64 KiB).

### 2.5 Versioning

Legacy `/api/...` paths and their `/api/v2/...` resource equivalents pass through the same authentication, admission and authorization middleware. [API resource migration](../../backend/API_RESOURCE_MIGRATION.md) maps the two.

## 3. Operations with additional rules

### 3.1 Administrator ride stop

`POST /api/shifts/stop` lets an administrator end a ride by its session, bus and route even when its driver was reassigned or the live record has no driver. This path requires `role: "admin"`, `admin: true` and a current `authorizationVersion` in both databases, the same contract as `requireAdmin`. Other callers must pass the driver check in Section 2.2.

### 3.2 Boarding

`PUT /api/v2/ride-sessions/{sessionId}/passengers/me` (legacy `POST /api/sessions/{sessionId}/join`) requires:

1. A passenger principal with an existing profile.
2. A session that is boarding, with a bus, a route and a resolved direction.
3. On first boarding, a browser position with accuracy of 100 m or better, within 150 m of the bus's live fix, and a bus fix no older than 60 s and no more than 10 s in the future.

The backend adds or updates only the caller's own manifest entry, and takes the display name and timestamps from the server. The browser position is used for the distance check and is not stored. It is reported by the client and is not proof of presence. No boarding code is required; the legacy `POST /api/sessions/{sessionId}/boarding-code` endpoint still issues a code to the assigned driver or an administrator, and boarding ignores it.

### 3.3 Ride chat

Clients cannot write messages to Firestore. `POST /api/v2/ride-sessions/{sessionId}/messages` checks that the sender is a manifest passenger with an existing profile, the assigned driver or an administrator, rechecks the ride state, applies the chat limits in [Security architecture](SECURITY_ARCHITECTURE.md#7-rate-limiting-and-abuse-controls), normalizes the text and masks a fixed profanity list before storing it. The browser renders messages as text.

### 3.4 Feedback

The browser writes feedback directly to Firestore in one transaction with the user's feedback cooldown; the rules validate the fields, the author, completed-ride membership and the 24 h cooldown. Administrators read and update feedback status through Firestore under the administrator rule. `POST /api/feedback` remains available to signed-in users.

### 3.5 Health endpoints

| Endpoint | Access | Content |
|---|---|---|
| `GET /live` | Public | `{"status":"alive"}` |
| `GET /health` | Public | `{"status":"ok"}` or `{"status":"degraded"}` from cached probes |
| `GET /api/health` | Administrator | Dependency state, telemetry counters, queue status and latency summaries |

`/api/health` counters cover the current process since startup and reset on restart. All three responses carry `Cache-Control: no-store`.

## 4. Tracker endpoints

Trackers do not use browser authentication. These paths skip browser admission and accept only `Authorization: Device <secret>`:

- `POST /api/devices/{deviceId}/telemetry`
- `POST /api/devices/{deviceId}/diagnostics`
- `POST /api/devices/{deviceId}/firmware/installation`
- `GET /api/devices/{deviceId}/firmware`

A 401 means an invalid or disabled credential; a 403 means a valid credential without a usable bus and route assignment. [Security architecture](SECURITY_ARCHITECTURE.md#43-devices) describes credential verification, and [Hardware telemetry](../hardware/HARDWARE_TELEMETRY.md) describes how the firmware reacts to each status. Do not add an unauthenticated endpoint that accepts location or health data.

## 5. Limits

Per-IP and per-user request limits, body sizes and the token verification capacity are listed in [Security architecture](SECURITY_ARCHITECTURE.md#7-rate-limiting-and-abuse-controls). Bounded internal queues are described in [Work admission](../operations/WORK_ADMISSION.md).

## 6. References

[1] Google, "Verify ID tokens," Firebase Authentication documentation, firebase.google.com/docs/auth/admin/verify-id-tokens. Accessed: 2026-10-30.

[2] M. Jones and D. Hardt, "The OAuth 2.0 Authorization Framework: Bearer Token Usage," RFC 6750, IETF, Oct. 2012.
