import "dotenv/config";
import { randomBytes } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { db } from "./lib/firebaseAdmin";
import { hashDeviceSecret } from "./services/deviceTelemetryService";

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
  const [busDoc, routeDoc, existingDevice] = await Promise.all([
    db.collection("buses").doc(busId).get(),
    db.collection("routes").doc(routeId).get(),
    deviceRef.get(),
  ]);
  const bus = busDoc.data();
  const assignedRoutes = Array.isArray(bus?.assignedRoutes)
    ? bus.assignedRoutes
    : typeof bus?.assignedRouteId === "string"
      ? [bus.assignedRouteId]
      : [];
  if (!busDoc.exists || !routeDoc.exists || !assignedRoutes.includes(routeId)) {
    throw new Error("The device must use an existing route assigned to the bus.");
  }
  const previous = existingDevice.data();
  if (
    typeof previous?.busId === "string" &&
    typeof previous?.routeId === "string"
  ) {
    const activeRide = await db.collection("active_rides")
      .doc(`${previous.busId}_${previous.routeId}`)
      .get();
    if (activeRide.exists) {
      throw new Error("Do not rotate or reassign a device during an active ride.");
    }
  }

  const plainSecret = randomBytes(32).toString("base64url");
  await deviceRef.set({
    deviceId,
    busId,
    routeId,
    enabled: true,
    secretHash: await hashDeviceSecret(plainSecret),
    secret: FieldValue.delete(),
    credentialRotatedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

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
