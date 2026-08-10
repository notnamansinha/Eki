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
      `${constraint.fieldPath}:${constraint.op}:${JSON.stringify(constraint.value)}`,
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
