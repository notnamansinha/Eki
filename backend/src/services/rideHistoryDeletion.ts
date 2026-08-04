import type {
  DocumentReference,
  Firestore,
} from "firebase-admin/firestore";

const TERMINAL_RIDE_STATUSES = new Set(["completed", "interrupted", "failed"]);
const DELETE_BATCH_SIZE = 400;

export class RideHistoryConflictError extends Error {
  constructor() {
    super("Only ended ride history can be deleted.");
    this.name = "RideHistoryConflictError";
  }
}

export function isTerminalRideStatus(status: unknown): boolean {
  return typeof status === "string" && TERMINAL_RIDE_STATUSES.has(status);
}

export function dedupeDocumentReferences<T extends { path: string }>(
  references: readonly T[],
): T[] {
  return [...new Map(references.map((reference) => [reference.path, reference])).values()];
}

async function deleteReferences(
  firestore: Firestore,
  references: DocumentReference[],
): Promise<void> {
  for (let offset = 0; offset < references.length; offset += DELETE_BATCH_SIZE) {
    const batch = firestore.batch();
    references
      .slice(offset, offset + DELETE_BATCH_SIZE)
      .forEach((reference) => batch.delete(reference));
    await batch.commit();
  }
}

export interface RideHistoryDeletionResult {
  sessionDeleted: boolean;
  completedTripProjectionsDeleted: number;
}

/**
 * Delete one terminal session and its derived completed-trip projections.
 * A missing session is treated idempotently so a retry can finish projection
 * cleanup after a previous recursive deletion partially succeeded.
 */
export async function deleteTerminalRideHistory(
  firestore: Firestore,
  sessionId: string,
): Promise<RideHistoryDeletionResult> {
  const sessionRef = firestore.collection("ride_sessions").doc(sessionId);
  const sessionSnapshot = await sessionRef.get();
  if (sessionSnapshot.exists && !isTerminalRideStatus(sessionSnapshot.data()?.status)) {
    throw new RideHistoryConflictError();
  }

  const completedTrips = firestore.collection("completed_trips");
  const sameIdRef = completedTrips.doc(sessionId);
  const [sameIdSnapshot, matchingSessionSnapshot] = await Promise.all([
    sameIdRef.get(),
    completedTrips.where("sessionId", "==", sessionId).get(),
  ]);
  const projectionReferences = dedupeDocumentReferences([
    ...(sameIdSnapshot.exists ? [sameIdRef] : []),
    ...matchingSessionSnapshot.docs.map((document) => document.ref),
  ]);

  if (sessionSnapshot.exists) {
    await firestore.recursiveDelete(sessionRef);
  }
  await deleteReferences(firestore, projectionReferences);

  return {
    sessionDeleted: sessionSnapshot.exists,
    completedTripProjectionsDeleted: projectionReferences.length,
  };
}
