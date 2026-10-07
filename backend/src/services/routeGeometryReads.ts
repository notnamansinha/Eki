import { routeListCache } from "./apiReadCache";
import { db } from "../lib/firebaseAdmin";
import { LruCache } from "../lib/lruCache";
import { createBoundedSingleFlight } from "../lib/boundedSingleFlight";

type RouteRead = { exists: boolean; data: Record<string, unknown> | undefined; expiresAt: number };
// Firestore limits each document to 1 MiB; cap retained documents independently
// of matcher geometry. No response is placed in a shared browser/proxy cache.
const cache = new LruCache<string, RouteRead>(100);
const fills = createBoundedSingleFlight<RouteRead>({ maxFills: 16, maxWaitersPerFill: 32, responseMs: 3_000 });

export function invalidateRouteGeometryRead(routeId?: string): void {
  routeListCache.invalidate();
  if (routeId === undefined) cache.clear(); else cache.delete(routeId);
  fills.invalidate(routeId);
}

export async function readRouteGeometryDocument(routeId: string): Promise<RouteRead> {
  const cached = cache.get(routeId);
  if (cached && cached.expiresAt > performance.now()) return cached;
  return fills.run(routeId, routeId, async isCurrent => {
    const snapshot = await db.collection("routes").doc(routeId).get();
    if (!isCurrent()) throw new Error("Route geometry read was invalidated or expired.");
    const value = { exists: snapshot.exists, data: snapshot.data(), expiresAt: performance.now() + 60_000 };
    cache.set(routeId, value); return value;
  });
}

export function routeGeometryReadStatus() { return { cached: cache.size, ...fills.snapshot() }; }
