"use client";

import { onValue, ref } from "firebase/database";
import { waitForAuth } from "@/lib/authState";
import { rtdb } from "@/lib/firebaseDatabase";

export type LiveBusSnapshot = Record<string, Record<string, unknown>>;
type Subscriber = {
  next: (value: LiveBusSnapshot | null) => void;
  error?: (error: Error) => void;
};

const subscribers = new Set<Subscriber>();
let cached: LiveBusSnapshot | null = null;
let unsubscribe: (() => void) | null = null;
let starting = false;

async function ensureListener() {
  if (unsubscribe || starting || subscribers.size === 0) return;
  starting = true;
  try {
    await waitForAuth();
    if (subscribers.size === 0 || unsubscribe) return;
    unsubscribe = onValue(
      ref(rtdb, "activeBuses"),
      (snapshot) => {
        cached = snapshot.val() as LiveBusSnapshot | null;
        subscribers.forEach((subscriber) => subscriber.next(cached));
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
  if (cached !== null) next(cached);
  void ensureListener();

  return () => {
    subscribers.delete(subscriber);
    if (subscribers.size === 0) {
      unsubscribe?.();
      unsubscribe = null;
      cached = null;
    }
  };
}
