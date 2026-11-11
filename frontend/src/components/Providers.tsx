"use client";

import { AuthProvider } from "@/hooks/useAuth";
import TelemetryTraceControls from "@/components/TelemetryTraceControls";

/**
 * Root providers — intentionally lean.
 *
 * Google Maps APIProvider has been moved to MapProviders.tsx and is only
 * mounted by pages that actually render a map (passenger and admin
 * route-planner). This keeps the Maps JS SDK out of the root bundle and
 * off the landing page, reducing TTI for unauthenticated visitors.
 *
 * Authentication loads lazily inside useAuth: right away on the workspaces,
 * on first interaction on the signed-out landing page, and only on demand on
 * other public pages (see lib/authLoadPolicy.ts).
 */
export default function Providers({ children }: { children: React.ReactNode }) {
  return <AuthProvider>{children}<TelemetryTraceControls /></AuthProvider>;
}
