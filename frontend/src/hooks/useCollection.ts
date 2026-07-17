import { useState, useEffect } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { waitForAuth } from "@/lib/authState";

interface CacheEntry<T> {
  data: T[];
  loading: boolean;
  listenerCount: number;
  unsubscribe: (() => void) | null;
  callbacks: Set<() => void>;
  timeoutId?: NodeJS.Timeout;
}

const queryCache = new Map<string, CacheEntry<any>>();

export function useCollection<T>(collectionName: string) {
  const [, forceRender] = useState(0);

  useEffect(() => {
    let entry = queryCache.get(collectionName);
    if (!entry) {
      entry = {
        data: [],
        loading: true,
        listenerCount: 0,
        unsubscribe: null,
        callbacks: new Set()
      };
      queryCache.set(collectionName, entry);
    }

    const currentEntry = entry;
    currentEntry.listenerCount++;
    
    // Cancel any pending disconnect
    if (currentEntry.timeoutId) {
      clearTimeout(currentEntry.timeoutId);
      currentEntry.timeoutId = undefined;
    }

    if (!currentEntry.unsubscribe) {
      waitForAuth().then(() => {
        // Double check if we still need it after auth resolves
        if (currentEntry.listenerCount > 0 && !currentEntry.unsubscribe) {
          currentEntry.unsubscribe = onSnapshot(
            collection(db, collectionName),
            (snapshot) => {
              currentEntry.data = snapshot.docs.map((doc) => ({
                id: doc.id,
                ...doc.data(),
              })) as T[];
              currentEntry.loading = false;
              currentEntry.callbacks.forEach(cb => cb());
            },
            (error) => {
              console.error(`Error fetching ${collectionName}:`, error);
              currentEntry.loading = false;
              currentEntry.callbacks.forEach(cb => cb());
            }
          );
        }
      });
    }

    const trigger = () => forceRender(n => n + 1);
    currentEntry.callbacks.add(trigger);
    
    // Trigger initial render if data is already loaded
    if (!currentEntry.loading) trigger();

    return () => {
      currentEntry.callbacks.delete(trigger);
      currentEntry.listenerCount--;

      if (currentEntry.listenerCount === 0) {
        // Debounce unsubscribe to survive StrictMode and rapid navigation
        currentEntry.timeoutId = setTimeout(() => {
          if (currentEntry.listenerCount === 0 && currentEntry.unsubscribe) {
            currentEntry.unsubscribe();
            currentEntry.unsubscribe = null;
            // We intentionally keep the cached data so next mount is instant
          }
        }, 3000);
      }
    };
  }, [collectionName]);

  const entry = queryCache.get(collectionName);
  return { 
    data: entry ? entry.data as T[] : [], 
    loading: entry ? entry.loading : true 
  };
}
