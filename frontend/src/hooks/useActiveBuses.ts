"use client";

import { useEffect, useRef, useState } from "react";
import { subscribeLiveBusChanges } from "@/lib/liveBusStore";
import {
  isActiveBusEntry,
  type ActiveBusEntry,
} from "@/lib/activeBusEntries";
import { isAuthoritativeLiveBusDelivery } from "@/lib/liveBusDelivery";

export type { ActiveBusEntry } from "@/lib/activeBusEntries";

export interface UseActiveBusesOptions {
  /**
   * RTDB reconnection lifecycle (from useRTDBResume). Optional so the fleet
   * panel can call useActiveBuses() with no wiring; when present, the
   * subscription re-attaches after a reconnect so the resume UX works.
   */
  connectionGeneration?: number;
  resumeGeneration?: number;
  markSnapshotReceived?: () => void;
}

/**
 * Shared live-fleet subscription. One hook, one filter, one ActiveBusEntry
 * type — the admin dashboard and fleet panel can no longer disagree about
 * which buses are active.
 */
export function useActiveBuses(options: UseActiveBusesOptions = {}): ActiveBusEntry[] {
  const { connectionGeneration, resumeGeneration, markSnapshotReceived } = options;
  const [active, setActive] = useState<ActiveBusEntry[]>([]);
  const activeByKeyRef = useRef(new Map<string, ActiveBusEntry>());

  useEffect(() => {
    const unsubscribe = subscribeLiveBusChanges(
      (change) => {
        if (isAuthoritativeLiveBusDelivery(change.source)) {
          markSnapshotReceived?.();
        }
        if (change.type === "reset") {
          activeByKeyRef.current = new Map(
            Object.entries(change.snapshot ?? {}).flatMap(([key, value]) =>
              isActiveBusEntry(value) ? [[key, value] as const] : []
            ),
          );
        } else if (change.type === "remove") {
          activeByKeyRef.current.delete(change.key);
        } else if (isActiveBusEntry(change.value)) {
          activeByKeyRef.current.set(change.key, change.value);
        } else {
          activeByKeyRef.current.delete(change.key);
        }
        setActive([...activeByKeyRef.current.values()]);
      },
      (error) => {
        console.warn("[RTDB] activeBuses read failed:", error.message);
      },
    );
    return () => {
      unsubscribe();
      activeByKeyRef.current.clear();
    };
  }, [connectionGeneration, resumeGeneration, markSnapshotReceived]);

  return active;
}
