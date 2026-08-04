# Eki: Hardware-Ingested GNSS Campus Bus Tracking Ecosystem

Eki is an enterprise-grade, multi-tenant university campus transit tracking system. It combines custom ESP32 hardware telemetry nodes, an Express.js backend server, Firebase Realtime Database for sub-second client push updates, Firestore for persistent trip lifecycle management, and a Next.js Progressive Web Application (PWA) supporting passenger, driver, and administrator workflows.

Telemetry is ingested directly from microcontroller hardware over certificate-pinned HTTPS POST endpoints. The backend acts as the authoritative boundary for identity, route geofencing, state transitions, and database mutations, eliminating direct client or hardware access to database write triggers.

---

## Architecture Overview

```mermaid
flowchart LR
  subgraph Hardware Tier
    NEO["u-blox NEO-M8N GNSS"] -->|"UART (9600 Baud)"| ESP["ESP32 Microcontroller"]
  end

  subgraph Ingestion & Processing Tier
    ESP -->|"HTTPS POST + Device Secret\n(TLS CA Pinned)"| API["Express Backend API"]
    API -->|"Validation & Auth"| INGEST["Telemetry Ingestion Worker"]
    INGEST -->|"Live Push (sub-second)"| RTDB["Firebase Realtime Database"]
    INGEST -->|"Lease-Locked State Engine"| FS["Firebase Firestore"]
  end

  subgraph Client Tier
    RTDB --> P["Passenger Web App"]
    RTDB --> D["Driver Web Panel"]
    RTDB --> A["Admin Dashboard"]
  end
```

---

## Hardware Specifications and Wiring

### Components

- **Microcontroller**: ESP32-WROOM-32 / ESP32 Dev Module (Espressif Systems)
  - Processor: Dual-core Xtensa 32-bit LX6 @ 240 MHz
  - Framework: Arduino Core on PlatformIO (`espressif32` platform)
  - Partitioning: `huge_app.csv` (Extended application partition layout)
- **GNSS Module**: u-blox NEO-M8N Concurrent GNSS Receiver
  - Constellations: GPS, GLONASS, BeiDou, QZSS
  - Antenna: Active ceramic patch antenna with clear sky deployment
  - Interface: Hardware UART (Serial2) at 9,600 Baud
- **Power Electronics**:
  - Input: Vehicle 12 V DC main battery line
  - Step-Down: Fused automotive 12 V to 5 V DC buck converter module supplying 5 V to ESP32 VIN

### Pinout Configuration

| ESP32 Pin | NEO-M8N Pin | Function |
|---|---|---|
| `5V` / `VIN` | `VCC` | Power Supply (5 V DC) |
| `GND` | `GND` | Ground Reference |
| `GPIO 16` (`RX2`) | `TX` | Serial Receive (HardwareSerial2) |
| `GPIO 17` (`TX2`) | `RX` | Serial Transmit (HardwareSerial2) |

### Embedded Firmware Architecture

- **Library Dependencies**:
  - `mikalhart/TinyGPSPlus` (`^1.0.3`): NMEA 0183 sentence parsing
  - `bblanchon/ArduinoJson` (`^7.0.0`): Telemetry payload serialization
- **Hardware Buffer Allocation**:
  - Custom HardwareSerial RX buffer set to 8,192 bytes (`Serial2.setRxBufferSize(8192)`). This prevents NMEA sentence drops during blocking TLS handshakes and HTTP transaction round-trips.
- **System Clock Synchronization**:
  - Internal ESP32 Real-Time Clock (RTC) is synchronized dynamically via GPS UTC date and time extraction (`settimeofday`) to satisfy certificate validity period checks during TLS handshakes.
- **Adaptive Telemetry Transmission Logic**:
  - Minimum publish interval: 3 seconds (when vehicle is in motion)
  - Moving heartbeat interval: 30 seconds
  - Stationary heartbeat interval: 60 seconds
  - Spatial displacement trigger: >= 5.0 meters
  - Heading displacement trigger: >= 15.0 degrees
  - Velocity delta trigger: >= 5.0 km/h
  - Horizontal Dilution of Precision (HDOP) cutoff: Rejects fix if HDOP > 4.0
  - Velocity classification: Moving (>= 2.5 km/h), Stopped (<= 1.5 km/h)
- **Security and TLS Configuration**:
  - Protocol: HTTPS POST via `HTTPClient` and `WiFiClientSecure`
  - Transport Security: Root CA Certificate verification (`WiFiClientSecure::setCACert`). Insecure TLS (bypassing certificate verification) is explicitly disabled in production code.
  - Authentication: Custom header `Authorization: Bearer <DEVICE_SECRET>`

---

## Hardware Telemetry Contract

Devices send an HTTP POST request to `/api/devices/:deviceId/telemetry`. The request payload is restricted to a maximum size of 512 bytes with the following structure:

```json
{
  "lat": 23.034,
  "lng": 72.55,
  "speed": 18.2,
  "heading": 94.0,
  "motionState": "moving",
  "timestamp": 1800000000000
}
```

### Validation and Ingestion Rules

1. **Payload Hygiene**: Rejects extra fields, missing fields, or invalid data types.
2. **Geographic Bounds**: Rejects latitude outside `[-90, 90]` or longitude outside `[-180, 180]`.
3. **Plausibility Checks**: Rejects speed > 200 km/h and heading outside `[0, 360]`.
4. **Timestamp Verification**: Rejects timestamps drifting into the future or stale beyond configured thresholds.
5. **Idempotency**: Duplicate timestamps are ignored cleanly, returning HTTP 200. Valid new telemetry samples return HTTP 202.
6. **Authentication & Scrypt Verification**: Device secrets are verified on the backend using salted `scrypt` verifiers cached for 60 seconds to minimize CPU load.

---

## Authoritative Trip Lifecycle Engine

Trip progress is governed strictly by the server-side state worker. Neither drivers nor clients can manually override location, stop index, or trip completion status.

```mermaid
stateDiagram-v2
  [*] --> PreDeparture: Assigned driver arms shift
  PreDeparture --> InService: Hardware GNSS enters Stop 1 geofence
  InService --> InService: Sequential entry into next expected stop geofence
  InService --> Completed: Hardware GNSS reaches final stop geofence
  Completed --> [*]
```

### Lifecycle Rules

- **Arming Shift**: Driver arms an assigned bus and route. The ride enters `pre_departure`.
- **Service Activation**: State transitions to `in_service` only when verified hardware GNSS coordinates enter the geofence of Stop 1.
- **Ordered Progress**: Stops must be visited strictly in order (Stop 1 -> Stop 2 -> ... -> Final Stop). Skipping stops is disallowed.
- **Geofence Crossing**: Interpolated geofence entry handles fast-moving vehicles passing between two telemetry sampling intervals.
- **Interruption Resilience**: If hardware power, Wi-Fi, or GNSS signal is lost, the ride state remains active in Firestore (`active_rides/{busId_routeId}`) and is projected as `offline` after stale timeout. Upon hardware reconnection, the session and stop index are restored without losing state.
- **Lease Locking**: Backend uses Firestore lease locks to ensure single-instance ownership of active trip state computation.

---

## Storage Architecture

| Storage Layer | Purpose | Primary Paths / Collections | Access Control |
|---|---|---|---|
| **Firebase Realtime Database (RTDB)** | Low-latency live location and motion projection for client subscription | `activeBuses/{busId}_{routeId}` | Client Read / Admin SDK Server Write Only |
| **Firebase Firestore** | Canonical persistent state, recovery records, configuration, and historical analytics | `routes`, `buses`, `drivers`, `devices`, `active_rides`, `ride_sessions`, `completed_trips` | Admin SDK Server Write / Strict Role-Based Rules |

### Collection Summary

- `routes`: Polyline geometry, stop coordinate arrays, geofence radii.
- `buses`: Vehicle metadata, route assignments, active driver links.
- `drivers`: Driver user profiles, custom claims, assignment history.
- `devices`: Hardware registry, device IDs, salted scrypt secret hashes, bus bindings.
- `active_rides`: Recovery records for in-progress shifts.
- `ride_sessions`: Session stop progression logs and timestamps.
- `completed_trips`: Archived finished rides for fleet analytics.

---

## API Reference

All browser API requests require a Firebase ID Token passed via `Authorization: Bearer <TOKEN>`. Admin routes require custom admin claims.

| Method | Endpoint Path | Access Level | Description |
|---|---|---|---|
| `GET` | `/health` | Public | System health check (Firebase, Worker, Ingestion) |
| `POST` | `/api/devices/:deviceId/telemetry` | Device Secret | Ingest and process hardware GNSS telemetry |
| `PUT` | `/api/devices/:deviceId` | Admin | Bind a physical device to a bus and route |
| `POST` | `/api/devices/:deviceId/disable` | Admin | Disable telemetry ingestion for a device |
| `GET` | `/api/buses` | Authenticated | Retrieve active bus snapshots |
| `GET` | `/api/buses/:busId` | Authenticated | Retrieve snapshot for a specific bus |
| `POST` | `/api/shifts/start` | Driver | Arm or resume assigned driver shift |
| `POST` | `/api/shifts/stop` | Driver | Acknowledge completed shift |
| `PATCH` | `/api/shifts/delay` | Driver | Log delay updates for active shift |
| `DELETE` | `/api/shifts/:sessionId/messages` | Admin | Clear route notification messages |
| `DELETE` | `/api/shifts/:sessionId/history` | Admin | Purge completed or interrupted trip session |
| `GET` | `/api/analytics/fleet` | Admin | Fetch fleet operational analytics |
| `PUT` / `DELETE` | `/api/fleet/buses/:id` | Admin | Create, update, or remove fleet vehicle records |
| `PUT` / `DELETE` | `/api/fleet/drivers/:id` | Admin | Manage driver profiles and role claims |
| `POST` | `/api/fleet/reconcile` | Admin | Reconcile assignment mirrors and claims |
| `POST` | `/api/routes/compute-polyline` | Admin | Calculate and save route geometry from stops |
| `POST` | `/api/plan` | Authenticated | Compute route plan using polyline geometry |
| `GET` | `/api/routes-list` | Authenticated | Fetch metadata list of available routes |
| `GET` | `/api/places/search?q=...` | Admin | Server-side stop coordinate search |

---

## Project Structure

```
Eki/
├── backend/                  # Node.js Express server & trip engine
│   ├── src/
│   │   ├── config/           # Environment and Firebase Admin setup
│   │   ├── controllers/      # Route handler implementations
│   │   ├── middleware/       # Auth, rate limiting, error handling
│   │   ├── services/         # Ingestion, state engine, scrypt verifiers
│   │   ├── types/            # TypeScript interface definitions
│   │   ├── server.ts         # Server entry point
│   │   └── seed.ts           # Database seeding utilities
│   ├── package.json
│   └── tsconfig.json
├── frontend/                 # Next.js App Router PWA frontend
│   ├── src/
│   │   ├── app/              # Routes: passenger, driver, admin panels
│   │   ├── components/       # Google Maps, UI elements, active bus cards
│   │   ├── hooks/            # RTDB listeners, auth hooks
│   │   └── lib/              # Firebase client SDK initialization
│   ├── public/               # Service worker, PWA icons, manifest
│   ├── package.json
│   └── tailwind.config.ts
├── hardware/                 # PlatformIO ESP32 firmware project
│   ├── include/
│   │   └── secrets.example.h # Hardware configuration template
│   ├── src/
│   │   └── main.cpp          # ESP32 main firmware logic
│   ├── platformio.ini        # PlatformIO build configuration
│   └── README.md
├── docs/                     # Technical specifications and deployment runbooks
│   ├── ARCHITECTURE.md
│   ├── LIVE_DEMO_RUNBOOK.md
│   ├── PRODUCTION_READINESS_AUDIT.md
│   ├── STORAGE_ARCHITECTURE.md
│   └── UNIVERSITY_DEPLOYMENT_CHECKLIST.md
├── firebase.json             # Firebase configuration (Hosting, RTDB, Firestore)
├── firestore.rules           # Firestore security rules
├── database.rules.json       # Realtime Database security rules
└── package.json              # Monorepo workspace configuration
```

---

## Local Setup Guide

### Prerequisites

- **Node.js**: v20.0.0 or higher
- **npm**: v10.0.0 or higher
- **PlatformIO CLI / VS Code Extension**: For hardware compilation
- **Firebase Project**: With Firestore, Realtime Database, and Authentication enabled
- **Google Maps Platform API Key**: Browser Maps JavaScript API and Server Directions API

### 1. Repository Setup

```bash
git clone https://github.com/your-org/eki.git
cd Eki
npm install
```

### 2. Backend Environment Configuration

Create `backend/.env` based on `backend/.env.example`:

```env
PORT=4000
FIREBASE_PROJECT_ID=your-firebase-project-id
FIREBASE_CLIENT_EMAIL=your-service-account-email
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
DATABASE_URL=https://your-firebase-project-id-default-rtdb.firebaseio.com
GOOGLE_MAPS_API_KEY=your-server-google-maps-api-key
```

### 3. Frontend Environment Configuration

Create `frontend/.env.local` based on `frontend/env.production.example`:

```env
NEXT_PUBLIC_FIREBASE_API_KEY=your-firebase-api-key
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
NEXT_PUBLIC_FIREBASE_DATABASE_URL=https://your-project-default-rtdb.firebaseio.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=your-project-id
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=your-project.appspot.com
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=your-sender-id
NEXT_PUBLIC_FIREBASE_APP_ID=your-app-id
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=your-browser-maps-api-key
NEXT_PUBLIC_BACKEND_URL=http://localhost:4000
```

### 4. Hardware Firmware Setup

Navigate to `hardware/` and create `include/secrets.h` from `include/secrets.example.h`:

```cpp
#pragma once

#define WIFI_SSID "YOUR_WIFI_SSID"
#define WIFI_PASS "YOUR_WIFI_PASSWORD"

#define DEVICE_ID "device_01"
#define DEVICE_SECRET "AT_LEAST_20_CHARACTER_RANDOM_SECRET"

#define BACKEND_URL "https://your-backend-domain.com"

static constexpr char EKI_BACKEND_ROOT_CA[] = R"EOF(
-----BEGIN CERTIFICATE-----
YOUR_BACKEND_SERVER_ROOT_CA_CERTIFICATE
-----END CERTIFICATE-----
)EOF";

#define BACKEND_ROOT_CA EKI_BACKEND_ROOT_CA
```

Compile, flash, and monitor:

```bash
cd hardware
platformio run
platformio run --target upload
platformio device monitor --baud 115200
```

### 5. Running the Application

To start both frontend and backend concurrently in development mode:

```bash
# From workspace root
npm run dev
```

- **Frontend**: `http://localhost:3000`
- **Backend API**: `http://localhost:4000`
- **Backend Health Check**: `http://localhost:4000/health`

---

## Verification and Testing

Execute full validation suite across all workspace packages:

```bash
npm run verify
```

Individual checks:

```bash
# Lint codebases
npm run lint

# Run backend unit and integration tests
npm test

# Build production packages
npm run build

# Verify PlatformIO firmware compilation
platformio run --project-dir hardware
```

---

## Production Security and Hardware Hardening

1. **Hardware Secure Boot & Flash Encryption**:
   - Provision Espressif Secure Boot V2 and eFuse flash encryption before fleet deployment to protect stored Wi-Fi credentials and device secrets against physical flash extraction.
2. **TLS Certificate Pinning**:
   - Firmware must pin the Root CA certificate issuing the backend HTTPS domain. Plain HTTP or unverified TLS is blocked by firmware logic.
3. **Role-Based Access Control**:
   - Admin routes check custom claims attached to Firebase Authentication ID Tokens (`syncRoleClaims`).
   - Browser applications are barred from writing directly to RTDB `activeBuses` or modifying Firestore ride state documents.
4. **Rate Limiting and Perimeter Protection**:
   - Production backend deployments must run behind reverse proxies (Nginx/Cloudflare) enforcing strict IP and device-level rate limiting on `/api/devices/:deviceId/telemetry`.

---

## Technical Documentation Links

- [Architecture & Trip Lifecycle Engine](docs/ARCHITECTURE.md)
- [Live Demo Operations Runbook](docs/LIVE_DEMO_RUNBOOK.md)
- [Storage Architecture Specification](docs/STORAGE_ARCHITECTURE.md)
- [Production Readiness Audit](docs/PRODUCTION_READINESS_AUDIT.md)
- [University Deployment & Handover Checklist](docs/UNIVERSITY_DEPLOYMENT_CHECKLIST.md)
- [Backend API Specification](backend/API.md)
- [Hardware Firmware README](hardware/README.md)

---

## License

Copyright (c) 2026 Eki Bus Tracking Project. Licensed under the MIT License.
