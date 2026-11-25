"use client";
import { useEffect, useState } from "react";
import { onValue, ref } from "firebase/database";
import { rtdb } from "@/lib/firebaseDatabase";
import { getAuthVerificationGeneration, waitForAuth } from "@/lib/authState";
import { liveBusRetryDelayMs } from "@/lib/liveBusRetry";
import { isCatalogReceiptLost } from "@/lib/liveBusFreshness";
import { serverNow } from "@/lib/serverClock";
import { attachServerClock } from "@/lib/serverClockSync";
import { useAuth } from "./useAuth";
import { isPermissionDeniedError } from "@/lib/liveDataErrors";
export interface LiveRouteAvailability { active: number; available: number; freshestAt: number; activeReceipts?: number[]; availableReceipts?: number[] }
export function useLiveRouteCatalog(recoveryKey = "") {
  const { user, loading, roleError } = useAuth();
  const generation = getAuthVerificationGeneration();
  const [state, setState] = useState({ catalog: {} as Record<string, LiveRouteAvailability>, projectionReady: false, catalogReady: false, error: null as string | null, accessDenied: false, generation, recoveryKey });
  const [revision, setRevision] = useState(0);
  const [now, setNow] = useState(() => serverNow());
  useEffect(() => {
    let alive = true, epoch = 0, attempt = 0;
    let disposals: Array<() => void> = [], timer: ReturnType<typeof setTimeout> | undefined;
    let projectionReady = false, catalogReady = false;
    let catalog: Record<string, LiveRouteAvailability> = {};
    let markerError: string | null = null, catalogError: string | null = null;
    let markerDenied = false, catalogDenied = false;
    const current = (expected: number) => alive && expected === epoch && generation === getAuthVerificationGeneration();
    const publish = () => setState({ catalog, projectionReady, catalogReady, error: markerError || catalogError, accessDenied: markerDenied || catalogDenied, generation, recoveryKey });
    const detach = () => { epoch++; disposals.forEach(stop => stop()); disposals = []; };
    const attach = async () => {
      const expected = epoch;
      try {
        await waitForAuth();
        if (!current(expected) || !user || loading || roleError) return;
        // Receipts are server times; judge them on the server timeline.
        disposals.push(attachServerClock(() => { if (current(expected)) setNow(serverNow()); }));
        disposals.push(onValue(ref(rtdb, "clientProjectionStatus/public"), snapshot => {
          if (!current(expected)) return;
          const value = snapshot.val();
          projectionReady = value?.schemaVersion === 1 && value?.ready === true;
          markerDenied = false;
          markerError = projectionReady ? null : "Live bus data is unavailable. The projection worker must finish backfill with a compatible schema. Retry after it is ready.";
          if (projectionReady && catalogReady && !catalogError) attempt = 0;
          publish();
        }, error => fail(expected, "marker", error)));
        disposals.push(onValue(ref(rtdb, "liveRouteCatalog/values"), snapshot => {
          if (!current(expected)) return;
          const raw = snapshot.val();
          const entries = Object.entries(raw && typeof raw === "object" ? raw : {}).flatMap(([key, item]) => {
            if (!key.startsWith("route:")) return [];
            const routeId = key.startsWith("route:") ? key.slice(6) : key;
            const value = item as LiveRouteAvailability;
            const receipts = value?.availableReceipts ?? [];
            const activeReceipts = value?.activeReceipts ?? [];
            if (!/^[A-Za-z0-9_-]{1,128}$/.test(routeId) || !value || !Number.isSafeInteger(value.active) || value.active < 0 ||
              ![receipts, activeReceipts].every(items => Array.isArray(items) && items.every(at => typeof at === "number" && Number.isFinite(at)))) return [];
            // Old publishers lack an active freshness lease: fail closed until
            // backfill rather than resurrecting a cached, disconnected ride.
            return [[routeId, { active: value.active, available: 0, freshestAt: value.freshestAt ?? 0, activeReceipts, availableReceipts: receipts }] as const];
          });
          catalog = Object.fromEntries(entries); catalogReady = true; catalogError = null; catalogDenied = false;
          if (projectionReady && !markerError) attempt = 0;
          publish(); setNow(serverNow());
        }, error => fail(expected, "catalog", error)));
      } catch { if (current(expected)) fail(expected, "marker"); }
    };
    const fail = (expected: number, channel: "marker" | "catalog", error?: unknown) => {
      if (!current(expected)) return;
      // A permission denial is not a connection problem: say so. Retries keep
      // failing after a denial; only a delivery on that channel clears it.
      const denied = isPermissionDeniedError(error);
      if (channel === "marker") { projectionReady = false; markerDenied ||= denied; markerError = "Live bus data could not be loaded. Check deployment permissions and retry."; }
      else { catalogReady = false; catalogDenied ||= denied; catalogError = catalogDenied ? "Live route availability could not be loaded: access to live data was denied." : "Live route availability could not be loaded. Check your connection and retry."; }
      publish(); detach();
      if (!timer) timer = setTimeout(() => { timer = undefined; void attach(); }, liveBusRetryDelayMs(attempt++));
    };
    queueMicrotask(() => { if (alive) { catalog = {}; projectionReady = false; catalogReady = false; publish(); } });
    void attach();
    const expiry = setInterval(() => { if (alive) setNow(serverNow()); }, 1000);
    return () => { alive = false; detach(); if (timer) clearTimeout(timer); clearInterval(expiry); };
  }, [generation, user, loading, roleError, revision, recoveryKey]);
  const compatible = state.generation === generation && state.recoveryKey === recoveryKey;
  const catalog = compatible && state.projectionReady && state.catalogReady
    ? Object.fromEntries(Object.entries(state.catalog).map(([routeId, value]) => [routeId, { ...value,
      active: Math.min(value.active, (value.activeReceipts ?? []).filter(at => !isCatalogReceiptLost(at, now)).length),
      available: (value.availableReceipts ?? []).filter(at => !isCatalogReceiptLost(at, now)).length }])) : {};
  return { catalog, projectionReady: compatible && state.projectionReady, catalogReady: compatible && state.catalogReady, error: compatible ? state.error : null, accessDenied: compatible && state.accessDenied, retry: () => setRevision(value => value + 1) };
}
