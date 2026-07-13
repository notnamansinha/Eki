# Remove Leaflet → Google Maps (Zero-Budget Strategy)

This replaces all Leaflet/react-leaflet map components with the Google Maps JavaScript API using `@vis.gl/react-google-maps` (Google's official React wrapper). All map instances are architected for the free tier.

## Background

The project already has a `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` and `NEXT_PUBLIC_GOOGLE_MAP_ID` configured. All the Google-facing hooks (`useGoogleDirections`, `usePlacesAutocomplete`, `useGoogleMapsOptimizations`) are currently mocked out because Google Maps was previously removed. We are now reinserting it — properly this time, with zero external API calls beyond map tile rendering.

---

## Google Maps Free Tier Constraints (as of March 2025)

| SKU | Free Cap / month | Notes |
|---|---|---|
| Maps JavaScript API (Dynamic Maps) | 10,000 map loads | Each `<APIProvider>` + `<Map>` init = 1 load |
| Places Autocomplete | 0 free (was $200 credit) | **DO NOT USE** |
| Directions API | 0 free | **DO NOT USE** |
| Geocoding API | 0 free | **DO NOT USE** |

**Strategy: Only use the Maps JavaScript API for tile rendering.** All routing, ETAs, and geocoding are done client-side with our existing math in `mapUtils.ts` (Haversine) and stored polylines. No Directions API, no Places API, no Geocoding calls. This keeps the budget at **$0**.

---

## Proposed Changes

### 1. Package Changes

#### [MODIFY] [package.json](file:///c:/Users/Naman%20Sinha/Desktop/Eki/frontend/package.json)
- Remove: `leaflet`, `react-leaflet`
- Remove dev: `@types/leaflet`  
- Add: `@vis.gl/react-google-maps` (Google's official React wrapper, supports React 19)

---

### 2. Map Components (Core Migration)

All 5 Leaflet map components get rewritten to use `@vis.gl/react-google-maps`. The logic (RTDB subscriptions, ETA calculation, stop detection, animation) is preserved identically — only the renderer changes.

#### [MODIFY] [PassengerMap.tsx](file:///c:/Users/Naman%20Sinha/Desktop/Eki/frontend/src/components/maps/PassengerMap.tsx)
- Replace `<MapContainer>` + `<TileLayer>` + `<Marker>` + `<Polyline>` with `<APIProvider>` + `<Map>` + `<AdvancedMarker>` + `<Polyline>` from `@vis.gl/react-google-maps`
- Bus icons use `<AdvancedMarker>` with a custom React element (our existing arrow SVG) — eliminates `L.divIcon` entirely
- Stop markers use `<AdvancedMarker>` with inline `<div>` elements
- Passenger location dot uses an `<AdvancedMarker>` with a CSS pulsing div
- Route polylines drawn using `google.maps.Polyline` via a `useEffect` hook on `<Map>` ref
- Remove `leafletLoaded` state gating — no longer needed
- Remove all `import "leaflet/..."` and `L.` references

#### [MODIFY] [DriverMap.tsx](file:///c:/Users/Naman%20Sinha/Desktop/Eki/frontend/src/components/maps/DriverMap.tsx)
- Same pattern as PassengerMap: full Leaflet → Google Maps swap
- Driver bus position marker uses `<AdvancedMarker>` with heading-rotated SVG
- Stop markers rendered as `<AdvancedMarker>` elements
- `map.panTo` / `map.setZoom` equivalents via `useMap()` hook from `@vis.gl/react-google-maps`

#### [MODIFY] [RoutePlannerMap.tsx](file:///c:/Users/Naman%20Sinha/Desktop/Eki/frontend/src/components/maps/RoutePlannerMap.tsx)
- Same migration. `map.fitBounds()` handled via Google Maps `LatLngBounds` + `map.fitBounds`

#### [MODIFY] [FleetMapOverview.tsx](file:///c:/Users/Naman%20Sinha/Desktop/Eki/frontend/src/components/admin/FleetMapOverview.tsx)
- Same migration. Bus selection click is handled through `<AdvancedMarker>` `onClick`

#### [MODIFY] [LiveMap.tsx](file:///c:/Users/Naman%20Sinha/Desktop/Eki/frontend/src/components/passenger/LiveMap.tsx)
- Same migration. Map click handler uses `<Map onClick>` prop

#### [MODIFY] [GoogleLiveMap.tsx](file:///c:/Users/Naman%20Sinha/Desktop/Eki/frontend/src/components/passenger/GoogleLiveMap.tsx)
- This component was already misnamed (still using Leaflet internally). Migrate properly.

---

### 3. Provider Setup

#### [MODIFY] [layout.tsx](file:///c:/Users/Naman%20Sinha/Desktop/Eki/frontend/src/app/layout.tsx)
- Wrap app with `<APIProvider apiKey={...} mapId={...}>` so the Google Maps JS SDK is loaded exactly once for the entire app (single `<script>` tag = single map load credit per session)

> [!IMPORTANT]
> The `<APIProvider>` must live at the root layout level to be counted as a single map load per user session across all pages, not per map component. This is the critical cost-optimization point.

---

### 4. Cost Guardrails

#### [MODIFY] [next.config.ts](file:///c:/Users/Naman%20Sinha/Desktop/Eki/frontend/next.config.ts)
- No changes needed here specifically, but document the API key restriction advice

#### [NEW] `src/config/maps.ts`
- Central constant file with map configuration (center, default zoom, map ID)
- `GOOGLE_MAPS_LOAD_STRATEGY` comment documenting why we do NOT call Directions/Places/Geocoding APIs

---

### 5. Cleanup

#### [DELETE] Remove mock stubs that are now real or unused:
- `src/components/DirectionsRoute.tsx` — was a stub, delete
- `src/components/MapPolyline.tsx` — was a stub, delete

#### [MODIFY] [useGoogleDirections.ts](file:///c:/Users/Naman%20Sinha/Desktop/Eki/frontend/src/hooks/useGoogleDirections.ts)
- Stays mocked — we deliberately do NOT call the Directions API to stay free

#### [MODIFY] [usePlacesAutocomplete.ts](file:///c:/Users/Naman%20Sinha/Desktop/Eki/frontend/src/hooks/usePlacesAutocomplete.ts)
- Stays mocked — same reason

---

## API Usage Analysis (Why This Is Zero-Cost)

```
Each user session → 1 map load (APIProvider at layout root)
Free: 10,000 map loads/month

What we DO use:
✅ Maps JavaScript API (tile rendering only) → free tier

What we DO NOT use:
❌ Directions API → $0 saved (would be ~$5/1000 requests)
❌ Places API → $0 saved
❌ Geocoding API → $0 saved
❌ Distance Matrix API → $0 saved

All routing/ETA: pure client-side math (Haversine)
All route polylines: pre-encoded in Firestore, decoded client-side
All stop matching: step-forward algorithm in PassengerMap
```

---

## Verification Plan

### Build Verification
```bash
cd frontend && npm run build
```
- Confirm zero TypeScript errors
- Confirm `leaflet` and `react-leaflet` are not in the build output

### Manual Verification
1. Open passenger view → map loads with Google Maps tiles
2. Bus markers appear and rotate correctly based on heading
3. Route polyline is visible on the map  
4. Stop markers are rendered with correct labels
5. Admin fleet map shows live bus positions
6. Driver map shows current position and route
7. Route planner shows the selected route segment

### Package Audit
```bash
cd frontend && npm ls leaflet react-leaflet
```
- Confirm both are absent from the dependency tree
