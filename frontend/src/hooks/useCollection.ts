import { useState, useEffect } from "react";
import {
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
  type OrderByDirection,
} from "firebase/firestore";
import { db } from "@/lib/firebaseFirestore";
import { waitForAuth } from "@/lib/authState";

interface CacheEntry {
  data: unknown[];
  loading: boolean;
  listenerCount: number;
  unsubscribe: (() => void) | null;
  callbacks: Set<() => void>;
  timeoutId?: NodeJS.Timeout;
}

interface CollectionOptions {
  maxResults?: number;
  orderByDirection?: OrderByDirection;
  orderByField?: string;
}

const queryCache = new Map<string, CacheEntry>();

/** Clear in-memory snapshots when the Firebase principal changes. */
export function clearCollectionCache(): void {
  for (const entry of queryCache.values()) {
    if (entry.timeoutId) clearTimeout(entry.timeoutId);
    entry.unsubscribe?.();
    entry.unsubscribe = null;
    entry.data = [];
    entry.loading = true;
  }
  queryCache.clear();
}

export function useCollection<T>(
  collectionName: string,
  options: CollectionOptions = {},
) {
  const [, forceRender] = useState(0);
  const maxResults = options.maxResults ?? 250;
  const orderByField = options.orderByField;
  const orderByDirection = options.orderByDirection ?? "asc";
  const cacheKey = [
    collectionName,
    orderByField ?? "",
    orderByDirection,
    maxResults,
  ].join(":");

  useEffect(() => {
    let entry = queryCache.get(cacheKey);
    if (!entry) {
      entry = {
        data: [],
        loading: true,
        listenerCount: 0,
        unsubscribe: null,
        callbacks: new Set()
      };
      queryCache.set(cacheKey, entry);
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
          const constraints = orderByField
            ? [
                orderBy(orderByField, orderByDirection),
                limit(maxResults),
              ]
            : [limit(maxResults)];
          currentEntry.unsubscribe = onSnapshot(
            query(collection(db, collectionName), ...constraints),
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
  }, [
    cacheKey,
    collectionName,
    maxResults,
    orderByDirection,
    orderByField,
  ]);

  const entry = queryCache.get(cacheKey);
  return { 
    data: entry ? entry.data as T[] : [], 
    loading: entry ? entry.loading : true 
  };
}
