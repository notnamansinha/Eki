import { AsyncLocalStorage } from "node:async_hooks";
import { assertWorkerLeadership, workerGeneration, workerTransaction, workerRtdbTransaction } from "../lib/workerFence";
import { db, rtdb } from "../lib/firebaseAdmin";
import { withoutLiveRouteContext } from "../lib/liveRouteContext";
import type { DeviceAssignment } from "./deviceTelemetryService";
import type { TelemetryPayload } from "./telemetryPayload";
import { durableLifecycle, durableTerminalLifecycle, freshestDelayMinutes, shouldApplyRestoreTelemetry } from "./durableRideRecoveryPolicy";
import { endpointSnapshotVersion } from "../lib/endpointSnapshotVersion";

const misses = new Map<string, { expiresAt: number; claimId: string | null; recoverTerminal: boolean }>();
const restores = new Map<string, Promise<boolean>>();
const MAX_ACTIVE_RESTORES = 16;
// Bound memory while retaining work that needs no further device sample.
// Saturation rejects visibly so existing background failure reporting alerts operators.
const MAX_QUEUED_RESTORES = 1_000;
const queuedRestores: Array<() => void> = [];
let activeRestores = 0;

/** Restore lock-owned active service or verified, unconsumed terminal intent. */
export function restoreDurableRide(assignment: DeviceAssignment, sample?: TelemetryPayload, claimId: string | null = null, recoverTerminal = true): Promise<boolean> {
  const nodeKey = `${assignment.busId}_${assignment.routeId}`;
  // Share in-flight work only within one worker authority (0 = unfenced device ingest),
  // so a superseded leader's restore never decides another caller's outcome.
  const restoreKey = `${workerGeneration()}:${nodeKey}`;
  const pending = restores.get(restoreKey);
  if (pending) return pending;
  const miss = misses.get(nodeKey);
  if (miss && miss.claimId === claimId && miss.recoverTerminal === recoverTerminal && miss.expiresAt > performance.now()) return Promise.resolve(false);
  if (queuedRestores.length >= MAX_QUEUED_RESTORES) {
    return Promise.reject(new Error("Durable ride recovery queue is full."));
  }
  // Queued work is started from another restore's settlement; keep the requester's worker fence.
  const runInCallerContext = AsyncLocalStorage.snapshot();
  const restore = new Promise<boolean>((resolve, reject) => {
    const start = () => {
      activeRestores++;
      void runInCallerContext(async () => {
        assertWorkerLeadership();
        return performDurableRideRestore(assignment, sample, claimId, nodeKey, recoverTerminal);
      })
        .then(resolve, reject)
        .finally(() => {
          activeRestores--;
          queuedRestores.shift()?.();
        });
    };
    if (activeRestores < MAX_ACTIVE_RESTORES) start();
    else queuedRestores.push(start);
  }).finally(() => { if (restores.get(restoreKey) === restore) restores.delete(restoreKey); });
  restores.set(restoreKey, restore);
  return restore;
}

async function performDurableRideRestore(
  assignment: DeviceAssignment, sample: TelemetryPayload | undefined,
  claimId: string | null, nodeKey: string, recoverTerminal: boolean,
): Promise<boolean> {
  const lifecycle = await workerTransaction(db, async transaction => {
    const activeRide = await transaction.get(db.collection("active_rides").doc(nodeKey));
    let value = activeRide.exists ? durableLifecycle(activeRide.data()!) : null;
    if (!value && recoverTerminal) {
      const fleet = await transaction.get(db.collection("bus_locations").doc(assignment.busId));
      value = durableTerminalLifecycle(fleet.data()?.terminalJourney);
    }
    if (!value) return null;
    const [lock, session] = await Promise.all([
      transaction.get(db.collection("_active_bus_locks").doc(assignment.busId)),
      transaction.get(db.collection("ride_sessions").doc(String(value.sessionId))),
    ]);
    const owner = lock.data();
    const record = session.data();
    if (value.tripState === "completed") {
      const [bus, driver, route] = await Promise.all([
        transaction.get(db.collection("buses").doc(assignment.busId)),
        transaction.get(db.collection("drivers").doc(String(value.driverId))),
        transaction.get(db.collection("routes").doc(assignment.routeId)),
      ]);
      const routes = bus.data()?.assignedRoutes ?? [bus.data()?.assignedRouteId];
      if (lock.exists || !record || record.status !== "completed" ||
        record.busId !== assignment.busId || record.routeId !== assignment.routeId || record.driverId !== value.driverId ||
        value.busId !== assignment.busId || value.routeId !== assignment.routeId ||
        !Number.isFinite(record.terminalArrivalConfirmedAt) ||
        driver.data()?.assignedBusId !== assignment.busId || !Array.isArray(routes) || !routes.includes(assignment.routeId) ||
        !Array.isArray(route.data()?.stops) || endpointSnapshotVersion(route.data()!.stops) !== value.directionEndpointVersion) return null;
      return value;
    }
    if (!lock.exists || !session.exists || !owner || !record || owner.sessionId !== value.sessionId ||
      owner.busId !== assignment.busId || owner.routeId !== assignment.routeId || owner.driverId !== value.driverId ||
      record?.busId !== assignment.busId || record.routeId !== assignment.routeId || record.driverId !== value.driverId ||
      !["pending", "armed", "active"].includes(record.status)) return null;
    return value;
  });
  if (!lifecycle) {
    if (misses.size >= 1_000) misses.delete(misses.keys().next().value!);
    misses.set(nodeKey, { claimId, recoverTerminal, expiresAt: performance.now() + (claimId ? 1_000 : 30_000) });
    return false;
  }
  misses.delete(nodeKey);
  const result = await workerRtdbTransaction(rtdb.ref(`activeBuses/${nodeKey}`), current => {
    const live = current as Record<string, unknown> | null;
    const sameSession = live?.sessionId === lifecycle.sessionId;
    if (lifecycle.tripState === "completed") {
      // Never replace a new session, a manual interruption, or an assignment tombstone.
      if (live?.sessionId || typeof live?.retiredAssignmentRevision === "number") return;
      const telemetry = sample && shouldApplyRestoreTelemetry(live?.timestamp, sample.timestamp) ? sample : {};
      return { ...withoutLiveRouteContext(live), ...telemetry, ...lifecycle,
        busId: assignment.busId, routeId: assignment.routeId,
        deviceState: live?.deviceState ?? "offline", lifecycleUpdatedAt: { ".sv": "timestamp" } };
    }
    if (live?.status === "active" && sameSession && ["pre_departure", "in_service"].includes(String(live.tripState))) return;
    if (live?.sessionId && !sameSession) {
      // An old completed session is replaceable only by its claimed return.
      if (live.tripState !== "completed" || lifecycle.automaticTurnaround !== true ||
        lifecycle.previousSessionId !== live.sessionId ||
        (live.turnaroundClaimId && live.turnaroundClaimId !== lifecycle.sessionId)) return;
    }
    if (sameSession && ["completed", "interrupted"].includes(String(live?.tripState))) return;
    const telemetry: Partial<TelemetryPayload> = sample && shouldApplyRestoreTelemetry(live?.timestamp, sample.timestamp) ? sample : {};
    const delay = freshestDelayMinutes(sameSession ? live : null, lifecycle);
    return {
      ...(sameSession ? live : withoutLiveRouteContext(live)),
      ...telemetry,
      ...lifecycle,
      ...delay,
      busId: assignment.busId,
      routeId: assignment.routeId,
      deviceState: live?.deviceState ?? "online",
      signalState: (telemetry.motionState ?? live?.motionState) === "uncertain" ? "gnss_lost" : "connected",
      lifecycleUpdatedAt: { ".sv": "timestamp" },
    };
  });
  return result.committed;
}

/** Drain after HTTP/leader admission stops, before Firebase shutdown. */
export async function drainDurableRideRecovery(): Promise<void> {
  while (restores.size) await Promise.allSettled([...restores.values()]);
}
