import type { Reference } from "firebase-admin/database";
import { assertWorkerLeadership, workerRtdbTransaction } from "../lib/workerFence";

export const STALE_SWEEP_PAGE_SIZE = 25;
export const STALE_SWEEP_WRITE_CONCURRENCY = 4;
const IDENTITY_FIELDS = ["timestamp", "seq", "backendReceivedAt", "busId", "routeId", "driverId", "sessionId", "status", "tripState"];

/** One indexed page per tick; retries keep the cursor before a failed page. */
export function createStaleBusSweeper(source: Reference, staleMs: number, onError: (error: unknown) => void, now = Date.now) {
  const stats = { pageReads: 0, pages: 0, examined: 0, markedOffline: 0, removed: 0, aborted: 0, failed: 0,
    transactionAttempts: 0, cycles: 0, maxPageRecords: 0, maxActiveWrites: 0 };
  let stopped = false; let inFlight: Promise<void> | null = null;
  let cursor: { timestamp: number; key: string } | null = null;
  let cutoff: number | null = null; let nextSweepAt = 0; let nextAttemptAt = 0; let consecutiveFailures = 0; let activeWrites = 0;
  if (!Number.isFinite(staleMs) || staleMs <= 0) throw new RangeError("Stale interval must be positive.");
  const deferRetry = () => {
    consecutiveFailures++;
    nextAttemptAt = now() + Math.min(30_000, 1000 * 2 ** Math.min(5, consecutiveFailures - 1));
  };
  return {
    tick(): Promise<void> {
      if (stopped || inFlight || now() < nextAttemptAt || (cutoff === null && now() < nextSweepAt)) return inFlight ?? Promise.resolve();
      const running = (async () => {
        assertWorkerLeadership();
        cutoff ??= now() - staleMs;
        let query = source.orderByChild("timestamp");
        query = cursor ? query.startAfter(cursor.timestamp, cursor.key) : query.startAt(0);
        stats.pageReads++;
        const page = await query.endAt(cutoff).limitToFirst(STALE_SWEEP_PAGE_SIZE).once("value");
        if (stopped) return;
        const children: import("firebase-admin/database").DataSnapshot[] = [];
        page.forEach(child => { children.push(child); });
        if (children.length > STALE_SWEEP_PAGE_SIZE) throw new Error("Stale sweep exceeded its page bound.");
        stats.pages++; stats.examined += children.length; stats.maxPageRecords = Math.max(stats.maxPageRecords, children.length);
        let pageFailed = false;
        const write = async (child: import("firebase-admin/database").DataSnapshot) => {
          const data = child.val() as Record<string, unknown> | null;
          if (stopped || !data || typeof data.timestamp !== "number" || !Number.isFinite(data.timestamp) || data.timestamp >= cutoff!) return;
          const active = data.status === "active" && (data.tripState === "pre_departure" || data.tripState === "in_service");
          if (active && data.deviceState === "offline") return;
          activeWrites++; stats.maxActiveWrites = Math.max(stats.maxActiveWrites, activeWrites);
          try {
            const result = await workerRtdbTransaction(child.ref, current => {
              stats.transactionAttempts++;
              // A fresh fix, reused session or same-fix lifecycle transition wins
              // even when it happened after this page was read.
              if (stopped) return;
              // Empty SDK cache must retry against the server, rather than
              // aborting cleanup before authority has ever been consulted.
              if (current === null) return null;
              if (!current || IDENTITY_FIELDS.some(field => current[field] !== data[field])) return;
              if (active) {
                if (current.deviceState === "offline") return;
                return { ...current, deviceState: "offline", signalState: "lost", lifecycleUpdatedAt: { ".sv": "timestamp" } };
              }
              return null;
            });
            if (!result.committed) stats.aborted++;
            else if (active && result.snapshot.exists()) stats.markedOffline++;
            else if (active) stats.aborted++;
            else stats.removed++;
          } catch (error) {
            pageFailed = true; stats.failed++;
            try { onError(error); } catch { /* Diagnostics cannot prevent retry. */ }
          } finally { activeWrites--; }
        };
        for (let offset = 0; offset < children.length && !stopped; offset += STALE_SWEEP_WRITE_CONCURRENCY) {
          await Promise.all(children.slice(offset, offset + STALE_SWEEP_WRITE_CONCURRENCY).map(write));
        }
        if (stopped) return;
        if (pageFailed) { deferRetry(); return; }
        consecutiveFailures = 0; nextAttemptAt = 0;
        if (children.length === STALE_SWEEP_PAGE_SIZE) {
          const last = children.at(-1)!; const timestamp = (last.val() as { timestamp?: unknown } | null)?.timestamp;
          if (typeof timestamp !== "number" || !Number.isFinite(timestamp) || !last.key) throw new Error("Invalid stale-sweep cursor.");
          cursor = { timestamp, key: last.key };
        } else {
          cutoff = null; cursor = null; nextSweepAt = now() + staleMs; stats.cycles++;
        }
      })().catch(error => {
        stats.failed++; deferRetry();
        try { onError(error); } catch { /* Keep the failed page recoverable. */ }
      }).finally(() => { if (inFlight === running) inFlight = null; });
      inFlight = running; return running;
    },
    stop() { stopped = true; },
    pending() { return inFlight; },
    snapshot() { return { ...stats, activeWrites, pending: inFlight !== null, hasMore: cutoff !== null, pageSize: STALE_SWEEP_PAGE_SIZE }; },
  };
}
