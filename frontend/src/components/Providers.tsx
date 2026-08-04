"use client";

import { AuthProvider } from "@/hooks/useAuth";

/**
 * Root providers — intentionally lean.
 *
 * Google Maps APIProvider has been moved to MapProviders.tsx and is only
 * mounted by pages that actually render a map (passenger, driver,
 * route-planner). This keeps the Maps JS SDK out of the root bundle and
 * off the landing page, reducing TTI for unauthenticated visitors.
 *
 * Firebase AppCheck is initialised lazily inside useAuth (post first-paint)
 * rather than here as a side-effect import, so it no longer blocks LCP.
 */
export default function Providers({ children }: { children: React.ReactNode }) {
  return <AuthProvider>{children}</AuthProvider>;
}
