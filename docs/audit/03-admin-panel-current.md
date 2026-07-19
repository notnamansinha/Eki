# Phase 3: Admin Panel Current State

## Screens & Routes
The admin panel exists at `/admin` and operates entirely within a single page with client-side tabs.

### 1. Routes Tab (`RouteManagementPanel`)
- **Purpose**: Manage bus routes and their stop sequences.
- **Features / CRUD**:
  - **List Routes**: Reads from Firestore `routes` collection.
  - **Create Route**: 
    - Form fields: Route ID, Display Name.
    - Map Interface: Allows searching for places via OSM Nominatim and clicking to add stops.
    - *Action (Deploy)*: POSTs to Backend `/api/routes/compute-polyline` to bake the route geometry, then writes the result to Firestore `routes/{id}`.
  - **Delete Route**: Deletes document from Firestore `routes/{id}`.
- **Broken/Stubbed**: 
  - Fails if the user is not authenticated, but the UI itself doesn't provide a login screen. It assumes the user is already authenticated via Firebase.
  - Deleting a route does not cascade to active buses on that route.

### 2. Fleet Tab (`FleetManagementPanel`, mode="fleet")
- **Purpose**: Manage physical buses and view live operations.
- **Features / CRUD**:
  - **List Buses**: Reads from Firestore `buses`.
  - **Create Bus**: Adds to Firestore `buses` (ID, license plate, capacity).
  - **Edit/Delete Bus**: Modifies/deletes from Firestore `buses`.
  - **Live Monitoring**: Subscribes to RTDB `activeBuses`. Displays a list of active buses with expandable cards showing status (tripState, motionState, speed, delay, coordinates).
  - **Completed Trips Analytics**: Reads from Firestore `completed_trips` (last 10 trips).
- **Broken/Stubbed**:
  - The map for fleet tracking is absent here (the live data is just a text list).

### 3. Personnel Tab (`FleetManagementPanel`, mode="personnel")
- **Purpose**: Manage drivers.
- **Features / CRUD**:
  - **List Drivers**: Reads from Firestore `drivers`.
  - **Create Driver**: Adds to Firestore `drivers` (ID, name, phone, assigned bus ID).
  - **Delete Driver**: Removes from Firestore `drivers`.

## Auth & Permission Model
- **Frontend**: The `/admin` page has no native login form or gate. However, operations like "Deploy Route" dynamically import `firebase/auth` and grab `auth.currentUser`. If null, it throws an error. 
- **Backend**: Protected endpoints (like `/api/routes/compute-polyline`) use a `requireAdmin` middleware which validates the Firebase ID token and checks if the decoded token has an `admin` custom claim.

## Design System
- **Framework**: Tailwind CSS.
- **Visuals**: Dark mode primary. Heavy use of `bg-brand-dark` and `bg-brand-surface` (custom colors).
- **Typography**: Uses `font-black uppercase tracking-widest` for tabs and buttons (highly stylized, almost brutalist).
- **Icons**: Lucide-react.
- **Alerts**: Inline banners used for errors (e.g., polyline bake failure).
