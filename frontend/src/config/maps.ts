/**
 * Google Maps configuration — Zero-Budget Strategy
 *
 * We ONLY use the Maps JavaScript API (tile rendering).
 * Free tier: 10,000 map loads / month (as of March 2025 pricing).
 *
 * APIProvider is mounted once at the root (Providers.tsx), so the entire
 * user session counts as a SINGLE map load, regardless of how many
 * map views are opened.
 *
 * ─── API USAGE ──────────────────────────────────────────────────────────
 * ✅ Maps JavaScript API — tile rendering (free tier: 10k loads/month)
 * ✅ Places API          — admin route editor autocomplete only (not passenger-facing)
 * ❌ Directions API      — all routing uses stored polylines + Haversine math
 * ❌ Geocoding API       — no lat/lng ↔ address conversion
 * ❌ Distance Matrix     — ETAs computed client-side from GPS + speed
 * ──────────────────────────────────────────────────────────────────────────
 */

export const MAPS_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";
export const MAPS_MAP_ID  = process.env.NEXT_PUBLIC_GOOGLE_MAP_ID ?? "";

/** Ahmedabad city center — default map center */
export const DEFAULT_CENTER = { lat: 23.0347, lng: 72.5483 } as const;
export const DEFAULT_ZOOM = 14;

/** Map styling: dark basemap matching the app's dark theme */
export const MAP_OPTIONS = {
  disableDefaultUI: true,
  gestureHandling: "greedy" as const,
  backgroundColor: "#1a1a2e",
} as const;
