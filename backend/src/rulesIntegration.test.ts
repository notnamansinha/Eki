import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { get, ref, set } from "firebase/database";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  deleteDoc,
} from "firebase/firestore";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const enabled = process.env.FIREBASE_RULES_TEST === "1";
const rulesDescribe = enabled ? describe : describe.skip;
let environment: RulesTestEnvironment;
let assertFails: any;
let assertSucceeds: any;

function rulesPath(variable: "FIRESTORE_RULES_PATH" | "DATABASE_RULES_PATH", fallback: string) {
  return process.env[variable] || resolve(__dirname, fallback);
}

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
      projectId: "demo-eki-rules-test",
      firestore: {
        ...emulator("FIRESTORE_EMULATOR_HOST"),
        rules: readFileSync(rulesPath("FIRESTORE_RULES_PATH", "../../firestore.rules"), "utf8"),
      },
      database: {
        ...emulator("FIREBASE_DATABASE_EMULATOR_HOST"),
        rules: readFileSync(rulesPath("DATABASE_RULES_PATH", "../../database.rules.json"), "utf8"),
      },
    });
    await environment.withSecurityRulesDisabled(async (context) => {
      for (const uid of ["admin_1", "fleet_viewer"]) {
        await setDoc(doc(context.firestore(), "users", uid), { role: "admin" });
        await setDoc(doc(context.firestore(), "_userAuthorization", uid), { role: "admin", version: "current" });
        await set(ref(context.database(), `_userAuthorization/${uid}`), { role: "admin", version: "current" });
      }
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
      await set(ref(context.database(), "publicRouteBuses"), {
        "route:route_1": { _workerGeneration: 7, revision: 1, buses: { "node:bus_1_route_1": { busId: "bus_1", routeId: "route_1", lat: 23 } } },
        "route:route_2": { _workerGeneration: 7, revision: 1, buses: { "node:bus_2_route_2": { busId: "bus_2", routeId: "route_2", lat: 24 } } },
      });
      await set(ref(context.database(), "liveRouteCatalog"), {
        _workerGeneration: 7, revisions: { "route:route_1": 1 }, values: { "route:route_1": { active: 1, available: 0, freshestAt: 0 } },
      });
      await set(ref(context.database(), "clientProjectionStatus"), { _workerGeneration: 7, public: { schemaVersion: 1, ready: true } });
      await set(ref(context.database(), "activeRouteGeometry/bus_1_route_1/2"), {
        routeId: "route_1",
        direction: "forward",
        source: "dynamic-reroute",
        routeVersion: 2,
        polyline: "encoded-polyline",
      });
      await setDoc(doc(context.firestore(), "routes", "route_1"), {
        id: "route_1",
        name: "Test",
      });
      await setDoc(doc(context.firestore(), "devices", "device_1"), {
        secretHash: "never-client-readable",
        busId: "bus_1",
        routeId: "route_1",
      });
      await setDoc(doc(context.firestore(), "devices", "device_2"), {
        secretHash: "never-client-readable",
        busId: "bus_1",
        routeId: "route_2",
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

  it("retained ride membership cannot authorize chat reads after the profile is deleted", async () => {
    const passenger = environment.authenticatedContext("retired_passenger", { role: "passenger" });
    const admin = environment.authenticatedContext("retirement_admin", { role: "admin", authorizationVersion: "current" });
    const session = "retained_session";
    await environment.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), "users", "retired_passenger"), { role: "passenger" });
      await setDoc(doc(context.firestore(), "users", "retirement_admin"), { role: "admin" });
      await setDoc(doc(context.firestore(), "_userAuthorization", "retirement_admin"), { role: "admin", version: "current" });
      await setDoc(doc(context.firestore(), "users", "retained_operator"), { role: "driver" });
      await setDoc(doc(context.firestore(), "drivers", "retained_driver"), { authUid: "retained_operator", assignedBusId: "retained_bus" });
      await setDoc(doc(context.firestore(), "_userAuthorization", "retained_operator"), {
        role: "driver", version: "current", driverId: "retained_driver", assignedBusId: "retained_bus",
      });
      await setDoc(doc(context.firestore(), "ride_sessions", session), {
        driverId: "retained_driver", busId: "retained_bus", passengers: { retired_passenger: { userId: "retired_passenger" } },
      });
      await setDoc(doc(context.firestore(), "ride_sessions", session, "messages", "retained"), { text: "Retained history" });
    });
    const message = doc(passenger.firestore(), "ride_sessions", session, "messages", "retained");
    await assertSucceeds(getDoc(message));
    await environment.withSecurityRulesDisabled(context => deleteDoc(doc(context.firestore(), "users", "retired_passenger")));
    // The same signed token and preserved manifest must now lose authority.
    await assertFails(getDoc(message));
    await assertSucceeds(getDoc(doc(admin.firestore(), "ride_sessions", session, "messages", "retained")));
    await assertSucceeds(getDoc(doc(environment.authenticatedContext("retained_operator", { role: "driver", driverId: "retained_driver", assignedBusId: "retained_bus", authorizationVersion: "current" }).firestore(), "ride_sessions", session, "messages", "retained")));
  });

  it("restricts cleared ride chat archives to current operators and denies client mutation", async () => {
    await environment.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), "users", "archive_admin"), { role: "admin" });
      await setDoc(doc(context.firestore(), "_userAuthorization", "archive_admin"), { role: "admin", version: "current" });
      await setDoc(doc(context.firestore(), "ride_sessions", "archive_session"), { passengers: { archive_passenger: { userId: "archive_passenger" } } });
      await setDoc(doc(context.firestore(), "ride_sessions", "archive_session", "archivedMessages", "kept"), { text: "Retained after clear" });
    });
    const admin = environment.authenticatedContext("archive_admin", { role: "admin", admin: true, authorizationVersion: "current" });
    const passenger = environment.authenticatedContext("archive_passenger", { role: "passenger" });
    const archived = (context: ReturnType<typeof environment.authenticatedContext>) => doc(context.firestore(), "ride_sessions", "archive_session", "archivedMessages", "kept");
    await assertSucceeds(getDoc(archived(admin)));
    await assertSucceeds(getDocs(collection(admin.firestore(), "ride_sessions", "archive_session", "archivedMessages")));
    await assertFails(getDoc(archived(passenger)));
    await assertFails(getDoc(archived(environment.unauthenticatedContext())));
    await assertFails(setDoc(archived(admin), { text: "Forged" }));
    await assertFails(deleteDoc(archived(admin)));
  });

  it("allows authenticated RTDB reads but denies every client write", async () => {
    const passenger = environment.authenticatedContext("passenger_1", { role: "passenger" });
    const admin = environment.authenticatedContext("admin_1", { role: "admin", admin: true, authorizationVersion: "current" });
    const device = environment.authenticatedContext("device_1", { role: "device" });
    await assertFails(get(ref(passenger.database(), "activeBuses")));
    await assertFails(get(ref(admin.database(), "activeBuses/bus_1_route_1")));
    await assertSucceeds(get(ref(passenger.database(), "activeRouteGeometry/bus_1_route_1/2")));
    await assertFails(get(ref(environment.unauthenticatedContext().database(), "activeBuses")));
    await assertFails(get(ref(environment.unauthenticatedContext().database(), "activeRouteGeometry")));
    await assertFails(set(ref(passenger.database(), "activeBuses/x"), { lat: 1 }));
    await assertFails(set(ref(admin.database(), "activeBuses/x"), { lat: 1 }));
    await assertFails(set(ref(device.database(), "activeBuses/x"), { lat: 1 }));
    await assertFails(set(ref(passenger.database(), "activeRouteGeometry/x/1"), { polyline: "x" }));
    await assertFails(set(ref(admin.database(), "activeRouteGeometry/x/1"), { polyline: "x" }));
    await assertFails(set(ref(device.database(), "activeRouteGeometry/x/1"), { polyline: "x" }));
  });

  it("scopes passengers to public route buses and hides authority and projection metadata", async () => {
    const passenger = environment.authenticatedContext("route_viewer", { role: "passenger" });
    const admin = environment.authenticatedContext("fleet_viewer", { role: "admin", admin: true, authorizationVersion: "current" });
    const route = await assertSucceeds(get(ref(passenger.database(), "publicRouteBuses/route:route_1/buses")));
    expect(Object.keys(route.val())).toEqual(["node:bus_1_route_1"]);
    expect(route.val()["node:bus_1_route_1"]).toEqual({ busId: "bus_1", routeId: "route_1", lat: 23 });
    await assertFails(get(ref(passenger.database(), "publicRouteBuses")));
    await assertFails(get(ref(passenger.database(), "publicRouteBuses/route:route_1")));
    await assertFails(get(ref(passenger.database(), "liveRouteCatalog/revisions")));
    await assertSucceeds(get(ref(passenger.database(), "liveRouteCatalog/values")));
    await assertSucceeds(get(ref(admin.database(), "publicRouteBuses")));
    await assertFails(get(ref(environment.authenticatedContext("role_only", { role: "admin" }).database(), "publicRouteBuses")));
    await assertSucceeds(get(ref(passenger.database(), "clientProjectionStatus/public")));
    await assertFails(get(ref(passenger.database(), "clientProjectionStatus")));
    await assertFails(get(ref(passenger.database(), "clientProjectionStatus/_workerGeneration")));
    await assertFails(get(ref(environment.unauthenticatedContext().database(), "clientProjectionStatus/public")));
    await assertFails(get(ref(environment.unauthenticatedContext().database(), "liveRouteCatalog/values")));
    await assertFails(get(ref(environment.unauthenticatedContext().database(), "publicRouteBuses/route:route_1/buses")));
    for (const context of [passenger, admin]) {
      await assertFails(set(ref(context.database(), "publicRouteBuses/route:route_1/buses/x"), { lat: 1 }));
      await assertFails(set(ref(context.database(), "liveRouteCatalog/values/route:route_1"), { active: 99 }));
      await assertFails(set(ref(context.database(), "clientProjectionStatus/public"), { schemaVersion: 1, ready: true }));
    }
  });

  it("denies browser route/device/session mutations and recovery-state reads", async () => {
    const admin = environment.authenticatedContext("admin_1", { role: "admin", admin: true, authorizationVersion: "current" });
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
    const admin = environment.authenticatedContext("admin_1", { role: "admin", admin: true, authorizationVersion: "current" });

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

    // Even admin status changes go through PATCH /api/feedback/:id/status;
    // every browser write to feedback documents is denied.
    await assertFails(updateDoc(doc(admin.firestore(), "feedbacks", "feedback_1"), {
      status: "reviewed",
    }));
    await assertFails(updateDoc(doc(admin.firestore(), "feedbacks", "feedback_1"), {
      comment: "tampered",
    }));
  });

  it("denies every client write to ride session manifests", async () => {
    const noRequest = environment.authenticatedContext("passenger_2", { role: "passenger" });
    const admin = environment.authenticatedContext("admin_1", { role: "admin", admin: true, authorizationVersion: "current" });

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

  it("executes the devices(busId, routeId) equality query used by provisioning", async () => {
    // Server-side provisioning (provisionDevice.ts and PATCH /api/devices)
    // queries devices by bus + route. Firestore merges the automatic
    // single-field indexes for multiple equality clauses, so this query must
    // remain covered without adding a redundant composite index.
    await environment.withSecurityRulesDisabled(async (context) => {
      const matches = await getDocs(
        query(
          collection(context.firestore(), "devices"),
          where("busId", "==", "bus_1"),
          where("routeId", "==", "route_1"),
        ),
      );
      expect(matches.docs.map((entry) => entry.id)).toEqual(["device_1"]);
    });
  });

  it("denies all client access to passenger requests", async () => {
    const passenger = environment.authenticatedContext("passenger_2", { role: "passenger" });
    const bus1Driver = environment.authenticatedContext("driver_1", {
      role: "driver",
      driverId: "driver_1",
      assignedBusId: "bus_1",
    });

    // The collection is backend-authoritative (issues #72 + #73): passengers
    // cannot create their own request, and no client — including the assigned
    // driver — can transition status or read through the rules.
    await assertFails(setDoc(doc(passenger.firestore(), "passenger_requests", "passenger_2"), {
      passengerId: "passenger_2",
      busId: "bus_1",
      type: "pickup",
      lat: 23.0,
      lng: 72.5,
      status: "pending",
      createdAt: serverTimestamp(),
    }));
    await assertFails(updateDoc(doc(bus1Driver.firestore(), "passenger_requests", "passenger_2"), {
      status: "accepted",
    }));
    await assertFails(getDoc(doc(passenger.firestore(), "passenger_requests", "passenger_2")));
  });

  it("rejects stale driver tokens after reassignment, unassignment, deletion and repeated assignment", async () => {
    const uid = "operator_auth";
    const claims = { role: "driver", driverId: "security_driver", assignedBusId: "security_bus", authorizationVersion: "v1" };
    const old = environment.authenticatedContext(uid, claims);
    const session = (context: ReturnType<typeof environment.authenticatedContext>) => doc(context.firestore(), "ride_sessions", "security_session");
    const message = (context: ReturnType<typeof environment.authenticatedContext>) => doc(context.firestore(), "ride_sessions", "security_session", "messages", "message");
    await environment.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), "users", uid), { role: "driver" });
      await setDoc(doc(context.firestore(), "users", "security_passenger"), { role: "passenger" });
      await setDoc(doc(context.firestore(), "_userAuthorization", uid), { version: "v1", role: "driver", driverId: "security_driver", assignedBusId: "security_bus" });
      await setDoc(doc(context.firestore(), "drivers", "security_driver"), { authUid: uid, assignedBusId: "security_bus" });
      await setDoc(session(context), { driverId: "security_driver", busId: "security_bus", boardingCode: "SYNTHETIC", passengers: { security_passenger: { userId: "security_passenger" } } });
      await setDoc(message(context), { text: "synthetic" });
    });
    await assertSucceeds(getDoc(session(old)));
    await assertSucceeds(getDoc(message(old)));
    for (const registry of [{ authUid: "replacement", assignedBusId: "security_bus" }, { authUid: uid, assignedBusId: null }, { authUid: uid, assignedBusId: "different_bus" }, null]) {
      await environment.withSecurityRulesDisabled(async context => {
        const driver = doc(context.firestore(), "drivers", "security_driver");
        if (registry) await setDoc(driver, registry); else await deleteDoc(driver);
      });
      await assertFails(getDoc(session(old)));
      await assertFails(getDoc(message(old)));
    }
    // Returning the SAME UID to the SAME bus must not revive its old token.
    await environment.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), "drivers", "security_driver"), { authUid: uid, assignedBusId: "security_bus" });
      await updateDoc(doc(context.firestore(), "_userAuthorization", uid), { version: "v2" });
    });
    await assertFails(getDoc(session(old)));
    await assertFails(getDoc(message(old)));
    const fresh = environment.authenticatedContext(uid, { ...claims, authorizationVersion: "v2" });
    await assertSucceeds(getDoc(session(fresh)));
    await assertSucceeds(getDoc(message(fresh)));
    const passenger = environment.authenticatedContext("security_passenger", { role: "passenger" });
    await assertFails(getDoc(session(passenger)));
    await assertSucceeds(getDoc(message(passenger)));
    await environment.withSecurityRulesDisabled(context => updateDoc(doc(context.firestore(), "users", uid), { role: "passenger" }));
    await assertFails(getDoc(session(fresh)));
    await assertFails(getDoc(message(fresh)));
    await environment.withSecurityRulesDisabled(async context => {
      await updateDoc(doc(context.firestore(), "users", uid), { role: "driver" });
      await setDoc(doc(context.firestore(), "drivers", "security_driver"), { authUid: uid, assignedBusId: null });
      await setDoc(doc(context.firestore(), "_userAuthorization", uid), { role: "driver", version: "unassigned", driverId: null, assignedBusId: null });
    });
    const unassigned = environment.authenticatedContext(uid, { role: "driver", authorizationVersion: "unassigned" });
    await assertSucceeds(getDoc(doc(unassigned.firestore(), "drivers", "security_driver")));
    await assertFails(getDoc(session(unassigned)));
    await assertFails(getDoc(message(unassigned)));
  });

  it("requires current admin authorization in both databases and never revives an old version", async () => {
    const uid = "security_admin";
    const contextFor = (authorizationVersion?: string, extra = { role: "admin", admin: true }) => environment.authenticatedContext(uid, { ...extra, ...(authorizationVersion ? { authorizationVersion } : {}) });
    const old = contextFor("a1");
    const feedback = (context: ReturnType<typeof contextFor>) => doc(context.firestore(), "feedbacks", "security_feedback");
    const fleet = (context: ReturnType<typeof contextFor>) => ref(context.database(), "publicRouteBuses");
    const publish = (role: string, version: string) => environment.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), "users", uid), { role });
      await setDoc(doc(context.firestore(), "_userAuthorization", uid), { role, version });
      await set(ref(context.database(), `_userAuthorization/${uid}`), { role, version });
      await setDoc(feedback(context), { userId: "synthetic" });
    });
    await publish("admin", "a1");
    await assertSucceeds(getDoc(feedback(old)));
    await assertSucceeds(get(fleet(old)));
    for (const role of ["blocked", "passenger"]) {
      await publish(role, "a2");
      await assertFails(getDoc(feedback(old)));
      await assertFails(get(fleet(old)));
    }
    await publish("admin", "a3");
    await assertFails(getDoc(feedback(old)));
    await assertFails(get(fleet(old)));
    for (const invalid of [contextFor(), contextFor("unknown"), contextFor("a3", { role: "passenger", admin: true })]) {
      await assertFails(getDoc(feedback(invalid)));
      await assertFails(get(fleet(invalid)));
    }
    const fresh = contextFor("a3");
    await assertSucceeds(getDoc(feedback(fresh)));
    await assertSucceeds(get(fleet(fresh)));
    for (const context of [old, fresh, environment.authenticatedContext("security_passenger", { role: "passenger" })]) {
      await assertFails(getDoc(doc(context.firestore(), "_userAuthorization", uid)));
      await assertFails(setDoc(doc(context.firestore(), "_userAuthorization", uid), { role: "admin", version: "a1" }));
      await assertFails(get(ref(context.database(), `_userAuthorization/${uid}`)));
      await assertFails(set(ref(context.database(), `_userAuthorization/${uid}`), { role: "admin", version: "a1" }));
    }
    await environment.withSecurityRulesDisabled(async context => {
      await deleteDoc(doc(context.firestore(), "_userAuthorization", uid));
      await set(ref(context.database(), `_userAuthorization/${uid}`), null);
    });
    await assertFails(getDoc(feedback(fresh)));
    await assertFails(get(fleet(fresh)));
  });
});
