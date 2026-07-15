import { useState, useEffect } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { waitForAuth } from "@/lib/authState";

export interface DriverData {
  id: string; // Driver unique ID e.g. "drv_1"
  name: string; // Driver display name e.g. "Ravi Kumar"
  assignedBusId: string | null; // Bus they are driving today
  photoUrl?: string; // Custom profile photo URL from Firebase Storage
}

export function useDrivers() {
  const [drivers, setDrivers] = useState<DriverData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    let cancelled = false;

    waitForAuth().then(() => {
      if (cancelled) {
        return;
      }

      const snapshotUnsubscribe = onSnapshot(
        collection(db, "drivers"),
        (snapshot) => {
          if (cancelled) {
            return;
          }

          const fetched = snapshot.docs.map((doc) => ({
            id: doc.id,
            ...doc.data(),
          })) as DriverData[];
          setDrivers(fetched);
          setLoading(false);
        },
        (error) => {
          if (cancelled) {
            return;
          }

          console.error("Error fetching drivers from Firestore:", error);
          setLoading(false);
        }
      );

      if (cancelled) {
        snapshotUnsubscribe();
        return;
      }

      unsubscribe = snapshotUnsubscribe;
    });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  return { drivers, loading };
}
