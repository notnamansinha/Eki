import {
  Bytes,
  DocumentReference,
  GeoPoint,
  Timestamp,
  type OrderByDirection,
  type WhereFilterOp,
} from "firebase/firestore";

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

export interface CollectionLoadError {
  code: string;
  message: string;
}

/**
 * Deterministic, type-aware encoding of a Firestore query value for cache
 * keys. JSON.stringify would collide distinct values (e.g. a `Date` and the
 * identical ISO string, or a Timestamp and a matching plain object), which
 * could make two different queries share one cache entry. Types get explicit
 * prefixes; plain-object keys are sorted for stability.
 */
function canonicalQueryValue(
  value: unknown,
  ancestors: Set<object>,
): unknown {
  if (value === null) return ["null"];
  if (typeof value === "string") return ["string", value];
  if (typeof value === "boolean") return ["boolean", value];
  if (typeof value === "number") {
    if (Number.isNaN(value)) return ["number", "NaN"];
    if (value === Number.POSITIVE_INFINITY) return ["number", "+Infinity"];
    if (value === Number.NEGATIVE_INFINITY) return ["number", "-Infinity"];
    if (Object.is(value, -0)) return ["number", "-0"];
    return ["number", value];
  }
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new TypeError("Firestore query values cannot contain an invalid Date.");
    }
    return ["date", value.toISOString()];
  }
  if (value instanceof Timestamp) {
    return ["timestamp", value.seconds, value.nanoseconds];
  }
  if (value instanceof DocumentReference) {
    return ["reference", value.path];
  }
  if (value instanceof GeoPoint) {
    return ["geopoint", value.latitude, value.longitude];
  }
  if (value instanceof Bytes) {
    return ["bytes", value.toBase64()];
  }
  if (typeof value !== "object" || value === undefined) {
    throw new TypeError(`Unsupported Firestore query value: ${typeof value}.`);
  }
  if (ancestors.has(value)) {
    throw new TypeError("Firestore query values cannot contain cycles.");
  }

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return [
        "array",
        value.map((entry) => canonicalQueryValue(entry, ancestors)),
      ];
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(
        `Unsupported Firestore query object: ${value.constructor?.name ?? "unknown"}.`,
      );
    }
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, entry]) => [
        key,
        canonicalQueryValue(entry, ancestors),
      ]);
    return ["map", entries];
  } finally {
    ancestors.delete(value);
  }
}

export function encodeQueryValue(value: unknown): string {
  return JSON.stringify(canonicalQueryValue(value, new Set()));
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
  const whereKey = (options.whereConstraints ?? []).map((constraint) => [
    constraint.fieldPath,
    constraint.op,
    encodeQueryValue(constraint.value),
  ]);
  return JSON.stringify(
    ["collection-query-v2", collectionName, orderByField, orderByDirection, maxResults, whereKey],
  );
}

/** Preserve the Firebase error code while producing a safe display message. */
export function normalizeCollectionError(
  collectionName: string,
  error: unknown,
): CollectionLoadError {
  const candidateCode = (error as { code?: unknown })?.code;
  const code = typeof candidateCode === "string" ? candidateCode : "unknown";
  if (code === "permission-denied") {
    return { code, message: `Permission denied reading ${collectionName}.` };
  }
  return { code, message: `Failed to load ${collectionName}.` };
}

/**
 * Human-readable error state for a failed collection listener, distinct from
 * "no data": consumers render this instead of an empty list.
 */
export function describeCollectionError(
  collectionName: string,
  error: unknown,
): string {
  return normalizeCollectionError(collectionName, error).message;
}
