"use client";

import { createLiveBusStore } from "./createLiveBusStore";
import type { LiveBusSnapshot } from "./liveBusSnapshot";
import type { LiveBusDeliverySource } from "./liveBusDelivery";
export type { LiveBusChange } from "./createLiveBusStore";
import type { LiveBusChange } from "./createLiveBusStore";

type Store = ReturnType<typeof createLiveBusStore>;
const scopes = new Map<string, Store>();
function scope(routeId?: string): Store {
  const key = routeId === undefined ? "fleet" : `route:${routeId}`;
  if (routeId !== undefined && !/^[A-Za-z0-9_-]{1,128}$/.test(routeId)) throw new Error("Invalid live route ID.");
  let store = scopes.get(key);
  if (!store) {
    store = createLiveBusStore(routeId ? `publicRouteBuses/route:${routeId}/buses` : "publicRouteBuses",
      !routeId, () => { scopes.delete(key); });
    scopes.set(key, store);
  }
  return store;
}
export function invalidateLiveBusCache(): void { [...scopes.values()].forEach(store => store.invalidate()); }
export function subscribeLiveBuses(next: (value: LiveBusSnapshot | null, source: LiveBusDeliverySource) => void, error?: (error: Error) => void) {
  return scope().subscribeSnapshot(next, error);
}
export function subscribeLiveBusChanges(next: (change: LiveBusChange) => void, error?: (error: Error) => void) {
  return scope().subscribeChanges(next, error);
}
export function subscribeLiveBusesByRoute(routeId: string, next: (value: LiveBusSnapshot | null, source: LiveBusDeliverySource) => void, error?: (error: Error) => void) {
  return scope(routeId).subscribeSnapshot(next, error);
}
export function subscribeLiveBusChangesByRoute(routeId: string, next: (change: LiveBusChange) => void, error?: (error: Error) => void) {
  return scope(routeId).subscribeChanges(next, error);
}
