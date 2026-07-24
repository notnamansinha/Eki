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
 * One APIProvider per layout ensures the SDK is still loaded only once
 * per session for map-heavy pages (passenger, driver, route-planner share
 * the same SDK instance via the React context tree).
 */
export default function MapProviders({ children }: { children: React.ReactNode }) {
  return (
    <APIProvider apiKey={MAPS_API_KEY} libraries={["places"]}>
      {children}
    </APIProvider>
  );
}
