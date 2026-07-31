import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { get, ref, set } from "firebase/database";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { afterAll, beforeAll, describe, it } from "vitest";

const enabled = process.env.FIREBASE_RULES_TEST === "1";
const rulesDescribe = enabled ? describe : describe.skip;
let environment: RulesTestEnvironment;

function emulator(name: "FIRESTORE_EMULATOR_HOST" | "FIREBASE_DATABASE_EMULATOR_HOST") {
  const [host, port] = (process.env[name] || "").split(":");
  if (!host || !port) throw new Error(`${name} is not configured.`);
  return { host, port: Number(port) };
}

rulesDescribe("Firebase security rules integration", () => {
  beforeAll(async () => {
    environment = await initializeTestEnvironment({
      projectId: "eki-rules-test",
      firestore: {
        ...emulator("FIRESTORE_EMULATOR_HOST"),
        rules: readFileSync(resolve(__dirname, "../../firestore.rules"), "utf8"),
      },
      database: {
        ...emulator("FIREBASE_DATABASE_EMULATOR_HOST"),
        rules: readFileSync(resolve(__dirname, "../../database.rules.json"), "utf8"),
      },
    });
    await environment.withSecurityRulesDisabled(async (context) => {
      await set(ref(context.database(), "activeBuses/bus_1_route_1"), {
        busId: "bus_1",
        routeId: "route_1",
        lat: 23,
        lng: 72,
        speed: 0,
        heading: 0,
        motionState: "stopped",
        timestamp: Date.now(),
      });
      await setDoc(doc(context.firestore(), "routes", "route_1"), {
        id: "route_1",
        name: "Test",
      });
      await setDoc(doc(context.firestore(), "devices", "device_1"), {
        secretHash: "never-client-readable",
      });
      await setDoc(doc(context.firestore(), "active_rides", "bus_1_route_1"), {
        sessionId: "session_1",
        status: "active",
        tripState: "in_service",
      });
    });
  });

  afterAll(async () => {
    await environment?.cleanup();
  });

  it("allows authenticated RTDB reads but denies every client write", async () => {
    const passenger = environment.authenticatedContext("passenger_1", { role: "passenger" });
    const admin = environment.authenticatedContext("admin_1", { role: "admin", admin: true });
    const device = environment.authenticatedContext("device_1", { role: "device" });
    await assertSucceeds(get(ref(passenger.database(), "activeBuses")));
    await assertFails(get(ref(environment.unauthenticatedContext().database(), "activeBuses")));
    await assertFails(set(ref(passenger.database(), "activeBuses/x"), { lat: 1 }));
    await assertFails(set(ref(admin.database(), "activeBuses/x"), { lat: 1 }));
    await assertFails(set(ref(device.database(), "activeBuses/x"), { lat: 1 }));
  });

  it("denies browser route/device/session mutations and recovery-state reads", async () => {
    const admin = environment.authenticatedContext("admin_1", { role: "admin", admin: true });
    await assertSucceeds(getDoc(doc(admin.firestore(), "routes", "route_1")));
    await assertFails(setDoc(doc(admin.firestore(), "routes", "route_2"), { name: "Bypass" }));
    await assertFails(getDoc(doc(admin.firestore(), "devices", "device_1")));
    await assertFails(getDoc(doc(admin.firestore(), "active_rides", "bus_1_route_1")));
    await assertFails(setDoc(doc(admin.firestore(), "ride_sessions", "session_1"), {
      status: "active",
    }));
  });

  it("allows a user to create only their own passenger profile", async () => {
    const passenger = environment.authenticatedContext("passenger_1", { role: "passenger" });
    await assertSucceeds(setDoc(doc(passenger.firestore(), "users", "passenger_1"), {
      uid: "passenger_1",
      email: "rider@example.edu",
      displayName: "Rider",
      photoURL: "",
      role: "passenger",
      createdAt: Date.now(),
    }));
    await assertFails(setDoc(doc(passenger.firestore(), "users", "admin_1"), {
      uid: "admin_1",
      email: "rider@example.edu",
      displayName: "Rider",
      photoURL: "",
      role: "admin",
      createdAt: Date.now(),
    }));
  });
});
