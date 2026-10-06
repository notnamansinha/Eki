"use client";

import { onChildAdded, onChildChanged, onChildRemoved, onValue, ref } from "firebase/database";
import { waitForAuth, getAuthVerificationGeneration } from "./authState";
import { rtdb } from "./firebaseDatabase";
import { millisecondsUntilNextPrune, pruneExpiredLiveBuses, type LiveBusSnapshot } from "./liveBusSnapshot";
import type { LiveBusDeliverySource } from "./liveBusDelivery";
import { liveBusRetryDelayMs } from "./liveBusRetry";
import {
  recordTelemetryListenerDelivery,
  recordRealtimePayload,
  recordRealtimeWatch,
  setTelemetryServerTimeOffset,
  telemetryTraceEnabled,
} from "./telemetryTrace";

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


export function createLiveBusStore(path: string, fleet = false, onIdle = () => {}) {
  const subscribers = new Set<Subscriber>();
  const changeSubscribers = new Set<ChangeSubscriber>();
  let cached: LiveBusSnapshot | null = null;
  let unsubscribes: (() => void)[] = [];
  let starting = false;
  let epoch = 0;
  let expiryTimer: ReturnType<typeof setTimeout> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let retryAttempt = 0;

  function subscriberCount(): number {
    return subscribers.size + changeSubscribers.size;
  }

  function notifySnapshotSubscribers(source: LiveBusDeliverySource): void {
    subscribers.forEach((subscriber) => {
      try { subscriber.next(cached, source); } catch (error) {
        console.error("Live bus subscriber failed:", error);
      }
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
    ];
    new Set(all).forEach((subscriber) => {
      try { subscriber.error?.(error); } catch (subscriberError) {
        console.error("Live bus subscriber error handler failed:", subscriberError);
      }
    });
  }

  function applyDelta(
    type: "upsert" | "remove",
    key: string,
    value?: Record<string, unknown>,
  ): void {
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
      }
      scheduleExpiry();
    }, Math.max(1, delay + 1));
  }

  function detachListeners(): void {
    epoch++;
    if (unsubscribes.length > 0) recordRealtimeWatch("active_buses", false);
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
    notifySubscriberErrors(error);
    scheduleRetry();
  }

  function invalidateLiveBusCache(): void {
    detachListeners();
    cached = null;
    if (expiryTimer) clearTimeout(expiryTimer);
    expiryTimer = null;
    notifySnapshotSubscribers("invalidation");
    notifyChangeSubscribers({ type: "reset", snapshot: null, source: "invalidation" });
    void ensureListener();
  }

  async function ensureListener(): Promise<void> {
    if (unsubscribes.length > 0 || starting || retryTimer || subscriberCount() === 0) return;
    starting = true;
    const attempt = epoch;
    try {
      await waitForAuth();
      if (attempt !== epoch) return;
      const authGeneration = getAuthVerificationGeneration();
      const current = () => attempt === epoch && authGeneration === getAuthVerificationGeneration();
      if (subscriberCount() === 0 || unsubscribes.length > 0) return;
      const busesRef = ref(rtdb, path);
      const buffered: Array<
        | { type: "upsert"; key: string; value: Record<string, unknown> }
        | { type: "remove"; key: string }
      > = [];
      let initialized = false;
      const receiveOne = (type: "upsert" | "remove", snapshot: { key: string | null; val: () => unknown }) => {
        if (!current() || !snapshot.key) return;
        const rawValue = snapshot.val();
        if (initialized) recordRealtimePayload("active_buses", rawValue);
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
          if (normalizedType === "upsert" && value) {
            recordTelemetryListenerDelivery(snapshot.key, value);
          }
          applyDelta(normalizedType, snapshot.key, value);
        }
      };
      const receive = (type: "upsert" | "remove", snapshot: { key: string | null; val: () => unknown }) => {
        if (!current() || !snapshot.key) return;
        if (!fleet) { receiveOne(type, snapshot); return; }
        const raw = snapshot.val() as { buses?: LiveBusSnapshot } | null;
        const buses = type === "remove" ? {} : raw?.buses ?? {};
        for (const [key, value] of Object.entries(cached ?? {})) {
          if (value.routeId === snapshot.key && !(key in buses)) receiveOne("remove", { key, val: () => null });
        }
        for (const [key, value] of Object.entries(buses)) receiveOne("upsert", { key, val: () => value });
      };
      const failure = (error: Error) => { if (current()) listenerFailed(error); };
      unsubscribes = [
        onChildAdded(busesRef, (snapshot) => receive("upsert", snapshot), failure),
        onChildChanged(busesRef, (snapshot) => receive("upsert", snapshot), failure),
        onChildRemoved(busesRef, (snapshot) => receive("remove", snapshot), failure),
      ];
      recordRealtimeWatch("active_buses", true);
      if (telemetryTraceEnabled()) {
        unsubscribes.push(onValue(
          ref(rtdb, ".info/serverTimeOffset"),
          (snapshot) => { if (current()) setTelemetryServerTimeOffset(snapshot.val()); },
        ));
      }
      unsubscribes.push(onValue(busesRef, (snapshot) => {
        if (!current()) return;
        retryAttempt = 0;
        const raw = snapshot.val();
        const value: LiveBusSnapshot | null = fleet && raw
          ? Object.assign({}, ...Object.values(raw as Record<string, { buses?: LiveBusSnapshot }>).map(route => route.buses ?? {}))
          : raw as LiveBusSnapshot | null;
        recordRealtimePayload("active_buses", value);
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
        scheduleExpiry();
      }, failure, { onlyOnce: true }));
    } catch (error) {
      if (attempt !== epoch) return;
      const listenerError = error instanceof Error ? error : new Error("Live bus listener failed.");
      detachListeners();
      notifySubscriberErrors(listenerError);
      scheduleRetry();
    } finally {
      starting = false;
      if (attempt !== epoch) void ensureListener();
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
    onIdle();
  }

  function subscribeLiveBuses(next: Subscriber["next"], error?: Subscriber["error"]): () => void {
    const subscriber = { next, error };
    subscribers.add(subscriber);
    if (cached !== null) next(cached, "cache");
    scheduleExpiry();
    void ensureListener();
    return () => { subscribers.delete(subscriber); teardownIfUnused(); };
  }

  function subscribeLiveBusChanges(
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

  return { subscribeSnapshot: subscribeLiveBuses, subscribeChanges: subscribeLiveBusChanges,
    invalidate: invalidateLiveBusCache };
}
