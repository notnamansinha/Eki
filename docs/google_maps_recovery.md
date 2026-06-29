# Google Maps Recovery Instructions

This document provides instructions for a future AI Agent on how to restore the
Google Maps API implementation that was temporarily replaced by Leaflet to
save costs.

## 1. Revert Package Dependencies

To switch back, you will need to uninstall Leaflet packages and reinstall the
`@vis.gl/react-google-maps` package:

```bash
npm uninstall leaflet react-leaflet @types/leaflet
npm install @vis.gl/react-google-maps
```

## 2. Restore Global Providers

In `src/components/Providers.tsx`, restore the `APIProvider`:

```tsx
"use client";

import { APIProvider } from "@vis.gl/react-google-maps";

// Note: Extract libraries array outside component to prevent re-renders
const LIBRARIES = ["geometry", "marker"] as const;

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <APIProvider
      apiKey={process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY as string}
      libraries={LIBRARIES}
    >
      {children}
    </APIProvider>
  );
}
```

## 3. Restore Map Components

The following files were migrated from Google Maps (`<GoogleMap>` / `<Map>`) to
Leaflet (`<MapContainer>`). You should revert them to use
`@vis.gl/react-google-maps`.

### A. `src/components/passenger/GoogleLiveMap.tsx`

**Key missing features to restore:**

- `window.google.maps.TrafficLayer()`: Restores visual traffic density layer.
- `window.google.maps.DirectionsRenderer()`: Re-enable native rendering of
  real-time route snapping using `cachedDirections` and `etaInfo` from
  `useThrottledDirections(driverLocation, destination)`.

### B. `src/components/passenger/LiveMap.tsx`

- Revert `MapContainer` back to `<Map disableDefaultUI={true} mapId="...">`.
- Restore the `DirectionsRoute` component usage.
- Re-enable `<AdvancedMarker>` instead of Leaflet's `<Marker>`.

### C. `src/components/driver/DriverNavMap.tsx`

**Key missing features to restore:**

- Native Google Directions API mapping using `DirectionsRoute`.
- Driver assigned route polyline auto-snapping.
- `DirectionsPanel` which requires a real `google.maps.DirectionsResult`
  object (currently mocked or passed null).
- Restore the `Recenter` component that leverages the Google map instance hook
  (`useMap()`) for panning.

### D. `src/components/DirectionsRoute.tsx`

- Restore the `DirectionsService` usage:

```tsx
const directionsService = new google.maps.DirectionsService();
directionsService.route({
  origin: waypoints[0],
  destination: waypoints[waypoints.length - 1],
  waypoints: waypoints.slice(1, -1).map(w => ({ location: w })),
  travelMode: google.maps.TravelMode.DRIVING
}, (result, status) => {
  if (status === "OK") { ... }
});
```

### E. Other Map Components

Revert the following files back to use `<Map>` from `@vis.gl/react-google-maps`:

- `src/components/maps/DriverMap.tsx`
- `src/components/maps/PassengerMap.tsx`
- `src/components/maps/RoutePlannerMap.tsx`
- `src/components/admin/FleetMapOverview.tsx`

## Notes for the AI Agent

When restoring, be sure that `process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY` is fully
configured and verify that there are no remaining `@types/leaflet` imports or
`<MapContainer>` implementations across the workspace. Ensure that marker
components gracefully switch from `L.divIcon` HTML elements back to native
DOM nodes inside `<AdvancedMarker>`.
