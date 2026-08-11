import { useCallback, useEffect, useState } from "react";
import {
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { db } from "@/lib/firebaseFirestore";
import { waitForAuth } from "@/lib/authState";
import { useAuth } from "./useAuth";
import {
  buildCollectionCacheKey,
  normalizeCollectionError,
  type CollectionLoadError,
  type CollectionOptions,
} from "./collectionCache";

export type { CollectionOptions, WhereConstraint } from "./collectionCache";

interface CacheEntry {
  data: unknown[];
  loading: boolean;
  error: CollectionLoadError | null;
  listenerCount: number;
  unsubscribe: (() => void) | null;
  callbacks: Set<() => void>;
  timeoutId?: NodeJS.Timeout;
}

const queryCache = new Map<string, CacheEntry>();

/**
 * Drop all cached collection snapshots and detach the shared listeners.
 * Called when the Firebase principal changes so data from the previous
 * account can never leak into the next session.
 */
export function clearCollectionCache(): void {
  for (const entry of queryCache.values()) {
    if (entry.timeoutId) clearTimeout(entry.timeoutId);
    entry.unsubscribe?.();
    entry.unsubscribe = null;
    entry.data = [];
    entry.loading = true;
    entry.error = null;
  }
  queryCache.clear();
}

/**
 * Subscribe to a Firestore collection query through a shared, cache-keyed
 * listener. Multiple consumers of the same query share one subscription and
 * its data; the cache key includes every query dimension (collection,
 * orderBy, limit, where constraints) so queries that differ in any filter
 * never share a cache entry (#46).
 *
 * Returns `error` distinct from empty data: consumers render the failure
 * state instead of an empty list, and stale data is flagged rather than
 * presented as live (#47).
 */
export function useCollection<T>(
  collectionName: string,
  options: CollectionOptions = {},
) {
  const { user } = useAuth();
  const [, forceRender] = useState(0);
  const [retryGeneration, setRetryGeneration] = useState(0);
  const maxResults = options.maxResults ?? 250;
  const orderByField = options.orderByField;
  const orderByDirection = options.orderByDirection ?? "asc";
  const whereConstraints = options.whereConstraints ?? [];
  const queryKey = buildCollectionCacheKey(collectionName, options);
  const principalScope = user
    ? `${user.uid}:${user.role ?? "unverified"}`
    : "signed-out";
  const cacheKey = JSON.stringify([
    "principal-query-v1",
    principalScope,
    queryKey,
  ]);

  useEffect(() => {
    let entry = queryCache.get(cacheKey);
    if (!entry) {
      entry = {
        data: [],
        loading: true,
        error: null,
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
      const reportListenerError = (error: unknown) => {
        // Keep the last snapshot only in `staleData`; live `data` is hidden
        // until a new listener produces an authoritative snapshot.
        const normalizedError = normalizeCollectionError(collectionName, error);
        console.warn(
          `[useCollection] ${collectionName} listener failed (${normalizedError.code}).`,
        );
        currentEntry.error = normalizedError;
        currentEntry.loading = false;
        // Firestore listener errors are terminal. Mark the subscription
        // detached so an explicit retry can create a fresh listener.
        currentEntry.unsubscribe = null;
        currentEntry.callbacks.forEach(cb => cb());
      };

      waitForAuth().then(() => {
        // Double check if we still need it after auth resolves
        if (currentEntry.listenerCount > 0 && !currentEntry.unsubscribe) {
          try {
            const constraints = [
              ...whereConstraints.map((constraint) =>
                where(constraint.fieldPath, constraint.op, constraint.value),
              ),
              ...(orderByField
                ? [orderBy(orderByField, orderByDirection)]
                : []),
              limit(maxResults),
            ];
            let listenerFailedSynchronously = false;
            const unsubscribe = onSnapshot(
              query(collection(db, collectionName), ...constraints),
              (snapshot) => {
                currentEntry.data = snapshot.docs.map((doc) => ({
                  id: doc.id,
                  ...doc.data(),
                })) as T[];
                currentEntry.loading = false;
                currentEntry.error = null;
                currentEntry.callbacks.forEach(cb => cb());
              },
              (error) => {
                listenerFailedSynchronously = true;
                reportListenerError(error);
              },
            );
            currentEntry.unsubscribe = listenerFailedSynchronously ? null : unsubscribe;
          } catch (error) {
            reportListenerError(error);
          }
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
            // Preserve the last snapshot only as explicitly stale data. Once
            // detached, it must be revalidated before `data` is live again.
            currentEntry.loading = true;
          }
        }, 3000);
      }
    };
    // The cache key encodes every query dimension, so it is the only safe
    // dependency: array options (whereConstraints) would otherwise re-subscribe
    // on every render when a caller passes a new inline array.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey, retryGeneration]);

  const entry = queryCache.get(cacheKey);
  const retry = useCallback(() => {
    const currentEntry = queryCache.get(cacheKey);
    if (currentEntry) {
      currentEntry.unsubscribe?.();
      currentEntry.unsubscribe = null;
      currentEntry.error = null;
      currentEntry.loading = true;
      currentEntry.callbacks.forEach((callback) => callback());
    }
    setRetryGeneration((generation) => generation + 1);
  }, [cacheKey]);
  const staleData = entry ? entry.data as T[] : [];
  return {
    data: entry?.error || entry?.loading ? [] : staleData,
    staleData,
    loading: entry ? entry.loading : true,
    error: entry?.error?.message ?? null,
    errorCode: entry?.error?.code ?? null,
    errorDetails: entry?.error ?? null,
    retry,
  };
}
