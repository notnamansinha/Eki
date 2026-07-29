import { randomUUID } from "node:crypto";
import { Timestamp } from "firebase-admin/firestore";
import { db } from "../lib/firebaseAdmin";
import { startTripStateEngine } from "./tripStateEngine";
import { startRetentionSweeper } from "./retentionSweeper";
import { reconcileFleetAuthorization } from "../routes/fleet";
import { startPrivacyDeletionWorker } from "./privacyDeletionWorker";

const LEASE_ID = "trip-state-worker";
const LEASE_DURATION_MS = 45_000;
const RENEW_INTERVAL_MS = 15_000;

export function startWorkerCoordinator(): () => Promise<void> {
  if (process.env.WORKER_ENABLED === "false") {
    console.log("[Worker] Disabled by WORKER_ENABLED=false.");
    return async () => undefined;
  }

  const ownerId = process.env.WORKER_INSTANCE_ID || randomUUID();
  const leaseRef = db.collection("_worker_leases").doc(LEASE_ID);
  let stopped = false;
  let active = false;
  let stopTripEngine: (() => void) | null = null;
  let stopRetention: (() => void) | null = null;
  let fleetReconcileTimer: NodeJS.Timeout | null = null;
  let stopPrivacyDeletion: (() => void) | null = null;

  const stopWork = () => {
    if (!active) return;
    active = false;
    stopTripEngine?.();
    stopRetention?.();
    if (fleetReconcileTimer) clearInterval(fleetReconcileTimer);
    stopPrivacyDeletion?.();
    stopTripEngine = null;
    stopRetention = null;
    fleetReconcileTimer = null;
    stopPrivacyDeletion = null;
    console.warn(`[Worker] Leadership lost by ${ownerId}; background work stopped.`);
  };

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
        active = true;
        stopTripEngine = startTripStateEngine();
        stopRetention = startRetentionSweeper();
        stopPrivacyDeletion = startPrivacyDeletionWorker();
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
        stopWork();
      }
    } catch (error) {
      console.error("[Worker] Lease renewal failed:", error);
      stopWork();
    }
  };

  void renew();
  const timer = setInterval(() => void renew(), RENEW_INTERVAL_MS);
  timer.unref();

  return async () => {
    stopped = true;
    clearInterval(timer);
    stopWork();
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
