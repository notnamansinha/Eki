"use client";

import { useEffect, useState } from "react";
import { subscribeLiveBuses } from "@/lib/liveBusStore";
import {
  filterActiveBusEntries,
  type ActiveBusEntry,
} from "@/lib/activeBusEntries";

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

  useEffect(() => {
    const unsubscribe = subscribeLiveBuses(
      (snapshot) => {
        markSnapshotReceived?.();
        setActive(
          filterActiveBusEntries(snapshot as Record<string, unknown> | null),
        );
      },
      (error) => {
        console.warn("[RTDB] activeBuses read failed:", error.message);
      },
    );
    return unsubscribe;
  }, [connectionGeneration, resumeGeneration, markSnapshotReceived]);

  return active;
}
