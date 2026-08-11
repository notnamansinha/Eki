"use client";

import { onValue, ref } from "firebase/database";
import { waitForAuth } from "@/lib/authState";
import { rtdb } from "@/lib/firebaseDatabase";
import {
  millisecondsUntilNextPrune,
  pruneExpiredLiveBuses,
  type LiveBusSnapshot,
} from "@/lib/liveBusSnapshot";
import type { LiveBusDeliverySource } from "@/lib/liveBusDelivery";
import { liveBusRetryDelayMs } from "@/lib/liveBusRetry";

type Subscriber = {
  next: (
    value: LiveBusSnapshot | null,
    source: LiveBusDeliverySource,
  ) => void;
  error?: (error: Error) => void;
};

const subscribers = new Set<Subscriber>();
let cached: LiveBusSnapshot | null = null;
let unsubscribe: (() => void) | null = null;
let starting = false;
let expiryTimer: ReturnType<typeof setTimeout> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryAttempt = 0;

function notifySubscribers(
  value: LiveBusSnapshot | null,
  source: LiveBusDeliverySource,
): void {
  subscribers.forEach((subscriber) => subscriber.next(value, source));
}

function scheduleExpiry(): void {
  if (expiryTimer) clearTimeout(expiryTimer);
  expiryTimer = null;
  if (!cached || subscribers.size === 0) return;
  const delay = millisecondsUntilNextPrune(cached);
  if (delay === null) return;
  expiryTimer = setTimeout(() => {
    expiryTimer = null;
    if (!cached) return;
    const fresh = pruneExpiredLiveBuses(cached);
    if (fresh !== cached) {
      cached = fresh;
      notifySubscribers(cached, "expiry");
    }
    scheduleExpiry();
  }, Math.max(1, delay + 1));
}

export function invalidateLiveBusCache(): void {
  cached = null;
  if (expiryTimer) {
    clearTimeout(expiryTimer);
    expiryTimer = null;
  }
  notifySubscribers(null, "invalidation");
}

async function ensureListener() {
  if (unsubscribe || starting || retryTimer || subscribers.size === 0) return;
  starting = true;
  try {
    await waitForAuth();
    if (subscribers.size === 0 || unsubscribe) return;
    unsubscribe = onValue(
      ref(rtdb, "activeBuses"),
      (snapshot) => {
        retryAttempt = 0;
        const value = snapshot.val() as LiveBusSnapshot | null;
        cached = value ? pruneExpiredLiveBuses(value) : null;
        notifySubscribers(cached, "listener");
        scheduleExpiry();
      },
      (error) => {
        unsubscribe?.();
        unsubscribe = null;
        cached = null;
        if (expiryTimer) clearTimeout(expiryTimer);
        expiryTimer = null;
        notifySubscribers(null, "invalidation");
        subscribers.forEach((subscriber) => subscriber.error?.(error));
        if (subscribers.size > 0 && !retryTimer) {
          const delay = liveBusRetryDelayMs(retryAttempt++);
          retryTimer = setTimeout(() => {
            retryTimer = null;
            void ensureListener();
          }, delay);
        }
      },
    );
  } catch (error) {
    const listenerError = error instanceof Error ? error : new Error("Live bus listener failed.");
    subscribers.forEach((subscriber) => subscriber.error?.(listenerError));
    if (subscribers.size > 0 && !retryTimer) {
      const delay = liveBusRetryDelayMs(retryAttempt++);
      retryTimer = setTimeout(() => {
        retryTimer = null;
        void ensureListener();
      }, delay);
    }
  } finally {
    starting = false;
  }
}

export function subscribeLiveBuses(
  next: Subscriber["next"],
  error?: Subscriber["error"],
): () => void {
  const subscriber = { next, error };
  subscribers.add(subscriber);
  scheduleExpiry();
  if (cached !== null) next(cached, "cache");
  void ensureListener();

  return () => {
    subscribers.delete(subscriber);
    if (subscribers.size === 0) {
      unsubscribe?.();
      unsubscribe = null;
      cached = null;
      retryAttempt = 0;
      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
      if (expiryTimer) {
        clearTimeout(expiryTimer);
        expiryTimer = null;
      }
    }
  };
}
