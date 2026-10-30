/**
 * usePassengerRouteConfig — Firestore `settings/passengerRoutes` listener.
 *
 * Holds the admin-approved passenger routes and their per-stop times. Reads
 * are direct (any signed-in user, like `settings/global`); saves go through
 * the admin-only backend endpoint, which validates against the route docs.
 */
import { useCallback, useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebaseFirestore";
import { auth } from "@/lib/firebaseAuth";
import { getAuthVerificationGeneration, waitForAuth } from "@/lib/authState";
import { apiRequest } from "@/lib/apiClient";
import {
  EMPTY_PASSENGER_ROUTE_CONFIG,
  normalizePassengerRouteConfig,
  type PassengerRouteConfig,
} from "@/lib/passengerRouteSchedule";
import { useAuth } from "./useAuth";

interface ConfigState {
  scope: string | null;
  config: PassengerRouteConfig;
  loaded: boolean;
  error: string | null;
}

export function usePassengerRouteConfig(): {
  config: PassengerRouteConfig;
  loading: boolean;
  /** Set when the stored configuration could not be read. */
  error: string | null;
  saveConfig: (config: PassengerRouteConfig) => Promise<void>;
} {
  const { user, loading: authLoading } = useAuth();
  const authGeneration = getAuthVerificationGeneration();
  const scope = user?.role && !authLoading ? `${user.uid}:${user.role}:${authGeneration}` : null;
  const [state, setState] = useState<ConfigState>({ scope: null, config: EMPTY_PASSENGER_ROUTE_CONFIG, loaded: false, error: null });

  useEffect(() => {
    if (!scope) return;
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;
    void waitForAuth().then(() => {
      if (cancelled || getAuthVerificationGeneration() !== authGeneration) return;
      unsubscribe = onSnapshot(
        doc(db, "settings", "passengerRoutes"),
        (snap) => {
          if (cancelled) return;
          setState({
            scope,
            config: snap.exists() ? normalizePassengerRouteConfig(snap.data()) : EMPTY_PASSENGER_ROUTE_CONFIG,
            loaded: true,
            error: null,
          });
        },
        (err: unknown) => {
          if (cancelled) return;
          const code = (err as { code?: unknown }).code;
          if (code !== "permission-denied") console.warn("[PassengerRoutes] Firestore read failed:", (err as { message?: unknown }).message);
          setState({ scope, config: EMPTY_PASSENGER_ROUTE_CONFIG, loaded: true, error: "Route schedules could not be loaded." });
        },
      );
    });
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [scope, authGeneration]);

  const uid = user?.uid;
  const role = user?.role;
  const saveConfig = useCallback(async (config: PassengerRouteConfig) => {
    if (!scope || role !== "admin" || !uid || auth.currentUser?.uid !== uid) throw new Error("Admin authentication required.");
    await waitForAuth();
    if (getAuthVerificationGeneration() !== authGeneration || auth.currentUser?.uid !== uid) throw new Error("Authentication changed. Try again.");
    const token = await auth.currentUser?.getIdToken();
    if (!token) throw new Error("Authentication required.");
    const result = await apiRequest<{ saved?: boolean }>("/api/v2/settings/passenger-routes", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ routes: config.routes }),
      fallbackError: "Unable to save passenger routes.",
    });
    if (result?.saved !== true) throw new Error("Passenger routes acknowledgement is missing.");
  }, [scope, role, uid, authGeneration]);

  const current = state.scope === scope;
  return {
    config: current ? state.config : EMPTY_PASSENGER_ROUTE_CONFIG,
    loading: scope ? !current || !state.loaded : authLoading,
    error: current ? state.error : null,
    saveConfig,
  };
}
