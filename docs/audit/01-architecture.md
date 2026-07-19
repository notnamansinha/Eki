# Phase 1: Architecture Reconnaissance

## Directory Tree & Applications
- **Frontend** (`/frontend`): Next.js web application encompassing three surfaces:
  - User Panel (`/src/app/passenger`)
  - Admin Panel (`/src/app/admin`)
  - Driver Panel (`/src/app/driver`)
- **Backend** (`/backend`): Node.js/Express REST and Socket API. Services include ETAs, geofencing logic, and admin APIs.
- **Hardware** (`/hardware`): C++ source for ESP32 with Neo-6M/8M GNSS modules. Contains PlatformIO configuration.

## Tech Stack
### Frontend
- **Framework**: Next.js 16.2.1, React 19
- **Styling**: Tailwind CSS v4
- **State Management**: React Hooks (useState, useEffect, custom hooks like `useRoutes`, `useBuses`)
- **Maps Integration**: `@vis.gl/react-google-maps` (Google Maps API)
- **Database Client**: Firebase SDK (Firestore for static data, RTDB for live data)

### Backend
- **Framework**: Express.js
- **Runtime**: Node.js (TypeScript, built with tsc)
- **Firebase**: Firebase Admin SDK (Firestore, RTDB, Auth)

### Hardware
- **Environment**: PlatformIO
- **Core**: ESP32 C++

## Firebase Schema

### Firestore (Static / Config)
- `routes`: 
  ```json
  {
    "id": "route_123",
    "name": "Downtown Express",
    "color": "#3b82f6",
    "stops": [{ "id": "stop1", "name": "Main St", "lat": 23.03, "lng": 72.55 }],
    "waypoints": [{ "lat": 23.03, "lng": 72.55 }],
    "polyline": "encoded_polyline_string"
  }
  ```
  - *Written by*: Admin Panel
  - *Read by*: Passenger, Admin, Driver, Backend

- `bus_locations`: Device presence and last seen state.
  ```json
  {
    "deviceState": "offline",
    "tripState": "completed",
    "lastSeen": "2026-07-17T20:00:00Z"
  }
  ```

- `completed_trips`: Historical trip logs.

### Realtime Database (RTDB) - Live Data
- `activeBuses`: Live streaming bus state. 
  Key format: `busId_routeId`
  ```json
  {
    "busId": "bus_001",
    "routeId": "route_123",
    "lat": 23.034,
    "lng": 72.541,
    "heading": 45,
    "speed": 30,
    "deviceState": "online",
    "motionState": "moving",
    "tripState": "in_service",
    "timestamp": 1700000000,
    "driverId": "driver_1",
    "currentStopIndex": 2,
    "delayMinutes": 0,
    "stopETAs": {
      "stop_3": 5,
      "stop_4": 12
    }
  }
  ```
  - *Written by*: Hardware (lat/lng/motion/speed/timestamp/deviceState), Driver Panel (simulated GPS/status), Backend `tripStateEngine` (tripState, currentStopIndex, stopETAs)
  - *Read by*: Passenger Panel, Backend, Admin Panel.

## Google Maps Integration
- **Passenger Panel** (`PassengerMap.tsx`, `RoutePlannerMap.tsx`): Renders live bus positions (`AdvancedMarker`), static stops, decoded polyline routes (`google.maps.Polyline`), and traffic layers (`DirectionsRoute` with live traffic enabled).
- **Admin Panel** (`RouteManagementPanel.tsx`): Renders map for selecting waypoints/stops to create new routes.
- **Driver Panel** (`DriverMap.tsx`): Displays route, current bus location, and upcoming stops.

## Auth Model
- **Passenger Panel**: Anonymous authentication (`signInAnonymously`).
- **Driver Panel**: LocalStorage-based driver ID tracking, uses anonymous Firebase Auth for RTDB read/write.
- **Admin Panel**: Firebase Auth (Google Provider). Backend endpoints verify Admin Firebase Tokens (`requireAdmin.ts`).

## Env Vars
- **Frontend**: 
  `NEXT_PUBLIC_FIREBASE_*` keys
  `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`
  `NEXT_PUBLIC_BACKEND_URL`
- **Backend**:
  `FIREBASE_SERVICE_ACCOUNT` (JSON string or path)
  `FIREBASE_DATABASE_URL`
  `GOOGLE_MAPS_API_KEY`
  `PORT`
  `CORS_ORIGIN`
