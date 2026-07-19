# Phase 5: Gap Analysis

## Field / Capability Mapping

| Field | Firebase path | Where shown | Admin-editable today? | Required feature? |
|---|---|---|---|---|
| Route Name | Firestore: `routes/{id}/name` | Home, Tracking Top Bar, NextBusCard | **No** (Create/Delete only) | Yes (Edit Route) |
| Route Stops | Firestore: `routes/{id}/stops` | Home, Tracking Map | **No** (Create/Delete only) | Yes (Edit Stops) |
| Route Polyline | Firestore: `routes/{id}/polyline` | Tracking Map | **No** (Bakes on create) | Yes (Rebake on edit) |
| Bus Lat/Lng | RTDB: `activeBuses/{id}/lat`, `lng` | Tracking Map | **No** (Driver Panel only) | Yes (Simulated Override) |
| Bus Motion State | RTDB: `activeBuses/{id}/motionState`| Tracking Map, NextBusCard | **No** (Driver Panel only) | Yes (Simulated Override) |
| Bus Speed | RTDB: `activeBuses/{id}/speed` | Tracking Map (ETA calc) | **No** (Driver Panel only) | Yes (Simulated Override) |
| Bus Delay | RTDB: `activeBuses/{id}/delayMinutes`| NextBusCard (ETA calc) | **No** (Driver Panel only) | Yes (Manual Delay Injection) |
| Service Start Time| App Config: `PASSENGER_BUS_START_TIME`| Home (Empty State) | **No** (Hardcoded in codebase) | Yes (Global Settings) |
| Schedule Time | None (Fake logic) | Home (Carousel) | **No** (Fake UI logic) | Yes (Real Schedules) |

## Standard Admin Capabilities Check
- **Bus CRUD**: ✅ Partial (Create, Delete, basic Edit exists).
- **Route CRUD**: ❌ Incomplete (Create and Delete exist, but no Edit).
- **Stop CRUD**: ❌ Missing (Stops are embedded in routes, no central Stop Library).
- **Driver/Staff Assignment**: ✅ Partial (Can assign bus to driver in Personnel tab).
- **Schedule Management**: ❌ Missing (Fake schedule times in passenger app).
- **Bulk Edit**: ❌ Missing.
- **Service Announcements**: ❌ Missing (No global alerts for passengers).
- **Offline/Maintenance Toggle**: ❌ Missing for admin (Only driver panel can end shift).
- **Change Audit Log**: ❌ Missing.
- **Search/Filter**: ❌ Missing (Lists are unpaginated and unfilterable).
- **Basic Analytics**: ✅ Partial (Shows recent 10 completed trips, but no uptime/ridership stats).

## Prioritized Feature List

### Must-Have
1. **Full Route Edit**: Ability to rename a route and add/remove/reorder stops without deleting and recreating it.
2. **Live Telemetry Overrides**: Admin ability to manually update bus location, set delays, force trip state (offline/maintenance), absorbing the Driver Panel's capabilities.
3. **Global Settings**: Move hardcoded values like `PASSENGER_BUS_START_TIME` to a Firestore settings document.
4. **Driver/Bus Assignment Validation**: Ensure a bus can't be assigned to multiple active drivers simultaneously.

### Nice-to-Have
1. **Schedule Management System**: Define real timetables for routes instead of faking them on the client.
2. **Global Announcements**: A messaging/banner system to push alerts to the passenger app (e.g., "Heavy traffic downtown").
3. **Search & Filter**: Add search bars to the Route, Bus, and Personnel lists.
4. **Stop Library**: Abstract stops into their own collection so multiple routes can share the same physical stop and name.
