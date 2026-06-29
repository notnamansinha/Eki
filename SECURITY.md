# Security Policy

This document outlines the security models, vulnerability reporting procedures,
and database rules governing the Eki ecosystem.

## Reporting a Vulnerability

If you discover a security vulnerability within Eki, please do not disclose it
publicly. Instead, contact the repository maintainers directly. Provide a
detailed summary of the vulnerability, including steps to reproduce.

## Security Architecture

### Role-Based Access Control (RBAC)

Eki enforces strict RBAC at two levels:

1. **Frontend (`RoleGuard`)**: Prevents unauthorized UI rendering by validating
   the authenticated Firebase user's role against a Firestore `users` collection.
2. **Backend/API**: The Express backend requires a valid Firebase ID Token
   (Bearer token) for all endpoints. Actions like modifying bus states or
   canceling passenger requests are strictly gated behind an `admin` role check.

### Firebase Security Rules

Our database relies on Firebase Security Rules (`firestore.rules` and
`database.rules.json`) as the final perimeter of defense.

- **Firestore**: User data and global route structures are restricted. Users
  can only read their own data unless they hold an `admin` role.
- **Realtime Database (RTDB)**: The `/activeBuses` tree is publicly readable
  by authenticated passengers but strictly writeable only by the hardware
  telemetry modules or admin backend.

### Hardware Authentication

ESP32 GNSS modules do not store long-lived Firebase Admin credentials. Instead,
they authenticate via a custom JWT flow using a hardware-specific
`DEVICE_SECRET`. This limits the blast radius if a module is physically
compromised.

## In-Transit Encryption

- All client-to-server HTTP traffic must enforce HTTPS.
- Hardware telemetry (ESP32) utilizes TLS via `WiFiClientSecure` when
  communicating with backend APIs and Firebase.
