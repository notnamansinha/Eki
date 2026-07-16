import { useState, useEffect } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { waitForAuth } from "@/lib/authState";

export function useCollection<T>(collectionName: string) {
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;
    let unsubscribe: (() => void) | undefined;

    waitForAuth().then(() => {
      if (!isMounted) return;
      unsubscribe = onSnapshot(
        collection(db, collectionName),
        (snapshot) => {
          if (!isMounted) return;
          const fetched = snapshot.docs.map((doc) => ({
            id: doc.id,
            ...doc.data(),
          })) as T[];
          setData(fetched);
          setLoading(false);
        },
        (error) => {
          if (!isMounted) return;
          console.error(`Error fetching ${collectionName} from Firestore:`, error);
          setLoading(false);
        }
      );
    });

    return () => {
      isMounted = false;
      unsubscribe?.();
    };
  }, [collectionName]);

  return { data, loading };
}
