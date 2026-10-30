/**
 * Google Maps configuration.
 *
 * Google bills one Dynamic Maps load each time a google.maps.Map is
 * constructed. Every <GoogleMap> sets `reuseMaps` and uses
 * `mapId={MAPS_MAP_ID}` with MAP_OPTIONS, so all maps share one @vis.gl cache
 * key: a remount (passenger route/direction/bus change, leaving and reopening
 * tracking, admin tab or route-editor switches) reattaches the cached instance
 * instead of creating a new load. A full page load, new tab or PWA relaunch
 * still constructs one map. Keep per-map options inside MAP_OPTIONS (or pass
 * them as props on every mount): a reused instance keeps options that a later
 * mount does not set again. Do not mount two maps at once unless two loads are
 * acceptable. Routes and ETAs use stored geometry and local calculations;
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
