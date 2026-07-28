import { FieldPath, FieldValue, type Query } from "firebase-admin/firestore";
import { auth, db } from "../lib/firebaseAdmin";

const BATCH_SIZE = 200;

async function deleteQuery(
  query: Query,
): Promise<number> {
  let count = 0;
  while (true) {
    const snapshot = await query.limit(BATCH_SIZE).get();
    if (snapshot.empty) return count;
    const batch = db.batch();
    snapshot.docs.forEach((document) => batch.delete(document.ref));
    await batch.commit();
    count += snapshot.size;
  }
}

async function removePassengerManifest(uid: string): Promise<number> {
  let count = 0;
  while (true) {
    const sessions = await db.collection("ride_sessions")
      .where(new FieldPath("passengers", uid, "userId"), "==", uid)
      .limit(BATCH_SIZE)
      .get();
    if (sessions.empty) return count;
    const batch = db.batch();
    sessions.docs.forEach((session) => {
      batch.update(session.ref, new FieldPath("passengers", uid), FieldValue.delete());
    });
    await batch.commit();
    count += sessions.size;
  }
}

async function processDeletion(uid: string): Promise<void> {
  await Promise.all([
    removePassengerManifest(uid),
    deleteQuery(db.collection("feedbacks").where("userId", "==", uid)),
    deleteQuery(db.collectionGroup("messages").where("senderId", "==", uid)),
    deleteQuery(db.collectionGroup("messageRateLimits").where("userId", "==", uid)),
  ]);

  const batch = db.batch();
  batch.delete(db.collection("users").doc(uid));
  batch.delete(db.collection("feedbackCooldowns").doc(uid));
  batch.delete(db.collection("passenger_requests").doc(uid));
  await batch.commit();
  await auth.deleteUser(uid).catch((error: any) => {
    if (error?.errorInfo?.code !== "auth/user-not-found") throw error;
  });
  await db.collection("_privacy_deletion_requests").doc(uid).delete();
}

export async function runPrivacyDeletionQueue(): Promise<void> {
  const requests = await db.collection("_privacy_deletion_requests")
    .where("status", "==", "pending")
    .limit(20)
    .get();
  for (const request of requests.docs) {
    try {
      await request.ref.set({
        attempts: FieldValue.increment(1),
        lastAttemptAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      await processDeletion(request.id);
      console.log("[Privacy] Completed one account deletion request.");
    } catch (error) {
      console.error("[Privacy] Account deletion attempt failed:", error);
      await request.ref.set({
        lastErrorAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    }
  }
}

export function startPrivacyDeletionWorker(): () => void {
  void runPrivacyDeletionQueue().catch((error) => {
    console.error("[Privacy] Initial deletion queue run failed:", error);
  });
  const timer = setInterval(() => {
    void runPrivacyDeletionQueue().catch((error) => {
      console.error("[Privacy] Deletion queue run failed:", error);
    });
  }, 60 * 60 * 1000);
  timer.unref();
  return () => clearInterval(timer);
}
