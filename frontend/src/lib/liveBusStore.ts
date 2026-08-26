"use client";

import { onChildAdded, onChildChanged, onChildRemoved, onValue, ref } from "firebase/database";
import { waitForAuth } from "./authState";
import { rtdb } from "./firebaseDatabase";
import { millisecondsUntilNextPrune, pruneExpiredLiveBuses, type LiveBusSnapshot } from "./liveBusSnapshot";
import type { LiveBusDeliverySource } from "./liveBusDelivery";
import { liveBusRetryDelayMs } from "./liveBusRetry";

type Subscriber = {
  next: (value: LiveBusSnapshot | null, source: LiveBusDeliverySource) => void;
  error?: (error: Error) => void;
};

export type LiveBusChange =
  | { type: "reset"; snapshot: LiveBusSnapshot | null; source: LiveBusDeliverySource }
  | { type: "upsert"; key: string; value: Record<string, unknown>; source: LiveBusDeliverySource }
  | { type: "remove"; key: string; source: LiveBusDeliverySource };

type ChangeSubscriber = {
  next: (change: LiveBusChange) => void;
  error?: (error: Error) => void;
};

const subscribers = new Set<Subscriber>();
const changeSubscribers = new Set<ChangeSubscriber>();
const routeSubscribers = new Map<string, Set<Subscriber>>();
let cached: LiveBusSnapshot | null = null;
let unsubscribes: (() => void)[] = [];
let starting = false;
let expiryTimer: ReturnType<typeof setTimeout> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryAttempt = 0;

function subscriberCount(): number {
  let routeCount = 0;
  routeSubscribers.forEach((routeSet) => { routeCount += routeSet.size; });
  return subscribers.size + changeSubscribers.size + routeCount;
}

function routeSnapshot(routeId: string): LiveBusSnapshot | null {
  if (!cached) return null;
  const entries = Object.entries(cached).filter(([, value]) =>
    typeof value === "object" && value !== null &&
    (value as Record<string, unknown>).routeId === routeId
  );
  return entries.length > 0 ? Object.fromEntries(entries) : null;
}

function notifySnapshotSubscribers(source: LiveBusDeliverySource): void {
  subscribers.forEach((subscriber) => {
    try { subscriber.next(cached, source); } catch (error) {
      console.error("Live bus subscriber failed:", error);
    }
  });
}

function notifyRouteSubscribers(routeIds: Set<string>, source: LiveBusDeliverySource): void {
  routeIds.forEach((routeId) => {
    routeSubscribers.get(routeId)?.forEach((subscriber) => {
      try { subscriber.next(routeSnapshot(routeId), source); } catch (error) {
        console.error("Live bus route subscriber failed:", error);
      }
    });
  });
}

function notifyChangeSubscribers(change: LiveBusChange): void {
  changeSubscribers.forEach((subscriber) => {
    try { subscriber.next(change); } catch (error) {
      console.error("Live bus change subscriber failed:", error);
    }
  });
}

function notifySubscriberErrors(error: Error): void {
  const all = [
    ...subscribers,
    ...changeSubscribers,
    ...Array.from(routeSubscribers.values()).flatMap((set) => [...set]),
  ];
  new Set(all).forEach((subscriber) => {
    try { subscriber.error?.(error); } catch (subscriberError) {
      console.error("Live bus subscriber error handler failed:", subscriberError);
    }
  });
}

function routeIdOf(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return null;
  const routeId = (value as Record<string, unknown>).routeId;
  return typeof routeId === "string" && routeId.length > 0 ? routeId : null;
}

function applyDelta(
  type: "upsert" | "remove",
  key: string,
  value?: Record<string, unknown>,
): void {
  const previous = cached?.[key];
  const affectedRoutes = new Set<string>();
  const previousRoute = routeIdOf(previous);
  const nextRoute = type === "upsert" ? routeIdOf(value) : null;
  if (previousRoute) affectedRoutes.add(previousRoute);
  if (nextRoute) affectedRoutes.add(nextRoute);

  if (type === "upsert" && value) {
    cached ??= {};
    cached[key] = value;
    notifyChangeSubscribers({ type, key, value, source: "listener" });
  } else {
    if (cached) {
      delete cached[key];
      if (Object.keys(cached).length === 0) cached = null;
    }
    notifyChangeSubscribers({ type: "remove", key, source: "listener" });
  }
  notifySnapshotSubscribers("listener");
  notifyRouteSubscribers(affectedRoutes, "listener");
  scheduleExpiry();
}

function scheduleRetry(): void {
  if (subscriberCount() === 0 || retryTimer) return;
  const delay = liveBusRetryDelayMs(retryAttempt);
  retryAttempt = Math.min(retryAttempt + 1, 5);
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void ensureListener();
  }, delay);
}

function scheduleExpiry(): void {
  if (expiryTimer) clearTimeout(expiryTimer);
  expiryTimer = null;
  if (!cached || subscriberCount() === 0) return;
  const delay = millisecondsUntilNextPrune(cached);
  if (delay === null) return;
  expiryTimer = setTimeout(() => {
    expiryTimer = null;
    if (!cached) return;
    const fresh = pruneExpiredLiveBuses(cached);
    if (fresh !== cached) {
      cached = Object.keys(fresh).length > 0 ? fresh : null;
      notifySnapshotSubscribers("expiry");
      notifyChangeSubscribers({ type: "reset", snapshot: cached, source: "expiry" });
      notifyRouteSubscribers(new Set(routeSubscribers.keys()), "expiry");
    }
    scheduleExpiry();
  }, Math.max(1, delay + 1));
}

function detachListeners(): void {
  unsubscribes.forEach((detach) => detach());
  unsubscribes = [];
}

function listenerFailed(error: Error): void {
  if (unsubscribes.length === 0) return;
  detachListeners();
  cached = null;
  if (expiryTimer) clearTimeout(expiryTimer);
  expiryTimer = null;
  notifySnapshotSubscribers("invalidation");
  notifyChangeSubscribers({ type: "reset", snapshot: null, source: "invalidation" });
  notifyRouteSubscribers(new Set(routeSubscribers.keys()), "invalidation");
  notifySubscriberErrors(error);
  scheduleRetry();
}

export function invalidateLiveBusCache(): void {
  cached = null;
  if (expiryTimer) clearTimeout(expiryTimer);
  expiryTimer = null;
  notifySnapshotSubscribers("invalidation");
  notifyChangeSubscribers({ type: "reset", snapshot: null, source: "invalidation" });
  notifyRouteSubscribers(new Set(routeSubscribers.keys()), "invalidation");
}

async function ensureListener(): Promise<void> {
  if (unsubscribes.length > 0 || starting || retryTimer || subscriberCount() === 0) return;
  starting = true;
  try {
    await waitForAuth();
    if (subscriberCount() === 0 || unsubscribes.length > 0) return;
    const busesRef = ref(rtdb, "activeBuses");
    const buffered: Array<
      | { type: "upsert"; key: string; value: Record<string, unknown> }
      | { type: "remove"; key: string }
    > = [];
    let initialized = false;
    const receive = (type: "upsert" | "remove", snapshot: { key: string | null; val: () => unknown }) => {
      if (!snapshot.key) return;
      const rawValue = snapshot.val();
      const normalizedType = type === "upsert" &&
        (typeof rawValue !== "object" || rawValue === null || Array.isArray(rawValue))
          ? "remove"
          : type;
      const value = normalizedType === "upsert"
        ? rawValue as Record<string, unknown>
        : undefined;
      if (!initialized) {
        if (normalizedType === "upsert" && value) {
          buffered.push({ type: "upsert", key: snapshot.key, value });
        } else {
          buffered.push({ type: "remove", key: snapshot.key });
        }
      } else {
        applyDelta(normalizedType, snapshot.key, value);
      }
    };
    const failure = (error: Error) => listenerFailed(error);
    unsubscribes = [
      onChildAdded(busesRef, (snapshot) => receive("upsert", snapshot), failure),
      onChildChanged(busesRef, (snapshot) => receive("upsert", snapshot), failure),
      onChildRemoved(busesRef, (snapshot) => receive("remove", snapshot), failure),
    ];
    unsubscribes.push(onValue(busesRef, (snapshot) => {
      retryAttempt = 0;
      const value = snapshot.val() as LiveBusSnapshot | null;
      cached = value ? pruneExpiredLiveBuses(value) : null;
      buffered.forEach((change) => {
        if (change.type === "upsert") {
          cached ??= {};
          cached[change.key] = change.value;
        } else if (cached) {
          delete cached[change.key];
        }
      });
      if (cached && Object.keys(cached).length === 0) cached = null;
      buffered.length = 0;
      initialized = true;
      notifySnapshotSubscribers("listener");
      notifyChangeSubscribers({ type: "reset", snapshot: cached, source: "listener" });
      notifyRouteSubscribers(new Set(routeSubscribers.keys()), "listener");
      scheduleExpiry();
    }, failure, { onlyOnce: true }));
  } catch (error) {
    const listenerError = error instanceof Error ? error : new Error("Live bus listener failed.");
    detachListeners();
    notifySubscriberErrors(listenerError);
    scheduleRetry();
  } finally {
    starting = false;
  }
}

function teardownIfUnused(): void {
  if (subscriberCount() !== 0) return;
  detachListeners();
  cached = null;
  retryAttempt = 0;
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  if (expiryTimer) clearTimeout(expiryTimer);
  expiryTimer = null;
}

export function subscribeLiveBuses(next: Subscriber["next"], error?: Subscriber["error"]): () => void {
  const subscriber = { next, error };
  subscribers.add(subscriber);
  if (cached !== null) next(cached, "cache");
  scheduleExpiry();
  void ensureListener();
  return () => { subscribers.delete(subscriber); teardownIfUnused(); };
}

export function subscribeLiveBusChanges(
  next: ChangeSubscriber["next"],
  error?: ChangeSubscriber["error"],
): () => void {
  const subscriber = { next, error };
  changeSubscribers.add(subscriber);
  if (cached !== null) next({ type: "reset", snapshot: cached, source: "cache" });
  scheduleExpiry();
  void ensureListener();
  return () => { changeSubscribers.delete(subscriber); teardownIfUnused(); };
}

export function subscribeLiveBusesByRoute(
  routeId: string,
  next: Subscriber["next"],
  error?: Subscriber["error"],
): () => void {
  const subscriber = { next, error };
  const routeSet = routeSubscribers.get(routeId) ?? new Set<Subscriber>();
  routeSet.add(subscriber);
  routeSubscribers.set(routeId, routeSet);
  if (cached !== null) next(routeSnapshot(routeId), "cache");
  scheduleExpiry();
  void ensureListener();
  return () => {
    routeSet.delete(subscriber);
    if (routeSet.size === 0) routeSubscribers.delete(routeId);
    teardownIfUnused();
  };
}
