export const DEFAULT_ABANDONED_RIDE_THRESHOLD_MS = 12 * 60 * 60 * 1000;
export const RECONCILABLE_RIDE_STATUSES = ["pending", "armed", "active"] as const;

const SECONDS_TO_MILLISECONDS_CUTOFF = 100_000_000_000;

export function timestampMillis(value: unknown): number | null {
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
  if (!value || typeof value !== "object") return null;

  const timestamp = value as {
    toMillis?: () => number;
    toDate?: () => Date;
    seconds?: number;
    nanoseconds?: number;
    _seconds?: number;
    _nanoseconds?: number;
  };
  if (typeof timestamp.toMillis === "function") {
    const millis = timestamp.toMillis();
    return Number.isFinite(millis) ? millis : null;
  }
  if (typeof timestamp.toDate === "function") {
    const millis = timestamp.toDate().getTime();
    return Number.isFinite(millis) ? millis : null;
  }
  const seconds = timestamp.seconds ?? timestamp._seconds;
  const nanoseconds = timestamp.nanoseconds ?? timestamp._nanoseconds ?? 0;
  if (!Number.isFinite(seconds) || !Number.isFinite(nanoseconds)) return null;
  return (seconds as number) * 1000 + (nanoseconds as number) / 1_000_000;
}

function recordValues(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is Record<string, unknown> =>
      Boolean(entry) && typeof entry === "object",
    );
  }
  if (!value || typeof value !== "object") return [];
  return Object.values(value).filter((entry): entry is Record<string, unknown> =>
    Boolean(entry) && typeof entry === "object",
  );
}

function activityValues(record: Record<string, unknown>): unknown[] {
  const values: unknown[] = [
    record.createdAt,
    record.armedAt,
    record.startTime,
    record.activatedAt,
    record.updatedAt,
  ];
  for (const stop of recordValues(record.stopsReached)) values.push(stop.timestamp);
  for (const point of recordValues(record.path)) values.push(point.timestamp);
  for (const passenger of recordValues(record.passengers)) values.push(passenger.joinedAt);
  return values;
}

export function latestSessionActivity(record: Record<string, unknown>): number | null {
  const times = activityValues(record)
    .map(timestampMillis)
    .filter((value): value is number => value !== null);
  return times.length > 0 ? Math.max(...times) : null;
}

export function latestActiveRideActivity(record: Record<string, unknown>): number | null {
  const times = [record.updatedAt, record.createdAt]
    .map(timestampMillis)
    .filter((value): value is number => value !== null);
  return times.length > 0 ? Math.max(...times) : null;
}

export function latestLiveBusActivity(record: Record<string, unknown>): number | null {
  const times = [record.timestamp, record.receivedAt, record.lifecycleUpdatedAt]
    .map(timestampMillis)
    .filter((value): value is number => value !== null);
  return times.length > 0 ? Math.max(...times) : null;
}

export function matchingSession(
  record: Record<string, unknown> | null | undefined,
  sessionId: string,
): boolean {
  return record?.sessionId === sessionId;
}

export interface ReconciliationDecision {
  stale: boolean;
  lastActivity: number | null;
  reason: "stale" | "terminal" | "recent" | "unknown_activity";
}

export function reconciliationDecision(
  sessionId: string,
  session: Record<string, unknown>,
  activeRide: Record<string, unknown> | null,
  liveBus: Record<string, unknown> | null,
  cutoff: number,
): ReconciliationDecision {
  if (!RECONCILABLE_RIDE_STATUSES.includes(
    session.status as (typeof RECONCILABLE_RIDE_STATUSES)[number],
  )) {
    return { stale: false, lastActivity: null, reason: "terminal" };
  }

  const sessionActivity = latestSessionActivity(session);
  const matchingActiveRide = matchingSession(activeRide, sessionId);
  const matchingLiveBus = matchingSession(liveBus, sessionId);
  const activeRideActivity = matchingActiveRide
    ? latestActiveRideActivity(activeRide!)
    : null;
  const liveBusActivity = matchingLiveBus ? latestLiveBusActivity(liveBus!) : null;

  // A matching lifecycle record without any interpretable timestamp is not
  // safe to destroy automatically.
  if (
    (matchingActiveRide && activeRideActivity === null) ||
    (matchingLiveBus && liveBusActivity === null)
  ) {
    return { stale: false, lastActivity: sessionActivity, reason: "unknown_activity" };
  }

  const activities = [sessionActivity, activeRideActivity, liveBusActivity]
    .filter((value): value is number => value !== null);
  if (activities.length === 0) {
    return { stale: false, lastActivity: null, reason: "unknown_activity" };
  }
  const lastActivity = Math.max(...activities);
  return lastActivity <= cutoff
    ? { stale: true, lastActivity, reason: "stale" }
    : { stale: false, lastActivity, reason: "recent" };
}
