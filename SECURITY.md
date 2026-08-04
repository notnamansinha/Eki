# Security Policy

This document outlines the security models, vulnerability reporting procedures,
and database rules governing the Eki ecosystem.

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

## In-Transit Encryption

- All HTTP traffic enforces HTTPS.
- Hardware telemetry uses `WiFiClientSecure` with a configured CA certificate
  when communicating with the backend API.
