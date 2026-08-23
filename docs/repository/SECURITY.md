# Security Policy

This document outlines the security models, vulnerability reporting procedures,
and database rules governing the Eki ecosystem. For the public-safe
configuration and documentation boundary, also see
[Environment and configuration](../CONFIGURATION.md) and [Getting started](../GETTING_STARTED.md).

## Reporting a Vulnerability

If you discover a security vulnerability within Eki, please do not disclose it
publicly. Instead, contact the repository maintainers directly. Provide a
detailed summary of the vulnerability, including steps to reproduce.

## Security Architecture

### Role-Based Access Control (RBAC) & Custom Claims

Eki enforces strict RBAC across presentation, API, and database perimeters:

1. **Immutable Firebase Custom Claims (`auth.token.role`)**:
   Role authorization is issued exclusively server-side via the admin sync utility (`npm run sync-role-claims`) or backend endpoints. Clients cannot self-assign or mirror roles in Realtime Database trees (`/users/$uid` has `.write: false`).
2. **Frontend Presentation Guard (`RoleGuard`)**:
   Controls route rendering based on authenticated claims (`admin`, `driver`, `passenger`).
3. **Backend API Authorization**:
   Express endpoints validate Bearer tokens. Admin endpoints enforce `requireAdmin` middleware checking `auth.token.admin === true`.

### Hardware Authentication & Isolation

ESP32 GNSS units post a closed six-field payload to
`/api/devices/{deviceId}/telemetry` over certificate-verified HTTPS:

- **Independent device credentials**: Per-device secrets are stored as salted
  scrypt verifiers and compared with `timingSafeEqual`. The plaintext is shown
  once by the local provisioning command and is never returned by an API.
- **Server-side assignment**: Bus and route IDs come from the protected device
  registry, not from device-controlled JSON.
- **Bounded ingestion**: Telemetry has a 512-byte parser limit, exact field and
  numeric validation, timestamp deduplication, per-IP and per-device limits,
  and a constant-time credential check.
- **No Firebase credential on hardware**: Devices cannot read or write Firebase
  directly. Only the backend Admin SDK writes the live RTDB projection.

### Firebase Security Rules Perimeter (`database.rules.json`)

- **`/activeBuses`**: Read-accessible to authenticated users and client-write
  denied. Lifecycle and coordinates are backend-authoritative.
- **`/driverRouteAssignments` and `/messages`**: Client reads and writes are
  denied; chat is stored under Firestore ride sessions with scoped rules.
- **`/users`**: Read-restricted to owner (`auth.uid == $uid`). Writes disabled (`.write: false`).

### HTTP Security Headers & Infrastructure

Firebase Hosting (`firebase.json`) enforces strict production security headers:
- **`Strict-Transport-Security`**: `max-age=31536000; includeSubDomains` (enforces HTTPS).
- **`Cross-Origin-Opener-Policy`**: `same-origin-allow-popups` (enables Google OAuth popups while isolating cross-origin windows).
- **`Content-Security-Policy`**: Restricts script, style, image, font, frame, and WebSocket origins (`wss://*.firebaseio.com`, `wss://*.firebasedatabase.app`). Disables `unsafe-eval`.
- **`X-Frame-Options`**: `DENY` (prevents clickjacking).

The service worker caches only explicitly public/static resources. Firebase
Auth/RTDB REST, backend API and all unknown requests are network-only, avoiding
stale authenticated responses crossing accounts on shared browsers.

### Lifecycle Integrity

- A deterministic backend-only `_active_bus_locks/{busId}` Firestore document
  makes active sessions mutually exclusive across every route for one bus.
- Completion, recovery cleanup, and abandonment compare `sessionId` inside
  transactions before changing RTDB or deleting `active_rides`/locks. Delayed
  work from an old session cannot overwrite a newer ride.
- Retention is fail-safe: production refuses to start unless
  `RETENTION_SWEEPER_ENABLED=true` exactly; development and tests remain
  non-destructive when it is omitted.

## In-Transit Encryption

- All HTTP traffic enforces HTTPS.
- Hardware telemetry uses `WiFiClientSecure` with a configured CA certificate
  when communicating with the backend API.

## Browser and Device Secret Handling

- Browser Firebase/Maps keys are public configuration, not secrets; restrict
  them by hostname/API and enforce App Check after staged validation.
- Device secrets, service-account JSON, App Check debug tokens and ignored
  environment files must never be committed or logged. Provisioning displays a
  device secret once and stores only its salted scrypt verifier server-side.
  Hardware operators transfer the plaintext only inside the controlled signing
  environment into the ignored `hardware/include/secrets.h`; it is embedded in
  a device-specific flash-encrypted image and replaced only by reflashing.
- Production should use Workload Identity/Secret Manager, university WAF/global
  rate limits, monitored rotation, immutable signed-OTA hosting and metadata,
  controlled signing-key custody, and the witnessed Secure Boot V2/release-mode
  flash-encryption/update/rollback procedure. See
  the deployment checklist for ownership requirements.

### Public documentation boundary

Architecture and API documentation may describe identifiers, routes, limits,
security controls, failure behavior and placeholder commands. It must not
contain service-account JSON, private keys, device or Wi-Fi secrets, App Check
debug tokens, bearer tokens, internal addresses, tunnel credentials, personal
records, or unredacted logs. Browser configuration identifiers are public but
must remain restricted by hostname and enabled API.
