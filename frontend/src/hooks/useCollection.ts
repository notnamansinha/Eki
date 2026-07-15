import { useState, useEffect } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { waitForAuth } from "@/lib/authState";

export function useCollection<T>(collectionName: string) {
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;

    waitForAuth().then(() => {
      unsubscribe = onSnapshot(
        collection(db, collectionName),
        (snapshot) => {
          const fetched = snapshot.docs.map((doc) => ({
            id: doc.id,
            ...doc.data(),
          })) as T[];
          setData(fetched);
          setLoading(false);
        },
        (error) => {
          console.error(`Error fetching ${collectionName} from Firestore:`, error);
          setLoading(false);
        }
      );
    });

    return () => unsubscribe?.();
  }, [collectionName]);

  return { data, loading };
}
