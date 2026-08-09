import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { get, ref, set } from "firebase/database";
import {
  collection,
  doc,
  getDoc,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  deleteDoc,
} from "firebase/firestore";
import { afterAll, beforeAll, describe, it } from "vitest";

const enabled = process.env.FIREBASE_RULES_TEST === "1";
const rulesDescribe = enabled ? describe : describe.skip;
let environment: RulesTestEnvironment;
let assertFails: any;
let assertSucceeds: any;

function emulator(name: "FIRESTORE_EMULATOR_HOST" | "FIREBASE_DATABASE_EMULATOR_HOST") {
  const [host, port] = (process.env[name] || "").split(":");
  if (!host || !port) throw new Error(`${name} is not configured.`);
  return { host, port: Number(port) };
}

rulesDescribe("Firebase security rules integration", () => {
  beforeAll(async () => {
    const rulesModule = await import("@firebase/rules-unit-testing");
    assertFails = rulesModule.assertFails;
    assertSucceeds = rulesModule.assertSucceeds;
    environment = await rulesModule.initializeTestEnvironment({
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
      await setDoc(doc(context.firestore(), "_active_bus_locks", "bus_1"), {
        sessionId: "session_1",
      });
      await setDoc(doc(context.firestore(), "ride_sessions", "session_1"), {
        id: "session_1",
        busId: "bus_1",
        driverId: "driver_1",
        routeId: "route_1",
        status: "active",
        passengers: {},
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
    await assertFails(getDoc(doc(admin.firestore(), "_active_bus_locks", "bus_1")));
    await assertFails(setDoc(doc(admin.firestore(), "ride_sessions", "session_1"), {
      status: "active",
    }));
  });

  it("keeps user profiles backend-authoritative: clients cannot create or escalate", async () => {
    const passenger = environment.authenticatedContext("passenger_1", { role: "passenger" });

    // Profile creation is server-only (POST /api/users/bootstrap); the client
    // can read its own profile but never write.
    await assertFails(setDoc(doc(passenger.firestore(), "users", "passenger_1"), {
      uid: "passenger_1",
      email: "rider@example.edu",
      displayName: "Rider",
      photoURL: "",
      role: "passenger",
      createdAt: Date.now(),
    }));
    // Even a self-targeted escalation attempt is denied.
    await assertFails(setDoc(doc(passenger.firestore(), "users", "passenger_1"), {
      uid: "passenger_1",
      email: "rider@example.edu",
      displayName: "Rider",
      photoURL: "",
      role: "admin",
      createdAt: Date.now(),
    }));
    // Own-profile read remains allowed (used to resolve the local role).
    await assertSucceeds(getDoc(doc(passenger.firestore(), "users", "passenger_1")));
  });

  it("keeps feedback backend-authoritative and gates ride feedback to session riders", async () => {
    const passenger = environment.authenticatedContext("passenger_1", { role: "passenger" });
    const outsider = environment.authenticatedContext("passenger_2", { role: "passenger" });
    const admin = environment.authenticatedContext("admin_1", { role: "admin", admin: true });

    // The backend issues boarding and feedback: simulate those
    // server-authoritative writes here (rules-disabled == Admin SDK path).
    await environment.withSecurityRulesDisabled(async (context) => {
      await updateDoc(doc(context.firestore(), "ride_sessions", "session_1"), {
        "passengers.passenger_1": {
          userId: "passenger_1",
          userName: "Rider",
          boardingStopId: "stop_1",
          alightingStopId: "stop_2",
          joinedAt: serverTimestamp(),
        },
        status: "completed",
      });
      await setDoc(doc(context.firestore(), "feedbacks", "feedback_1"), {
        userId: "passenger_1",
        userName: "Rider",
        type: "ride",
        sessionId: "session_1",
        busId: "bus_1",
        driverId: "driver_1",
        rating: 5,
        comment: "Safe ride",
        timestamp: serverTimestamp(),
        status: "new",
      });
      await setDoc(doc(context.firestore(), "feedbackCooldowns", "passenger_1"), {
        userId: "passenger_1",
        lastSubmittedAt: serverTimestamp(),
      });
    });

    // Clients can never create feedback or cooldown docs — the backend is
    // the only writer (POST /api/feedback).
    await assertFails(runTransaction(passenger.firestore(), async (transaction) => {
      transaction.set(doc(collection(passenger.firestore(), "feedbacks")), {
        userId: "passenger_1",
        userName: "Rider",
        type: "general",
        sessionId: null,
        busId: null,
        driverId: null,
        rating: null,
        comment: "Hello",
        timestamp: serverTimestamp(),
        status: "new",
      });
      transaction.set(doc(passenger.firestore(), "feedbackCooldowns", "passenger_1"), {
        userId: "passenger_1",
        lastSubmittedAt: serverTimestamp(),
      });
    }));
    await assertFails(runTransaction(outsider.firestore(), async (transaction) => {
      transaction.set(doc(collection(outsider.firestore(), "feedbacks")), {
        userId: "passenger_2",
        userName: "Outsider",
        type: "ride",
        sessionId: "session_1",
        busId: "bus_1",
        driverId: "driver_1",
        rating: 4,
        comment: "Not my ride",
        timestamp: serverTimestamp(),
        status: "new",
      });
      transaction.set(doc(outsider.firestore(), "feedbackCooldowns", "passenger_2"), {
        userId: "passenger_2",
        lastSubmittedAt: serverTimestamp(),
      });
    }));

    // Admin may still update feedback status (review workflow) but cannot
    // create, delete, or rewrite other fields from the client.
    await assertSucceeds(updateDoc(doc(admin.firestore(), "feedbacks", "feedback_1"), {
      status: "reviewed",
    }));
    await assertFails(updateDoc(doc(admin.firestore(), "feedbacks", "feedback_1"), {
      comment: "tampered",
    }));
  });

  it("denies every client write to ride session manifests", async () => {
    const noRequest = environment.authenticatedContext("passenger_2", { role: "passenger" });
    const admin = environment.authenticatedContext("admin_1", { role: "admin", admin: true });

    const joinPayload = (uid: string, userName: string) => ({
      [`passengers.${uid}`]: {
        userId: uid,
        userName,
        boardingStopId: "stop_1",
        alightingStopId: null,
        joinedAt: serverTimestamp(),
      },
    });

    // Manifest self-join is fully denied: the backend is the only writer.
    await assertFails(updateDoc(doc(noRequest.firestore(), "ride_sessions", "session_1"), joinPayload("passenger_2", "Rider")));
    // Even an admin cannot write the manifest from the client.
    await assertFails(updateDoc(doc(admin.firestore(), "ride_sessions", "session_1"), joinPayload("admin_1", "Admin")));
    // Session lifecycle writes from clients are equally denied.
    await assertFails(updateDoc(doc(noRequest.firestore(), "ride_sessions", "session_1"), {
      status: "completed",
    }));
    // And deleting a session is backend-only.
    await assertFails(deleteDoc(doc(admin.firestore(), "ride_sessions", "session_1")));
  });

  it("keeps passenger requests locked to their owner and assigned drivers", async () => {
    const passenger = environment.authenticatedContext("passenger_2", { role: "passenger" });
    const bus1Driver = environment.authenticatedContext("driver_1", {
      role: "driver",
      driverId: "driver_1",
      assignedBusId: "bus_1",
    });
    const bus2Driver = environment.authenticatedContext("driver_2", {
      role: "driver",
      driverId: "driver_2",
      assignedBusId: "bus_2",
    });

    await assertSucceeds(setDoc(doc(passenger.firestore(), "passenger_requests", "passenger_2"), {
      passengerId: "passenger_2",
      busId: "bus_1",
      type: "pickup",
      lat: 23.0,
      lng: 72.5,
      status: "pending",
      createdAt: serverTimestamp(),
    }));
    // A passenger cannot create a request on someone else's behalf.
    await assertFails(setDoc(doc(passenger.firestore(), "passenger_requests", "passenger_9"), {
      passengerId: "passenger_9",
      busId: "bus_1",
      type: "pickup",
      lat: 23.0,
      lng: 72.5,
      status: "pending",
      createdAt: serverTimestamp(),
    }));
    // The assigned driver can transition status.
    await assertSucceeds(updateDoc(doc(bus1Driver.firestore(), "passenger_requests", "passenger_2"), {
      status: "accepted",
    }));
    // A driver of a different bus cannot touch it.
    await assertFails(updateDoc(doc(bus2Driver.firestore(), "passenger_requests", "passenger_2"), {
      status: "cancelled",
    }));
  });
});
