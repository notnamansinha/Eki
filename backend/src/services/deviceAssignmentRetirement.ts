import { rtdb } from "../lib/firebaseAdmin";

/** Keep a tombstone so an already authenticated old request cannot revive presence. */
export function retiredDevicePresence(
  current: Record<string, unknown> | null,
  deviceId: string,
  revision: number,
): Record<string, unknown> | undefined {
  if (!current || (typeof current.deviceId === "string" && current.deviceId !== deviceId) ||
      Number(current.assignmentRevision ?? 0) >= revision ||
      (current.status === "active" && typeof current.sessionId === "string" && current.sessionId)) return;
  return { ...current, deviceId, retiredAssignmentRevision: revision, deviceState: "offline" };
}

export async function retireDeviceAssignment(
  deviceId: string, busId: string, routeId: string, revision: number,
): Promise<void> {
  if (![deviceId, busId, routeId].every(id => /^[A-Za-z0-9_-]{1,128}$/.test(id)) ||
      !Number.isSafeInteger(revision) || revision < 1) throw new Error("Invalid assignment retirement.");
  await rtdb.ref(`activeBuses/${busId}_${routeId}`).transaction(
    current => retiredDevicePresence(current, deviceId, revision), undefined, false,
  );
}
