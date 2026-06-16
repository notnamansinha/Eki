import { useState, useEffect } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";

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
    const unsubscribe = onSnapshot(collection(db, "drivers"), (snapshot) => {
      const fetched = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as DriverData[];
      
      setDrivers(fetched);
      setLoading(false);
    }, (error) => {
      console.error("Error fetching drivers from Firestore:", error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  return { drivers, loading };
}
