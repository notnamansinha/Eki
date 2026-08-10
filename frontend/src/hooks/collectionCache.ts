import type { OrderByDirection, WhereFilterOp } from "firebase/firestore";

/** One Firestore equality/range clause; fieldPath is a plain dotted path. */
export interface WhereConstraint {
  fieldPath: string;
  op: WhereFilterOp;
  value: unknown;
}

export interface CollectionOptions {
  maxResults?: number;
  orderByDirection?: OrderByDirection;
  orderByField?: string;
  whereConstraints?: WhereConstraint[];
}

/**
 * Deterministic, type-aware encoding of a Firestore query value for cache
 * keys. JSON.stringify would collide distinct values (e.g. a `Date` and the
 * identical ISO string, or a Timestamp and a matching plain object), which
 * could make two different queries share one cache entry. Types get explicit
 * prefixes; plain-object keys are sorted for stability.
 */
export function encodeQueryValue(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "string") return `s:${value}`;
  if (typeof value === "number") return `n:${value}`;
  if (typeof value === "boolean") return `b:${value}`;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? "d:invalid" : `d:${value.toISOString()}`;
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => encodeQueryValue(entry)).join(",")}]`;
  }
  if (typeof value === "object") {
    // Firestore Timestamp-like values are compared by seconds+nanoseconds;
    // encode them explicitly so a Timestamp never collides with a plain object.
    const objectKeys = Object.keys(value as object);
    const seconds = (value as { seconds?: unknown }).seconds;
    const nanoseconds = (value as { nanoseconds?: unknown }).nanoseconds;
    if (
      objectKeys.length === 2 &&
      typeof seconds === "number" &&
      typeof nanoseconds === "number" &&
      "seconds" in (value as object) &&
      "nanoseconds" in (value as object)
    ) {
      return `t:${seconds}:${nanoseconds}`;
    }
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, entry]) => `${key}=${encodeQueryValue(entry)}`);
    return `{${entries.join(",")}}`;
  }
  return `u:${String(value)}`;
}

/**
 * Deterministic cache key for a collection query.
 *
 * Every query dimension must be part of the key: collection, orderBy, limit
 * AND the where constraints. Before constraints were included (#46), two
 * consumers querying the same collection with different filters could share
 * one cache entry and silently see the other's data. Constraint order is
 * significant because Firestore semantics are order-dependent.
 */
export function buildCollectionCacheKey(
  collectionName: string,
  options: CollectionOptions,
): string {
  const maxResults = options.maxResults ?? 250;
  const orderByField = options.orderByField ?? "";
  const orderByDirection = options.orderByDirection ?? "asc";
  const whereKey = (options.whereConstraints ?? [])
    .map((constraint) =>
      `${constraint.fieldPath}:${constraint.op}:${encodeQueryValue(constraint.value)}`,
    )
    .join("|");
  return [collectionName, orderByField, orderByDirection, maxResults, whereKey].join(
    ":",
  );
}

/**
 * Human-readable error state for a failed collection listener, distinct from
 * "no data": consumers render this instead of an empty list.
 */
export function describeCollectionError(
  collectionName: string,
  error: unknown,
): string {
  const code = (error as { code?: string })?.code;
  if (code === "permission-denied") {
    return `Permission denied reading ${collectionName}.`;
  }
  return `Failed to load ${collectionName}.`;
}
