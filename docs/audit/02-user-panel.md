# Phase 2: User Panel Inventory

## Screens & Content

### 1. Home View (`/passenger`)
**Content:**
- **Heading**: "Live Routes"
- **Label**: "Select a route to view schedules."
- **Empty States**:
  - "No buses running" / "Service starts at {PASSENGER_BUS_START_TIME}"
  - "No live routes right now" / "Routes will appear here once a bus is active."
- **Route Carousel Item** (For each active route):
  - **Route Name**: e.g., "Downtown Express" (Source: Firestore `routes > name`)
  - **Terminals**: "{Start Stop Name} -> {End Stop Name}" (Source: Firestore `routes > stops[0].name` and `stops[n-1].name`)
  - **Live Indicator**: "LIVE" (Shown if active buses > 0)
  - **Stops Count**: "{N} stops" (Source: Firestore `routes > stops.length`)
  - **Schedule**: "Scheduled: {time}" (⚠️ **Hardcoded/Fake**: Calculated dynamically as `Date.now() + duration`)
  - **Button**: "TRACK ROUTE →"

### 2. Tracking View (`/passenger` - map active)
**Content:**
- **Top Bar**:
  - **Button**: Back Arrow (returns to Home)
  - **Label**: "Live"
  - **Route Name**: e.g., "Downtown Express" (Source: Firestore `routes > name`)
- **Map (`RouteNodeList`)**:
  - **Bus Marker**: Placed at live lat/lng. Color reflects motion state (Emerald = moving, Amber = stopped, Red = uncertain).
  - **Stop Markers**: Placed at stop coordinates.
- **Messaging FAB**:
  - **Icon**: Radio/Live icon.
  - **Badge**: Unread count number (Source: RTDB `messages > busId`).
- **Next Bus Card (`NextBusCard`)**:
  - **Heading**: "Next Bus"
  - **Route Name**: e.g., "Downtown Express"
  - **Target Stop**: e.g., "Main St" (Source: Firestore `routes > stops > name`)
  - **ETA**: "{N} min" (Source: Calculated client-side using Haversine distance to target stop / bus speed, + RTDB `delayMinutes`, OR fallback to RTDB `stopETAs`)
  - **Status**: e.g., "Moving", "Stopped at traffic" (Derived from RTDB `motionState`)
- **Signal Lost Banner**:
  - **Label**: "GPS Signal Lost" / "Last updated {N} mins ago" (Shown if RTDB `timestamp` > 90s old)
- **Route Ended State**:
  - **Heading**: "Route ended"
  - **Label**: "The bus has reached the terminus." / "Waiting for next bus"

### 3. Profile View (`AccountTab`)
**Content:**
- **Heading**: "Profile"
- **Label**: "Anonymous Rider" (⚠️ **Hardcoded**)
- **Label**: "Account details are hidden in demo mode." (⚠️ **Hardcoded**)

### 4. Bottom Navigation Bar
- **Tab 1**: "Routes" (Icon: Map)
- **Tab 2**: "Profile" (Icon: User)

## Interactions
- **Navigation**: Tap route in carousel to enter Tracking View. Tap Back arrow to return. Bottom nav switches between Routes and Profile.
- **Map Interaction**: Free pan/zoom. Selecting a stop updates the `NextBusCard` target and ETA.
- **Refresh Cadence**: Real-time push via Firebase RTDB `onValue` listener on `activeBuses`. No polling.
- **Stale Data Handling**:
  - > 90 seconds since last update: Shows "Signal Lost" banner.
  - > 5 minutes since last update: Bus is silently removed from the map and active lists.

## Field / Capability Mapping

| Field | Firebase path | Where shown | Admin-editable today? |
|---|---|---|---|
| Route Name | Firestore: `routes/{id}/name` | Home, Tracking Top Bar, NextBusCard | |
| Route Stops | Firestore: `routes/{id}/stops` | Home, Tracking Map | |
| Route Polyline | Firestore: `routes/{id}/polyline` | Tracking Map | |
| Bus Lat/Lng | RTDB: `activeBuses/{id}/lat`, `lng` | Tracking Map (Marker) | |
| Bus Motion State | RTDB: `activeBuses/{id}/motionState`| Tracking Map (Color), NextBusCard | |
| Bus Speed | RTDB: `activeBuses/{id}/speed` | Tracking Map (ETA calc) | |
| Bus Delay | RTDB: `activeBuses/{id}/delayMinutes` | NextBusCard (ETA calc) | |
| Service Start Time| App Config: `PASSENGER_BUS_START_TIME`| Home (Empty State) | |
| Schedule Time | None (Fake client logic) | Home (Route Carousel) | |
