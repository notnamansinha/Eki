# BusTrack Backend API Reference

This document outlines the REST API endpoints and Socket.io events exposed by the Node.js/Express backend.

## REST Endpoints

All REST endpoints (except `/health`) require an `Authorization: Bearer <Firebase_ID_Token>` header unless specified otherwise.

| Method | Path | Auth Required | Description |
|---|---|---|---|
| GET | `/health` | None | Server health and Firebase connection status check. |
| GET | `/api/buses` | Firebase Token | Returns a list of all active buses currently streaming location data. |
| GET | `/api/buses/:busId` | Firebase Token | Returns the current state and metadata of a specific bus. |
| PATCH | `/api/buses/:busId` | Admin Token | Overrides bus status (e.g., forcing a bus offline). |
| GET | `/api/analytics/fleet` | Admin Token | Returns aggregated fleet statistics (active vs idle buses, total trips). |
| POST | `/api/requests` | Firebase Token | Creates a new passenger pickup/dropoff request. |
| GET | `/api/requests` | Admin Token | Lists all active passenger requests in the system. |
| PATCH | `/api/requests/:id` | Admin Token | Updates a request status (e.g., completed, ignored). |
| DELETE | `/api/requests/:id` | Admin Token | Cancels a request. |
| POST | `/api/routes/compute-polyline` | Admin Secret | Re-bakes a route polyline utilizing the Google Maps Routes API v2. Requires `ADMIN_API_SECRET`. |

## Socket.io Gateway

The WebSocket gateway runs on the same port as the REST API. Clients must pass their Firebase ID Token during connection handshakes.

### Authentication Handshake (Client)
```javascript
const socket = io(process.env.NEXT_PUBLIC_SOCKET_URL, {
  auth: {
    token: "firebase-id-token"
  }
});
```

### Events (Client -> Server)

| Event Name | Payload Structure | Description |
|---|---|---|
| `driver:start-tracking` | `{ busId: string, driverId: string, routeId?: string }` | Initializes a shift and marks the bus as active. |
| `driver:location-update` | `{ busId: string, driverId: string, lat: number, lng: number, heading: number, speed: number, timestamp: number }` | Sends raw GPS data (deprecated in favor of ESP32 hardware streaming). |
| `driver:route-update` | `{ busId: string, routeId: string }` | Changes the assigned route for an active bus. |
| `driver:stop-tracking` | `{ busId: string }` | Terminates a shift and marks the bus as offline. |
| `passenger:join` | None | Subscribes the client to the global live updates feed. |
| `passenger:request` | `{ passengerId: string, busId: string, type: string, lat: number, lng: number }` | Emits a real-time request to a specific driver. |
| `admin:join` | None | Subscribes the client to the elevated admin monitoring feed. |

### Events (Server -> Client)

| Event Name | Payload Structure | Target Audience |
|---|---|---|
| `bus:location-update` | `BusLocation` object | Broadcasted to `passengers`, `admin`, and specific `bus:<id>` rooms. |
| `error` | `{ message: string }` | Emitted to the offending socket upon validation failure. |
