import { Router, type Request, type Response } from "express";
import { requireAdmin } from "../middleware/requireAdmin";
import { auth, db, rtdb } from "../lib/firebaseAdmin";
import { FieldValue } from "firebase-admin/firestore";
import { FleetReconciliationCache } from "../services/fleetReconciliationCache";

const router = Router();
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
  await Promise.all([
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
      ? reconciliationCache.mirrorFor(driverId)
      : (await mirrorRef.once("value")).val();
    const claimsChanged =
      existing.role !== "driver" ||
      existing.admin !== undefined ||
      existing.driverId !== undefined ||
      existing.assignedBusId !== undefined;
    if (!claimsChanged && mirror === null) return false;

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
    await Promise.all(updates);
    return true;
  }

  const mirrorRef = rtdb.ref(`driverRouteAssignments/${driverId}`);
  const [routeIds, mirror] = await Promise.all([
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
  await Promise.all(updates);
  return true;
}

export async function reconcileFleetAuthorization(): Promise<{
  checked: number;
  repaired: number;
  failed: number;
}> {
  const drivers = await db.collection("drivers").limit(500).get();
  let reconciliationCache: FleetReconciliationCache | undefined;
  try {
    const mirrorSnapshot = await rtdb.ref("driverRouteAssignments").once("value");
    const rawMirrors = mirrorSnapshot.val();
    reconciliationCache = new FleetReconciliationCache(
      rawMirrors && typeof rawMirrors === "object" && !Array.isArray(rawMirrors)
        ? rawMirrors as Record<string, unknown>
        : {},
      loadBusRouteIds,
    );
  } catch (error) {
    // Preserve the original per-driver lookup path if the bulk optimization is
    // temporarily unavailable; reconciliation remains a safety mechanism.
    console.warn("[Fleet] Bulk assignment mirror read failed; using per-driver reads:", error);
  }
  let repaired = 0;
  let failed = 0;
  for (let index = 0; index < drivers.docs.length; index += 10) {
    const chunk = drivers.docs.slice(index, index + 10);
    await Promise.all(chunk.map(async (driver) => {
      const data = driver.data();
      if (!validId(data.authUid)) {
        failed += 1;
        return;
      }
      try {
        if (await applyDriverAuthorization(
          driver.id,
          data.authUid,
          validId(data.assignedBusId) ? data.assignedBusId : null,
          reconciliationCache,
        )) {
          repaired += 1;
        }
      } catch (error) {
        failed += 1;
        console.error(`[Fleet] Reconciliation failed for ${driver.id}:`, error);
      }
    }));
  }
  return { checked: drivers.size, repaired, failed };
}

router.use(requireAdmin);
router.use(async (req, res, next) => {
  const operation = db.collection("_fleet_operations").doc();
  const user = (req as Request & { user?: { uid?: string } }).user;
  try {
    await operation.set({
      method: req.method,
      path: req.path.slice(0, 256),
      adminUid: user?.uid ?? "unknown",
      status: "pending",
      createdAt: FieldValue.serverTimestamp(),
    });
    res.once("finish", () => {
      void operation.set({
        status: res.statusCode < 400 ? "completed" : "failed",
        statusCode: res.statusCode,
        completedAt: FieldValue.serverTimestamp(),
      }, { merge: true }).catch((error) => {
        console.error("[Fleet] Failed to finalize operation record:", error);
      });
    });
  } catch (error) {
    console.error("[Fleet] Failed to create operation record:", error);
    res.status(503).json({ error: "Fleet audit log is unavailable; no change was made." });
    return;
  }
  next();
});

router.post("/reconcile", async (_req: Request, res: Response) => {
  try {
    const result = await reconcileFleetAuthorization();
    res.status(result.failed ? 207 : 200).json(result);
  } catch (error) {
    console.error("[Fleet] Reconciliation job failed:", error);
    res.status(500).json({ error: "Fleet reconciliation failed." });
  }
});

router.put("/buses/:id", async (req: Request, res: Response) => {
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
    const [routeDocs, activeRides, devices] = await Promise.all([
      Promise.all(
        assignedRoutes.map((routeId) => db.collection("routes").doc(routeId).get()),
      ),
      db.collection("active_rides").where("busId", "==", id).limit(50).get(),
      db.collection("devices").where("busId", "==", id).limit(250).get(),
    ]);
    if (routeDocs.some((route) => !route.exists)) {
      res.status(400).json({ error: "One or more assigned routes do not exist." });
      return;
    }
    if (
      activeRides.docs.some(
        (ride) => !assignedRoutes.includes(ride.data().routeId),
      )
    ) {
      res.status(409).json({
        error: "An active ride route cannot be removed before its final stop.",
      });
      return;
    }
    if (
      devices.docs.some(
        (device) => !assignedRoutes.includes(device.data().routeId),
      )
    ) {
      res.status(409).json({
        error: "Reassign every bound device before removing its route.",
      });
      return;
    }
    await db.collection("buses").doc(id).set({ id, name, assignedRoutes });

    const drivers = await db.collection("drivers").where("assignedBusId", "==", id).limit(250).get();
    await Promise.all(drivers.docs.map((driver) => {
      const data = driver.data();
      return validId(data.authUid)
        ? applyDriverAuthorization(driver.id, data.authUid, id)
        : Promise.resolve();
    }));
    res.json({ saved: true });
  } catch (error) {
    console.error("[Fleet] Failed to save bus:", error);
    res.status(500).json({ error: "Unable to save vehicle." });
  }
});

router.delete("/buses/:id", async (req: Request, res: Response) => {
  const id = req.params.id;
  if (!validId(id)) {
    res.status(400).json({ error: "Invalid vehicle ID." });
    return;
  }
  try {
    const [drivers, activeSnapshot, activeRides, activeBusLock, devices] = await Promise.all([
      db.collection("drivers").where("assignedBusId", "==", id).limit(250).get(),
      rtdb.ref("activeBuses").once("value"),
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
    const batch = db.batch();
    batch.delete(db.collection("buses").doc(id));
    batch.delete(db.collection("bus_locations").doc(id));
    drivers.docs.forEach((driver) => batch.set(driver.ref, { assignedBusId: null }, { merge: true }));
    await batch.commit();

    await Promise.all([
      ...drivers.docs.map(async (driver) => {
        const data = driver.data();
        await rtdb.ref(`driverRouteAssignments/${driver.id}`).remove();
        if (validId(data.authUid)) {
          await applyDriverAuthorization(driver.id, data.authUid, null);
        }
      }),
      ...Object.entries(activeSnapshot.val() ?? {})
        .filter(([, value]) => (value as { busId?: unknown })?.busId === id)
        .map(([key]) => rtdb.ref(`activeBuses/${key}`).remove()),
    ]);
    res.json({ deleted: true });
  } catch (error) {
    console.error("[Fleet] Failed to delete bus:", error);
    res.status(500).json({ error: "Unable to delete vehicle." });
  }
});

router.put("/drivers/:id", async (req: Request, res: Response) => {
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
});

router.delete("/drivers/:id", async (req: Request, res: Response) => {
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
    await Promise.all([
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
});

export default router;
