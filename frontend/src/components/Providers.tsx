iles if"use client";

import { useAutoUpdate } from "@/hooks/useAutoUpdate";

/**
 * Root providers — intentionally lean.
 *
 * Google Maps APIProvider has been moved to MapProviders.tsx and is only
 * mounted by pages that actually render a map (passenger, driver,
 * route-planner). This keeps the Maps JS SDK out of the root bundle and
 * off the landing page, reducing TTI for unauthenticated visitors.
 */
export default function Providers({ children }: { children: React.ReactNode }) {
  // Mount the global auto-update polling hook here
  // so it is active across all surfaces (passenger, admin, driver)
  useAutoUpdate();

  return <>{children}</>;
}
