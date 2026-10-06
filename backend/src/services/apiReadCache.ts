import { createBoundedSingleFlight, SingleFlightCapacityError, SingleFlightDeadlineError } from "../lib/boundedSingleFlight";
import { LruCache } from "../lib/lruCache";
import type { Response } from "express";

const statuses = new Map<string, () => unknown>();
/** Bounded successful-result cache. Invalidated/timed-out fills never republish. */
export function createApiReadCache<T>(name: string, ttlMs: number, entries = 16) {
  const cache = new LruCache<string, { value: T; expires: number }>(entries);
  const flights = createBoundedSingleFlight<T>({ maxFills: 8, maxWaitersPerFill: 32, responseMs: 3000 });
  const stats = { hits: 0, fills: 0, failures: 0, invalidations: 0 };
  const snapshot = () => ({ ...stats, cached: cache.size, ttlMs, ...flights.snapshot() });
  statuses.set(name, snapshot);
  return {
    invalidate() { cache.clear(); flights.invalidate(); stats.invalidations++; },
    snapshot,
    async read(key: string, load: () => Promise<T>): Promise<T> {
      const hit = cache.get(key);
      if (hit && hit.expires > performance.now()) { stats.hits++; return hit.value; }
      return flights.run(key, name, async current => {
        stats.fills++;
        try {
          const value = await load();
          if (!current()) throw new SingleFlightDeadlineError();
          // Up to 16 retained entries of <=256 KiB; larger legacy payloads
          // can be served without retaining a fleet-sized cache value.
          if (ttlMs > 0 && Buffer.byteLength(JSON.stringify(value)) <= 256 * 1024) {
            cache.set(key, { value, expires: performance.now() + ttlMs });
          }
          return value;
        } catch (error) { stats.failures++; throw error; }
      });
    },
  };
}
export const routeListCache = createApiReadCache<unknown>("routeCatalog", 5000);
export function apiReadCacheStatus() { return Object.fromEntries([...statuses].map(([name, read]) => [name, read()])); }
export function apiReadFailure(res: Response, error: unknown, message: string) {
  if (error instanceof SingleFlightCapacityError || error instanceof SingleFlightDeadlineError) {
    res.set("Retry-After", "1"); res.status(503).json({ error: message });
  } else res.status(500).json({ error: message });
}
