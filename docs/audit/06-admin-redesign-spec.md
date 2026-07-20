# Phase 6: Admin Panel Redesign Spec

## Design System
- **Palette**:
  - Backgrounds: `bg-brand-dark` (Slate 950, #020617) for root, `bg-brand-surface` (Slate 900, #0f172a) for cards/panels.
  - Primary Action: `bg-brand-accent` (Blue 500, #3b82f6) for primary buttons.
  - Destructive: Red 500 (#ef4444) for delete actions.
  - Status Indicators: Emerald 400 (Moving/Online), Amber 400 (Stopped/Delayed), Red 400 (Offline/Error).
- **Typography**: 
  - Switch from purely stylized `uppercase tracking-widest` to readable Sentence Case for data rows. Keep uppercase tracking for headers/tabs to retain brand feel.
  - Type Scale: xs (12px), sm (14px), base (16px), lg (18px), xl (20px), 2xl (24px).
- **Interactions**:
  - Hover states: Lighten surface backgrounds (`hover:bg-slate-800`).
  - Active states: `active:scale-95` on primary buttons.
  - Always pair icons with text labels (no icon-only buttons for accessibility).
- **Accessibility**: 
  - Ensure minimum 4.5:1 contrast ratio for text.
  - Statuses must have text labels in addition to colored dots.

## Information Architecture (IA)
The admin panel will use a persistent Left Sidebar (desktop) / Bottom Tab Bar (mobile) with the following sections:

1. **Dashboard (Live Monitoring)**
   - Combined Map + Fleet List.
   - Shows active buses, routes, and live traffic.
   - Allows quick-action overrides (e.g., force offline, inject delay).
2. **Routes**
   - List of all routes.
   - Full CRUD (Create, Edit, Delete).
3. **Fleet & Devices**
   - List of buses and attached hardware devices.
   - CRUD for physical buses.
4. **Personnel**
   - List of drivers.
   - Assign drivers to buses.
5. **Settings**
   - Global app settings (e.g., Service Start Time, Announcements).

## Screen-by-Screen Breakdown

### 1. Dashboard (`/admin/dashboard`)
- **Map View**: Full-width map displaying all active buses and their assigned routes. Clicking a bus opens a quick-edit sheet.
- **Sidebar List**: List of active buses with status.
- **Overrides**: "Simulate Telemetry" button (absorbs Driver Panel functionality). Allows admin to manually update lat/lng, speed, and delay.

### 2. Routes Management (`/admin/routes`)
- **List View**: Searchable list of routes.
- **Edit/Create View**: 
  - Editable "Route Name".
  - Draggable/Reorderable "Stops" list.
  - Re-bakes polyline automatically when stops change.

### 3. Fleet & Devices (`/admin/fleet`)
- **List View**: Searchable list of buses.
- **CRUD Form**: ID, License Plate, Capacity.

### 4. Personnel (`/admin/personnel`)
- **List View**: Searchable list of drivers.
- **CRUD Form**: Name, Phone, Assigned Bus. Validates that a bus is not assigned twice.

### 5. Settings (`/admin/settings`)
- **Form**: 
  - Service Start Time (Time picker).
  - Global Announcement Banner (Text field, active toggle).

## Proposed Firebase Schema Changes

To support the gap analysis, the following schema migrations are proposed:

1. **New Collection**: `settings`
   - Document: `global`
   - Fields: `serviceStartTime` (string), `globalAnnouncement` (string), `announcementActive` (boolean).
   - *Reason*: To remove hardcoded values from the frontend codebase.

2. **No changes required to `routes`, `buses`, or `drivers`** — we will just build the missing Edit functionality on top of the existing schema.
