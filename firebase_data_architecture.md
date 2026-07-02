# Eki BusTracker — Firebase Data Architecture

This document is the canonical reference for every field stored in Firebase for the Eki project.

---

## Firebase Services Used

| Service | Purpose |
|---|---|
| **Firestore** | Persistent, structured, queryable data (routes, buses, drivers, analytics) |
| **Realtime Database (RTDB)** | Live, low-latency bus telemetry stream. Read by passenger + admin frontends |

---

## Firestore Collections

### `routes/{routeId}`
**Written by:** Admin via the frontend route editor.

| Field | Type | Description |
|---|---|---|
| `id` | `string` | Document ID, same as `routeId` |
| `name` | `string` | Display name (e.g. `"Red Line Express"`) |
| `color` | `string` | Hex color for map rendering (e.g. `"#ef4444"`) |
| `stops` | `RouteStop[]` | Ordered list of stops from A (first) to Z (last) |
| `stops[].id` | `string` | Unique stop identifier |
| `stops[].name` | `string` | Full display name (e.g. `"Kankaria Lake"`) |
| `stops[].shortName` | `string` | Short label for map pins |
| `stops[].lat` | `number` | Latitude of the stop (WGS84) |
| `stops[].lng` | `number` | Longitude of the stop (WGS84) |
| `waypoints` | `RouteWaypoint[]` | Intermediate GPS points for drawing the polyline |
| `waypoints[].lat` | `number` | Latitude |
| `waypoints[].lng` | `number` | Longitude |
| `polyline` | `string?` | Pre-computed Google Maps encoded polyline (seeded) |
| `distanceMeters` | `number?` | Total route length in metres (seeded) |
| `duration` | `string?` | Pre-computed travel time string (e.g. `"600s"`, seeded) |

> **Stop detection:** The backend uses `stops[0]` and `stops[last]` with a 20 m Haversine geofence to trigger `pre_departure -> in_service -> completed` transitions.

---

### `buses/{busId}`
**Written by:** Admin panel frontend.

| Field | Type | Description |
|---|---|---|
| `id` | `string` | Document ID, matches the hardware ID flashed on the ESP32 |
| `name` | `string` | Human-readable name (e.g. `"BRTS-101"`) |
| `assignedRoutes` | `string[]` | Array of `routeId`s this vehicle is permitted to run |

---

### `drivers/{driverId}`
**Written by:** Admin panel frontend.

| Field | Type | Description |
|---|---|---|
| `id` | `string` | Document ID, matches the driver's auth UID or custom ID |
| `name` | `string` | Full name of the driver |
| `assignedBusId` | `string | null` | The `busId` this driver is assigned to operate |

---

### `bus_locations/{busId}`
**Written by:** Backend socket gateway (`trackingGateway.ts`) on every location update.
**Purpose:** Persistent snapshot of the last known state. Survives server restarts and is used for **Trip State Recovery**.

| Field | Type | Description |
|---|---|---|
| `busId` | `string` | Hardware ID of the bus |
| `driverId` | `string` | ID of the driver currently operating the bus |
| `routeId` | `string?` | Primary route the bus is running |
| `routeIds` | `string[]?` | All route IDs associated with this bus |
| `lat` | `number` | Latest latitude (WGS84) |
| `lng` | `number` | Latest longitude (WGS84) |
| `heading` | `number` | Compass bearing in degrees (0 = North) |
| `speed` | `number` | Speed in km/h |
| `timestamp` | `number` | Unix millisecond timestamp from hardware |
| `deviceState` | `"online" | "offline"` | Whether the ESP32 is currently connected |
| `motionState` | `"moving" | "stopped" | "uncertain"` | Physical movement state (computed on hardware via hysteresis) |
| `tripState` | `"pre_departure" | "in_service" | "completed" | "maintenance"` | Trip lifecycle state (computed by backend geofencing) |
| `currentStopIndex` | `number?` | Index of the most recently passed stop in `routes.stops[]` |
| `delayMinutes` | `number?` | Delay in minutes (positive = late), reserved for future ETA diff |
| `lastSeen` | `string` | ISO 8601 timestamp of when the backend last wrote this document |

> **Recovery:** On `driver:start-tracking`, the backend reads this document. If `tripState` is `"in_service"` and `lastSeen` is within 2 hours, it resumes the trip instead of resetting to `pre_departure`.

---

### `passenger_requests/{requestId}`
**Written by:** Backend socket gateway on `passenger:request` event.

| Field | Type | Description |
|---|---|---|
| `requestId` | `string` | Auto-generated document ID |
| `passengerId` | `string` | UID of the passenger who made the request |
| `busId` | `string` | The target bus's hardware ID |
| `type` | `"pickup" | "dropoff"` | Type of request |
| `lat` | `number` | Passenger latitude at time of request |
| `lng` | `number` | Passenger longitude at time of request |
| `status` | `"pending" | "accepted" | "completed" | "cancelled"` | Current request status |
| `createdAt` | `number` | Unix millisecond timestamp of creation |

---

### `completed_trips/{autoId}`
**Written by:** Backend socket gateway when `tripState` transitions to `"completed"`.
**Purpose:** Route analytics. Read by the admin panel's "Route Analytics" section.

| Field | Type | Description |
|---|---|---|
| `busId` | `string` | Hardware ID of the bus that completed the route |
| `driverId` | `string` | Driver who operated the bus |
| `routeId` | `string | null` | The route that was completed |
| `completedAt` | `string` | ISO 8601 timestamp of route completion |
| `stopCount` | `number` | Total number of stops on the route |
| `stopNames` | `string[]` | Ordered list of stop names for display |

> **Future fields to add:** `durationMs`, `avgSpeedKmh`, `peakSpeedKmh`, `passengerRequestCount`

---

## Firebase Realtime Database (RTDB)

### `/activeBuses/{busId}_{routeId}`
**Written by:** ESP32 hardware directly (telemetry) AND the backend socket gateway (state fields).
**Read by:** Passenger frontend and Admin frontend via `onValue()` listeners.
**Removed by:** Backend on disconnect, `driver:stop-tracking`, or 30s after route `completed`.

The key is `{busId}_{routeId}` to allow a bus on multiple routes to appear on each route's map.

| Field | Written By | Type | Description |
|---|---|---|---|
| `busId` | Hardware + Backend | `string` | Hardware ID |
| `driverId` | Backend | `string` | Driver ID |
| `routeId` | Backend | `string` | Route this entry belongs to |
| `lat` | Hardware | `number` | Current latitude |
| `lng` | Hardware | `number` | Current longitude |
| `heading` | Hardware | `number` | Compass bearing (degrees, 0=N) |
| `speed` | Hardware | `number` | Speed in km/h |
| `satellites` | Hardware | `number?` | GNSS satellite count |
| `hdop` | Hardware | `number?` | Horizontal Dilution of Precision |
| `lowAccuracy` | Hardware | `boolean?` | `true` when HDOP > 2.5 |
| `timestamp` | Hardware | `number` | Server-injected Unix ms timestamp (`{".sv": "timestamp"}`) |
| `deviceState` | Hardware + Backend | `"online" | "offline"` | Online = ESP32 alive and transmitting |
| `motionState` | Hardware | `"moving" | "stopped" | "uncertain"` | Hysteresis: 8 km/h up / 5 km/h down, 3-reading gate |
| `tripState` | Backend | `"pre_departure" | "in_service" | "completed" | "maintenance"` | 20 m geofence against route stops |
| `currentStopIndex` | Backend | `number?` | Most recently passed stop index |
| `delayMinutes` | Backend | `number?` | ETA delay (reserved) |

---

## State Machine Reference

### `motionState` (computed on ESP32 hardware)
```
speed >= 8 km/h for 3 readings  ->  "moving"
speed <  5 km/h for 3 readings  ->  "stopped"
GPS fix lost                    ->  "uncertain"
Dead-band (5-8 km/h)            ->  hold current state
```

### `tripState` (computed by backend geofencing)
```
Bus connects (driver:start-tracking)    ->  "pre_departure"  (or recovered if within 2h)
Bus within 20m of stops[0]             ->  "in_service"
Bus within 20m of stops[last]          ->  "completed"  (then RTDB cleared after 30s)
motionState === "uncertain"            ->  "maintenance"
GPS fix returns (was maintenance)       ->  "in_service"
```

### `deviceState`
```
Hardware connected & transmitting  ->  "online"
Backend disconnect handler fires   ->  "offline"
driver:stop-tracking event         ->  "offline"
```

### Trip State Recovery (on mid-route power loss + reboot)
On `driver:start-tracking`, the backend queries `bus_locations/{busId}`:
1. If `tripState` was `"in_service"` or `"maintenance"` **and** `lastSeen` < 2 hours ago
   -> restore that `tripState` and `currentStopIndex` (bus reappears on map immediately)
2. Otherwise -> start fresh with `pre_departure`

---

## Access Control Summary

| Collection / Path | Read | Write |
|---|---|---|
| Firestore `routes` | Passenger + Admin frontend | Admin frontend |
| Firestore `buses` | Admin frontend | Admin frontend |
| Firestore `drivers` | Admin frontend | Admin frontend |
| Firestore `bus_locations` | Backend (recovery only) | Backend socket gateway |
| Firestore `passenger_requests` | Backend + Admin frontend | Backend socket gateway |
| Firestore `completed_trips` | Admin frontend | Backend socket gateway |
| RTDB `/activeBuses` | Frontend (authenticated, read-only) | Hardware (telemetry) + Backend (state fields) |

> **Rule:** The passenger frontend NEVER writes to Firebase. GPS coordinates are exclusively produced by the ESP32 hardware. The backend owns all state fields.

