"use client";

import { useEffect, useState } from "react";
import { collection, limit, onSnapshot, query, where } from "firebase/firestore";
import { db } from "@/lib/firebaseFirestore";
import { waitForAuth } from "@/lib/authState";
import { useAuth } from "./useAuth";

export interface DriverData {
  id: string;
  name: string;
  assignedBusId: string | null;
  authUid?: string;
  photoUrl?: string;
}

export function useDrivers() {
  const { user } = useAuth();
  const [drivers, setDrivers] = useState<DriverData[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadedScope, setLoadedScope] = useState<string | null>(null);
  const scope = user && (user.role === "admin" || user.role === "driver")
    ? `${user.uid}:${user.role}`
    : null;

  useEffect(() => {
    if (!user || !scope) return;

    let unsubscribe: (() => void) | undefined;
    let active = true;

    void waitForAuth().then(() => {
      if (!active) return;
      const source = user.role === "admin"
        ? query(collection(db, "drivers"), limit(250))
        : query(collection(db, "drivers"), where("authUid", "==", user.uid), limit(1));

      unsubscribe = onSnapshot(
        source,
        snapshot => {
          setDrivers(snapshot.docs.map(driver => ({
            id: driver.id,
            ...driver.data(),
          })) as DriverData[]);
          setLoadedScope(scope);
          setLoading(false);
        },
        error => {
          console.error("Error fetching drivers:", error);
          setLoadedScope(scope);
          setLoading(false);
        },
      );
    });

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [scope, user]);

  const hasCurrentScope = scope !== null && loadedScope === scope;
  return {
    drivers: hasCurrentScope ? drivers : [],
    loading: scope === null ? false : !hasCurrentScope || loading,
  };
}
