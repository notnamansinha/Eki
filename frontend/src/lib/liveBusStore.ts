"use client";

import { onValue, ref } from "firebase/database";
import { waitForAuth } from "@/lib/authState";
import { rtdb } from "@/lib/firebaseDatabase";
import {
  millisecondsUntilNextPrune,
  pruneExpiredLiveBuses,
  type LiveBusSnapshot,
} from "@/lib/liveBusSnapshot";

type Subscriber = {
  next: (value: LiveBusSnapshot | null) => void;
  error?: (error: Error) => void;
};

const subscribers = new Set<Subscriber>();
let cached: LiveBusSnapshot | null = null;
let unsubscribe: (() => void) | null = null;
let starting = false;
let expiryTimer: ReturnType<typeof setTimeout> | null = null;

function notifySubscribers(value: LiveBusSnapshot | null): void {
  subscribers.forEach((subscriber) => subscriber.next(value));
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
      notifySubscribers(cached);
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
  notifySubscribers(null);
}

async function ensureListener() {
  if (unsubscribe || starting || subscribers.size === 0) return;
  starting = true;
  try {
    await waitForAuth();
    if (subscribers.size === 0 || unsubscribe) return;
    unsubscribe = onValue(
      ref(rtdb, "activeBuses"),
      (snapshot) => {
        const value = snapshot.val() as LiveBusSnapshot | null;
        cached = value ? pruneExpiredLiveBuses(value) : null;
        notifySubscribers(cached);
        scheduleExpiry();
      },
      (error) => subscribers.forEach((subscriber) => subscriber.error?.(error)),
    );
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
  if (cached !== null) next(cached);
  void ensureListener();

  return () => {
    subscribers.delete(subscriber);
    if (subscribers.size === 0) {
      unsubscribe?.();
      unsubscribe = null;
      cached = null;
      if (expiryTimer) {
        clearTimeout(expiryTimer);
        expiryTimer = null;
      }
    }
  };
}
