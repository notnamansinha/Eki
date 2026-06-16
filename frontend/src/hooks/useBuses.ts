import { useState, useEffect } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";

export interface BusData {
  id: string; // The bus hardware ID e.g. "BRTS-101"
  name: string; // The display name e.g. "Red Line Express"
  assignedRoutes?: string[]; // Routes it should run on
}

export function useBuses() {
  const [buses, setBuses] = useState<BusData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, "buses"), (snapshot) => {
      const fetched = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as BusData[];
      
      setBuses(fetched);
      setLoading(false);
    }, (error) => {
      console.error("Error fetching buses from Firestore:", error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  return { buses, loading };
}
