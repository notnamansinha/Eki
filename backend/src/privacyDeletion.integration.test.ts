import { fork } from "node:child_process";
import { resolve } from "node:path";
import { Firestore } from "firebase-admin/firestore";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ firestore: null as Firestore | null, deleted: [] as string[], fails: new Set<string>() }));
vi.mock("./lib/firebaseAdmin", () => ({ db: { collection: (name: string) => state.firestore!.collection(name), collectionGroup: (name: string) => state.firestore!.collectionGroup(name), runTransaction: (work: any) => state.firestore!.runTransaction(work), batch: () => state.firestore!.batch() },
  // Auth is synthetic; the test cannot touch live accounts.
  auth: { getUser: async () => ({ customClaims: {}, metadata: { creationTime: "2026-01-01" } }), deleteUser: async (uid: string) => { state.deleted.push(uid); if (state.fails.has(uid)) throw Error("Synthetic Auth outage"); } } }));
import { runPrivacyDeletionQueue, drainPrivacyDeletions } from "./services/privacyDeletionWorker";
import { requestPrivacyDeletion, recoverPrivacyDeletion, listPrivacyDeletions } from "./services/privacyDeletionRequests";
import { readFleetLock, recoverFleetLock } from "./services/httpOperations";
const integration = process.env.FIREBASE_RULES_TEST === "1" ? describe : describe.skip;
integration("privacy recovery against actual loopback Firestore", () => {
  beforeAll(() => {
    const host = process.env.FIRESTORE_EMULATOR_HOST;
    if (!host || !/^(localhost|127\.0\.0\.1|\[::1\]):\d+$/.test(host)) throw Error("Loopback emulator required");
    state.firestore = new Firestore({ projectId: "eki-privacy-test", host, ssl: false });
  });
  beforeEach(async () => {
    await drainPrivacyDeletions(false); state.deleted = []; state.fails.clear();
    for (const name of ["_privacy_deletion_requests", "_reconciliation_cursors", "_fleet_reconciliation_locks", "_fleet_lock_recoveries", "ride_sessions", "feedbacks", "users", "drivers", "feedbackCooldowns", "passenger_requests"]) {
      const docs = await state.firestore!.collection(name).get();
      for (let index = 0; index < docs.size; index += 400) { const batch = state.firestore!.batch(); docs.docs.slice(index, index + 400).forEach(doc => batch.delete(doc.ref)); await batch.commit(); }
    }
    for (const name of ["messages", "messageRateLimits"]) { const batch = state.firestore!.batch(); (await state.firestore!.collectionGroup(name).get()).docs.forEach(doc => batch.delete(doc.ref)); await batch.commit(); }
  });
  afterAll(async () => { await drainPrivacyDeletions(false); await state.firestore?.terminate(); });
  it("advances past 20 poison passengers, preserves resubmission history and monitors bounded pages", async () => {
    const batch = state.firestore!.batch();
    for (let index = 0; index < 20; index++) { const uid = `poison_${String(index).padStart(2, "0")}`; state.fails.add(uid); batch.set(state.firestore!.collection("_privacy_deletion_requests").doc(uid), { status: "pending", attempts: 0, nextAttemptAt: Date.now() + 60000 }); }
    batch.set(state.firestore!.collection("_privacy_deletion_requests").doc("z_healthy"), { status: "pending" }); await batch.commit();
    await runPrivacyDeletionQueue(); await drainPrivacyDeletions(false);
    expect(state.deleted).toHaveLength(0);
    await runPrivacyDeletionQueue(); await drainPrivacyDeletions(false); expect(state.deleted).toEqual(["z_healthy"]);
    const ref = state.firestore!.collection("_privacy_deletion_requests").doc("poison_00");
    await ref.set({ status: "failed", attempts: 5, failures: 5, generation: 5, lastErrorCode: "DEPENDENCY_FAILURE", lastErrorAt: new Date("2026-01-01"), nextAttemptAt: Date.now() + 60000 }, { merge: true });
    await requestPrivacyDeletion("poison_00"); expect((await ref.get()).data()).toMatchObject({ status: "pending", attempts: 5, failures: 0, generation: 6, lastErrorCode: "DEPENDENCY_FAILURE" });
    const page = await listPrivacyDeletions() as any; expect(page.requests).toHaveLength(20); expect(page.nextCursor).toBe("poison_19"); expect(page.requests[0]).toMatchObject({ recoveryRequired: false, lastErrorAt: "2026-01-01T00:00:00.000Z" });
  }, 30000);
  it("cleans manifests and collection groups through bounded resumable chunks, then retires the account", async () => {
    const uid = "big"; const batch = state.firestore!.batch();
    batch.set(state.firestore!.collection("users").doc(uid), { role: "passenger" });
    batch.set(state.firestore!.collection("ride_sessions").doc("indexed"), { passengerIds: [uid, "keep"], passengers: { [uid]: { userId: uid }, keep: { userId: "keep" } } });
    batch.set(state.firestore!.collection("ride_sessions").doc("legacy"), { passengers: { [uid]: { userId: uid } } });
    batch.set(state.firestore!.collection("chats").doc("thread").collection("messages").doc("personal"), { senderId: uid });
    batch.set(state.firestore!.collection("chats").doc("thread").collection("messageRateLimits").doc("personal"), { userId: uid });
    await batch.commit();
    for (let start = 0; start < 1001; start += 400) { const part = state.firestore!.batch(); for (let index = start; index < Math.min(start + 400, 1001); index++) part.set(state.firestore!.collection("feedbacks").doc(`f_${String(index).padStart(4, "0")}`), { userId: uid }); await part.commit(); }
    await requestPrivacyDeletion(uid); await requestPrivacyDeletion("later");
    await runPrivacyDeletionQueue(); await drainPrivacyDeletions(false);
    expect((await state.firestore!.collection("feedbacks").get()).size).toBe(801); expect(state.deleted).toEqual(["later"]);
    for (let index = 0; index < 5; index++) { await runPrivacyDeletionQueue(); await drainPrivacyDeletions(false); }
    expect(state.deleted).toContain(uid); expect((await state.firestore!.collection("_privacy_deletion_requests").doc(uid).get()).exists).toBe(false);
    expect((await state.firestore!.collection("ride_sessions").doc("indexed").get()).data()).toEqual({ passengerIds: ["keep"], passengers: { keep: { userId: "keep" } } });
    expect((await state.firestore!.collection("ride_sessions").doc("legacy").get()).data()).toEqual({ passengerIds: [], passengers: {} });
    expect((await state.firestore!.collectionGroup("messages").get()).empty).toBe(true); expect((await state.firestore!.collectionGroup("messageRateLimits").get()).empty).toBe(true);
  }, 60000);
  it("recovers a killed raw executor in claim-before-lock order without deleting a recreated identity", async () => {
    await requestPrivacyDeletion("crashed");
    const child = fork(resolve(__dirname, "../test-support/privacy-crash.cjs"), [], { execArgv: ["--import", "tsx"], stdio: ["ignore", "ignore", "inherit", "ipc"] });
    const exited = new Promise<void>(done => child.once("exit", () => done()));
    try { await new Promise<void>((done, fail) => { child.once("message", () => done()); child.once("error", fail); child.once("exit", code => fail(Error(`Child exited before Auth dispatch: ${code}`))); }); }
    finally { child.kill("SIGKILL"); await exited; }
    const ref = state.firestore!.collection("_privacy_deletion_requests").doc("crashed"); const claimed = (await ref.get()).data()!;
    expect(claimed).toMatchObject({ status: "processing", attempts: 1, phase: "auth_deletion_dispatched" });
    const lock = (await readFleetLock())!; expect(lock.privacyRequestId).toBe("crashed");
    await expect(recoverFleetLock({ expectedOwner: lock.owner, executorStopped: true, adminUid: "admin" })).rejects.toThrow("linked privacy");
    await expect(recoverPrivacyDeletion("crashed", { expectedExecutorId: claimed.executorId, expectedGeneration: claimed.generation, adminUid: "admin" })).rejects.toThrow("not eligible");
    // Accelerate only the elapsed claim deadline after the real process has exited.
    await ref.update({ deadlineAt: Date.now() - 1 });
    await recoverPrivacyDeletion("crashed", { expectedExecutorId: claimed.executorId, expectedGeneration: claimed.generation, executorStopped: true, adminUid: "admin" });
    await recoverFleetLock({ expectedOwner: lock.owner, executorStopped: true, adminUid: "admin" });
    expect((await ref.get()).data()).toMatchObject({ status: "pending", attempts: 1, generation: 2, recoveredBy: "admin" });
    await ref.update({ targetCreatedAt: "original-account-that-was-recreated" });
    await runPrivacyDeletionQueue(); await drainPrivacyDeletions(false);
    expect((await ref.get()).data()).toMatchObject({ status: "failed", lastErrorCode: "ACCOUNT_INELIGIBLE" }); expect(state.deleted).toHaveLength(0);
  }, 30000);
});
