import { useState, useEffect } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { waitForAuth } from "@/lib/authState";

export interface BusData {
  id: string; // The bus hardware ID e.g. "BRTS-101"
  name: string; // The display name e.g. "Red Line Express"
  assignedRoutes?: string[]; // Routes it should run on
}

export function useBuses() {
  const [buses, setBuses] = useState<BusData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    let cancelled = false;

    waitForAuth().then(() => {
      if (cancelled) {
        return;
      }

      const snapshotUnsubscribe = onSnapshot(
        collection(db, "buses"),
        (snapshot) => {
          if (cancelled) {
            return;
          }

          const fetched = snapshot.docs.map((doc) => ({
            id: doc.id,
            ...doc.data(),
          })) as BusData[];
          setBuses(fetched);
          setLoading(false);
        },
        (error) => {
          if (cancelled) {
            return;
          }

          console.error("Error fetching buses from Firestore:", error);
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

  return { buses, loading };
}
