"use client";

import { createContext, ReactNode, useContext, useEffect, useMemo, useState } from "react";
import { ref, onValue } from "firebase/database";
import { rtdb } from "@/lib/firebase";
import { useBuses, BusData } from "@/hooks/useBuses";
import { useDrivers, DriverData } from "@/hooks/useDrivers";
import { useRoutes, RouteData } from "@/hooks/useRoutes";

export interface ActiveBusEntry {
  busId: string;
  driverId?: string;
  routeId?: string;
  lat?: number;
  lng?: number;
  speed?: number;
  heading?: number;
  timestamp?: number;
  deviceState?: "online" | "offline";
  motionState?: "moving" | "stopped" | "uncertain";
  tripState?: "pre_departure" | "in_service" | "completed" | "maintenance";
  currentStopIndex?: number;
  lowAccuracy?: boolean;
}

interface AdminDataContextValue {
  buses: BusData[];
  busesLoading: boolean;
  drivers: DriverData[];
  driversLoading: boolean;
  routes: RouteData[];
  routesLoading: boolean;
  activeBuses: ActiveBusEntry[];
  activeBusesUpdatedAt: number;
}

const AdminDataContext = createContext<AdminDataContextValue | null>(null);

export function AdminDataProvider({ children }: { children: ReactNode }) {
  const { buses, loading: busesLoading } = useBuses();
  const { drivers, loading: driversLoading } = useDrivers();
  const { routes, loading: routesLoading } = useRoutes();
  const [activeBuses, setActiveBuses] = useState<ActiveBusEntry[]>([]);
  const [activeBusesUpdatedAt, setActiveBusesUpdatedAt] = useState(0);

  useEffect(() => {
    const activeRef = ref(rtdb, "activeBuses");
    const unsubscribe = onValue(activeRef, (snap) => {
      const data = snap.val() as Record<string, ActiveBusEntry> | null;
      setActiveBuses(data ? Object.values(data) : []);
      setActiveBusesUpdatedAt(Date.now());
    });

    return () => unsubscribe();
  }, []);

  const value = useMemo(
    () => ({
      buses,
      busesLoading,
      drivers,
      driversLoading,
      routes,
      routesLoading,
      activeBuses,
      activeBusesUpdatedAt,
    }),
    [activeBuses, activeBusesUpdatedAt, buses, busesLoading, drivers, driversLoading, routes, routesLoading]
  );

  return <AdminDataContext.Provider value={value}>{children}</AdminDataContext.Provider>;
}

export function useAdminData() {
  const context = useContext(AdminDataContext);
  if (!context) {
    throw new Error("useAdminData must be used within AdminDataProvider");
  }
  return context;
}
