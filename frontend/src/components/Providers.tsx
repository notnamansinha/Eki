"use client";

import { APIProvider } from "@vis.gl/react-google-maps";
import { MAPS_API_KEY, MAPS_MAP_ID } from "@/config/maps";

/**
 * Root provider — APIProvider is intentionally mounted here so the Maps JS SDK
 * is loaded ONCE per user session (= 1 billable map load), regardless of how
 * many map components render during navigation.
 */
export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <APIProvider apiKey={MAPS_API_KEY}>
      {children}
    </APIProvider>
  );
}
