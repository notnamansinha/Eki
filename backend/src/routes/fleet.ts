import { withFleetLock, FleetReconciliationBusy } from "../services/fleetMutationLock";
import { assertWorkerLeadership } from "../lib/workerFence";
import { randomUUID } from "node:crypto";
import { Router, type Request, type Response, type NextFunction } from "express";
import { requireAdmin } from "../middleware/requireAdmin";
import { auth, db, rtdb } from "../lib/firebaseAdmin";
import { FieldValue } from "firebase-admin/firestore";
import { singleRouteParam } from "../lib/requestParams";
import { OPERATION_ID, OperationConflict, OperationRecoveryConflict, readFleetLock, recoverFleetLock, readOperation, submitOperation, type OperationExecutionContext } from "../services/httpOperations";
import { BoundedKeyedExecutor } from "../lib/boundedKeyedExecutor";
import { reconciliationPage, reconciliationPages, forEachBounded, settleTogether } from "../lib/reconciliationPages";
import { FleetReconciliationCache } from "../services/fleetReconciliationCache";

import { operationRecovery, operationRecoveryList } from "./operationRecovery";
export { withFleetLock, FleetReconciliationBusy } from "../services/fleetMutationLock";

const router = Router();
export const fleetReconciliationJobsRouter = Router();
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;

function validId(value: unknown): value is string {
  return typeof value === "string" && SAFE_ID.test(value);
}

async function loadBusRouteIds(busId: string): Promise<string[]> {
  const busDoc = await db.collection("buses").doc(busId).get();
  const bus = busDoc.data();
  const routeIds = (Array.isArray(bus?.assignedRoutes)
    ? bus.assignedRoutes
    : typeof bus?.assignedRouteId === "string"
      ? [bus.assignedRouteId]
      : []).filter(validId);
  if (!busDoc.exists || routeIds.length === 0) {
    throw new Error("Assigned bus must have at least one valid route.");
  }
  return routeIds;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

async function demoteDriverAccount(authUid: string): Promise<void> {
  const user = await auth.getUser(authUid);
  const claims = { ...(user.customClaims ?? {}) };
  delete claims.admin;
  delete claims.driverId;
  delete claims.assignedBusId;
  await settleAuthorizationUpdates([
    auth.setCustomUserClaims(authUid, { ...claims, role: "passenger" }),
    auth.revokeRefreshTokens(authUid),
    db.collection("users").doc(authUid).set({ role: "passenger" }, { merge: true }),
  ]);
}

async function applyDriverAuthorization(
  driverId: string,
  authUid: string,
  assignedBusId: string | null,
  reconciliationCache?: FleetReconciliationCache,
  context?: OperationExecutionContext,
): Promise<boolean> {
  const user = await auth.getUser(authUid);
  const existing = user.customClaims ?? {};
  const claims = { ...existing };
  delete claims.admin;
  delete claims.driverId;
  delete claims.assignedBusId;

  if (!assignedBusId) {
    const mirrorRef = rtdb.ref(`driverRouteAssignments/${driverId}`);
    const mirror = reconciliationCache
      ? await reconciliationCache.mirrorFor(driverId)
      : (await mirrorRef.once("value")).val();
    const claimsChanged =
      existing.role !== "driver" ||
      existing.admin !== undefined ||
      existing.driverId !== undefined ||
      existing.assignedBusId !== undefined;
    if (!claimsChanged && mirror === null) return false;

    context?.assertActive();
    assertWorkerLeadership();
    const updates: Promise<unknown>[] = [];
    if (claimsChanged) {
      updates.push(
        auth.setCustomUserClaims(authUid, { ...claims, role: "driver" }),
        auth.revokeRefreshTokens(authUid),
      );
    }
    if (mirror !== null) {
      updates.push(mirrorRef.remove());
      reconciliationCache?.setMirror(driverId, null);
    }
    await settleAuthorizationUpdates(updates);
    return true;
  }

  const mirrorRef = rtdb.ref(`driverRouteAssignments/${driverId}`);
  const [routeIds, mirror] = await settleTogether([
    reconciliationCache
      ? reconciliationCache.routesForBus(assignedBusId)
      : loadBusRouteIds(assignedBusId),
    reconciliationCache
      ? Promise.resolve(reconciliationCache.mirrorFor(driverId))
      : mirrorRef.once("value").then((snapshot) => snapshot.val()),
  ]);

  const expectedMirror = {
    [assignedBusId]: Object.fromEntries(
      [...new Set(routeIds)].sort().map((routeId) => [routeId, true]),
    ),
  };
  const claimsChanged =
    existing.role !== "driver" ||
    existing.admin !== undefined ||
    existing.driverId !== driverId ||
    existing.assignedBusId !== assignedBusId;
  const mirrorChanged =
    stableJson(mirror) !== stableJson(expectedMirror);
  if (!claimsChanged && !mirrorChanged) return false;

  context?.assertActive();
  assertWorkerLeadership();
  const updates: Promise<unknown>[] = [];
  if (claimsChanged) {
    updates.push(auth.setCustomUserClaims(authUid, {
      ...claims,
      role: "driver",
      driverId,
      assignedBusId,
    }), auth.revokeRefreshTokens(authUid));
  }
  if (mirrorChanged) {
    updates.push(mirrorRef.set(expectedMirror));
    reconciliationCache?.setMirror(driverId, expectedMirror);
  }
  await settleAuthorizationUpdates(updates);
  return true;
}

async function settleAuthorizationUpdates(updates: Promise<unknown>[]): Promise<void> {
  const outcomes = await Promise.allSettled(updates);
  const failure = outcomes.find(outcome => outcome.status === "rejected");
  if (failure?.status === "rejected") throw failure.reason;
}

type FleetRecord = { driverId: string; outcome: "repaired" | "unchanged" | "failed"; code?: string };

export async function reconcileFleetAuthorization(deadlineAt = Date.now() + 30_000, operationId: string | null = null, context?: OperationExecutionContext, cursor?: string): Promise<{
  checked: number; repaired: number; failed: number; records: FleetRecord[]; nextCursor: string | null; timeBudgetExceeded: boolean;
}> {
  return withFleetLock(operationId, async () => {
    const page = await reconciliationPage(db.collection("drivers"), cursor);
    const reconciliationCache = new FleetReconciliationCache({}, loadBusRouteIds,
      async driverId => (await rtdb.ref(`driverRouteAssignments/${driverId}`).once("value")).val());
    let repaired = 0;
    let failed = 0;
    const records: FleetRecord[] = [];
    let completedCursor = cursor ?? ""; let timeBudgetExceeded = false;
    for (let index = 0; index < page.docs.length; index += 10) {
      if (Date.now() >= deadlineAt) { timeBudgetExceeded = true; break; }
      assertWorkerLeadership();
      const chunk = page.docs.slice(index, index + 10);
      await context?.checkpoint({ phase: "authorizing", checked: records.length, repaired, failed, batchDriverIds: chunk.map(driver => driver.id), cursor: completedCursor });
      await settleTogether(chunk.map(async (driver) => {
        const data = driver.data();
        if (!validId(data.authUid)) {
          failed += 1;
          records.push({ driverId: driver.id, outcome: "failed", code: "INVALID_DRIVER_AUTH" });
          return;
        }
        try {
          const changed = await applyDriverAuthorization(
            driver.id,
            data.authUid,
            validId(data.assignedBusId) ? data.assignedBusId : null,
            reconciliationCache, context,
          );
          if (changed) repaired += 1;
          records.push({ driverId: driver.id, outcome: changed ? "repaired" : "unchanged" });
        } catch (error) {
          failed += 1;
          records.push({ driverId: driver.id, outcome: "failed", code: "RECONCILIATION_RECORD_FAILED" });
          console.error(`[Fleet] Reconciliation failed for ${driver.id}:`, error);
        }
      }));
      completedCursor = chunk.at(-1)!.id;
      await context?.checkpoint({ phase: "authorizing", checked: records.length, repaired, failed, batchDriverIds: [], cursor: completedCursor });
    }
    return { checked: records.length, repaired, failed, records: records.sort((a, b) => a.driverId.localeCompare(b.driverId)),
      nextCursor: timeBudgetExceeded ? completedCursor : page.nextCursor, timeBudgetExceeded };
  }, context);
}

const fleetMutations = new BoundedKeyedExecutor<string>({ maxConcurrent: 2, maxPending: 8, maxPendingPerKey: 1, maxQueueAgeMs: 2_000 });
let fleetDraining = false;
export async function drainFleetMutations(stopAdmission = true) {
  fleetDraining ||= stopAdmission;
  await Promise.allSettled(fleetMutations.pending());
}
type FleetHandler = (req: Request, res: Response) => Promise<void>;
function fleetMutation(handler: FleetHandler, lock = true): FleetHandler {
  return async (req, res) => {
    try {
      if (fleetDraining) throw new Error("Fleet mutation admission is draining.");
      await fleetMutations.run(randomUUID(), async () => {
        const operation = db.collection("_fleet_operations").doc();
        const adminUid = (req as Request & { user?: { uid?: string } }).user?.uid ?? "unknown";
        await operation.set({ method: req.method, path: req.path.slice(0, 256), adminUid, status: "pending", createdAt: FieldValue.serverTimestamp() });
        res.locals.fleetAudit = operation;
        let executionFailed = false;
        try {
          if (lock) await withFleetLock(null, () => handler(req, res), undefined, operation.id);
          else await handler(req, res);
        } catch (error) {
          executionFailed = true;
          if (!res.headersSent) res.status(error instanceof FleetReconciliationBusy ? 409 : 503);
          throw error;
        } finally {
          await operation.set({ status: !executionFailed && res.statusCode < 400 ? "completed" : "failed", statusCode: res.statusCode, completedAt: FieldValue.serverTimestamp() }, { merge: true });
        }
      });
    } catch (error) {
      console.error("[Fleet] Mutation/audit outcome unavailable:", error);
      if (res.headersSent) return;
      const busy = error instanceof FleetReconciliationBusy;
      res.set("Retry-After", "1").status(busy ? 409 : 503).json({ error: busy ? "Fleet authorization is running or awaiting recovery." : "Fleet mutation/audit is unavailable; inspect current state before retrying." });
    }
  };
}
async function checkpointFleetMutation(res: Response, progress: Record<string, unknown>) {
  await res.locals.fleetAudit.set({ progress, progressAt: FieldValue.serverTimestamp() }, { merge: true });
}
router.use(requireAdmin);
router.post("/reconcile", fleetMutation(async (req: Request, res: Response) => {
  const cursor = req.query.cursor;
  if (cursor !== undefined && (typeof cursor !== "string" || (cursor !== "" && !validId(cursor)))) {
    res.status(400).json({ error: "Invalid reconciliation cursor." }); return;
  }
  const result = await reconcileFleetAuthorization(Date.now() + 30_000, null, undefined, cursor as string | undefined);
  const { checked, repaired, failed } = result;
  res.set("X-Reconciliation-Complete", String(result.nextCursor === null));
  if (result.nextCursor !== null) res.set("X-Next-Cursor", result.nextCursor);
  res.status(failed || result.timeBudgetExceeded ? 207 : 200).json({ checked, repaired, failed });
}, false));

router.put("/buses/:id", fleetMutation(async (req: Request, res: Response) => {
  const id = req.params.id;
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  const rawRoutes: unknown[] = Array.isArray(req.body?.assignedRoutes)
    ? req.body.assignedRoutes
    : [];
  const assignedRoutes = [
    ...new Set(rawRoutes.filter((value): value is string => validId(value))),
  ];
  if (!validId(id) || !name || name.length > 100 || assignedRoutes.length > 50) {
    res.status(400).json({ error: "Invalid vehicle data." });
    return;
  }
  try {
    const routeDocs = await settleTogether(assignedRoutes.map(routeId => db.collection("routes").doc(routeId).get()));
    if (routeDocs.some(route => !route.exists)) { res.status(400).json({ error: "One or more assigned routes do not exist." }); return; }
    for await (const rides of reconciliationPages(db.collection("active_rides").where("busId", "==", id))) {
      if (rides.some(ride => !assignedRoutes.includes(ride.data().routeId))) {
        res.status(409).json({ error: "An active ride route cannot be removed before its final stop." }); return;
      }
    }
    for await (const devices of reconciliationPages(db.collection("devices").where("busId", "==", id))) {
      if (devices.some(device => !assignedRoutes.includes(device.data().routeId))) {
        res.status(409).json({ error: "Reassign every bound device before removing its route." }); return;
      }
    }
    // Own only editable catalog fields. Merge preserves server timestamps and
    // unrelated metadata without replaying a stale document snapshot.
    await db.collection("buses").doc(id).set({
      id, name, assignedRoutes, assignedRouteId: FieldValue.delete(),
    }, { merge: true });

    let checked = 0;
    for await (const drivers of reconciliationPages(db.collection("drivers").where("assignedBusId", "==", id))) {
      for (let index = 0; index < drivers.length; index += 10) {
        const batch = drivers.slice(index, index + 10);
        await checkpointFleetMutation(res, { phase: "authorizing", checked, batchDriverIds: batch.map(driver => driver.id) });
        await forEachBounded(batch, 10, async driver => {
          const data = driver.data();
          if (validId(data.authUid)) await applyDriverAuthorization(driver.id, data.authUid, id);
        });
        checked += batch.length;
        await checkpointFleetMutation(res, { phase: "authorizing", checked, cursor: batch.at(-1)!.id, batchDriverIds: [] });
      }
    }
    res.json({ saved: true });
  } catch (error) {
    console.error("[Fleet] Failed to save bus:", error);
    res.status(500).json({ error: "Unable to save vehicle." });
  }
}));
router.delete("/buses/:id", fleetMutation(async (req: Request, res: Response) => {
  const id = req.params.id;
  if (!validId(id)) {
    res.status(400).json({ error: "Invalid vehicle ID." });
    return;
  }
  try {
    const [activeRides, activeBusLock, devices] = await settleTogether([
      db.collection("active_rides").where("busId", "==", id).limit(1).get(),
      db.collection("_active_bus_locks").doc(id).get(),
      db.collection("devices").where("busId", "==", id).limit(1).get(),
    ]);
    if (!activeRides.empty || activeBusLock.exists) {
      res.status(409).json({
        error: "A vehicle with an active ride cannot be deleted before its final stop.",
      });
      return;
    }
    if (!devices.empty) {
      res.status(409).json({
        error: "Reassign the bound hardware device before deleting this vehicle.",
      });
      return;
    }
    let checked = 0;
    for await (const drivers of reconciliationPages(db.collection("drivers").where("assignedBusId", "==", id))) {
      for (let index = 0; index < drivers.length; index += 10) {
        const group = drivers.slice(index, index + 10);
        await checkpointFleetMutation(res, { phase: "unassigning", checked, batchDriverIds: group.map(driver => driver.id) });
        await forEachBounded(group, 10, async driver => {
          const data = await db.runTransaction(async transaction => {
            const [current, currentLock] = await settleTogether([transaction.get(driver.ref), transaction.get(db.collection("_active_bus_locks").doc(id))]);
            if (currentLock.exists) throw new Error("A ride or installation started during deletion.");
            if (current.data()?.assignedBusId !== id) return null;
            transaction.set(driver.ref, { assignedBusId: null }, { merge: true }); return current.data()!;
          });
          if (data && validId(data.authUid)) await applyDriverAuthorization(driver.id, data.authUid, null);
          else if (data) await rtdb.ref(`driverRouteAssignments/${driver.id}`).remove();
        });
        checked += group.length;
        await checkpointFleetMutation(res, { phase: "unassigning", checked, cursor: group.at(-1)!.id, batchDriverIds: [] });
      }
    }
    await db.runTransaction(async transaction => {
      const [lock, rides, devices] = await settleTogether([
        transaction.get(db.collection("_active_bus_locks").doc(id)),
        transaction.get(db.collection("active_rides").where("busId", "==", id).limit(1)),
        transaction.get(db.collection("devices").where("busId", "==", id).limit(1)),
      ]);
      if (lock.exists || !rides.empty || !devices.empty) throw new Error("Vehicle gained an active ride/installation/device during deletion.");
      transaction.delete(db.collection("buses").doc(id)); transaction.delete(db.collection("bus_locations").doc(id));
    });
    // RTDB cleanup is also paginated; recheck values to preserve a newer lifecycle.
    let liveCursor: string | undefined;
    do {
      let query = rtdb.ref("activeBuses").orderByKey().limitToFirst(100);
      if (liveCursor) query = query.startAfter(liveCursor);
      const snapshot = await query.once("value"); const nodes: Array<[string, unknown]> = [];
      snapshot.forEach(child => { nodes.push([child.key!, child.val()]); });
      await forEachBounded(nodes, 4, async ([key, value]) => {
        if ((value as { busId?: unknown })?.busId !== id) return;
        await rtdb.ref(`activeBuses/${key}`).transaction(current => current === null || (current?.busId === id && stableJson(current) === stableJson(value)) ? null : undefined);
      });
      liveCursor = nodes.length === 100 ? nodes.at(-1)![0] : undefined;
    } while (liveCursor);
    res.json({ deleted: true });
  } catch (error) {
    console.error("[Fleet] Failed to delete bus:", error);
    res.status(500).json({ error: "Unable to delete vehicle." });
  }
}));
router.put("/drivers/:id", fleetMutation(async (req: Request, res: Response) => {
  const id = req.params.id;
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  const authUid = typeof req.body?.authUid === "string" ? req.body.authUid.trim() : "";
  const assignedBusId = req.body?.assignedBusId === null || req.body?.assignedBusId === ""
    ? null
    : req.body?.assignedBusId;
  if (
    !validId(id) ||
    !name ||
    name.length > 100 ||
    !validId(authUid) ||
    (assignedBusId !== null && !validId(assignedBusId))
  ) {
    res.status(400).json({ error: "Invalid operator data." });
    return;
  }
  try {
    const existingDriver = await db.collection("drivers").doc(id).get();
    const previousAuthUid = existingDriver.data()?.authUid;
    const previousBusId = existingDriver.data()?.assignedBusId ?? null;
    const activeRides = await db.collection("active_rides")
      .where("driverId", "==", id)
      .limit(1)
      .get();
    if (
      !activeRides.empty &&
      (authUid !== previousAuthUid || assignedBusId !== previousBusId)
    ) {
      res.status(409).json({
        error: "An active ride operator cannot be reassigned before the final stop.",
      });
      return;
    }
    const duplicate = await db.collection("drivers").where("authUid", "==", authUid).limit(2).get();
    if (duplicate.docs.some((doc) => doc.id !== id)) {
      res.status(409).json({ error: "That Auth UID is already assigned to another operator." });
      return;
    }
    await auth.getUser(authUid);
    if (validId(previousAuthUid) && previousAuthUid !== authUid) {
      // Revoke the old principal before reusing this driver ID. Otherwise the
      // old account retains claims that still match the RTDB assignment mirror.
      await demoteDriverAccount(previousAuthUid);
    }
    await db.collection("drivers").doc(id).set({ id, name, authUid, assignedBusId });
    await db.collection("users").doc(authUid).set({ role: "driver" }, { merge: true });
    await applyDriverAuthorization(id, authUid, assignedBusId);
    res.json({ saved: true });
  } catch (error) {
    console.error("[Fleet] Failed to save driver:", error);
    res.status(500).json({ error: "Unable to save operator." });
  }
}));
router.delete("/drivers/:id", fleetMutation(async (req: Request, res: Response) => {
  const id = req.params.id;
  if (!validId(id)) {
    res.status(400).json({ error: "Invalid operator ID." });
    return;
  }
  try {
    const driverRef = db.collection("drivers").doc(id);
    const driverDoc = await driverRef.get();
    if (!driverDoc.exists) {
      res.status(404).json({ error: "Operator not found." });
      return;
    }
    const activeRides = await db.collection("active_rides")
      .where("driverId", "==", id)
      .limit(1)
      .get();
    if (!activeRides.empty) {
      res.status(409).json({
        error: "An operator with an active ride cannot be deleted before the final stop.",
      });
      return;
    }
    const authUid = driverDoc.data()?.authUid;
    await settleTogether([
      driverRef.delete(),
      rtdb.ref(`driverRouteAssignments/${id}`).remove(),
    ]);
    if (validId(authUid)) {
      await demoteDriverAccount(authUid);
    }
    res.json({ deleted: true });
  } catch (error) {
    console.error("[Fleet] Failed to delete driver:", error);
    res.status(500).json({ error: "Unable to delete operator." });
  }
}));
function privateResponse(_req: Request, res: Response, next: NextFunction) {
  res.set("Cache-Control", "no-store"); next();
}
fleetReconciliationJobsRouter.post("/", privateResponse, requireAdmin, async (req: Request, res: Response) => {
  const id = req.get("Idempotency-Key");
  if (!id || !OPERATION_ID.test(id) || (req.body !== undefined &&
      (!req.body || typeof req.body !== "object" || Array.isArray(req.body) || Object.keys(req.body).some(key => key !== "cursor") || (req.body.cursor !== undefined && (typeof req.body.cursor !== "string" || (req.body.cursor !== "" && !validId(req.body.cursor))))))) {
    res.status(400).json({ error: "A valid Idempotency-Key and optional safe cursor are required.", code: "INVALID_RECONCILIATION" }); return;
  }
  const cursor = typeof req.body?.cursor === "string" && req.body.cursor ? req.body.cursor : undefined;
  try {
    const snapshot = await submitOperation({ collection: "_fleet_reconciliation_jobs", id,
      adminUid: (req as Request & { user?: { uid?: string } }).user?.uid,
      payload: cursor ? { cursor } : {}, budgetMs: 30_000, execute: async context => {
        try {
          const result = await reconcileFleetAuthorization(Date.now() + 30_000, id, context, cursor);
          return { result, ...(result.failed || result.timeBudgetExceeded ? { error: { code: "RECONCILIATION_PARTIAL_FAILURE", error: "Some records could not be reconciled; inspect per-record results." } } : {}) };
        } catch (error) {
          if (error instanceof FleetReconciliationBusy) return { error: { code: "FLEET_RECONCILIATION_BUSY", error: "Another reconciliation is running or awaiting recovery; poll it before starting a new job." } };
          throw error;
        }
      } });
    res.location(`/api/v2/fleet-reconciliation-jobs/${id}`);
    if (snapshot.status === "processing") res.set("Retry-After", "1");
    res.status(snapshot.status === "processing" ? 202 : 200).json(snapshot);
  } catch (error) {
    const conflict = error instanceof OperationConflict;
    if (!conflict) res.set("Retry-After", "1");
    res.status(conflict ? 409 : 503).json({ error: conflict ? "Operation key belongs to a different payload." : "Job status is unavailable; retry with the same key.",
      code: conflict ? "IDEMPOTENCY_KEY_REUSED" : "OPERATION_UNAVAILABLE" });
  }
});
fleetReconciliationJobsRouter.get("/lock", privateResponse, requireAdmin, async (_req: Request, res: Response) => {
  try {
    const lock = await readFleetLock();
    if (!lock) { res.status(404).json({ error: "No reconciliation lock exists.", code: "LOCK_NOT_FOUND" }); return; }
    res.json(lock);
  } catch { res.set("Retry-After", "1").status(503).json({ error: "Lock status is unavailable.", code: "OPERATION_UNAVAILABLE" }); }
});
fleetReconciliationJobsRouter.post("/lock/recovery", privateResponse, requireAdmin, async (req: Request, res: Response) => {
  const body = req.body;
  if (!body || Array.isArray(body) || Object.keys(body).some(key => !["expectedOwner", "executorStopped"].includes(key)) ||
      !validId(body.expectedOwner) || body.executorStopped !== true) {
    res.status(400).json({ error: "Current lock owner and executorStopped:true are required.", code: "INVALID_RECOVERY" }); return;
  }
  try {
    const adminUid = (req as Request & { user?: { uid?: string } }).user?.uid ?? "";
    res.json(await recoverFleetLock({ ...body, adminUid }));
  } catch (error) {
    const conflict = error instanceof OperationRecoveryConflict;
    if (!conflict) res.set("Retry-After", "1");
    res.status(conflict ? 409 : 503).json({ error: conflict ? "Lock recovery is not eligible; recover its operation and stop the prior executor first." : "Recovery acknowledgement is unavailable; inspect lock status before retrying.",
      code: conflict ? "RECOVERY_CONFLICT" : "OPERATION_UNAVAILABLE" });
  }
});
fleetReconciliationJobsRouter.post("/:operationId/recovery", privateResponse, requireAdmin, operationRecovery("_fleet_reconciliation_jobs"));
fleetReconciliationJobsRouter.get("/recovery", privateResponse, requireAdmin, operationRecoveryList("_fleet_reconciliation_jobs"));
fleetReconciliationJobsRouter.get("/:operationId", privateResponse, requireAdmin, async (req: Request, res: Response) => {
  const id = singleRouteParam(req.params.operationId);
  if (!id || !OPERATION_ID.test(id)) { res.status(400).json({ error: "Invalid operation ID.", code: "INVALID_OPERATION_ID" }); return; }
  try {
    const snapshot = await readOperation("_fleet_reconciliation_jobs", id);
    if (!snapshot) { res.status(404).json({ error: "Job not found.", code: "OPERATION_NOT_FOUND" }); return; }
    if (snapshot.status === "processing") res.set("Retry-After", "1");
    res.json(snapshot);
  } catch { res.set("Retry-After", "1").status(503).json({ error: "Job status is unavailable.", code: "OPERATION_UNAVAILABLE" }); }
});

export default router;
