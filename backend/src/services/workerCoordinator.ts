import { randomUUID } from "node:crypto";
import { Timestamp } from "firebase-admin/firestore";
import { db } from "../lib/firebaseAdmin";
import { startTripStateEngine } from "./tripStateEngine";
import { startLiveBusProjection } from "./liveBusProjection";
import { startRetentionSweeper } from "./retentionSweeper";
import { reconcileFleetAuthorization } from "../routes/fleet";
import { startPrivacyDeletionWorker } from "./privacyDeletionWorker";
import { startAbandonedRideReconciler } from "./abandonedRideReconciler";
import { recordWorkerRun, setWorkerLeadership } from "../lib/metrics";
import { WorkerFence, workerTransaction, WORKER_CLOCK_SKEW_MS, WORKER_LEASE_ID } from "../lib/workerFence";

const LEASE_ID = WORKER_LEASE_ID;
const LEASE_DURATION_MS = 45_000;
const RENEW_INTERVAL_MS = 15_000;

/** Coordinates singleton background work under a renewable Firestore lease. */
export function startWorkerCoordinator(): () => Promise<void> {
  if (process.env.WORKER_ENABLED === "false") {
    setWorkerLeadership(false);
    console.log("[Worker] Disabled by WORKER_ENABLED=false.");
    return async () => undefined;
  }

  // A configured label must not make two processes the same lease owner.
  const ownerId = `${process.env.WORKER_INSTANCE_ID || "worker"}:${randomUUID()}`;
  const leaseRef = db.collection("_worker_leases").doc(LEASE_ID);
  let stopped = false;
  let active = false;
  let stopTripEngine: (() => Promise<void>) | null = null;
  let stopProjection: (() => Promise<void>) | null = null;
  let stopRetention: (() => void) | null = null;
  let fleetReconcileTimer: NodeJS.Timeout | null = null;
  let stopPrivacyDeletion: (() => void) | null = null;
  let stopRideReconciliation: (() => void) | null = null;
  let stopWorkPromise: Promise<void> | null = null;
  let renewInFlight: Promise<void> | null = null;
  let fence: WorkerFence | null = null;
  let expiryTimer: NodeJS.Timeout | null = null;
  let transition = 0;
  let fleetInFlight: Promise<void> | null = null;

  /** Stops every leader-owned worker and waits for lifecycle cleanup. */
  const stopWork = async (): Promise<void> => {
    fence?.revoke();
    fence = null;
    if (expiryTimer) clearTimeout(expiryTimer);
    expiryTimer = null;
    if (!active) {
      await stopWorkPromise;
      return;
    }
    active = false;
    setWorkerLeadership(false);
    const stopTripEngineNow = stopTripEngine;
    const stopProjectionNow = stopProjection;
    const stopRetentionNow = stopRetention;
    const stopPrivacyDeletionNow = stopPrivacyDeletion;
    const stopRideReconciliationNow = stopRideReconciliation;
    if (fleetReconcileTimer) clearInterval(fleetReconcileTimer);
    stopTripEngine = null;
    stopProjection = null;
    stopRetention = null;
    fleetReconcileTimer = null;
    stopPrivacyDeletion = null;
    stopRideReconciliation = null;
    const stopping = (async () => {
      const results = await Promise.allSettled([
        stopTripEngineNow?.() ?? Promise.resolve(),
        stopProjectionNow?.() ?? Promise.resolve(),
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
    const attempt = transition;
    const started = performance.now();
    try {
      const acquired = await db.runTransaction(async (transaction) => {
        if (stopped || attempt !== transition) return null;
        const lease = await transaction.get(leaseRef);
        if (stopped || attempt !== transition) return null;
        // Firestore may retry the callback: never reuse an earlier wall time.
        const now = Date.now();
        const data = lease.data();
        const expiresAt =
          data?.expiresAt instanceof Timestamp ? data.expiresAt.toMillis() : 0;
        const currentOwner = typeof data?.ownerId === "string" ? data.ownerId : null;
        if (currentOwner !== ownerId && expiresAt + WORKER_CLOCK_SKEW_MS > now) return null;
        const previousGeneration = Number.isSafeInteger(data?.generation) ? data!.generation : 0;
        const generation = currentOwner === ownerId && expiresAt > now
          ? previousGeneration : previousGeneration + 1;

        transaction.set(leaseRef, {
          ownerId,
          generation,
          renewedAt: Timestamp.fromMillis(now),
          expiresAt: Timestamp.fromMillis(now + LEASE_DURATION_MS),
        });
        return { generation, expiresAt: now + LEASE_DURATION_MS };
      });
      const remaining = acquired ? Math.min(
        LEASE_DURATION_MS - 2 * WORKER_CLOCK_SKEW_MS - (performance.now() - started),
        acquired.expiresAt - Date.now() - WORKER_CLOCK_SKEW_MS,
      ) : 0;
      if (stopped || attempt !== transition) return;
      if (!acquired || remaining <= 0) { transition += 1; await stopWork(); return; }
      const deadline = performance.now() + remaining;
      if (active && fence?.generation !== acquired.generation) await stopWork();
      if (!active) {
        await stopWorkPromise;
        if (stopped || active || attempt !== transition || performance.now() >= deadline) return;
        fence = new WorkerFence(ownerId, acquired.generation, deadline);
        active = true;
        setWorkerLeadership(true);
        const currentFence = fence;
        currentFence.run(() => {
          stopTripEngine = startTripStateEngine();
          stopProjection = startLiveBusProjection();
          stopRetention = startRetentionSweeper();
          stopPrivacyDeletion = startPrivacyDeletionWorker();
          stopRideReconciliation = startAbandonedRideReconciler();
          const runFleetPages = async () => {
            const cursorRef = db.collection("_reconciliation_cursors").doc("fleet-authorizations");
            currentFence.assert();
            const saved = await cursorRef.get();
            let cursor = typeof saved.data()?.cursor === "string" ? saved.data()!.cursor as string : undefined;
            let partialFailure = false;
            do {
              if (stopped || !active || fence !== currentFence) return;
              currentFence.assert();
              const result = await reconcileFleetAuthorization(Date.now() + 30_000, null, undefined, cursor);
              if (result.nextCursor !== null && result.nextCursor === (cursor ?? "")) {
                throw new Error("Fleet page made no progress before its budget; cursor retained.");
              }
              await workerTransaction(db, async transaction => {
                transaction.set(cursorRef, { cursor: result.nextCursor, updatedAt: Timestamp.now() });
              });
              partialFailure ||= result.failed > 0;
              cursor = result.nextCursor ?? undefined;
            } while (cursor);
            return !partialFailure;
          };
          const runFleet = () => {
            if (stopped || !active || fence !== currentFence || fleetInFlight) return;
            const running = runFleetPages().then(
              complete => recordWorkerRun("fleet_reconciliation", complete === false ? "failure" : "success"),
              (error) => {
                recordWorkerRun("fleet_reconciliation", "failure");
                console.error("[Worker] Fleet reconciliation failed:", error);
              },
            ).finally(() => { if (fleetInFlight === running) fleetInFlight = null; });
            fleetInFlight = running;
          };
          runFleet();
          fleetReconcileTimer = setInterval(runFleet, 10 * 60 * 1000);
          fleetReconcileTimer.unref();
        });
        console.log(`[Worker] Leadership acquired by ${ownerId}.`);
      } else fence!.extend(deadline);
      if (expiryTimer) clearTimeout(expiryTimer);
      expiryTimer = setTimeout(() => {
        transition += 1;
        void stopWork();
      }, Math.max(0, deadline - performance.now()));
      expiryTimer.unref();
    } catch (error) {
      console.error("[Worker] Lease renewal failed:", error);
      transition += 1;
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
    const releaseLease = active;
    stopped = true;
    transition += 1;
    clearInterval(timer);
    await stopWork();
    // Neither shutdown nor revocation may wait for an unbounded renewal.
    // A dispatched lease commit can settle late; its response is fenced above.
    if (renewInFlight || !releaseLease) return;
    try {
      await db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(leaseRef);
        if (snapshot.data()?.ownerId === ownerId) {
          // Keep generations monotonic across orderly restarts.
          transaction.set(leaseRef, { ownerId: null, expiresAt: Timestamp.fromMillis(0) }, { merge: true });
        }
      });
    } catch (error) {
      console.warn("[Worker] Lease release failed:", error);
    }
  };
}
