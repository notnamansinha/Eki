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

ESP32 GNSS telemetry units authenticate via `/api/devices/auth`:
- **Scrypt Password Hashing**: Hardware secrets are hashed using `scrypt` with unique salts and compared via constant-time buffer comparison (`timingSafeEqual`). Plaintext secrets are strictly rejected.
- **Path-Isolated Custom Tokens**: Upon authentication, the backend mints a custom token containing `role: "device"` and `deviceId`.
- **RTDB Path Isolation**: Realtime Database rules restrict device writes under `/activeBuses/$busKey` so a device can *only* write to keys matching `auth.token.deviceId + '_' + routeId`.
- **Secret Migration Security**: Secret hashing endpoints (`/api/devices/hash-secret`) require an admin ID token (`requireAdmin`).

### Firebase Security Rules Perimeter (`database.rules.json`)

- **`/activeBuses`**: Read-accessible to authenticated users; write-gated to custom claim `driver`, `admin`, or path-isolated `device`.
- **`/messages`**: Append-only (`!data.exists()`). Enforces required fields (`text`, `from`, `senderName`, `senderId`, `timestamp`), max string lengths (text $\le 500$, name $\le 100$), numeric timestamps, and `senderId === auth.uid`.
- **`/users`**: Read-restricted to owner (`auth.uid == $uid`). Writes disabled (`.write: false`).

### HTTP Security Headers & Infrastructure

Firebase Hosting (`firebase.json`) enforces strict production security headers:
- **`Strict-Transport-Security`**: `max-age=31536000; includeSubDomains` (enforces HTTPS).
- **`Cross-Origin-Opener-Policy`**: `same-origin-allow-popups` (enables Google OAuth popups while isolating cross-origin windows).
- **`Content-Security-Policy`**: Restricts script, style, image, font, frame, and WebSocket origins (`wss://*.firebaseio.com`, `wss://*.firebasedatabase.app`). Disables `unsafe-eval`.
- **`X-Frame-Options`**: `DENY` (prevents clickjacking).

## In-Transit Encryption

- All HTTP traffic enforces HTTPS.
- Hardware telemetry (ESP32) utilizes TLS via `WiFiClientSecure` when communicating with backend APIs and Firebase.
