"use client";
import { useEffect, useState } from "react";
import { onValue, ref } from "firebase/database";
import { rtdb } from "@/lib/firebaseDatabase";
import { getAuthVerificationGeneration, waitForAuth } from "@/lib/authState";
import { liveBusRetryDelayMs } from "@/lib/liveBusRetry";
import { isLiveBusTimestamp } from "@/lib/liveBusFreshness";
import { useAuth } from "./useAuth";
export interface LiveRouteAvailability { active: number; available: number; freshestAt: number; availableReceipts?: number[] }
export function useLiveRouteCatalog(recoveryKey = "") {
  const { user, loading, roleError } = useAuth();
  const generation = getAuthVerificationGeneration();
  const [state, setState] = useState({ catalog: {} as Record<string, LiveRouteAvailability>, projectionReady: false, catalogReady: false, error: null as string | null, generation, recoveryKey });
  const [revision, setRevision] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let alive = true, epoch = 0, attempt = 0;
    let disposals: Array<() => void> = [], timer: ReturnType<typeof setTimeout> | undefined;
    let projectionReady = false, catalogReady = false;
    let catalog: Record<string, LiveRouteAvailability> = {};
    let markerError: string | null = null, catalogError: string | null = null;
    const current = (expected: number) => alive && expected === epoch && generation === getAuthVerificationGeneration();
    const publish = () => setState({ catalog, projectionReady, catalogReady, error: markerError || catalogError, generation, recoveryKey });
    const detach = () => { epoch++; disposals.forEach(stop => stop()); disposals = []; };
    const attach = async () => {
      const expected = epoch;
      try {
        await waitForAuth();
        if (!current(expected) || !user || loading || roleError) return;
        disposals.push(onValue(ref(rtdb, "clientProjectionStatus/public"), snapshot => {
          if (!current(expected)) return;
          const value = snapshot.val();
          projectionReady = value?.schemaVersion === 1 && value?.ready === true;
          markerError = projectionReady ? null : "Live bus data is unavailable. The projection worker must finish backfill with a compatible schema. Retry after it is ready.";
          if (projectionReady && catalogReady && !catalogError) attempt = 0;
          publish();
        }, () => fail(expected, "marker")));
        disposals.push(onValue(ref(rtdb, "liveRouteCatalog/values"), snapshot => {
          if (!current(expected)) return;
          const raw = snapshot.val();
          const entries = Object.entries(raw && typeof raw === "object" ? raw : {}).flatMap(([key, item]) => {
            if (!key.startsWith("route:")) return [];
            const routeId = key.startsWith("route:") ? key.slice(6) : key;
            const value = item as LiveRouteAvailability;
            const receipts = value?.availableReceipts ?? [];
            if (!/^[A-Za-z0-9_-]{1,128}$/.test(routeId) || !value || !Number.isSafeInteger(value.active) || value.active < 0 || !Array.isArray(receipts) || !receipts.every(at => typeof at === "number" && Number.isFinite(at))) return [];
            return [[routeId, { active: value.active, available: 0, freshestAt: value.freshestAt ?? 0, availableReceipts: receipts }] as const];
          });
          catalog = Object.fromEntries(entries); catalogReady = true; catalogError = null;
          if (projectionReady && !markerError) attempt = 0;
          publish(); setNow(Date.now());
        }, () => fail(expected, "catalog")));
      } catch { if (current(expected)) fail(expected, "marker"); }
    };
    const fail = (expected: number, channel: "marker" | "catalog") => {
      if (!current(expected)) return;
      if (channel === "marker") { projectionReady = false; markerError = "Live bus data could not be loaded. Check deployment permissions and retry."; }
      else { catalogReady = false; catalogError = "Live route availability could not be loaded. Check your connection and retry."; }
      publish(); detach();
      if (!timer) timer = setTimeout(() => { timer = undefined; void attach(); }, liveBusRetryDelayMs(attempt++));
    };
    queueMicrotask(() => { if (alive) { catalog = {}; projectionReady = false; catalogReady = false; publish(); } });
    void attach();
    const expiry = setInterval(() => { if (alive) setNow(Date.now()); }, 1000);
    return () => { alive = false; detach(); if (timer) clearTimeout(timer); clearInterval(expiry); };
  }, [generation, user, loading, roleError, revision, recoveryKey]);
  const compatible = state.generation === generation && state.recoveryKey === recoveryKey;
  const catalog = compatible && state.projectionReady && state.catalogReady
    ? Object.fromEntries(Object.entries(state.catalog).map(([routeId, value]) => [routeId, { ...value, available: (value.availableReceipts ?? []).filter(at => isLiveBusTimestamp(at, now)).length }])) : {};
  return { catalog, projectionReady: compatible && state.projectionReady, catalogReady: compatible && state.catalogReady, error: compatible ? state.error : null, retry: () => setRevision(value => value + 1) };
}
