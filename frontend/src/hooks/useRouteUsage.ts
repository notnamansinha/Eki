/**
 * useRouteUsage — Firestore `settings/routeUsage` listener.
 *
 * Completed-ride counts per route, recomputed hourly by the backend leader
 * from `completed_trips`, which passengers cannot read themselves. Only used
 * to order the Routes tab, so a read failure is reported but never blocks it.
 */
import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebaseFirestore";
import { getAuthVerificationGeneration, waitForAuth } from "@/lib/authState";
import { EMPTY_ROUTE_USAGE, normalizeRouteUsage, type RouteUsage } from "@/lib/passengerRouteSchedule";
import { useAuth } from "./useAuth";

interface UsageState {
  scope: string | null;
  usage: RouteUsage;
  loaded: boolean;
  error: string | null;
}

export function useRouteUsage(): { usage: RouteUsage; loading: boolean; error: string | null } {
  const { user, loading: authLoading } = useAuth();
  const authGeneration = getAuthVerificationGeneration();
  const scope = user?.role && !authLoading ? `${user.uid}:${user.role}:${authGeneration}` : null;
  const [state, setState] = useState<UsageState>({ scope: null, usage: EMPTY_ROUTE_USAGE, loaded: false, error: null });

  useEffect(() => {
    if (!scope) return;
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;
    void waitForAuth().then(() => {
      if (cancelled || getAuthVerificationGeneration() !== authGeneration) return;
      unsubscribe = onSnapshot(
        doc(db, "settings", "routeUsage"),
        snap => {
          if (cancelled) return;
          setState({ scope, usage: snap.exists() ? normalizeRouteUsage(snap.data()) : EMPTY_ROUTE_USAGE, loaded: true, error: null });
        },
        (err: unknown) => {
          if (cancelled) return;
          if ((err as { code?: unknown }).code !== "permission-denied") {
            console.warn("[RouteUsage] Firestore read failed:", (err as { message?: unknown }).message);
          }
          setState({ scope, usage: EMPTY_ROUTE_USAGE, loaded: true, error: "Route usage could not be loaded." });
        },
      );
    });
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [scope, authGeneration]);

  const current = state.scope === scope;
  return {
    usage: current ? state.usage : EMPTY_ROUTE_USAGE,
    loading: scope ? !current || !state.loaded : authLoading,
    error: current ? state.error : null,
  };
}
