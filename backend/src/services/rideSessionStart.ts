import { createHash } from "node:crypto";
import { FieldValue, type DocumentReference, type Transaction } from "firebase-admin/firestore";
import type { Reference } from "firebase-admin/database";
import { db, rtdb } from "../lib/firebaseAdmin";
import { endpointSnapshotVersion } from "../lib/endpointSnapshotVersion";
import { inferRideDirectionFromTelemetry } from "../lib/automaticRideDirection";
import { withoutLiveRouteContext } from "../lib/liveRouteContext";
import { isRideDirection, stopsInRideDirection, type RideDirection } from "../lib/rideDirection";
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;
export interface ServiceAssignment { driverId: string; busId: string; routeId: string }
export class RideSessionStartError extends Error {
  constructor(readonly statusCode: number, message: string, readonly reason?: "terminal_session" | "interrupted_session") { super(message); }
}
export interface ServiceStartResult { sessionId: string; resumed: boolean; direction: RideDirection | null; pending: boolean; created: boolean }

async function completeAutomaticSetup(node: Reference, sessionId: string, automatic?: boolean) {
  if (!automatic) return;
  await node.transaction(live => {
    if (live === null) return null;
    if (live.sessionId !== sessionId || live.serviceSetupPending !== true) return;
    return { ...live, serviceSetupPending: false, automaticServiceState: null };
  }, undefined, false);
}
export class SessionCreationConflict extends Error { readonly statusCode = 409; }

export async function runSessionTransaction<T>(work: (transaction: Transaction) => Promise<T>): Promise<T> {
  try {
    return await db.runTransaction(work);
  } catch (error) {
    // The SDK retries expired transaction IDs, but not this closed-ID response.
    // Start one fresh transaction; every ownership/lifecycle read runs again.
    // Callers keep session IDs and idempotency keys outside the retry callback.
    if (typeof error !== "object" || error === null ||
        !("code" in error) || error.code !== 3 ||
        !("details" in error) || error.details !== "Transaction is invalid or closed.") throw error;
    console.warn("[Shifts] Retrying a closed Firestore transaction once.");
    return db.runTransaction(work);
  }
}

type SessionProjection = { ref: DocumentReference; data: Record<string, unknown>; merge?: boolean };

// Protect terminal transitions and newer telemetry/delay projections when a
// creation retry races another writer. All reads precede transaction writes.
async function commitCreationProjections(writes: SessionProjection[], verify?: (transaction: Transaction) => Promise<void>) {
  await runSessionTransaction(async transaction => {
    await verify?.(transaction);
    const session = await transaction.get(writes[0].ref);
    const stored = session.data();
    if (!session.exists || ["completed", "interrupted", "failed"].includes(stored?.status)) {
      throw new SessionCreationConflict("Session ended while starting; retry the same key.");
    }
    const live = (await rtdb.ref(`activeBuses/${stored!.busId}_${stored!.routeId}`).once("value"))
      .val() as Record<string, unknown> | null;
    if (live?.sessionId !== writes[0].ref.id || live.status !== "active" || live.tripState === "completed") {
      throw new SessionCreationConflict("Live session changed while starting; retry the same key.");
    }
    const active = writes[1] ? await transaction.get(writes[1].ref) : null;
    const activeData = active?.data();
    if (active?.exists && activeData?.sessionId !== writes[0].ref.id) {
      throw new SessionCreationConflict("A different session owns the live projection.");
    }
    const sessionData = { ...writes[0].data };
    if (stored?.status === "active") sessionData.status = "active";
    if (stored?.status === "armed" && sessionData.status === "pending") sessionData.status = "armed";
    if (isRideDirection(stored?.direction)) {
      for (const field of ["direction", "directionState", "directionEndpointVersion", "originStopId", "destinationStopId"]) {
        if (stored[field] !== undefined) sessionData[field] = stored[field];
      }
    }
    for (const field of ["startTime", "activatedAt", "stopsReached"]) {
      if (stored?.[field] !== undefined &&
          (field !== "stopsReached" || Object.keys(stored[field] ?? {}).length > 0)) {
        sessionData[field] = stored[field];
      }
    }
    transaction.set(writes[0].ref, sessionData, { merge: true });
    if (writes[1]) {
      const data = { ...writes[1].data };
      if (activeData && normalizedDelayRevision(activeData.delayUpdatedAt) > normalizedDelayRevision(data.delayUpdatedAt)) {
        data.delayMinutes = activeData.delayMinutes;
        data.delayUpdatedAt = activeData.delayUpdatedAt;
      }
      if (normalizedDelayRevision(live.delayUpdatedAt) > normalizedDelayRevision(data.delayUpdatedAt)) {
        data.delayMinutes = normalizedDelayMinutes(live.delayMinutes);
        data.delayUpdatedAt = normalizedDelayRevision(live.delayUpdatedAt);
      }
      if (activeData?.tripState === "in_service") data.tripState = "in_service";
      if (Number.isInteger(activeData?.currentStopIndex) && Number(activeData?.currentStopIndex) > Number(data.currentStopIndex)) {
        data.currentStopIndex = activeData?.currentStopIndex;
      }
      if (activeData?.hasDepartedOrigin === true) data.hasDepartedOrigin = true;
      transaction.set(writes[1].ref, data, { merge: true });
    }
  });
}

export function activeRideId(busId: string, routeId: string): string {
  return `${busId}_${routeId}`;
}

export function normalizedDelayRevision(value: unknown): number {
  return Number.isSafeInteger(value) && Number(value) >= 0
    ? Number(value)
    : 0;
}

export function normalizedDelayMinutes(value: unknown): number {
  return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 1440
    ? Number(value)
    : 0;
}

export function activeBusLockRef(busId: string) {
  return db.collection("_active_bus_locks").doc(busId);
}

export async function releaseActiveBusLock(busId: string, sessionId: string): Promise<void> {
  const lockRef = activeBusLockRef(busId);
  await runSessionTransaction(async (transaction) => {
    const lock = await transaction.get(lockRef);
    if (lock.data()?.sessionId === sessionId) transaction.delete(lockRef);
  });
}


/** Shared domain operation. HTTP callers authorize first; device callers additionally fence every creation transaction. */
export async function startAssignedService(assignment: ServiceAssignment, options: {
  principalScope: string; idempotencyKey?: string; automatic?: boolean; assignmentRevision?: number;
  verify?: (transaction: Transaction) => Promise<void>;
}): Promise<ServiceStartResult> {
  const guardedTransaction = <T>(work: (transaction: Transaction) => Promise<T>) => runSessionTransaction(async transaction => {
    await options.verify?.(transaction);
    return work(transaction);
  });
  const key = options.idempotencyKey;
  const keyRef = key ? db.collection("_ride_session_creation_keys").doc(
    createHash("sha256").update(`${options.principalScope}\0${key}`).digest("hex"),
  ) : null;
  const matchesAssignment = (value: Record<string, unknown>) =>
    value.busId === assignment.busId && value.routeId === assignment.routeId &&
    value.driverId === assignment.driverId;
  const bindingData = (sessionId: string) => ({
    ...assignment, sessionId, createdAt: FieldValue.serverTimestamp(),
  });
  const priorBinding = keyRef ? await keyRef.get() : null;
  const prior = priorBinding?.data();
  if (priorBinding?.exists && (!prior || !matchesAssignment(prior))) {
    throw new RideSessionStartError(409, "Idempotency key belongs to a different assignment.");
  }
  const pinnedSessionId = prior?.sessionId as string | undefined;
  if (pinnedSessionId) {
    const pinned = await db.collection("ride_sessions").doc(pinnedSessionId).get();
    if (!pinned.exists) {
      throw new RideSessionStartError(410, "The session for this idempotency key was deleted.");
    }
    const data = pinned.data();
    if (["completed", "interrupted", "failed"].includes(data?.status)) {
      if (options.automatic) {
        throw data?.status === "completed"
          ? new RideSessionStartError(409, "The prior automatic service is terminal; explicit operator recovery is required.", "terminal_session")
          : new RideSessionStartError(409, "The prior automatic service ended early.", "interrupted_session");
      }
      const direction = isRideDirection(data?.direction) ? data.direction : null;
      return { ...{ sessionId: pinnedSessionId, resumed: true, direction, pending: !direction }, created: false };
    }
  }
  const nodeRef = rtdb.ref(`activeBuses/${assignment.busId}_${assignment.routeId}`);
  const current = (await nodeRef.once("value")).val() as Record<string, unknown> | null;
  if (options.automatic && (current?.tripState === "completed" || current?.tripState === "interrupted" ||
      current?.automaticServicePaused === true || typeof current?.retiredAssignmentRevision === "number" ||
      Number(current?.assignmentRevision ?? 0) !== Number(options.assignmentRevision ?? 0))) {
    throw new RideSessionStartError(409, "Automatic service is paused or awaiting terminal recovery.");
  }
  if (keyRef && pinnedSessionId && pinnedSessionId === current?.sessionId && current?.tripState === "completed") {
    throw new RideSessionStartError(409, "The original session is awaiting completion recovery.");
  }
  if (pinnedSessionId && current?.status === "active" &&
      current.tripState !== "completed" && current.sessionId !== pinnedSessionId) {
    throw new RideSessionStartError(409, "The original session is awaiting lifecycle recovery.");
  }
  if (
    current?.status === "active" &&
    current?.tripState !== "completed" &&
    current?.driverId === assignment.driverId &&
    typeof current.sessionId === "string" &&
    SAFE_ID.test(current.sessionId)
  ) {
    const direction = isRideDirection(current.direction) ? current.direction : null;
    const sessionStatus = direction
      ? current.tripState === "pre_departure" ? "armed" : "active"
      : "pending";
    const lockRef = activeBusLockRef(assignment.busId);
    const lockClaimed = await guardedTransaction(async (transaction) => {
      const binding = keyRef ? await transaction.get(keyRef) : null;
      const lock = await transaction.get(lockRef);
      const session = await transaction.get(db.collection("ride_sessions").doc(current.sessionId as string));
      if (binding?.exists && (!matchesAssignment(binding.data()!) || binding.data()?.sessionId !== current.sessionId)) return false;
      if ((keyRef && !session.exists) || (session.exists && ["completed", "interrupted", "failed"].includes(session.data()?.status))) return false;
      if (lock.exists && lock.data()?.sessionId !== current.sessionId) return false;
      if (keyRef && !binding?.exists) transaction.create(keyRef, bindingData(current.sessionId as string));
      transaction.set(lockRef, {
        busId: assignment.busId,
        routeId: assignment.routeId,
        driverId: assignment.driverId,
        sessionId: current.sessionId,
        direction,
        updatedAt: FieldValue.serverTimestamp(),
      });
      return true;
    });
    if (!lockClaimed) {
      throw new RideSessionStartError(409, "This bus already has an active shift on another route.");
    }
    const projections = [
      { ref: db.collection("ride_sessions").doc(current.sessionId), data: {
        id: current.sessionId,
        busId: assignment.busId,
        driverId: assignment.driverId,
        routeId: assignment.routeId,
        status: sessionStatus,
        direction,
        directionState: direction ? "resolved" : "pending",
        originStopId: typeof current.originStopId === "string" ? current.originStopId : null,
        destinationStopId: typeof current.destinationStopId === "string" ? current.destinationStopId : null,
      } },
      ...(direction ? [{ ref: db.collection("active_rides")
        .doc(activeRideId(assignment.busId, assignment.routeId)), data: {
          sessionId: current.sessionId,
          busId: assignment.busId,
          driverId: assignment.driverId,
          routeId: assignment.routeId,
          status: "active",
          direction,
          originStopId: typeof current.originStopId === "string" ? current.originStopId : null,
          destinationStopId: typeof current.destinationStopId === "string" ? current.destinationStopId : null,
          tripState:
            current.tripState === "in_service"
              ? "in_service"
              : "pre_departure",
          currentStopIndex: Number.isInteger(current.currentStopIndex)
            ? current.currentStopIndex
            : 0,
          hasDepartedOrigin: current.hasDepartedOrigin === true,
          delayMinutes: normalizedDelayMinutes(current.delayMinutes),
          delayUpdatedAt: normalizedDelayRevision(current.delayUpdatedAt),
          updatedAt: FieldValue.serverTimestamp(),
        } }] : []),
    ];
    if (keyRef) {
      await commitCreationProjections(projections, options.verify);
    } else {
      await Promise.all(projections.map(projection => projection.ref.set(projection.data, { merge: true })));
    }
    await completeAutomaticSetup(nodeRef, current.sessionId as string, options.automatic);
    return { ...{
      sessionId: current.sessionId,
      resumed: true,
      direction,
      pending: !direction,
    }, created: false };
  }
  // A completed ride is terminal: the live node still reports
  // status="active" until the engine's 30s cleanup, but it must never be
  // resurrected. Fall through to a fresh start below.
  if (
    current?.status === "active" &&
    current?.tripState !== "completed" &&
    typeof current?.sessionId === "string" &&
    SAFE_ID.test(current.sessionId)
  ) {
    throw new RideSessionStartError(409, "This bus already has an active shift.");
  }

  const routeDoc = await db.collection("routes").doc(assignment.routeId).get();
  const routeStops = routeDoc.data()?.stops;
  const naturalStops = Array.isArray(routeStops) ? routeStops : [];
  if (naturalStops.length < 2) {
    throw new RideSessionStartError(422, "This route requires at least two valid ordered stops.");
  }
  const telemetryTimestamp = Number(current?.timestamp);
  const currentLat = Number(current?.lat);
  const currentLng = Number(current?.lng);
  if (
    !Number.isFinite(currentLat) ||
    !Number.isFinite(currentLng) ||
    !Number.isFinite(telemetryTimestamp) ||
    Date.now() - telemetryTimestamp > 60_000 ||
    telemetryTimestamp > Date.now() + 10_000
    || (options.automatic && (current?.motionState === "uncertain" || typeof current?.gpsHdop !== "number" ||
      !Number.isFinite(current.gpsHdop) || current.gpsHdop < 0 || current.gpsHdop > 4))
  ) {
    throw new RideSessionStartError(409, "A fresh hardware GNSS fix is required before starting a shift.");
  }
  const routeEndpointVersion = endpointSnapshotVersion(naturalStops);
  if (routeEndpointVersion === null) {
    throw new RideSessionStartError(422, "This route requires at least two valid ordered stops.");
  }
  const inferredDirection = inferRideDirectionFromTelemetry(
    naturalStops,
    {
      now: Date.now(),
      timestamp: telemetryTimestamp,
      motionState: current?.motionState,
      gpsHdop: current?.gpsHdop,
      position: { lat: currentLat, lng: currentLng },
    },
  );
  // New sessions must never inherit the completed or provisional direction.
  const requestedDirection = inferredDirection;
  const stops = requestedDirection
    ? stopsInRideDirection(naturalStops, requestedDirection)
    : [];
  const origin = stops[0] ?? null;
  const destination = stops.at(-1) ?? null;
  const proposedSessionRef = db.collection("ride_sessions").doc();
  const lockRef = activeBusLockRef(assignment.busId);
  const proposedArmedAt = Date.now();
  const lockClaim = await guardedTransaction(async (transaction) => {
    const binding = keyRef ? await transaction.get(keyRef) : null;
    const lock = await transaction.get(lockRef);
    if (binding?.exists && (!matchesAssignment(binding.data()!) ||
        binding.data()?.sessionId !== lock.data()?.sessionId)) return null;
    if (pinnedSessionId && lock.data()?.sessionId !== pinnedSessionId) return null;
    if (keyRef && lock.exists && current?.tripState === "completed" && lock.data()?.sessionId === current.sessionId) return null;
    if (lock.exists) {
      const lockData = lock.data();
      if (
        lockData?.driverId !== assignment.driverId ||
        lockData?.routeId !== assignment.routeId ||
        typeof lockData.sessionId !== "string" ||
        !SAFE_ID.test(lockData.sessionId)
      ) {
        return null;
      }
      const existingSession = await transaction.get(
        db.collection("ride_sessions").doc(lockData.sessionId),
      );
      const session = existingSession.data();
      const sessionStatus = session?.status;
      if (
        !existingSession.exists ||
        (sessionStatus !== "pending" &&
          sessionStatus !== "armed" &&
          sessionStatus !== "active")
      ) {
        return null;
      }
      const existingDirection = isRideDirection(session?.direction)
        ? session.direction
        : null;
      if (existingDirection && requestedDirection && existingDirection !== requestedDirection) {
        return null;
      }
      const direction = existingDirection ?? requestedDirection;
      const resolvedStops = direction
        ? stopsInRideDirection(naturalStops, direction)
        : [];
      const resolvedOrigin = resolvedStops[0] ?? null;
      const resolvedDestination = resolvedStops.at(-1) ?? null;
      if (keyRef && !binding?.exists) transaction.create(keyRef, bindingData(lockData.sessionId));
      if (direction && !existingDirection) {
        transaction.set(db.collection("ride_sessions").doc(lockData.sessionId), {
          direction,
          directionState: "resolved",
          directionEndpointVersion: routeEndpointVersion,
          originStopId: typeof resolvedOrigin?.id === "string" ? resolvedOrigin.id : null,
          destinationStopId:
            typeof resolvedDestination?.id === "string" ? resolvedDestination.id : null,
          directionResolvedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
        transaction.set(lockRef, {
          direction,
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
      }
      // A deliberate manual start resumes automatic service, as a new shift does.
      if (!options.automatic) {
        transaction.set(db.collection("bus_locations").doc(assignment.busId), {
          automaticServicePaused: false, automaticServiceEpoch: FieldValue.increment(1),
        }, { merge: true });
      }
      return {
        sessionId: lockData.sessionId,
        armedAt: typeof session?.armedAt === "number" ? session.armedAt : proposedArmedAt,
        status: sessionStatus,
        created: false,
        direction,
      };
    }
    if (keyRef) transaction.create(keyRef, bindingData(proposedSessionRef.id));
    transaction.create(proposedSessionRef, {
      id: proposedSessionRef.id,
      busId: assignment.busId,
      driverId: assignment.driverId,
      routeId: assignment.routeId,
      direction: requestedDirection,
      directionState: requestedDirection ? "resolved" : "pending",
      directionEndpointVersion: requestedDirection ? routeEndpointVersion : null,
      originStopId: typeof origin?.id === "string" ? origin.id : null,
      destinationStopId: typeof destination?.id === "string" ? destination.id : null,
      armedAt: proposedArmedAt,
      status: "pending",
      passengers: {},
      stopsReached: {},
    });
    transaction.create(lockRef, {
      busId: assignment.busId,
      routeId: assignment.routeId,
      driverId: assignment.driverId,
      sessionId: proposedSessionRef.id,
      direction: requestedDirection,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    // A deliberate new shift consumes any earlier terminal recovery intent.
    transaction.set(db.collection("bus_locations").doc(assignment.busId), {
      terminalJourney: FieldValue.delete(),
      ...(!options.automatic ? { automaticServicePaused: false, automaticServiceEpoch: FieldValue.increment(1) } : {}),
    }, { merge: true });
    return {
      sessionId: proposedSessionRef.id,
      armedAt: proposedArmedAt,
      status: "pending" as const,
      created: true,
      direction: requestedDirection,
    };
  });
  if (!lockClaim) {
    throw new RideSessionStartError(409, "This bus already has an active shift on another route.");
  }
  const sessionRef = db.collection("ride_sessions").doc(lockClaim.sessionId);
  const armedAt = lockClaim.armedAt;
  const direction = lockClaim.direction;
  const claimedStops = direction
    ? stopsInRideDirection(naturalStops, direction)
    : [];
  const claimedOrigin = claimedStops[0] ?? null;
  const claimedDestination = claimedStops.at(-1) ?? null;
  let claimedTripState = direction && !options.automatic && current?.automaticServicePaused !== true ? "in_service" : "pre_departure";
  let claimedStopIndex = 0;
  let claimedHasDepartedOrigin = false;
  let claimedDelayMinutes = 0;
  let claimedDelayUpdatedAt = 0;
  if (!lockClaim.created && lockClaim.status !== "pending") {
    const recovery = await db.collection("active_rides")
      .doc(activeRideId(assignment.busId, assignment.routeId))
      .get();
    const recoveryData = recovery.data();
    if (!recovery.exists || recoveryData?.sessionId !== sessionRef.id) {
      throw new RideSessionStartError(409, "The existing ride is awaiting lifecycle recovery. Retry after telemetry reconnects.");
    }
    claimedTripState = recoveryData.tripState === "in_service"
      ? "in_service"
      : "pre_departure";
    claimedStopIndex = Number.isInteger(recoveryData.currentStopIndex)
      ? recoveryData.currentStopIndex
      : 0;
    claimedHasDepartedOrigin = recoveryData.hasDepartedOrigin === true;
    claimedDelayMinutes = normalizedDelayMinutes(recoveryData.delayMinutes);
    claimedDelayUpdatedAt = normalizedDelayRevision(recoveryData.delayUpdatedAt);
  }

  // Preserve the RTDB claim, pending session and bus lock on an ambiguous
  // Firestore failure. A retry enters the idempotent resume branch and
  // repairs the durable projections; eager rollback could undo a commit
  // whose response was lost.

  // Claim the live vehicle atomically. Two near-simultaneous start
  // requests may both pass the initial read, but only one session is
  // allowed to replace a node that has no active session. A completed
  // node is terminal and may be claimed by a fresh session (the engine
  // cancels its pending completion cleanup once tripState changes).
  const claim = await nodeRef.transaction((liveValue) => {
    const live = liveValue as Record<string, unknown> | null;
    if (options.automatic && (live?.tripState === "completed" || live?.tripState === "interrupted" ||
        live?.automaticServicePaused === true || typeof live?.retiredAssignmentRevision === "number" ||
        Number(live?.assignmentRevision ?? 0) !== Number(current?.assignmentRevision ?? 0))) return;
    if (keyRef && live?.sessionId === sessionRef.id && live.tripState === "completed") return;
    if (
      live?.status === "active" &&
      live?.tripState !== "completed" &&
      typeof live.sessionId === "string" &&
      live.sessionId.length > 0
    ) {
      return;
    }
    return {
      ...withoutLiveRouteContext(live),
      busId: assignment.busId,
      driverId: assignment.driverId,
      routeId: assignment.routeId,
      direction,
      directionState: direction ? "resolved" : "pending",
      directionEndpointVersion: direction ? routeEndpointVersion : null,
      originStopId: typeof claimedOrigin?.id === "string" ? claimedOrigin.id : null,
      destinationStopId:
        typeof claimedDestination?.id === "string" ? claimedDestination.id : null,
      sessionId: sessionRef.id,
      status: "active",
      deviceState: "online",
      automaticServicePaused: false,
      automaticServiceState: null,
      serviceSetupPending: options.automatic === true,
      tripState: claimedTripState,
      hasDepartedOrigin: claimedHasDepartedOrigin,
      currentStopIndex: claimedStopIndex,
      delayMinutes: claimedDelayMinutes,
      delayUpdatedAt: claimedDelayUpdatedAt,
      automaticTurnaround: false,
      previousSessionId: null,
      completedAt: null,
      turnaroundEligibleAt: null,
      turnaroundClaimId: null,
      turnaroundClaimedAt: null,
      lifecycleUpdatedAt: { ".sv": "timestamp" },
    };
  });
  if (!claim.committed) {
    const winner = claim.snapshot.val() as Record<string, unknown> | null;
    if (keyRef && winner?.sessionId === sessionRef.id && winner.tripState === "completed") {
      throw new RideSessionStartError(409, "The original session is awaiting completion recovery.");
    }
    if (
      winner?.driverId === assignment.driverId &&
      winner.sessionId === sessionRef.id
    ) {
      return { ...{
        sessionId: winner.sessionId,
        resumed: true,
        direction: isRideDirection(winner.direction) ? winner.direction : null,
        pending: !isRideDirection(winner.direction),
      }, created: false };
    }
    // A reused claim belongs to an existing session. This request did not
    // create that lock, so it must not fail the session or release its
    // lock merely because a different live session won the RTDB race.
    if (lockClaim.created) {
      // One commit: a failed session must never keep owning the bus lock,
      // because only non-terminal sessions are reconciled later.
      const failedAt = Date.now();
      await runSessionTransaction(async (transaction) => {
        const lock = await transaction.get(lockRef);
        transaction.set(sessionRef, {
          status: "failed",
          endTime: failedAt,
          failureReason: "shift_conflict",
        }, { merge: true });
        if (lock.data()?.sessionId === sessionRef.id) transaction.delete(lockRef);
      });
    }
    throw new RideSessionStartError(409, "This bus already has an active shift.");
  }
  const activeRideRef = db.collection("active_rides")
    .doc(activeRideId(assignment.busId, assignment.routeId));
  const batch = db.batch();
  const projectionWrites: { ref: typeof sessionRef; data: Record<string, unknown>; merge?: boolean }[] = [];
  const writeProjection = (ref: typeof sessionRef, data: Record<string, unknown>, options?: { merge: boolean }) => {
    projectionWrites.push({ ref, data, merge: options?.merge });
    if (options) batch.set(ref, data, options);
    else batch.set(ref, data);
  };
  writeProjection(sessionRef, {
    status: direction
      ? (claimedTripState === "in_service" ? "active" : "armed")
      : "pending",
    armedAt,
    direction,
    directionState: direction ? "resolved" : "pending",
    directionEndpointVersion: direction ? routeEndpointVersion : null,
    originStopId: typeof claimedOrigin?.id === "string" ? claimedOrigin.id : null,
    destinationStopId:
      typeof claimedDestination?.id === "string" ? claimedDestination.id : null,
    ...(direction && claimedTripState === "in_service" && lockClaim.created
      ? {
          startTime: armedAt,
          activatedAt: FieldValue.serverTimestamp(),
          stopsReached: {
            0: {
              stopIndex: 0,
              stopId: typeof claimedOrigin?.id === "string" ? claimedOrigin.id : "",
              stopName: typeof claimedOrigin?.name === "string" ? claimedOrigin.name : "",
              timestamp: FieldValue.serverTimestamp(),
            },
          },
        }
      : {}),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  if (direction) {
    writeProjection(activeRideRef, {
      sessionId: sessionRef.id,
      busId: assignment.busId,
      driverId: assignment.driverId,
      routeId: assignment.routeId,
      status: "active",
      direction,
      originStopId: typeof claimedOrigin?.id === "string" ? claimedOrigin.id : null,
      destinationStopId:
        typeof claimedDestination?.id === "string" ? claimedDestination.id : null,
      tripState: claimedTripState,
      currentStopIndex: claimedStopIndex,
      hasDepartedOrigin: claimedHasDepartedOrigin,
      delayMinutes: claimedDelayMinutes,
      delayUpdatedAt: claimedDelayUpdatedAt,
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
  if (keyRef) {
    await commitCreationProjections(projectionWrites, options.verify);
  } else {
    await batch.commit();
  }
  await completeAutomaticSetup(nodeRef, sessionRef.id, options.automatic);

  return {
    created: lockClaim.created,
    sessionId: sessionRef.id,
    resumed: !lockClaim.created,
    direction,
    pending: !direction,
  };
}
