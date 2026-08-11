/**
 * Google Maps configuration - zero-budget strategy.
 *
 * APIProvider is mounted once at the root, so a user session counts as one
 * map load. Routes and ETAs use stored geometry and local calculations;
 * Places is used only by the admin route editor.
 */

export const MAPS_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";
export const MAPS_MAP_ID = process.env.NEXT_PUBLIC_GOOGLE_MAP_ID ?? "";

/** Ahmedabad city center - the single fallback map center. */
export const DEFAULT_CENTER = { lat: 23.0347, lng: 72.5483 } as const;

/** Map styling: dark basemap matching the app's dark theme. */
export const MAP_OPTIONS = {
  disableDefaultUI: true,
  gestureHandling: "greedy" as const,
  backgroundColor: "#1a1a2e",
} as const;
