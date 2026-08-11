"use client";

import { onValue, ref } from "firebase/database";
import { waitForAuth } from "./authState";
import { rtdb } from "./firebaseDatabase";
import {
  millisecondsUntilNextPrune,
  pruneExpiredLiveBuses,
  type LiveBusSnapshot,
} from "./liveBusSnapshot";
import type { LiveBusDeliverySource } from "./liveBusDelivery";
import { liveBusRetryDelayMs } from "./liveBusRetry";

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
  subscribers.forEach((subscriber) => {
    try {
      subscriber.next(value, source);
    } catch (subscriberError) {
      console.error("Live bus subscriber failed:", subscriberError);
    }
  });
}

function notifySubscriberErrors(error: Error): void {
  subscribers.forEach((subscriber) => {
    try {
      subscriber.error?.(error);
    } catch (subscriberError) {
      console.error("Live bus subscriber error handler failed:", subscriberError);
    }
  });
}

function scheduleRetry(): void {
  if (subscribers.size === 0 || retryTimer) return;
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
        notifySubscriberErrors(error);
        // Retry while the view is subscribed; the interval is capped, and
        // teardown cancels the loop when the final subscriber leaves.
        scheduleRetry();
      },
    );
  } catch (error) {
    const listenerError = error instanceof Error ? error : new Error("Live bus listener failed.");
    notifySubscriberErrors(listenerError);
    scheduleRetry();
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
