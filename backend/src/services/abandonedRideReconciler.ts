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

const RECONCILIATION_INTERVAL_MS = 60 * 60 * 1000;
const INTERRUPTION_REASON = "abandoned_session_timeout";

function configuredThresholdMs(value: string | undefined): number {
  const hours = Number(value);
  return Number.isFinite(hours) && hours >= 1
    ? Math.floor(hours * 60 * 60 * 1000)
    : DEFAULT_ABANDONED_RIDE_THRESHOLD_MS;
}

function lifecycleKey(session: Record<string, unknown>): string | null {
  return typeof session.busId === "string" && typeof session.routeId === "string"
    ? `${session.busId}_${session.routeId}`
    : null;
}

function records(value: unknown): Record<string, Record<string, unknown>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, Record<string, unknown>>;
}

export interface AbandonedRideReconciliationSummary {
  dryRun: boolean;
  now: number;
  thresholdMs: number;
  scanned: number;
  staleIds: string[];
  interruptedIds: string[];
  protectedIds: string[];
  skippedIds: string[];
  activeRideIdsDeleted: string[];
  liveNodeKeysRetired: string[];
}

export interface AbandonedRideReconciliationOptions {
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
    scanned: 0,
    staleIds: [],
    interruptedIds: [],
    protectedIds: [],
    skippedIds: [],
    activeRideIdsDeleted: [],
    liveNodeKeysRetired: [],
  };

  const [sessionsSnapshot, liveSnapshot] = await Promise.all([
    firestore.collection("ride_sessions")
      .where("status", "in", ["pending", "armed", "active"])
      .get(),
    realtimeDatabase.ref("activeBuses").once("value"),
  ]);
  const liveBuses = records(liveSnapshot.val());
  summary.scanned = sessionsSnapshot.size;

  await Promise.all(sessionsSnapshot.docs.map(async (sessionDocument) => {
    const sessionId = sessionDocument.id;
    const initialSession = sessionDocument.data();
    const key = lifecycleKey(initialSession);
    if (!key) {
      summary.skippedIds.push(sessionId);
      return;
    }
    const activeRideRef = firestore.collection("active_rides").doc(key);
    const initialActiveRideDocument = await activeRideRef.get();
    const initialActiveRide = initialActiveRideDocument.exists
      ? initialActiveRideDocument.data() ?? null
      : null;
    const initialLiveBus = liveBuses[key] ?? null;
    const initialDecision = reconciliationDecision(
      sessionId,
      initialSession,
      initialActiveRide,
      initialLiveBus,
      cutoff,
    );
    if (!initialDecision.stale) {
      summary.protectedIds.push(sessionId);
      return;
    }
    summary.staleIds.push(sessionId);
    if (dryRun) return;

    let liveBlocked = false;
    let retiredLiveRecord: Record<string, unknown> | null = null;
    const liveRef = realtimeDatabase.ref(`activeBuses/${key}`);
    await liveRef.transaction((currentValue) => {
      const current = currentValue && typeof currentValue === "object"
        ? currentValue as Record<string, unknown>
        : null;
      if (!matchingSession(current, sessionId)) return;
      const activity = latestLiveBusActivity(current!);
      if (activity === null || activity > cutoff) {
        liveBlocked = true;
        return;
      }
      retiredLiveRecord = current;
      return null;
    }, undefined, false);
    if (liveBlocked) {
      summary.protectedIds.push(sessionId);
      return;
    }

    const transactionResult = await firestore.runTransaction(async (transaction) => {
      const sessionRef = firestore.collection("ride_sessions").doc(sessionId);
      const [currentSessionDocument, currentActiveRideDocument] = await Promise.all([
        transaction.get(sessionRef),
        transaction.get(activeRideRef),
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
      return { interrupted: true, deleted: deleteActiveRide };
    });

    if (!transactionResult.interrupted) {
      summary.protectedIds.push(sessionId);
      return;
    }
    summary.interruptedIds.push(sessionId);
    if (transactionResult.deleted) summary.activeRideIdsDeleted.push(key);
    if (retiredLiveRecord) summary.liveNodeKeysRetired.push(key);
  }));

  summary.staleIds.sort();
  summary.interruptedIds.sort();
  summary.protectedIds = [...new Set(summary.protectedIds)].sort();
  summary.skippedIds.sort();
  summary.activeRideIdsDeleted.sort();
  summary.liveNodeKeysRetired.sort();
  return summary;
}

export function startAbandonedRideReconciler(): () => void {
  const run = () => {
    void runAbandonedRideReconciliation().then(
      (summary) => console.log("[RideReconciliation] Sweep complete", summary),
      (error) => console.error("[RideReconciliation] Sweep failed:", error),
    );
  };
  run();
  const timer = setInterval(run, RECONCILIATION_INTERVAL_MS);
  timer.unref();
  return () => clearInterval(timer);
}
