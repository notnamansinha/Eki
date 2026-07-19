# Phase 4: Driver Panel (Reference Only)

## Overview
The Driver Panel (`/driver`) serves as an internal testing tool that simulates a hardware GNSS transmitter and manages the driver's active shift/route assignment. It will eventually be deprecated for production, but its manual override/simulation capabilities must be absorbed by the Admin Panel.

## Features & Firebase Writes

### 1. Shift & Route Assignment
- **Inputs**: Driver selects their own Driver ID, Vehicle (Bus ID), and Route(s).
- **Behavior**: Clicking "Start Tracking" writes the initial bus state to RTDB.

### 2. Live Telemetry Simulation (Transmitter Controls)
- **Firebase Path**: RTDB `activeBuses/{busId}_{routeId}`
- **Fields Written (on start or via heartbeat)**:
  - `driverId`: string (from local storage / selection)
  - `status`: "active"
  - `deviceState`: "online"
  - `tripState`: "in_service"
  - `timestamp`: Date.now() (sent every 60s as a heartbeat)
  - `lat`, `lng`: numbers (defaults to first stop of route if simulating, or updated via simulated drive)
  - `speed`: 25 (simulated)
  - `heading`: 0
  - `currentStopIndex`: number (manually controllable via UI)
  - `delayMinutes`: number (manually controllable via UI)
  - `routeId`: string

### 3. End Shift
- **Behavior**: Clicking "Stop Tracking" marks the bus offline.
- **Firebase Writes**: 
  - RTDB `activeBuses/{busId}_{routeId}`: updates `status: "offline"`, `deviceState: "offline"`, `tripState: "ended"`, `driverId: "hw_device"` (handing control back to hardware).
  - RTDB `messages/{busId}`: deletes the entire message thread for that bus.

## Unique Capabilities to Preserve for Admin
- **Manual Location Override**: Ability to manually set lat/lng/speed without hardware.
- **Trip State Override**: Ability to force a bus online/offline or mark it as "ended".
- **Schedule Override**: Ability to manually advance the `currentStopIndex` and inject `delayMinutes`.
- **Message Wiping**: Ability to clear a bus's message queue when a shift ends.
