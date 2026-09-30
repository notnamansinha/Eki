"use client";

import { useEffect, useRef, useState } from "react";
import {
  selectLiveBusMarkerPosition,
  type LiveBusMarkerSelection,
  type LiveBusPositionInput,
} from "@/lib/liveBusMarkerPosition";

const EMPTY_INPUT: LiveBusPositionInput = {};

/** Keep both live maps on the same bounded raw/matched selection policy. */
export function useLiveBusMarkerPosition(
  input: LiveBusPositionInput | null | undefined,
): LiveBusMarkerSelection {
  const inputRef = useRef<LiveBusPositionInput>(input ?? EMPTY_INPUT);
  const [current, setCurrent] = useState(() =>
    selectLiveBusMarkerPosition(input ?? EMPTY_INPUT),
  );
  const selectionRef = useRef<LiveBusMarkerSelection>(current);

  useEffect(() => {
    inputRef.current = input ?? EMPTY_INPUT;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;

    const refresh = () => {
      if (cancelled) return;
      const now = Date.now();
      const next = selectLiveBusMarkerPosition(
        inputRef.current,
        selectionRef.current,
        now,
      );
      selectionRef.current = next;
      setCurrent(next);
      if (next.decision === "match_pending" && next.pendingUntil !== undefined) {
        timer = setTimeout(refresh, Math.max(1, next.pendingUntil - now));
      }
    };

    refresh();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [input]);

  return current;
}
