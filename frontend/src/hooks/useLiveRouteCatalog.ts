"use client";

import { useEffect, useState } from "react";
import { onValue, ref } from "firebase/database";
import { rtdb } from "@/lib/firebaseDatabase";
import { getAuthVerificationGeneration, waitForAuth } from "@/lib/authState";
import { liveBusRetryDelayMs } from "@/lib/liveBusRetry";
import { useAuth } from "./useAuth";

export interface LiveRouteAvailability { active: number; available: number; freshestAt: number }
export function useLiveRouteCatalog() {
  const { user, loading, roleError } = useAuth();
  const generation = getAuthVerificationGeneration();
  const [catalog, setCatalog] = useState<Record<string, LiveRouteAvailability>>({});
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let alive = true; let detach: (() => void) | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined; let attempt = 0;
    const current = () => alive && generation === getAuthVerificationGeneration();
    const attach = async () => {
      try { await waitForAuth(); } catch {
        if (current()) retry = setTimeout(() => { void attach(); }, liveBusRetryDelayMs(attempt++));
        return;
      }
      if (!current() || !user || loading || roleError) return;
      detach = onValue(ref(rtdb, "liveRouteCatalog/values"), snapshot => {
        if (!current()) return;
        attempt = 0;
        const raw = snapshot.val() as Record<string, LiveRouteAvailability> | null;
        setCatalog(Object.fromEntries(Object.entries(raw ?? {}).filter(([, value]) => value &&
          Number.isSafeInteger(value.active) && value.active >= 0 && Number.isSafeInteger(value.available) && value.available >= 0 &&
          typeof value.freshestAt === "number" && Number.isFinite(value.freshestAt))));
        setNow(Date.now());
      }, () => {
        if (!current()) return;
        detach?.(); setCatalog({});
        retry = setTimeout(() => { void attach(); }, liveBusRetryDelayMs(attempt++));
      });
    };
    queueMicrotask(() => { if (current()) setCatalog({}); });
    void attach();
    const expiry = setInterval(() => { if (current()) setNow(Date.now()); }, 60_000);
    return () => { alive = false; detach?.(); if (retry) clearTimeout(retry); clearInterval(expiry); };
  }, [generation, user, loading, roleError]);
  return Object.fromEntries(Object.entries(catalog).map(([routeId, value]) => [routeId,
    { ...value, available: now - value.freshestAt < 360_000 ? value.available : 0 }]));
}
