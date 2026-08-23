import "dotenv/config";
import { randomBytes } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "./lib/firebaseAdmin";
import {
  hashDeviceSecret,
  publishDeviceCredentialInvalidation,
} from "./services/deviceTelemetryService";

const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;

function argument(name: string): string {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? process.argv[index + 1] : "";
  if (!SAFE_ID.test(value ?? "")) {
    throw new Error(`Missing or invalid --${name}.`);
  }
  return value;
}

async function provision(): Promise<void> {
  const deviceId = argument("device-id");
  const busId = argument("bus-id");
  const routeId = argument("route-id");
  const deviceRef = db.collection("devices").doc(deviceId);
  const plainSecret = randomBytes(32).toString("base64url");
  const secretHash = await hashDeviceSecret(plainSecret);
  const result = await db.runTransaction(async (transaction) => {
    const busRef = db.collection("buses").doc(busId);
    const routeRef = db.collection("routes").doc(routeId);
    const targetRideRef = db.collection("active_rides").doc(`${busId}_${routeId}`);
    const targetLockRef = db.collection("_active_bus_locks").doc(busId);
    const targetDevices = db.collection("devices")
      .where("busId", "==", busId)
      .where("routeId", "==", routeId);
    const [busDoc, routeDoc, existingDevice, targetRide, targetLock, matchingDevices] =
      await Promise.all([
        transaction.get(busRef),
        transaction.get(routeRef),
        transaction.get(deviceRef),
        transaction.get(targetRideRef),
        transaction.get(targetLockRef),
        transaction.get(targetDevices),
      ]);
    const bus = busDoc.data();
    const assignedRoutes = Array.isArray(bus?.assignedRoutes)
      ? bus.assignedRoutes
      : typeof bus?.assignedRouteId === "string"
        ? [bus.assignedRouteId]
        : [];
    if (!busDoc.exists || !routeDoc.exists || !assignedRoutes.includes(routeId)) {
      return "invalid_assignment" as const;
    }
    if (
      targetRide.exists ||
      targetLock.exists ||
      matchingDevices.docs.some((doc) => doc.id !== deviceId)
    ) {
      return "target_conflict" as const;
    }

    const previous = existingDevice.data();
    if (
      existingDevice.exists &&
      typeof previous?.busId === "string" &&
      typeof previous?.routeId === "string"
    ) {
      const [previousRide, previousLock] = await Promise.all([
        transaction.get(
          db.collection("active_rides").doc(`${previous.busId}_${previous.routeId}`),
        ),
        transaction.get(db.collection("_active_bus_locks").doc(previous.busId)),
      ]);
      if (previousRide.exists || previousLock.exists) {
        return "active_previous_ride" as const;
      }
    }

    transaction.set(deviceRef, {
      deviceId,
      busId,
      routeId,
      enabled: true,
      secretHash,
      secret: FieldValue.delete(),
      credentialRotatedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return "saved" as const;
  });
  if (result === "invalid_assignment") {
    throw new Error("The device must use an existing route assigned to the bus.");
  }
  if (result === "target_conflict") {
    throw new Error("The bus route already has an active ride or another device.");
  }
  if (result === "active_previous_ride") {
    throw new Error("Do not rotate or reassign a device during an active ride.");
  }
  await publishDeviceCredentialInvalidation(deviceId);

  console.log("Device provisioned. Copy this secret now; it is not stored in plaintext:");
  console.log(plainSecret);
}

void provision().then(
  () => process.exit(0),
  (error) => {
    console.error(
      error instanceof Error ? error.message : "Device provisioning failed.",
    );
    process.exit(1);
  },
);
