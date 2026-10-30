"use client";

import { useEffect, useState } from "react";
import { serverNow } from "@/lib/serverClock";
import { liveBusHealth, nextLiveBusHealthChangeAt, type LiveBusHealthInput } from "@/lib/liveBusHealth";

// While a bus is degraded its "N s ago" text keeps counting; live buses only
// re-render at their next threshold crossing.
const DEGRADED_REFRESH_MS = 5_000;

/**
 * Server-timeline clock that re-renders exactly when a watched bus's live
 * health can change during silence: no new snapshot, and no running backend,
 * is needed to stop calling a silent bus live. Also refreshes on tab resume.
 */
export function useLiveHealthClock(buses: readonly LiveBusHealthInput[]): number {
  const [now, setNow] = useState(() => serverNow());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = undefined;
      const current = serverNow();
      const deadlines = buses.flatMap(bus => {
        const next = nextLiveBusHealthChangeAt(bus, current);
        const degraded = liveBusHealth(bus, current).state !== "live" ? current + DEGRADED_REFRESH_MS : undefined;
        return [next, degraded].filter((value): value is number => value !== undefined);
      });
      if (deadlines.length === 0) return;
      timer = setTimeout(() => { setNow(serverNow()); schedule(); }, Math.max(0, Math.min(...deadlines) - current) + 5);
    };
    const resume = () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      setNow(serverNow());
      schedule();
    };
    schedule();
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("focus", resume);
    window.addEventListener("online", resume);
    return () => {
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("focus", resume);
      window.removeEventListener("online", resume);
    };
  }, [buses]);
  return now;
}
