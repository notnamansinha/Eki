import { FieldPath, FieldValue } from "firebase-admin/firestore";
import { auth, db } from "../lib/firebaseAdmin";
import { createBoundedSingleFlight } from "../lib/boundedSingleFlight";
import { settleTogether } from "../lib/reconciliationPages";
export class PrivacyConflict extends Error {}
export const PRIVACY_REQUESTS = "_privacy_deletion_requests";
export const PRIVACY_FAILURE_LIMIT = 5;
export const privacyExecutions = new Set<string>();
const admissions = createBoundedSingleFlight<void>({ maxFills: 8, maxWaitersPerFill: 16, responseMs: 3_000 });
const controls = createBoundedSingleFlight<unknown>({ maxFills: 8, maxWaitersPerFill: 16, responseMs: 3_000 });
export function validPrivacyUid(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 128 && !value.includes("/") && ![".", ".."].includes(value);
}
/** Current Auth plus durable membership, including accounts without a role claim. */
export async function passengerIdentity(uid: string, allowDeleted = false): Promise<string | null> {
  const [user, profile, drivers] = await settleTogether([
    auth.getUser(uid).catch((error: any) => {
      if (allowDeleted && (error?.code ?? error?.errorInfo?.code) === "auth/user-not-found") return null;
      throw error;
    }),
    db.collection("users").doc(uid).get(),
    db.collection("drivers").where("authUid", "==", uid).limit(1).get(),
  ]);
  const claims = user?.customClaims ?? {};
  const profileRole = profile.data()?.role;
  if (!drivers.empty || (profileRole !== undefined && profileRole !== "passenger") ||
      claims.admin === true || claims.driverId !== undefined || claims.assignedBusId !== undefined ||
      (claims.role !== undefined && claims.role !== "passenger")) {
    throw new PrivacyConflict("Operator and administrator accounts require IT offboarding.");
  }
  return user?.metadata.creationTime ?? null;
}
export async function requestPrivacyDeletion(uid: string): Promise<void> {
  if (!validPrivacyUid(uid)) throw new PrivacyConflict("Invalid passenger identity.");
  return admissions.run(uid, uid, async isCurrent => {
    const targetCreatedAt = await passengerIdentity(uid);
    if (!isCurrent()) throw Error("Privacy admission expired.");
    await db.runTransaction(async transaction => {
      if (!isCurrent()) throw Error("Privacy admission expired.");
      const ref = db.collection(PRIVACY_REQUESTS).doc(uid), existing = (await transaction.get(ref)).data();
      if (existing?.targetCreatedAt && existing.targetCreatedAt !== targetCreatedAt) throw new PrivacyConflict("Account identity changed; recovery requires operator review.");
      if (!isCurrent()) throw Error("Privacy admission expired.");
      if (existing) transaction.set(ref, {
        targetCreatedAt, resubmittedAt: FieldValue.serverTimestamp(), resubmissions: FieldValue.increment(1), updatedAt: FieldValue.serverTimestamp(),
        ...(existing.status === "failed" ? { status: "pending", failures: 0, generation: Number(existing.generation ?? 0) + 1,
          nextAttemptAt: Date.now(), phase: "cleaning" } : {}),
      }, { merge: true });
      else transaction.create(ref, { status: "pending", attempts: 0, failures: 0, generation: 0, targetCreatedAt, nextAttemptAt: Date.now(), requestedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    });
  });
}
function snapshot(uid: string, data: Record<string, any>) {
  const status = ["pending", "processing", "failed"].includes(data.status) ? data.status : "failed";
  return { uid, status, attempts: Number.isSafeInteger(data.attempts) && data.attempts >= 0 ? data.attempts : 0,
    failures: Number.isSafeInteger(data.failures) && data.failures >= 0 ? data.failures : 0,
    generation: Number.isSafeInteger(data.generation) && data.generation >= 0 ? data.generation : 0,
    executorId: typeof data.executorId === "string" ? data.executorId : "legacy",
    ...(typeof data.lastErrorCode === "string" && /^[A-Z_]{1,64}$/.test(data.lastErrorCode) ? { lastErrorCode: data.lastErrorCode } : {}),
    ...(Number.isFinite(data.nextAttemptAt) ? { nextAttemptAt: data.nextAttemptAt } : {}),
    ...(Number.isFinite(data.deadlineAt) ? { deadlineAt: data.deadlineAt } : {}),
    ...(["cleaning", "auth_deletion_dispatched"].includes(data.phase) ? { phase: data.phase } : {}),
    ...(data.lastErrorAt?.toDate?.() ? { lastErrorAt: data.lastErrorAt.toDate().toISOString() } : {}),
    recoveryRequired: status === "failed" || (status === "processing" && Number(data.deadlineAt ?? 0) <= Date.now()),
  };
}
export async function listPrivacyDeletions(cursor?: string) {
  return controls.run(`list:${cursor ?? ""}`, "list", async () => {
    let query = db.collection(PRIVACY_REQUESTS).orderBy(FieldPath.documentId()).limit(20);
    if (cursor) query = query.startAfter(cursor);
    const page = await query.get();
    return { requests: page.docs.map(doc => snapshot(doc.id, doc.data())), nextCursor: page.size === 20 ? page.docs.at(-1)!.id : null };
  });
}
export async function recoverPrivacyDeletion(uid: string, options: { expectedExecutorId: string; expectedGeneration: number; executorStopped?: true; adminUid: string }) {
  return controls.run(`recover:${uid}:${options.expectedExecutorId}:${options.expectedGeneration}:${options.executorStopped === true}:${options.adminUid}`, uid, isCurrent => db.runTransaction(async transaction => {
    const ref = db.collection(PRIVACY_REQUESTS).doc(uid), data = (await transaction.get(ref)).data();
    if (!isCurrent() || !data || !options.adminUid || privacyExecutions.has(uid) ||
        (data.executorId ?? "legacy") !== options.expectedExecutorId || Number(data.generation ?? 0) !== options.expectedGeneration ||
        !["failed", "processing"].includes(data.status) ||
        (data.status === "processing" && (options.executorStopped !== true || Number(data.deadlineAt ?? 0) > Date.now()))) {
      throw new PrivacyConflict("Recovery identity changed, not eligible, or execution is still active.");
    }
    if (!isCurrent() || privacyExecutions.has(uid)) throw new PrivacyConflict("Recovery expired or execution is active.");
    transaction.set(ref, { status: "pending", generation: options.expectedGeneration + 1, failures: 0, nextAttemptAt: Date.now(),
      recoveredBy: options.adminUid, recoveredAt: FieldValue.serverTimestamp(), recoveries: FieldValue.increment(1),
      executorStopped: options.executorStopped === true, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return { recovered: true };
  }));
}
