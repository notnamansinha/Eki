"use client";

import { useCallback, useEffect, useState } from "react";
import { onValue, ref } from "firebase/database";
import { rtdb } from "@/lib/firebaseDatabase";
import { getAuthVerificationGeneration, waitForAuth } from "@/lib/authState";
import { BUS_EXPIRY_MS, isLiveBusTimestamp } from "@/lib/liveBusFreshness";
import { liveBusRetryDelayMs } from "@/lib/liveBusRetry";
import { useAuth } from "./useAuth";

export interface LiveRouteAvailability {
  active: number; available: number; freshestAt: number;
  previewFreshness?: Record<string, number>;
}
export function availablePreviewCount(value: LiveRouteAvailability, now: number): number {
  if (value.previewFreshness) return Object.entries(value.previewFreshness)
    .reduce((count, [at, buses]) => count + (isLiveBusTimestamp(Number(at), now) ? buses : 0), 0);
  return isLiveBusTimestamp(value.freshestAt, now) ? value.available : 0;
}

export function useLiveRouteCatalog() {
  const { user, loading, roleError } = useAuth();
  const generation = getAuthVerificationGeneration();
  const [state, setState] = useState({ generation, catalog: {} as Record<string, LiveRouteAvailability>, error: null as string | null });
  const [now, setNow] = useState(() => Date.now());
  const [retryGeneration, setRetryGeneration] = useState(0);
  const retry = useCallback(() => setRetryGeneration(value => value + 1), []);
  const allowed = Boolean(user) && !loading && !roleError;
  useEffect(() => {
    let alive = true; let detach: (() => void) | undefined;
    let retryTimer: ReturnType<typeof setTimeout> | undefined; let attempt = 0;
    const current = () => alive && generation === getAuthVerificationGeneration();
    const fail = () => {
      if (!current()) return;
      detach?.(); detach = undefined;
      setState({ generation, catalog: {}, error: "Live route availability is unavailable. Check your access or retry." });
      retryTimer = setTimeout(() => { void attach(); }, liveBusRetryDelayMs(attempt++));
    };
    const attach = async () => {
      if (!allowed) return;
      try { await waitForAuth(); } catch { fail(); return; }
      if (!current()) return;
      detach = onValue(ref(rtdb, "liveRouteCatalog/values"), snapshot => {
        if (!current()) return;
        attempt = 0;
        const raw = snapshot.val() as Record<string, LiveRouteAvailability> | null;
        const catalog = Object.fromEntries(Object.entries(raw ?? {}).flatMap(([key, value]) => {
          if (!value || !Number.isSafeInteger(value.active) || value.active < 0 ||
              !Number.isSafeInteger(value.available) || value.available < 0 ||
              typeof value.freshestAt !== "number" || !Number.isFinite(value.freshestAt)) return [];
          const previewFreshness = value.previewFreshness && typeof value.previewFreshness === "object"
            ? Object.fromEntries(Object.entries(value.previewFreshness).filter(([at, count]) =>
                Number.isFinite(Number(at)) && Number(at) > 0 && Number.isSafeInteger(count) && count > 0))
            : undefined;
          return [[key, { active: value.active, available: value.available, freshestAt: value.freshestAt,
            ...(previewFreshness ? { previewFreshness } : {}) }]];
        }));
        setState({ generation, catalog, error: null }); setNow(Date.now());
      }, fail);
    };
    queueMicrotask(() => { if (current()) setState({ generation, catalog: {}, error: null }); });
    void attach();
    return () => { alive = false; detach?.(); if (retryTimer) clearTimeout(retryTimer); };
  }, [generation, allowed, retryGeneration]);

  useEffect(() => {
    if (!allowed || state.generation !== generation) return;
    let delay = Infinity;
    const time = Date.now();
    for (const value of Object.values(state.catalog)) {
      const times = value.previewFreshness ? Object.keys(value.previewFreshness).map(Number) : [value.freshestAt];
      for (const at of times) {
        if (at > time + 10_000) delay = Math.min(delay, at - time - 10_000);
        else if (at + BUS_EXPIRY_MS > time) delay = Math.min(delay, at + BUS_EXPIRY_MS - time);
      }
    }
    if (!Number.isFinite(delay)) return;
    const timer = setTimeout(() => setNow(Date.now()), Math.max(1, delay));
    return () => clearTimeout(timer);
  }, [allowed, generation, state, now]);
  const catalog = allowed && state.generation === generation ? Object.fromEntries(Object.entries(state.catalog)
    .map(([routeId, value]) => [routeId, { ...value, available: availablePreviewCount(value, now) }])) : {};
  return { catalog, error: allowed && state.generation === generation ? state.error : null, retry };
}
