"use client";

/**
 * Root providers — intentionally lean.
 *
 * Google Maps APIProvider has been moved to MapProviders.tsx and is only
 * mounted by pages that actually render a map (passenger, driver,
 * route-planner). This keeps the Maps JS SDK out of the root bundle and
 * off the landing page, reducing TTI for unauthenticated visitors.
 */
export default function Providers({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
