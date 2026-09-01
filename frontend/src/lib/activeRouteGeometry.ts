import { get, ref } from "firebase/database";
import { rtdb } from "./firebaseDatabase";
import { decodePolyline, type LatLng } from "./polyline";

export interface ActiveRouteGeometry {
  polyline: string;
  path: LatLng[];
}

/**
 * RTDB key for one live bus node (`activeBuses/{busId}_{routeId}`) and the
 * version-keyed sibling that holds its reroute geometry.
 */
export function activeBusNodeKey(busId: string, routeId: string): string {
  return `${busId}_${routeId}`;
}

// Reroute geometry is version-keyed and immutable per version, so a small
// module cache means clients fetch each version exactly once.
const cache = new Map<string, ActiveRouteGeometry | null>();
const inflight = new Map<string, Promise<ActiveRouteGeometry | null>>();
const CACHE_MAX = 100;

function cacheKey(nodeKey: string, version: number): string {
  return `${nodeKey}:${version}`;
}

/**
 * Synchronous best-effort lookup. Returns the cached geometry, `null` when a
 * version was already fetched and found absent/invalid, or `undefined` when it
 * has not been loaded yet.
 */
export function cachedActiveRouteGeometry(
  nodeKey: string,
  version: number,
): ActiveRouteGeometry | null | undefined {
  return cache.get(cacheKey(nodeKey, version));
}

/**
 * Fetch (and cache) the reroute geometry for one live node at one route
 * version. Resolves `null` when the sibling node is missing or invalid.
 */
export function fetchActiveRouteGeometry(
  nodeKey: string,
  version: number,
): Promise<ActiveRouteGeometry | null> {
  const key = cacheKey(nodeKey, version);
  const cached = cache.get(key);
  if (cached !== undefined) return Promise.resolve(cached);
  const existing = inflight.get(key);
  if (existing) return existing;
  const pending = loadGeometry(key, nodeKey, version).finally(() => {
    if (inflight.get(key) === pending) inflight.delete(key);
  });
  inflight.set(key, pending);
  return pending;
}

async function loadGeometry(
  key: string,
  nodeKey: string,
  version: number,
): Promise<ActiveRouteGeometry | null> {
  let snapshot;
  try {
    snapshot = await get(ref(rtdb, `activeRouteGeometry/${nodeKey}/${version}`));
  } catch {
    // Transient read failure: do NOT cache, so callers can retry once
    // connectivity recovers. Only successfully resolved missing/invalid
    // geometry is cached as null below.
    return null;
  }
  let geometry: ActiveRouteGeometry | null = null;
  const value = snapshot?.val() as { polyline?: unknown } | null;
  if (typeof value?.polyline === "string" && value.polyline.length > 0) {
    const path = decodePolyline(value.polyline);
    if (path.length >= 2) geometry = { polyline: value.polyline, path };
  }
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, geometry);
  return geometry;
}

/** Test hook to clear the module-level geometry cache. */
export function __resetActiveRouteGeometryForTests(): void {
  cache.clear();
  inflight.clear();
}