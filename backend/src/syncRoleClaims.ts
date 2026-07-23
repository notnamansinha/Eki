import { auth, db, rtdb } from "./lib/firebaseAdmin";

const roles = new Set(["passenger", "driver", "admin"]);

async function syncRoleClaims() {
  const users = await db.collection("users").get();
  let updated = 0;
  let hasErrors = false;

  for (const user of users.docs) {
    const role = user.data().role;
    if (typeof role !== "string" || !roles.has(role)) {
      console.warn(`Skipping ${user.id}: invalid role`);
      continue;
    }

    try {
      const existingClaims = (await auth.getUser(user.id)).customClaims ?? {};
      const previousDriverId = typeof existingClaims.driverId === "string"
        ? existingClaims.driverId
        : null;
      const preservedClaims = { ...existingClaims };
      delete preservedClaims.admin;
      delete preservedClaims.role;
      delete preservedClaims.driverId;
      delete preservedClaims.assignedBusId;
      const driverAssignment = role === "driver"
        ? await db.collection("drivers").where("authUid", "==", user.id).limit(2).get()
        : null;

      if (role === "driver" && (!driverAssignment || driverAssignment.size !== 1)) {
        console.error(`Skipping ${user.id}: driver must have exactly one authUid assignment.`);
        hasErrors = true;
        continue;
      }

      const driver = driverAssignment?.docs[0]?.data();
      const assignedBusId = driver?.assignedBusId;
      if (role === "driver" && (typeof assignedBusId !== "string" || !assignedBusId.trim())) {
        console.error(`Skipping ${user.id}: invalid driver bus assignment.`);
        hasErrors = true;
        continue;
      }

      let routeAssignments: Record<string, true> | undefined;
      if (role === "driver") {
        const bus = await db.collection("buses").doc(assignedBusId).get();
        const busData = bus.data();
        const routeIds = Array.isArray(busData?.assignedRoutes)
          ? busData.assignedRoutes
          : typeof busData?.assignedRouteId === "string"
            ? [busData.assignedRouteId]
            : [];
        const validRouteIds = routeIds.filter(
          (routeId): routeId is string => typeof routeId === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(routeId),
        );
        if (!bus.exists || validRouteIds.length === 0) {
          console.error(`Skipping ${user.id}: assigned bus ${assignedBusId} has no valid routes.`);
          hasErrors = true;
          continue;
        }
        routeAssignments = Object.fromEntries(validRouteIds.map((routeId) => [routeId, true]));
      }

      // Keep unrelated claims intact and synchronize the legacy `admin` claim
      // used by protected backend routes with the Firestore role.
      await auth.setCustomUserClaims(user.id, {
        ...preservedClaims,
        role,
        ...(role === "admin" ? { admin: true } : {}),
        ...(role === "driver" ? {
          driverId: driverAssignment!.docs[0].id,
          assignedBusId,
        } : {}),
      });
      // RTDB rules cannot read Firestore. Mirror the trusted bus-route
      // assignment into a server-only RTDB path so driver writes are bound to
      // both their bus and one of its assigned routes.
      if (role === "driver" && routeAssignments) {
        const currentDriverId = driverAssignment!.docs[0].id;
        await rtdb.ref(`driverRouteAssignments/${currentDriverId}`).set({
          [assignedBusId]: routeAssignments,
        });
        if (previousDriverId && previousDriverId !== currentDriverId) {
          await rtdb.ref(`driverRouteAssignments/${previousDriverId}`).remove();
        }
      } else {
        const staleAssignmentIds = new Set([user.id, previousDriverId].filter(Boolean));
        await Promise.all(
          [...staleAssignmentIds].map((driverId) => rtdb.ref(`driverRouteAssignments/${driverId}`).remove()),
        );
      }
      updated += 1;
    } catch (err: any) {
      // auth/user-not-found: Firestore doc exists but Auth account was deleted.
      // Log and continue so later users still get their claims synced.
      if (err?.errorInfo?.code === "auth/user-not-found") {
        console.warn(`Skipping ${user.id}: Auth account not found (may have been deleted).`);
      } else {
        console.error(`Error syncing ${user.id}:`, err);
      }
      hasErrors = true;
    }
  }

  console.log(`Synchronized role claims for ${updated} users.`);
  if (hasErrors) {
    console.error("Some users failed to sync. Check logs above.");
    process.exitCode = 1;
  }
}

syncRoleClaims()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((error) => {
    console.error("Failed to synchronize role claims:", error);
    process.exit(1);
  });
