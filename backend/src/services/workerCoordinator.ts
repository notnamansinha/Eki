import { randomUUID } from "node:crypto";
import { Timestamp } from "firebase-admin/firestore";
import { db } from "../lib/firebaseAdmin";
import { startTripStateEngine } from "./tripStateEngine";
import { startRetentionSweeper } from "./retentionSweeper";
import { reconcileFleetAuthorization } from "../routes/fleet";
import { startPrivacyDeletionWorker } from "./privacyDeletionWorker";
import { startAbandonedRideReconciler } from "./abandonedRideReconciler";

const LEASE_ID = "trip-state-worker";
const LEASE_DURATION_MS = 45_000;
const RENEW_INTERVAL_MS = 15_000;

/** Coordinates singleton background work under a renewable Firestore lease. */
export function startWorkerCoordinator(): () => Promise<void> {
  if (process.env.WORKER_ENABLED === "false") {
    console.log("[Worker] Disabled by WORKER_ENABLED=false.");
    return async () => undefined;
  }

  const ownerId = process.env.WORKER_INSTANCE_ID || randomUUID();
  const leaseRef = db.collection("_worker_leases").doc(LEASE_ID);
  let stopped = false;
  let active = false;
  let stopTripEngine: (() => Promise<void>) | null = null;
  let stopRetention: (() => void) | null = null;
  let fleetReconcileTimer: NodeJS.Timeout | null = null;
  let stopPrivacyDeletion: (() => void) | null = null;
  let stopRideReconciliation: (() => void) | null = null;
  let stopWorkPromise: Promise<void> | null = null;
  let renewInFlight: Promise<void> | null = null;

  /** Stops every leader-owned worker and waits for lifecycle cleanup. */
  const stopWork = async (): Promise<void> => {
    if (!active) {
      await stopWorkPromise;
      return;
    }
    active = false;
    const stopTripEngineNow = stopTripEngine;
    const stopRetentionNow = stopRetention;
    const stopPrivacyDeletionNow = stopPrivacyDeletion;
    const stopRideReconciliationNow = stopRideReconciliation;
    if (fleetReconcileTimer) clearInterval(fleetReconcileTimer);
    stopTripEngine = null;
    stopRetention = null;
    fleetReconcileTimer = null;
    stopPrivacyDeletion = null;
    stopRideReconciliation = null;
    const stopping = (async () => {
      const results = await Promise.allSettled([
        stopTripEngineNow?.() ?? Promise.resolve(),
        Promise.resolve().then(() => stopRetentionNow?.()),
        Promise.resolve().then(() => stopPrivacyDeletionNow?.()),
        Promise.resolve().then(() => stopRideReconciliationNow?.()),
      ]);
      for (const result of results) {
        if (result.status === "rejected") {
          console.warn("[Worker] Background worker shutdown failed:", result.reason);
        }
      }
      console.warn(`[Worker] Leadership lost by ${ownerId}; background work stopped.`);
    })();
    stopWorkPromise = stopping;
    await stopping;
    if (stopWorkPromise === stopping) stopWorkPromise = null;
  };

  /** Acquires or renews leadership, serializing transitions with shutdown. */
  const renew = async () => {
    if (stopped) return;
    const now = Date.now();
    try {
      const acquired = await db.runTransaction(async (transaction) => {
        const lease = await transaction.get(leaseRef);
        const data = lease.data();
        const expiresAt =
          data?.expiresAt instanceof Timestamp ? data.expiresAt.toMillis() : 0;
        const currentOwner = typeof data?.ownerId === "string" ? data.ownerId : null;
        if (currentOwner !== ownerId && expiresAt > now) return false;

        transaction.set(leaseRef, {
          ownerId,
          renewedAt: Timestamp.fromMillis(now),
          expiresAt: Timestamp.fromMillis(now + LEASE_DURATION_MS),
        });
        return true;
      });

      if (acquired && !active) {
        await stopWorkPromise;
        if (stopped || active) return;
        active = true;
        stopTripEngine = startTripStateEngine();
        stopRetention = startRetentionSweeper();
        stopPrivacyDeletion = startPrivacyDeletionWorker();
        stopRideReconciliation = startAbandonedRideReconciler();
        void reconcileFleetAuthorization().catch((error) => {
          console.error("[Worker] Initial fleet reconciliation failed:", error);
        });
        fleetReconcileTimer = setInterval(() => {
          void reconcileFleetAuthorization().catch((error) => {
            console.error("[Worker] Fleet reconciliation failed:", error);
          });
        }, 10 * 60 * 1000);
        fleetReconcileTimer.unref();
        console.log(`[Worker] Leadership acquired by ${ownerId}.`);
      } else if (!acquired) {
        await stopWork();
      }
    } catch (error) {
      console.error("[Worker] Lease renewal failed:", error);
      await stopWork();
    }
  };

  /** Prevents overlapping lease transactions when Firestore is slow. */
  const runRenew = () => {
    if (stopped || renewInFlight) return;
    const running = renew().finally(() => {
      if (renewInFlight === running) renewInFlight = null;
    });
    renewInFlight = running;
  };

  runRenew();
  const timer = setInterval(runRenew, RENEW_INTERVAL_MS);
  timer.unref();

  return async () => {
    stopped = true;
    clearInterval(timer);
    await renewInFlight;
    await stopWork();
    try {
      await db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(leaseRef);
        if (snapshot.data()?.ownerId === ownerId) {
          transaction.delete(leaseRef);
        }
      });
    } catch (error) {
      console.warn("[Worker] Lease release failed:", error);
    }
  };
}
