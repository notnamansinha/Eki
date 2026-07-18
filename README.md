# Eki — Open-Source GPS & Vehicle Tracking System

<img src="./frontend/public/eki-logo.png" alt="Eki Logo" width="200" />

> An open-source, full-stack vehicle tracking ecosystem engineered entirely for **Zero-Budget** operations on Free Tiers. Build your own live GPS tracker using an ESP32 and NEO-M8N GNSS module, streaming sub-second telemetry to Firebase RTDB with Next.js live-map dashboards.

![Hardware Setup and Explanation](./docs/assets/image.jpg)

---

## Overview

Eki (BusTrackr) is a full-stack, real-time fleet management ecosystem. By bridging custom OEM hardware telemetry (ESP32) directly to a Firebase real-time streaming layer and serving it through a Next.js App Router stack, it completely eliminates manual driver interaction for location updates while providing sub-second latency for commuters.

The system is composed of three primary surfaces:

1. **Passenger App**: Interactive live maps, zero-latency ETA calculations, and dynamic live announcements.
2. **Admin Dashboard**: Bird's-eye fleet map, historical analytics, route infrastructure management, and passenger communication overrides.
3. **Hardware Telemetry**: Dedicated ESP32 GNSS modules physically installed on buses, autonomously streaming high-frequency location data using smart-delta transmission.

---

## System Architecture

Eki utilizes a highly optimized real-time architecture, maximizing Google Cloud and Firebase free tiers.

- **Hardware Telemetry (ESP-WROOM-32 & NEO-M8N):** Processes NMEA sentences via TinyGPS++ to extract live coordinates, speed, and heading.
- **Cost-Optimized Sync:** Smart delta-transmission firmware calculates Haversine distance locally. It only sends HTTPS PATCH updates to Firebase RTDB when the vehicle moves >10m or turns >15°, reducing cloud writes by ~85%.
- **Role-Based Access Control:** Next.js Server/Client component boundary validating Firebase Auth tokens against Firestore role hierarchies, securely routing traffic between Admin, Driver, and Passenger views.
- **Client Real-Time Singletons:** Global Module-Level Singletons heavily optimize Firestore snapshot listeners and RTDB listeners, ensuring that no matter how many React components mount, exactly 1 WebSocket connection is used per client.

```mermaid
graph TD
    subgraph Hardware [OEM Telemetry]
        ESP[ESP32 GNSS Module]
    end

    subgraph Firebase Ecosystem
        Auth["Firebase Auth API"]
        RTDB[("Realtime Database (High-Frequency GPS)")]
        FS[("Firestore (Persistent Data/Roles)")]
        Hosting["Firebase Hosting (Static CDN)"]
    end

    subgraph Cloud Container [Backend Server]
        Express["Node.js + Express"]
        SocketIO["Socket.io Gateway"]
        RoutesAPI["Google Maps Routes API v2"]
    end

    subgraph Frontend [Client Applications]
        P["Passenger App"]
        D["Driver Console"]
        A["Admin Dashboard"]
    end

    %% Hardware Flow
    ESP -->|Authenticates via Custom Token| Express
    ESP -->|PATCH Location Updates| RTDB

    %% Web connections
    Hosting -.->|Delivers Static App| Frontend
    Frontend -->|Authenticates| Auth
    
    %% Realtime Connections
    RTDB -->|Data Sync Stream| P
    RTDB -->|Data Sync Stream| A

    %% Backend Connections
    Frontend -->|REST and WS| Express
    Express -->|Validates/Updates| FS
    Express -->|Computes Polylines| RoutesAPI
```

---

## Tech Stack

| Layer | Technologies Used |
| --- | --- |
| **Frontend** | Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS, Google Maps (@vis.gl) |
| **Backend** | Node.js, Express 4, Socket.io 4, TypeScript, Docker |
| **Hardware** | ESP-WROOM-32, NEO-M8N GNSS, PlatformIO, ArduinoJson |
| **Data & Auth** | Firestore, Firebase Realtime Database, Firebase Auth, Firebase Hosting |
| **Maps & GIS** | Google Maps JS API (Client), Routes API v2 (Server) |

---

## Repository Structure

This repository is structured as a monorepo, separating the distinct operational domains of the ecosystem.

```text
Eki/
├── backend/       # Node.js server (WebSocket gateway, Routes API, secure ops)
├── docs/          # Deep-dive architecture, zero-budget optimizations, and hardware
├── frontend/      # Next.js web applications (Passenger, Driver, Admin portals)
├── hardware/      # PlatformIO/C++ firmware for ESP32 GNSS telemetry modules
└── scripts/       # Repository-wide utility and build scripts
```

---

## Prerequisites & Installation

To run this ecosystem locally, you will need:

- **Node.js** ≥ 20.x
- **PlatformIO** (if compiling hardware firmware)
- A **Google Cloud Project** with Maps JavaScript API and Routes API v2 enabled.
- A **Firebase Project** with Authentication, Firestore, and Realtime Database initialized.

### 1. Clone & Install

```bash
git clone https://github.com/AryanPatelOnGIT/Bus_Track.git
cd Bus_Track
npm install
```

### 2. Environment Configuration

You must configure environment variables for both the backend and frontend.

**Backend (`backend/.env`):**
Requires your Firebase Admin Service Account JSON and a Google Maps Server Key (IP Restricted).

```bash
cp backend/.env.example backend/.env
# Edit backend/.env with your credentials
```

**Frontend (`frontend/.env.local`):**
Requires your Firebase public config and a Google Maps Browser Key (HTTP Referrer Restricted).

```env
NEXT_PUBLIC_FIREBASE_API_KEY=your_public_key
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=your_browser_key
# ... see frontend/README.md for full list
```

---

## Running the Application

### Development Mode

You can spin up both the Next.js frontend and the Express backend concurrently from the root directory:

```bash
npm run dev
```

- **Frontend:** [http://localhost:3000](http://localhost:3000)
- **Backend:** [http://localhost:4000](http://localhost:4000)

### Production Build & PWA Auto-Update

To create a production-optimized static export of the frontend and deploy to Firebase Hosting:

```bash
npm run deploy
```
*Note: The frontend leverages an advanced `version.json` cache-busting strategy, ensuring users with aggressive Safari caches immediately auto-refresh when new deployments hit production.*

---

## Documentation Index

For super-detailed explanations of the system architecture, zero-budget scaling, and hardware integration, please refer to our deep-dive documentation:

- [System Architecture & RBAC Flow](docs/ARCHITECTURE.md) **(Updated)**
- [Zero-Budget & API Optimizations](docs/OPTIMIZATIONS.md) **(NEW)**
- [GNSS Hardware Migration Guide](docs/GNSS_HARDWARE_MIGRATION.md)
- [System Workflows](docs/WORKFLOW_EXPLANATION.md)
- [PWA Update Strategy](docs/PWA_UPDATE_STRATEGY.md)
- [Hardware Telemetry & Security](hardware/README.md)
- [Frontend Workspace](frontend/README.md)
- [Backend Workspace](backend/README.md)
