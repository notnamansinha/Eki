"use client";

import { APIProvider } from "@vis.gl/react-google-maps";
import { MAPS_API_KEY } from "@/config/maps";

/**
 * MapProviders — wraps only the pages that actually render a map.
 *
 * By NOT mounting APIProvider in the root layout, the Google Maps JS SDK
 * (~220KB parsed + evaluated) is excluded from the landing page, feedback
 * page, and any other map-free route. This reduces TTI on those pages.
 *
 * Mounted by the admin layout and by each passenger tracking view. Remounting
 * it does not reload the SDK (the @vis.gl loader is module-global, so the
 * script loads once per page). Map loads are governed by `reuseMaps` on each
 * <GoogleMap>; see config/maps.ts.
 */
export default function MapProviders({ children }: { children: React.ReactNode }) {
  return (
    <APIProvider apiKey={MAPS_API_KEY}>
      {children}
    </APIProvider>
  );
}
