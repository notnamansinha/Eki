import { FieldPath, Timestamp, type Query } from "firebase-admin/firestore";
import { db } from "../lib/firebaseAdmin";

const DAY_MS = 24 * 60 * 60 * 1000;
const BATCH_SIZE = 200;

function readDays(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : fallback;
}

async function deleteDocuments(query: Query, recursive = false): Promise<number> {
  let deleted = 0;
  while (true) {
    const snapshot = await query.limit(BATCH_SIZE).get();
    if (snapshot.empty) break;
    if (recursive) {
      for (const document of snapshot.docs) await db.recursiveDelete(document.ref);
    } else {
      const batch = db.batch();
      snapshot.docs.forEach((document) => batch.delete(document.ref));
      await batch.commit();
    }
    deleted += snapshot.size;
  }
  return deleted;
}

export function isRetentionSweeperEnabled(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === "true";
}

async function runRetentionSweep(now = Date.now()): Promise<void> {
  const rideDays = readDays(process.env.RIDE_SESSION_RETENTION_DAYS, 90);
  const feedbackDays = readDays(process.env.FEEDBACK_RETENTION_DAYS, 180);
  const tripDays = readDays(process.env.COMPLETED_TRIP_RETENTION_DAYS, 180);
  const operationDays = readDays(process.env.OPERATION_LOG_RETENTION_DAYS, 90);

  const [sessions, feedback, trips, operations] = await Promise.all([
    deleteDocuments(
      db.collection("ride_sessions")
        .where("status", "in", ["completed", "failed", "interrupted"])
        .where("endTime", "<", now - rideDays * DAY_MS)
        .orderBy("endTime")
        .orderBy(FieldPath.documentId()),
      true,
    ),
    deleteDocuments(
      db.collection("feedbacks")
        .where("timestamp", "<", Timestamp.fromMillis(now - feedbackDays * DAY_MS))
        .orderBy("timestamp")
        .orderBy(FieldPath.documentId()),
    ),
    deleteDocuments(
      db.collection("completed_trips")
        .where("completedAt", "<", new Date(now - tripDays * DAY_MS).toISOString())
        .orderBy("completedAt")
        .orderBy(FieldPath.documentId()),
    ),
    deleteDocuments(
      db.collection("_fleet_operations")
        .where("createdAt", "<", Timestamp.fromMillis(now - operationDays * DAY_MS))
        .orderBy("createdAt")
        .orderBy(FieldPath.documentId()),
    ),
  ]);
  console.log("[Retention] Sweep complete", { sessions, feedback, trips, operations });
}

export function startRetentionSweeper(): () => void {
  // Retention deletes durable data, so an absent/misspelled setting must be
  // safe. Operators have to opt in explicitly after reviewing the periods.
  if (!isRetentionSweeperEnabled(process.env.RETENTION_SWEEPER_ENABLED)) {
    console.log("[Retention] Sweeper disabled (set RETENTION_SWEEPER_ENABLED=true to enable)." );
    return () => undefined;
  }
  void runRetentionSweep().catch((error) => {
    console.error("[Retention] Initial sweep failed:", error);
  });
  const timer = setInterval(() => {
    void runRetentionSweep().catch((error) => {
      console.error("[Retention] Scheduled sweep failed:", error);
    });
  }, DAY_MS);
  timer.unref();
  return () => clearInterval(timer);
}
