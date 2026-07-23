"use client";

import { useEffect, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
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

  useEffect(() => {
    if (!user || (user.role !== "admin" && user.role !== "driver")) {
      return;
    }

    let unsubscribe: (() => void) | undefined;
    let active = true;

    void waitForAuth().then(() => {
      if (!active) return;
      const source = user.role === "admin"
        ? collection(db, "drivers")
        : query(collection(db, "drivers"), where("authUid", "==", user.uid));

      unsubscribe = onSnapshot(
        source,
        snapshot => {
          setDrivers(snapshot.docs.map(driver => ({
            id: driver.id,
            ...driver.data(),
          })) as DriverData[]);
          setLoading(false);
        },
        error => {
          console.error("Error fetching drivers:", error);
          setLoading(false);
        },
      );
    });

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [user]);

  return { drivers, loading };
}
