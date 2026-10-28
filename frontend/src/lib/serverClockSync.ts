"use client";

import { onValue, ref } from "firebase/database";
import { rtdb } from "./firebaseDatabase";
import { serverTimeOffsetMs, setServerTimeOffset } from "./serverClock";

/**
 * Keep the shared server-clock offset current while a live listener needs it.
 * `onOffset` receives each accepted offset with the one this caller last saw,
 * so a consumer can re-evaluate freshness when the estimate moves.
 */
export function attachServerClock(
  onOffset?: (offsetMs: number, previousOffsetMs: number) => void,
): () => void {
  let seen = serverTimeOffsetMs();
  return onValue(ref(rtdb, ".info/serverTimeOffset"), (snapshot) => {
    if (!setServerTimeOffset(snapshot.val())) return;
    const previous = seen;
    seen = serverTimeOffsetMs();
    onOffset?.(seen, previous);
  });
}
