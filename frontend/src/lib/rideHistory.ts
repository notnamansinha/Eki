export interface FirestoreTimestampLike {
  toDate?: () => Date;
  toMillis?: () => number;
  seconds?: number;
  nanoseconds?: number;
  _seconds?: number;
  _nanoseconds?: number;
}

export type TimestampValue =
  | number
  | Date
  | FirestoreTimestampLike
  | null
  | undefined;

export interface RideStopRecord {
  stopIndex: number;
  stopId: string;
  stopName: string;
  timestamp: TimestampValue;
}

export interface StopNameRecord {
  id?: unknown;
  name?: unknown;
}

export interface RideHistorySortable {
  id: string;
  armedAt?: TimestampValue;
  startTime?: TimestampValue;
}

export const ARRIVAL_STOP_UNAVAILABLE = "Arrival stop unavailable";
export const RIDE_HISTORY_DELETE_WARNING =
  "The passenger manifest, route log, and messages will be permanently deleted. This cannot be undone.";

const DELETABLE_RIDE_STATUSES = new Set(["completed", "interrupted", "failed"]);

export type RideHistoryDeletionState = "idle" | "confirming" | "deleting";
export type RideHistoryDeletionAction =
  | "open"
  | "cancel"
  | "confirm"
  | "failure"
  | "success";

export function canDeleteRideHistory(status: string): boolean {
  return DELETABLE_RIDE_STATUSES.has(status);
}

export function rideHistoryDeletionTransition(
  state: RideHistoryDeletionState,
  action: RideHistoryDeletionAction,
): RideHistoryDeletionState {
  if (state === "idle" && action === "open") return "confirming";
  if (state === "confirming" && action === "cancel") return "idle";
  if (state === "confirming" && action === "confirm") return "deleting";
  if (state === "deleting" && action === "failure") return "confirming";
  if (state === "deleting" && action === "success") return "idle";
  return state;
}

const SECONDS_TO_MILLISECONDS_CUTOFF = 100_000_000_000;

export function timestampMillis(value: TimestampValue): number | null {
  if (value == null) return null;
  if (value instanceof Date) {
    const millis = value.getTime();
    return Number.isFinite(millis) ? millis : null;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    return Math.abs(value) < SECONDS_TO_MILLISECONDS_CUTOFF
      ? value * 1000
      : value;
  }
  if (typeof value.toMillis === "function") {
    const millis = value.toMillis();
    return Number.isFinite(millis) ? millis : null;
  }
  if (typeof value.toDate === "function") {
    const millis = value.toDate().getTime();
    return Number.isFinite(millis) ? millis : null;
  }
  const seconds = value.seconds ?? value._seconds;
  const nanoseconds = value.nanoseconds ?? value._nanoseconds ?? 0;
  if (!Number.isFinite(seconds) || !Number.isFinite(nanoseconds)) return null;
  return (seconds as number) * 1000 + (nanoseconds as number) / 1_000_000;
}

export function timestampDate(value: TimestampValue): Date | null {
  const millis = timestampMillis(value);
  return millis === null ? null : new Date(millis);
}

/**
 * Combines the armedAt and startTime queries used by Admin History. Firestore
 * orderBy omits documents without that field, so either query alone loses
 * valid sessions: armed-but-not-started rides or older started records.
 */
export function mergeRideHistorySessions<T extends RideHistorySortable>(
  armedSessions: T[],
  startedSessions: T[],
  limit = 100,
): T[] {
  const byId = new Map<string, T>();
  for (const session of [...startedSessions, ...armedSessions]) {
    byId.set(session.id, session);
  }
  return [...byId.values()]
    .sort((left, right) => {
      const leftTime = timestampMillis(left.armedAt ?? left.startTime) ?? 0;
      const rightTime = timestampMillis(right.armedAt ?? right.startTime) ?? 0;
      return rightTime - leftTime;
    })
    .slice(0, limit);
}

/**
 * Legacy sessions may contain the same stop more than once under different
 * array/object keys. Prefer the earliest record with a valid timestamp. Route
 * index is authoritative because circular routes may revisit a stop ID;
 * stop ID is only a fallback for malformed records without a valid index.
 */
export function dedupeStopRecords(stops: RideStopRecord[]): RideStopRecord[] {
  const chronological = [...stops].sort((left, right) => {
    const leftTime = timestampMillis(left.timestamp) ?? Number.POSITIVE_INFINITY;
    const rightTime = timestampMillis(right.timestamp) ?? Number.POSITIVE_INFINITY;
    return leftTime - rightTime;
  });
  const seenIndexes = new Set<number>();
  const seenIds = new Set<string>();
  const unique: RideStopRecord[] = [];

  for (const stop of chronological) {
    const hasIndex = Number.isInteger(stop.stopIndex);
    const stopId = typeof stop.stopId === "string" ? stop.stopId : "";
    const hasId = stopId.length > 0;
    if (
      (hasIndex && seenIndexes.has(stop.stopIndex)) ||
      (!hasIndex && hasId && seenIds.has(stopId))
    ) {
      continue;
    }
    unique.push({ ...stop, stopId });
    if (hasIndex) seenIndexes.add(stop.stopIndex);
    if (!hasIndex && hasId) seenIds.add(stopId);
  }

  return unique.sort((left, right) => {
    if (left.stopIndex !== right.stopIndex) return left.stopIndex - right.stopIndex;
    return (
      (timestampMillis(left.timestamp) ?? Number.POSITIVE_INFINITY) -
      (timestampMillis(right.timestamp) ?? Number.POSITIVE_INFINITY)
    );
  });
}

export function destinationReachedAt(
  destinationStopId: string | null,
  recordedAt: TimestampValue,
  stops: RideStopRecord[],
): number | null {
  if (!destinationStopId) return null;
  const passengerTime = timestampMillis(recordedAt);
  if (passengerTime === null) return null;
  const destination = stops.find(
    (stop) => typeof stop.stopId === "string" && stop.stopId === destinationStopId,
  );
  const destinationTime = timestampMillis(destination?.timestamp);
  return destinationTime !== null && destinationTime >= passengerTime
    ? destinationTime
    : null;
}

export function resolveArrivalStopName(
  arrivalStopId: string | null | undefined,
  historicalStops: RideStopRecord[],
  currentRouteStops: readonly StopNameRecord[],
): string {
  if (!arrivalStopId) return ARRIVAL_STOP_UNAVAILABLE;

  const historicalName = historicalStops.find(
    (stop) => stop.stopId === arrivalStopId &&
      typeof stop.stopName === "string" &&
      stop.stopName.trim().length > 0,
  )?.stopName;
  if (typeof historicalName === "string") return historicalName.trim();

  const currentName = currentRouteStops.find(
    (stop) => stop.id === arrivalStopId &&
      typeof stop.name === "string" &&
      stop.name.trim().length > 0,
  )?.name;
  return typeof currentName === "string"
    ? currentName.trim()
    : ARRIVAL_STOP_UNAVAILABLE;
}
