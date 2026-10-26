import { assertWorkerLeadership, workerTransaction, workerRtdbTransaction } from "../lib/workerFence";
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import type { Database } from "firebase-admin/database";
import { db, rtdb } from "../lib/firebaseAdmin";
import {
  DEFAULT_ABANDONED_RIDE_THRESHOLD_MS,
  latestActiveRideActivity,
  latestLiveBusActivity,
  matchingSession,
  reconciliationDecision,
} from "./abandonedRideReconciliationLogic";

import { BoundedKeyedExecutor } from "../lib/boundedKeyedExecutor";
import { reconciliationPage, forEachBounded, settleTogether } from "../lib/reconciliationPages";
const backgroundScans = new BoundedKeyedExecutor<string>({ maxConcurrent: 1, maxPending: 1, maxPendingPerKey: 1, maxQueueAgeMs: 5_000 });
const pageExecutions = new BoundedKeyedExecutor<string>({ maxConcurrent: 1, maxPending: 3, maxPendingPerKey: 3, maxQueueAgeMs: 5_000 });

const RECONCILIATION_INTERVAL_MS = 60 * 60 * 1000;
const INTERRUPTION_REASON = "abandoned_session_timeout";

function configuredThresholdMs(value: string | undefined): number {
  const hours = Number(value);
  return Number.isFinite(hours) && hours >= 1
    ? Math.floor(hours * 60 * 60 * 1000)
    : DEFAULT_ABANDONED_RIDE_THRESHOLD_MS;
}

const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;

// An identifier that cannot address a Firestore document or RTDB node would
// throw for the whole page and retain its cursor forever; skip it instead.
function lifecycleKey(session: Record<string, unknown>): string | null {
  return typeof session.busId === "string" && SAFE_ID.test(session.busId) &&
    typeof session.routeId === "string" && SAFE_ID.test(session.routeId)
    ? `${session.busId}_${session.routeId}`
    : null;
}

export interface AbandonedRideReconciliationSummary {
  dryRun: boolean;
  now: number;
  thresholdMs: number;
  scanned: number;
  nextCursor: string | null;
  staleIds: string[];
  interruptedIds: string[];
  protectedIds: string[];
  skippedIds: string[];
  activeRideIdsDeleted: string[];
  liveNodeKeysRetired: string[];
}

export interface AbandonedRideReconciliationOptions {
  cursor?: string;
  now?: number;
  thresholdMs?: number;
  dryRun?: boolean;
  firestore?: Firestore;
  realtimeDatabase?: Database;
}

/**
 * Reconcile one snapshot of abandoned ride sessions. Supplying dryRun=true
 * performs all reads and returns the same candidate IDs without writing.
 * Mutating runs re-check both stores and use conditional transactions so a
 * newly active lifecycle cannot be overwritten by the sweep's earlier read.
 */
export async function runAbandonedRideReconciliation(
  options: AbandonedRideReconciliationOptions = {},
): Promise<AbandonedRideReconciliationSummary> {
  return pageExecutions.run("abandoned", () => runReconciliationPage(options));
}
async function runReconciliationPage(options: AbandonedRideReconciliationOptions): Promise<AbandonedRideReconciliationSummary> {
  assertWorkerLeadership();
  const now = options.now ?? Date.now();
  const thresholdMs = options.thresholdMs ?? configuredThresholdMs(
    process.env.ABANDONED_RIDE_THRESHOLD_HOURS,
  );
  if (!Number.isFinite(thresholdMs) || thresholdMs < 60 * 60 * 1000) {
    throw new Error("Abandoned ride threshold must be at least one hour.");
  }
  const dryRun = options.dryRun ?? false;
  const firestore = options.firestore ?? db;
  const realtimeDatabase = options.realtimeDatabase ?? rtdb;
  const cutoff = now - thresholdMs;
  const summary: AbandonedRideReconciliationSummary = {
    dryRun,
    now,
    thresholdMs,
    scanned: 0, nextCursor: null,
    staleIds: [],
    interruptedIds: [],
    protectedIds: [],
    skippedIds: [],
    activeRideIdsDeleted: [],
    liveNodeKeysRetired: [],
  };

  const page = await reconciliationPage(firestore.collection("ride_sessions")
    .where("status", "in", ["pending", "armed", "active"]), options.cursor);
  summary.scanned = page.docs.length; summary.nextCursor = page.nextCursor;

  await forEachBounded(page.docs, 4, async sessionDocument => {
    assertWorkerLeadership();
    const sessionId = sessionDocument.id;
    const initialSession = sessionDocument.data();
    const key = lifecycleKey(initialSession);
    if (!key) {
      summary.skippedIds.push(sessionId);
      return;
    }
    const activeRideRef = firestore.collection("active_rides").doc(key);
    const busId = typeof initialSession.busId === "string" ? initialSession.busId : "";
    const busLockRef = firestore.collection("_active_bus_locks").doc(busId);
    const liveRef = realtimeDatabase.ref(`activeBuses/${key}`);
    const [initialActiveRideDocument, initialLiveSnapshot] = await settleTogether([activeRideRef.get(), liveRef.once("value")]);
    const initialActiveRide = initialActiveRideDocument.exists
      ? initialActiveRideDocument.data() ?? null
      : null;
    const rawLive = initialLiveSnapshot.val();
    const initialLiveBus = rawLive && typeof rawLive === "object" && !Array.isArray(rawLive) ? rawLive as Record<string, unknown> : null;
    const initialDecision = reconciliationDecision(
      sessionId,
      initialSession,
      initialActiveRide,
      initialLiveBus,
      cutoff,
      now,
    );
    if (!initialDecision.stale) {
      summary.protectedIds.push(sessionId);
      return;
    }
    summary.staleIds.push(sessionId);
    if (dryRun) return;

    let liveBlocked = false;
    let retiredLiveRecord: Record<string, unknown> | null = null;
    await workerRtdbTransaction(liveRef, (currentValue) => {
      liveBlocked = false;
      retiredLiveRecord = null;
      const current = currentValue && typeof currentValue === "object"
        ? currentValue as Record<string, unknown>
        : null;
      // RTDB can start a transaction with an empty local cache. Returning
      // undefined here would abort before the server supplies its real value.
      if (currentValue === null) return null;
      if (!matchingSession(current, sessionId)) return;
      const activity = latestLiveBusActivity(current!);
      if (activity === null || activity > cutoff) {
        liveBlocked = true;
        return;
      }
      retiredLiveRecord = current;
      return null;
    });
    if (liveBlocked) {
      summary.protectedIds.push(sessionId);
      return;
    }

    const transactionResult = await workerTransaction(firestore, async (transaction) => {
      const sessionRef = firestore.collection("ride_sessions").doc(sessionId);
      const [currentSessionDocument, currentActiveRideDocument, currentBusLock] = await settleTogether([
        transaction.get(sessionRef),
        transaction.get(activeRideRef),
        transaction.get(busLockRef),
      ]);
      if (!currentSessionDocument.exists) return { interrupted: false, deleted: false };
      const currentSession = currentSessionDocument.data()!;
      const currentActiveRide = currentActiveRideDocument.exists
        ? currentActiveRideDocument.data() ?? null
        : null;
      const decision = reconciliationDecision(
        sessionId,
        currentSession,
        currentActiveRide,
        retiredLiveRecord,
        cutoff,
        now,
      );
      if (!decision.stale || decision.lastActivity === null) {
        return { interrupted: false, deleted: false };
      }

      transaction.set(sessionRef, {
        status: "interrupted",
        endTime: decision.lastActivity,
        interruptionReason: INTERRUPTION_REASON,
        reconciledAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });

      const deleteActiveRide = matchingSession(currentActiveRide, sessionId) &&
        latestActiveRideActivity(currentActiveRide!) !== null &&
        latestActiveRideActivity(currentActiveRide!)! <= cutoff;
      if (deleteActiveRide) transaction.delete(activeRideRef);
      if (currentBusLock.data()?.sessionId === sessionId) {
        transaction.delete(busLockRef);
      }
      return { interrupted: true, deleted: deleteActiveRide };
    });

    if (!transactionResult.interrupted) {
      summary.protectedIds.push(sessionId);
      return;
    }
    summary.interruptedIds.push(sessionId);
    if (transactionResult.deleted) summary.activeRideIdsDeleted.push(key);
    if (retiredLiveRecord) summary.liveNodeKeysRetired.push(key);
  });

  summary.staleIds.sort();
  summary.interruptedIds.sort();
  summary.protectedIds = [...new Set(summary.protectedIds)].sort();
  summary.skippedIds.sort();
  summary.activeRideIdsDeleted.sort();
  summary.liveNodeKeysRetired.sort();
  return summary;
}

export function startAbandonedRideReconciler(): () => void {
  let stopped = false; let inFlight = false;
  const cursorRef = db.collection("_reconciliation_cursors").doc("abandoned-sessions");
  const run = async () => {
    if (stopped || inFlight) return;
    inFlight = true;
    try {
      await backgroundScans.run("abandoned", async () => {
        if (stopped) return;
        assertWorkerLeadership();
        const saved = await cursorRef.get();
        let cursor = typeof saved.data()?.cursor === "string" ? saved.data()!.cursor as string : undefined;
        do {
          if (stopped) break;
          assertWorkerLeadership();
          const summary = await runAbandonedRideReconciliation({ cursor });
          await workerTransaction(db, async transaction => {
            transaction.set(cursorRef, { cursor: summary.nextCursor, updatedAt: FieldValue.serverTimestamp() });
          });
          console.log("[RideReconciliation] Page complete", summary);
          cursor = summary.nextCursor ?? undefined;
        } while (!stopped && cursor);
      });
    } catch (error) { console.error("[RideReconciliation] Sweep failed; cursor retained:", error); }
    finally { inFlight = false; }
  };
  void run();
  const timer = setInterval(() => { void run(); }, RECONCILIATION_INTERVAL_MS);
  timer.unref();
  return () => { stopped = true; clearInterval(timer); };
}
